// lib/services/scanService.js — port of service/ScanService.java
const { sql } = require('../db');
const { ApiError, generateId, SCAN_PLAN } = require('../util');
const scanPurchase = require('./scanPurchase');
const ai = require('./ai');

const ALLOWED_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp']);

function rowToResult(row) {
  if (!row) return null;
  return {
    id: row.id,
    purchaseId: row.purchase_id,
    email: row.email,
    scanPlan: row.scan_plan,
    totalPicksDetected: row.total_picks_detected,
    picksAnalyzed: row.picks_analyzed,
    predictions: row.predictions,
    coverageNote: row.coverage_note,
    rawModelOutput: row.raw_model_output,
    createdAt: row.created_at,
  };
}

function buildCoverageNote(plan, totalDetected, analyzed, unpredicted, flagged) {
  let note;
  if (plan.maxPicks < 0) {
    if (unpredicted > 0) {
      note = `Full coverage attempted — ${analyzed} of ${totalDetected} picks predicted; ${unpredicted} pick(s) could not be analysed and are listed below.`;
    } else {
      note = `Full coverage plan - all ${analyzed} detected pick(s) analyzed.`;
    }
  } else if (totalDetected > analyzed) {
    note = `${analyzed} of ${totalDetected} picks covered on the ${plan.name} plan. Upgrade to a higher tier for more picks per slip.`;
  } else {
    note = `${analyzed} of ${totalDetected} picks covered.`;
  }
  if (flagged > 0) note += ` ${flagged} pick(s) could not be confirmed — check the flagged rows against your slip.`;
  return note;
}

function buildCoverageNoteWithRecovered(plan, totalDetected, analyzed, unpredicted, flagged, recovered) {
  let note = buildCoverageNote(plan, totalDetected, analyzed, unpredicted, flagged);
  if (recovered > 0) note += ` ${recovered} pick(s) recovered on a second look — check them against your slip.`;
  return note;
}

function computeMissing(predictions, total) {
  const t = Number(total) || 0;
  if (!t || t <= 0) return [];
  const covered = new Set();
  for (const p of predictions || []) {
    const idx = Number(p.sectionIndex);
    if (Number.isFinite(idx) && idx >= 1 && idx <= t) covered.add(idx);
  }
  const missing = [];
  for (let i = 1; i <= t; i++) if (!covered.has(i)) missing.push(i);
  return missing;
}

// Shared purchase + grant gate WITHOUT consuming. Every stage runs it,
// so a grant that lapses mid-flow fails the next stage with the same
// specific error as analyze() — never a generic failure, never a silent
// consume. Identical checks/messages to analyze(): ownership, status,
// image (when required), grant validity. requireImage=false for the
// finalize stage, which carries no upload.
async function gatePurchase(purchaseId, email, imageBuffer, contentType, requireImage) {
  const purchase = await scanPurchase.getById(purchaseId);
  if (purchase.email.toLowerCase() !== email.toLowerCase()) {
    throw new ApiError(`This scan purchase does not belong to ${email}`, 403);
  }
  if (purchase.status === 'PENDING') {
    throw new ApiError(
      'This scan purchase is still awaiting admin review. It becomes usable once approved.',
      409
    );
  }
  if (purchase.status === 'REJECTED') {
    throw new ApiError('This scan purchase was rejected. Buy a new scan to continue.', 409);
  }
  if (requireImage) {
    if (!imageBuffer || !imageBuffer.length) throw new ApiError('An image file is required', 400);
    if (!contentType || !ALLOWED_TYPES.has(contentType.toLowerCase())) {
      throw new ApiError('Unsupported image type. Allowed: image/jpeg, image/png, image/webp.', 400);
    }
  }
  // CREDIT GATE (2026-11-20): the wallet must hold at least 4 credits
  // to start a scan. The named purchase still has to be APPROVED (the
  // status checks above); the old 10-scan grant no longer gates
  // anything. The spend itself happens only in storeAnalysisResult,
  // after a completed analysis.
  const credits = require('./credits');
  await credits.requireCredits(email);
  return { purchase, plan: SCAN_PLAN[purchase.scanPlan] };
}

// Spend exactly once + store. Shared by analyze() and finalizeStage.
// The AI call already succeeded by the time this runs, so 4 credits
// are spent atomically from the wallet (the UPDATE itself is the
// claim — two concurrent last-credit scans cannot both succeed).
// Throws 403 CREDITS_EXHAUSTED when the balance dropped below 5
// between gate and claim — nothing is stored and nothing is spent.
async function storeAnalysisResult(purchaseId, email, plan, analysis) {
  const db = sql();
  const id = generateId();
  const credits = require('./credits');
  const creditsLeft = await credits.spendCredits(email, { reason: 'SCAN', ref: 'SCAN_RESULT_' + id });
  // picksAnalyzed counts REAL calls only (1/X/2). Entries the AI could
  // not predict ('unpredicted' / 'unreadable') are listed explicitly in
  // the result but never counted as analysed — the header stays honest.
  const realCalls = analysis.predictions.filter((p) => ai.isRealCall(p.prediction)).length;
  const unpredicted = analysis.predictions.length - realCalls;
  const flagged = analysis.predictions.filter((p) => p.verification === 'mismatch' || p.verification === 'unverified').length;
  const recovered = analysis.predictions.filter((p) => p.recovered === true).length;
  const coverageNote = buildCoverageNoteWithRecovered(plan, analysis.totalPicksDetected, realCalls, unpredicted, flagged, recovered);
  await db`
    INSERT INTO scan_results (id, purchase_id, email, scan_plan, total_picks_detected, picks_analyzed, predictions, coverage_note, raw_model_output)
    VALUES (${id}, ${purchaseId}, ${email}, ${plan.name}, ${analysis.totalPicksDetected}, ${realCalls}, ${JSON.stringify(analysis.predictions)}, ${coverageNote}, ${analysis.rawModelOutput || null})
  `;
  const result = await getById(id);
  result.credits = { ...credits.summary(creditsLeft), spent: credits.COST_PER_USE };
  return result;
}

async function analyze(purchaseId, email, imageBuffer, contentType) {
  const { plan } = await gatePurchase(purchaseId, email, imageBuffer, contentType, true);
  const base64 = imageBuffer.toString('base64');

  // The AI call runs BEFORE any consumption: a failed analysis (AI not
  // configured, provider error, unparsable slip) consumes NOTHING.
  const analysis = await ai.analyzeSlip(base64, contentType, plan);

  // Spend 4 credits from the wallet (atomic claim — a concurrent
  // last-credit scan cannot also succeed). If the balance dropped
  // below 5 between gate and claim, no result is stored.
  return storeAnalysisResult(purchaseId, email, plan, analysis);
}

// --- Staged scan pipeline (async, past the 60s function wall) --------
// Each stage is its own /api/scan/stage/* invocation, each comfortably
// under 60s; the client orchestrates and shows real stage progress.
// No stage consumes anything — consumption happens only in
// finalizeStage, after a completed analysis, exactly like analyze().

// Stage 1: first read only. Returns picks + the model that actually
// served them (the verification stage must differ from it).
async function transcribeStage(purchaseId, email, imageBuffer, contentType) {
  const { plan } = await gatePurchase(purchaseId, email, imageBuffer, contentType, true);
  const base64 = imageBuffer.toString('base64');
  const { analysis, servingModel } = await ai.transcribeFirst(base64, contentType, plan);
  return {
    picks: analysis.predictions,
    totalPicksDetected: analysis.totalPicksDetected,
    servingModel: servingModel || null,
    missingPositions: computeMissing(analysis.predictions, analysis.totalPicksDetected),
  };
}

// Stage 2: one gap-fill round for still-missing positions. A provider
// failure is NON-fatal (mirrors analyzeSlip's break): picks come back
// unchanged with gapfillFailed=true and the caller proceeds to verify,
// which lists the rest as unpredicted — never omitted, never faked.
async function gapFillStage(purchaseId, email, imageBuffer, contentType, predictions, totalPicksDetected) {
  const { plan } = await gatePurchase(purchaseId, email, imageBuffer, contentType, true);
  const base64 = imageBuffer.toString('base64');
  const analysis = {
    totalPicksDetected: totalPicksDetected || 0,
    predictions: (predictions || []).map((p) => ({ ...p })),
  };
  const { recovered, failed } = await ai.gapFillOnce(base64, contentType, plan, analysis);
  const merged = analysis.predictions.slice().sort((a, b) => (a.sectionIndex || 0) - (b.sectionIndex || 0));
  return {
    picks: merged,
    totalPicksDetected: analysis.totalPicksDetected,
    recoveredPositions: recovered,
    missingPositions: computeMissing(merged, analysis.totalPicksDetected),
    gapfillFailed: failed,
  };
}

// Stage 3: unpredicted-fill + sanitize + diverse verification. No
// consumption; a failed double-check flags picks unverified, never fails
// the stage.
async function verifyStage(purchaseId, email, imageBuffer, contentType, predictions, totalPicksDetected, servingModel) {
  const { plan } = await gatePurchase(purchaseId, email, imageBuffer, contentType, true);
  const base64 = imageBuffer.toString('base64');
  const analysis = await ai.verifyAnalysis(base64, contentType, plan, predictions, totalPicksDetected, servingModel || null);
  return {
    predictions: analysis.predictions,
    totalPicksDetected: analysis.totalPicksDetected,
  };
}

// Stage 4: validate + sanitize client-submitted predictions, consume
// exactly once, store. The submitted predictions can only ever affect
// the submitter's own record (purchase ownership + email match are
// enforced by the gate); shape is validated and sanitize re-applied so
// malformed rows cannot be stored as real calls.
async function finalizeStage(purchaseId, email, predictions, totalPicksDetected) {
  const { plan } = await gatePurchase(purchaseId, email, null, null, false);
  const clean = Array.isArray(predictions) ? predictions.slice(0, 500) : [];
  const analysis = {
    totalPicksDetected: Number(totalPicksDetected) || 0,
    predictions: ai.sanitizePredictions(clean.map((p) => ({
      sectionIndex: Number(p.sectionIndex) || 0,
      teamName: String(p.teamName || ''),
      matchLabel: String(p.matchLabel || p.teamName || ''),
      winningTeamName: String(p.winningTeamName || ''),
      originalPick: String(p.originalPick || ''),
      prediction: String(p.prediction || ''),
      accuracyPercent: Number(p.accuracyPercent) || 0,
      confidence: String(p.confidence || ''),
      reason: String(p.reason || p.analysis || ''),
      analysis: String(p.analysis || p.reason || ''),
      verification: p.verification,
      verificationNote: p.verificationNote,
      recovered: p.recovered === true,
    }))),
  };
  // Non-real rows carry no verification flag in the normal flow (verify
  // skips them); strip any client-submitted mismatch/unverified flag
  // from them so the coverage note's flagged count stays honest. Same
  // for the recovered flag: a row with no call has nothing recovered.
  for (const p of analysis.predictions) {
    if (!ai.isRealCall(p.prediction) && (p.verification === 'mismatch' || p.verification === 'unverified')) {
      delete p.verification;
      delete p.verificationNote;
    }
    if (!ai.isRealCall(p.prediction)) delete p.recovered;
  }
  if (!analysis.predictions.length) throw new ApiError('No predictions to save.', 400);
  return storeAnalysisResult(purchaseId, email, plan, analysis);
}

async function getById(id) {
  const db = sql();
  const rows = await db`SELECT * FROM scan_results WHERE id = ${id}`;
  const result = rowToResult(rows[0]);
  if (!result) throw new ApiError('Scan result not found', 404);
  return result;
}

async function getByPurchaseId(purchaseId) {
  const db = sql();
  const rows = await db`SELECT * FROM scan_results WHERE purchase_id = ${purchaseId} ORDER BY created_at DESC LIMIT 1`;
  const result = rowToResult(rows[0]);
  if (!result) throw new ApiError('No scan result yet for this purchase', 404);
  return result;
}

async function listForEmail(email) {
  const db = sql();
  const rows = await db`SELECT * FROM scan_results WHERE email = ${email} ORDER BY created_at DESC`;
  return rows.map(rowToResult);
}

module.exports = { analyze, transcribeStage, gapFillStage, verifyStage, finalizeStage, getById, getByPurchaseId, listForEmail };
