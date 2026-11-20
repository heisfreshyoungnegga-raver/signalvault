const { sql } = require('../db');
const { ApiError, generateId, scanSessionPlanFromCode, mapSessionPlanToScanPlan, SCAN_SESSION_PLAN, resolveGhNetwork, detectGhNetworkFromPhone } = require('../util');
const ai = require('./ai');

const SIMULATOR_EMAIL = 'superadmin-simulator@darkweb.local';

async function ensureSimulatorSchema() {
  const db = sql();
  // The gateway-era reference columns stay in the schema for historical
  // rows; the simulator no longer writes them.
  await db`ALTER TABLE scan_sessions ADD COLUMN IF NOT EXISTS shinobipay_reference TEXT`;
  await db`ALTER TABLE scan_sessions ADD COLUMN IF NOT EXISTS shinobipay_intent_id TEXT`;
  await db`ALTER TABLE scan_sessions ADD COLUMN IF NOT EXISTS paid_amount_cedis NUMERIC`;
  await db`ALTER TABLE scan_sessions ADD COLUMN IF NOT EXISTS manual_reference TEXT`;
}

function rowToSession(row) {
  if (!row) return null;
  return {
    id: row.id,
    email: row.email,
    plan: row.plan,
    status: row.status,
    createdAt: row.created_at,
    activatedAt: row.activated_at,
    expiresAt: row.expires_at,
    scanCount: row.scan_count,
    paymentStatus: row.simulator_payment_status || 'PENDING',
    paymentMethod: row.payment_method || 'SIMULATED',
    // Historical gateway-era reference (old rows only; new simulated rows
    // leave it null — no gateway exists any more).
    paymentReference: row.shinobipay_reference || null,
    phone: row.phone || null,
    network: row.network || null,
    paidAmountCedis: row.paid_amount_cedis != null ? Number(row.paid_amount_cedis) : null,
    // Manual-proof fields — only populated on manual simulator rows.
    accountName: row.account_name,
    accountNumber: row.account_number,
    networkOrBank: row.network_or_bank,
    reference: row.manual_reference,
    screenshotUrl: row.manual_screenshot_url,
  };
}

function rowToResult(row) {
  if (!row) return null;
  return {
    id: row.id,
    purchaseId: row.purchase_id,
    scanPlan: row.scan_plan,
    totalPicksDetected: row.total_picks_detected,
    picksAnalyzed: row.picks_analyzed,
    predictions: row.predictions,
    coverageNote: row.coverage_note,
    rawModelOutput: row.raw_model_output,
    createdAt: row.created_at,
  };
}

function secondsRemaining(session) {
  if (!session.expiresAt) return 0;
  const secs = Math.floor((new Date(session.expiresAt).getTime() - Date.now()) / 1000);
  return Math.max(secs, 0);
}

function canScan(session) {
  return session.status === 'ACTIVE' && session.expiresAt && new Date() < new Date(session.expiresAt);
}

/**
 * Simulates the live manual flow's first step: the customer submits their
 * payment proof and the purchase waits for admin review. The session row
 * is a faithful manual-payment session (payment_method 'SIMULATED',
 * sim- reference, phone, network, country) in AWAITING_PAYMENT — only the
 * review itself is driven by the simulator controls. No money moves.
 */
async function createSimulatorSession(planCode, payment = {}) {
  console.log(`[sim] createSimulatorSession called: planCode=${planCode}`);
  const start = Date.now();
  await ensureSimulatorSchema();
  const db = sql();
  let plan;
  try {
    plan = scanSessionPlanFromCode(planCode || 'SESSION_500');
  } catch {
    console.error(`[sim] createSimulatorSession: invalid plan code '${planCode}'`);
    throw new ApiError(`Invalid plan code '${planCode}'. Valid codes: SESSION_550`, 400);
  }
  console.log(`[sim] createSimulatorSession: resolved plan=${JSON.stringify(plan)}`);

  const phone = payment.phone || payment.accountNumber || '0244123456';
  let network = 'MTN';
  try { network = resolveGhNetwork(payment.network, phone); } catch { network = detectGhNetworkFromPhone(phone) || 'MTN'; }

  const sessionId = 'sim-' + generateId();
  const reference = 'sim-' + generateId().replace(/-/g, '').slice(0, 24);
  console.log(`[sim] createSimulatorSession: sessionId=${sessionId} reference=${reference} network=${network}`);

  await db`
    INSERT INTO scan_sessions (id, email, plan, status, country, payment_method, simulator_payment_status, manual_reference, phone, network)
    VALUES (${sessionId}, ${SIMULATOR_EMAIL}, ${plan.name}, 'AWAITING_PAYMENT', 'GH', 'SIMULATED', 'SUBMITTED', ${reference}, ${phone}, ${network})
  `;
  console.log(`[sim] createSimulatorSession: inserted row (simulated proof submitted), took ${Date.now() - start}ms`);

  const result = await getSimulatorSession(sessionId);
  console.log(`[sim] createSimulatorSession: done, status=${result.status}`);
  return result;
}

/**
 * Simulates an admin approving the submitted manual payment: the payment
 * settles and the session activates for the plan's duration, exactly like
 * the live rail's approval (paid amount = plan price).
 */
async function approveSimulatorPayment(sessionId) {
  console.log(`[sim] approveSimulatorPayment called: sessionId=${sessionId}`);
  const start = Date.now();
  const db = sql();
  const session = await getSimulatorSession(sessionId);
  console.log(`[sim] approveSimulatorPayment: current status=${session.status}`);

  if (session.status !== 'AWAITING_PAYMENT') {
    console.error(`[sim] approveSimulatorPayment: rejected, session not AWAITING_PAYMENT (current: ${session.status})`);
    throw new ApiError(`Session is not in AWAITING_PAYMENT state (current: ${session.status})`, 409);
  }
  const plan = SCAN_SESSION_PLAN[session.plan];
  const activatedAt = new Date();
  const expiresAt = new Date(activatedAt.getTime() + plan.durationMinutes * 60 * 1000);
  console.log(`[sim] approveSimulatorPayment: settling + activating, plan=${session.plan} durationMinutes=${plan.durationMinutes} expiresAt=${expiresAt.toISOString()}`);

  await db`
    UPDATE scan_sessions SET simulator_payment_status = 'SUCCEEDED', status = 'ACTIVE', activated_at = ${activatedAt.toISOString()}, expires_at = ${expiresAt.toISOString()}, paid_amount_cedis = ${plan.amountCedis}
    WHERE id = ${sessionId} AND email = ${SIMULATOR_EMAIL} AND status = 'AWAITING_PAYMENT'
  `;
  console.log(`[sim] approveSimulatorPayment: updated row, took ${Date.now() - start}ms`);

  const result = await getSimulatorSession(sessionId);
  console.log(`[sim] approveSimulatorPayment: done, status=${result.status}`);
  return result;
}

/** Simulates an admin rejecting the submitted manual payment: payment fails. */
async function failSimulatorPayment(sessionId) {
  console.log(`[sim] failSimulatorPayment called: sessionId=${sessionId}`);
  const db = sql();
  const session = await getSimulatorSession(sessionId);
  if (session.status !== 'AWAITING_PAYMENT') {
    throw new ApiError(`Session is not in AWAITING_PAYMENT state (current: ${session.status})`, 409);
  }
  await db`
    UPDATE scan_sessions SET simulator_payment_status = 'FAILED', status = 'FAILED'
    WHERE id = ${sessionId} AND email = ${SIMULATOR_EMAIL} AND status = 'AWAITING_PAYMENT'
  `;
  console.log(`[sim] failSimulatorPayment: marked FAILED: ${sessionId}`);
  return getSimulatorSession(sessionId);
}

async function analyzeSlip(sessionId, imageBase64, mimeType) {
  console.log(`[sim] analyzeSlip called: sessionId=${sessionId} mimeType=${mimeType} imageBase64Length=${imageBase64 ? imageBase64.length : 0}`);
  const overallStart = Date.now();

  const db = sql();
  const session = await getSimulatorSession(sessionId);
  console.log(`[sim] analyzeSlip: session loaded, status=${session.status} plan=${session.plan} scanCount=${session.scanCount} expiresAt=${session.expiresAt}`);

  if (!canScan(session)) {
    const reason =
      session.status === 'AWAITING_PAYMENT'
        ? 'The simulated payment has not been approved yet. Approve the payment first.'
        : session.status === 'EXPIRED'
        ? 'Session has expired. Create a new one.'
        : `Session is in status ${session.status} and cannot scan.`;
    console.error(`[sim] analyzeSlip: cannot scan, reason="${reason}"`);
    throw new ApiError(reason, 409);
  }
  console.log('[sim] analyzeSlip: canScan check passed');

  if (!imageBase64 || !imageBase64.trim()) {
    console.error('[sim] analyzeSlip: rejected, imageBase64 missing or empty');
    throw new ApiError('imageBase64 is required', 400);
  }

  const mime = (mimeType || 'image/jpeg').toLowerCase().trim();
  if (!/^image\/(jpeg|png|webp)$/.test(mime)) {
    console.error(`[sim] analyzeSlip: rejected, unsupported mime type '${mime}'`);
    throw new ApiError(`Unsupported image type '${mime}'. Allowed: image/jpeg, image/png, image/webp`, 400);
  }
  console.log(`[sim] analyzeSlip: mime type accepted: ${mime}`);

  const aiPlan = mapSessionPlanToScanPlan(SCAN_SESSION_PLAN[session.plan]);
  console.log(`[sim] analyzeSlip: mapped to aiPlan=${JSON.stringify(aiPlan)}, calling ai.analyzeSlip now`);

  const aiCallStart = Date.now();
  let analysis;
  try {
    analysis = await ai.analyzeSlip(imageBase64, mime, aiPlan);
  } catch (err) {
    console.error(`[sim] analyzeSlip: ai.analyzeSlip THREW after ${Date.now() - aiCallStart}ms: ${err.message}`);
    throw err;
  }
  console.log(`[sim] analyzeSlip: ai.analyzeSlip returned after ${Date.now() - aiCallStart}ms — provider=${analysis.providerUsed} model=${analysis.modelUsed} totalPicksDetected=${analysis.totalPicksDetected} picksParsed=${analysis.predictions.length}`);

  const id = generateId();
  const coverageNote = buildCoverageNote(SCAN_SESSION_PLAN[session.plan], analysis);
  console.log(`[sim] analyzeSlip: coverageNote="${coverageNote}", inserting scan_result id=${id}`);

  const dbInsertStart = Date.now();
  // picksAnalyzed counts REAL calls only (1/X/2); explicitly
  // unpredicted entries are listed but never counted as analysed.
  const realCalls = (analysis.predictions || []).filter((p) => ai.isRealCall(p.prediction)).length;
  await db`
    INSERT INTO scan_results (id, purchase_id, email, scan_plan, total_picks_detected, picks_analyzed, predictions, coverage_note, raw_model_output)
    VALUES (${id}, ${sessionId}, ${SIMULATOR_EMAIL}, ${aiPlan.name}, ${analysis.totalPicksDetected}, ${realCalls}, ${JSON.stringify(analysis.predictions)}, ${coverageNote}, ${analysis.rawModelOutput || null})
  `;
  console.log(`[sim] analyzeSlip: scan_result inserted in ${Date.now() - dbInsertStart}ms`);

  await db`UPDATE scan_sessions SET scan_count = ${session.scanCount + 1} WHERE id = ${sessionId}`;
  console.log(`[sim] analyzeSlip: scan_count incremented to ${session.scanCount + 1}`);

  const rows = await db`SELECT * FROM scan_results WHERE id = ${id}`;
  console.log(`[sim] analyzeSlip: DONE, total time ${Date.now() - overallStart}ms`);
  return rowToResult(rows[0]);
}

function buildCoverageNote(plan, analysis) {
  const detected = analysis.totalPicksDetected;
  const analyzed = analysis.predictions ? analysis.predictions.filter((p) => ai.isRealCall(p.prediction)).length : 0;
  const unpredicted = (analysis.predictions ? analysis.predictions.length : 0) - analyzed;
  switch (plan.name) {
    case 'BASIC':
      return `${analyzed} of ${detected} picks covered on the BASIC plan (10-min session).`;
    case 'STANDARD':
      return `${analyzed} of ${detected} picks covered on the STANDARD plan (20-min session).`;
    default:
      if (unpredicted > 0) {
        return `Full coverage attempted — ${analyzed} of ${detected} picks predicted; ${unpredicted} pick(s) could not be analysed and are listed below (PREMIUM 40-min session).`;
      }
      return `Full coverage — all ${analyzed} detected pick(s) analyzed (PREMIUM 40-min session).`;
  }
}

async function getSimulatorSession(sessionId) {
  console.log(`[sim] getSimulatorSession called: sessionId=${sessionId}`);
  const db = sql();
  const rows = await db`SELECT * FROM scan_sessions WHERE id = ${sessionId} AND email = ${SIMULATOR_EMAIL}`;
  const session = rowToSession(rows[0]);
  if (!session) {
    console.error(`[sim] getSimulatorSession: not found: ${sessionId}`);
    throw new ApiError('Simulator session not found: ' + sessionId, 404);
  }
  console.log(`[sim] getSimulatorSession: found, status=${session.status}`);
  return session;
}

async function listSimulatorSessions() {
  console.log('[sim] listSimulatorSessions called');
  const db = sql();
  const rows = await db`SELECT * FROM scan_sessions WHERE email = ${SIMULATOR_EMAIL} ORDER BY created_at DESC`;
  console.log(`[sim] listSimulatorSessions: found ${rows.length} session(s)`);
  return rows.map(rowToSession);
}

async function listSimulatorResults() {
  console.log('[sim] listSimulatorResults called');
  const db = sql();
  const rows = await db`SELECT * FROM scan_results WHERE email = ${SIMULATOR_EMAIL} ORDER BY created_at DESC`;
  console.log(`[sim] listSimulatorResults: found ${rows.length} result(s)`);
  return rows.map(rowToResult);
}

async function expireSession(sessionId) {
  console.log(`[sim] expireSession called: sessionId=${sessionId}`);
  const db = sql();
  await getSimulatorSession(sessionId);
  await db`UPDATE scan_sessions SET status = 'EXPIRED' WHERE id = ${sessionId}`;
  console.log(`[sim] expireSession: marked EXPIRED: ${sessionId}`);
  return getSimulatorSession(sessionId);
}

function listPlans() {
  console.log('[sim] listPlans called');
  return Object.values(SCAN_SESSION_PLAN).map((p) => ({
    code: p.code,
    name: p.name,
    amountCedis: p.amountCedis,
    durationMinutes: p.durationMinutes,
    label: 'GHS ' + p.amountCedis,
  }));
}

module.exports = {
  SIMULATOR_EMAIL,
  createSimulatorSession,
  approveSimulatorPayment,
  failSimulatorPayment,
  analyzeSlip,
  getSimulatorSession,
  listSimulatorSessions,
  listSimulatorResults,
  expireSession,
  listPlans,
  secondsRemaining,
};
