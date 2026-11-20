// lib/services/simScanService.js — SIMULATED slip scan on the REAL AI pipeline.
//
// Staff-only QA: the /simulator/scan-slip page runs the same staged AI
// pipeline as the real /scan-slip (transcribe + gap-fill + diverse-model
// verification + mismatch/unverified/unreadable flags + whole-slip
// coverage), but every gate, consume and store lands on the SIMULATOR's
// own tables only:
//   - identity comes from the SA-started sim run (sim_runs), never from
//     a real purchase, real user or real session;
//   - the wallet is sim_credit_balances (30 sim credits per approved
//     sim payment, 5 per completed sim scan — same as the real model);
//   - results land in sim_scans, never scan_results;
//   - no real credit is read, spent or decremented anywhere here.
// Spending mirrors the real model exactly: the AI runs BEFORE any
// spend, only finalize (after a completed analysis) spends exactly
// once, atomically; failed or cancelled sim scans spend nothing.
// Rail separation is structural, not a flag: this module never imports
// scanPurchase or scanService, and the real scan modules never import
// it — there is no code path by which a sim scan can touch real data.
const { sql } = require('../db');
const { ApiError, generateId, SCAN_PLAN } = require('../util');
const simulator = require('./simulator');
const ai = require('./ai');

const ALLOWED_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp']);
// The sim scan is the full-coverage Premium plan (maxPicks -1), the
// same plan the sim Buy page sells.
const PLAN = SCAN_PLAN.PREMIUM;

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

function buildCoverageNote(totalDetected, analyzed, unpredicted, flagged) {
  let note;
  if (unpredicted > 0) {
    note = `Full coverage attempted — ${analyzed} of ${totalDetected} picks predicted; ${unpredicted} pick(s) could not be analysed and are listed below.`;
  } else {
    note = `Full coverage plan - all ${analyzed} detected pick(s) analyzed.`;
  }
  if (flagged > 0) note += ` ${flagged} pick(s) could not be confirmed — check the flagged rows against your slip.`;
  return note;
}

function buildCoverageNoteWithRecovered(totalDetected, analyzed, unpredicted, flagged, recovered) {
  let note = buildCoverageNote(totalDetected, analyzed, unpredicted, flagged);
  if (recovered > 0) note += ` ${recovered} pick(s) recovered on a second look — check them against your slip.`;
  return note;
}

// Shared sim-run + sim-credit gate WITHOUT consuming. Every stage runs
// it, so a wallet that runs dry mid-flow fails the next stage with the
// same specific error — never a generic failure, never a silent spend.
// The spend itself happens only in finalizeStage, after a completed
// analysis. The legacy sim_scan_access rows grant nothing any more.
async function gateRun(runId, imageBuffer, contentType, requireImage) {
  const run = await simulator.getRun(runId);
  const identity = run.sim_identity;
  const credits = require('./credits');
  await credits.requireSimCredits(identity);
  if (requireImage) {
    if (!imageBuffer || !imageBuffer.length) throw new ApiError('An image file is required', 400);
    if (!contentType || !ALLOWED_TYPES.has(contentType.toLowerCase())) {
      throw new ApiError('Unsupported image type. Allowed: image/jpeg, image/png, image/webp.', 400);
    }
  }
  const balance = await credits.simBalanceFor(identity);
  return { run, identity, grant: { state: 'active', scansUsed: 0, scansMax: 0, scansLeft: 0, windowStartedAt: null, windowExpiresAt: null, secondsLeft: 0, started: true }, credits: credits.summary(balance) };
}

// --- Staged sim scan pipeline (same shape as the real staged pipeline)
// Each stage is its own invocation (<60s); the sim client orchestrates
// and shows real stage progress. No stage consumes anything —
// consumption happens only in finalizeStage, after a completed
// analysis, exactly like the real finalize.

// Stage 1: first read only. Returns picks + the model that actually
// served them (the verification stage must differ from it).
async function transcribeStage(runId, imageBuffer, contentType) {
  await gateRun(runId, imageBuffer, contentType, true);
  const base64 = imageBuffer.toString('base64');
  const { analysis, servingModel } = await ai.transcribeFirst(base64, contentType, PLAN);
  return {
    picks: analysis.predictions,
    totalPicksDetected: analysis.totalPicksDetected,
    servingModel: servingModel || null,
    missingPositions: computeMissing(analysis.predictions, analysis.totalPicksDetected),
  };
}

// Stage 2: one gap-fill round for still-missing positions. A provider
// failure is NON-fatal (mirrors the real stage): picks come back
// unchanged with gapfillFailed=true and the caller proceeds to verify,
// which lists the rest as unpredicted — never omitted, never faked.
async function gapFillStage(runId, imageBuffer, contentType, predictions, totalPicksDetected) {
  await gateRun(runId, imageBuffer, contentType, true);
  const base64 = imageBuffer.toString('base64');
  const analysis = {
    totalPicksDetected: totalPicksDetected || 0,
    predictions: (predictions || []).map((p) => ({ ...p })),
  };
  const { recovered, failed } = await ai.gapFillOnce(base64, contentType, PLAN, analysis);
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
async function verifyStage(runId, imageBuffer, contentType, predictions, totalPicksDetected, servingModel) {
  await gateRun(runId, imageBuffer, contentType, true);
  const base64 = imageBuffer.toString('base64');
  const analysis = await ai.verifyAnalysis(base64, contentType, PLAN, predictions, totalPicksDetected, servingModel || null);
  return {
    predictions: analysis.predictions,
    totalPicksDetected: analysis.totalPicksDetected,
  };
}

// Stage 4: validate + sanitize client-submitted predictions, consume
// exactly once from the SIM grant, store in sim_scans. The submitted
// predictions can only ever affect the submitter's own sim record (the
// run resolves to its own sim identity); shape is validated and
// sanitize re-applied so malformed rows cannot be stored as real calls.
async function finalizeStage(runId, predictions, totalPicksDetected, slipName) {
  const { identity } = await gateRun(runId, null, null, false);
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

  // Spend 5 sim credits, atomically (the UPDATE itself is the claim —
  // a raced last-credit scan fails here and stores nothing).
  const db = sql();
  const credits = require('./credits');
  const creditsLeft = await credits.spendSimCredits(identity, { reason: 'SIM_SCAN', ref: 'SIMSCAN_' + generateId() });

  const realCalls = analysis.predictions.filter((p) => ai.isRealCall(p.prediction)).length;
  const unpredicted = analysis.predictions.length - realCalls;
  const flagged = analysis.predictions.filter((p) => p.verification === 'mismatch' || p.verification === 'unverified').length;
  const recovered = analysis.predictions.filter((p) => p.recovered === true).length;
  const coverageNote = buildCoverageNoteWithRecovered(analysis.totalPicksDetected, realCalls, unpredicted, flagged, recovered);
  const id = 'simscan-' + generateId();
  const result = {
    scanPlan: 'PREMIUM',
    totalPicksDetected: analysis.totalPicksDetected,
    picksAnalyzed: realCalls,
    coverageNote,
    predictions: analysis.predictions,
  };
  await db`
    INSERT INTO sim_scans (id, identity, slip_name, result)
    VALUES (${id}, ${identity}, ${String(slipName || '').trim() || null}, ${JSON.stringify(result)}::jsonb)
  `;
  const rows = await db`SELECT * FROM sim_scans WHERE id = ${id}`;
  return {
    id: rows[0].id,
    slipName: rows[0].slip_name,
    createdAt: rows[0].created_at,
    ...rows[0].result,
    credits: { ...credits.summary(creditsLeft), spent: credits.COST_PER_USE },
  };
}

module.exports = { transcribeStage, gapFillStage, verifyStage, finalizeStage };
