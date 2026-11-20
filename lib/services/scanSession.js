// lib/services/scanSession.js — port of service/ScanSessionService.java
const { sql } = require('../db');
const { ApiError, generateId, scanSessionPlanFromCode, mapSessionPlanToScanPlan, SCAN_SESSION_PLAN } = require('../util');
const commission = require('./commission');
const account = require('./account');
const ai = require('./ai');


function rowToSession(row) {
  if (!row) return null;
  return {
    id: row.id,
    email: row.email,
    plan: row.plan,
    akwapayReference: row.akwapay_reference,
    akwapayIntentId: row.akwapay_intent_id,
    phone: row.phone,
    network: row.network,
    country: row.country,
    status: row.status,
    createdAt: row.created_at,
    activatedAt: row.activated_at,
    expiresAt: row.expires_at,
    scanCount: row.scan_count,
    // Real amount AkwaPay confirms was paid, captured at activation — see
    // schema.sql's paid_amount_cedis comment. Null until activated.
    paidAmountCedis: row.paid_amount_cedis != null ? Number(row.paid_amount_cedis) : null,
  };
}

function secondsRemaining(session) {
  if (!session.expiresAt) return 0;
  const secs = Math.floor((new Date(session.expiresAt).getTime() - Date.now()) / 1000);
  return Math.max(secs, 0);
}
function isExpired(session) {
  return session.expiresAt && new Date() > new Date(session.expiresAt);
}
function canScan(session) {
  return session.status === 'ACTIVE' && session.expiresAt && new Date() < new Date(session.expiresAt);
}

function listPlans() {
  return Object.values(SCAN_SESSION_PLAN).map((p) => ({
    code: p.code,
    name: p.name,
    amountCedis: p.amountCedis,
    durationMinutes: p.durationMinutes,
  }));
}

async function initSession() {
  throw new ApiError('Automated scan-session payments are disabled. Submit manual payment proof for admin review.', 410);
}

async function getById(id) {
  const db = sql();
  const rows = await db`SELECT * FROM scan_sessions WHERE id = ${id}`;
  return rowToSession(rows[0]);
}

async function sessionStatus(sessionId) {
  let session = await getById(sessionId);
  if (!session) throw new ApiError('Session not found', 404);
  session = await lazilyExpire(session);

  const plan = SCAN_SESSION_PLAN[session.plan];
  return {
    sessionId: session.id,
    status: session.status,
    plan: session.plan,
    durationMinutes: plan.durationMinutes,
    amountCedis: plan.amountCedis,
    scanCount: session.scanCount,
    activatedAt: session.activatedAt,
    expiresAt: session.expiresAt,
    secondsRemaining: secondsRemaining(session),
  };
}

async function lazilyExpire(session) {
  if (session.status === 'ACTIVE' && isExpired(session)) {
    const db = sql();
    await db`UPDATE scan_sessions SET status = 'EXPIRED' WHERE id = ${session.id}`;
    return getById(session.id);
  }
  return session;
}

async function analyze(sessionId, email, imageBuffer, mimeType) {
  const db = sql();
  let session = await getById(sessionId);
  if (!session) throw new ApiError('Scan session not found', 404);

  if (session.email.toLowerCase() !== email.toLowerCase()) {
    throw new ApiError('Email does not match this session', 403);
  }

  if (session.status === 'AWAITING_PAYMENT') {
    throw new ApiError('Payment is awaiting admin review. The session activates only after manual payment approval.', 402);
  }
  if (session.status === 'FAILED') {
    throw new ApiError('Payment failed. Please start a new session.', 402);
  }
  session = await lazilyExpire(session);
  if (session.status === 'EXPIRED') {
    throw new ApiError('Your scan session has expired. Purchase a new session to continue.', 410);
  }
  if (!canScan(session)) {
    throw new ApiError('Session is not active', 410);
  }

  const imageBase64 = imageBuffer.toString('base64');
  const aiPlan = mapSessionPlanToScanPlan(SCAN_SESSION_PLAN[session.plan]);
  const analysis = await ai.analyzeSlip(imageBase64, mimeType, aiPlan);

  // Atomic increment — avoids a race condition if two scan requests arrive simultaneously
  // for the same session (both would otherwise read the same scanCount and both write scanCount+1).
  await db`UPDATE scan_sessions SET scan_count = scan_count + 1 WHERE id = ${sessionId}`;
  session = await getById(sessionId);

  const out = {
    sessionId: session.id,
    plan: session.plan,
    scanCount: session.scanCount,
    secondsRemaining: secondsRemaining(session),
    expiresAt: session.expiresAt,
    totalPicksDetected: analysis.totalPicksDetected,
    picksAnalyzed: analysis.predictions.length,
    predictions: analysis.predictions,
  };
  if (analysis.rawModelOutput) out.rawModelOutput = analysis.rawModelOutput;
  return out;
}

module.exports = {
  listPlans,
  initSession,
  getById,
  sessionStatus,
  analyze,
  secondsRemaining,
};
