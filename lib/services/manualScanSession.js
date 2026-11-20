const { sql } = require('../db');
const { ApiError, generateId, scanSessionPlanFromCode, SCAN_SESSION_PLAN, assertCleanField, countryForManualSubmission } = require('../util');
const ban = require('./ban');
const account = require('./account');
const commission = require('./commission');
const scanSession = require('./scanSession');
const customerUsers = require('./customerUsers');

// The receiving details users pay to live in settings.js
// (getPaymentDetails) — this service only records the customer's proof.

function isValidHttpUrl(value) { return /^https?:\/\//i.test(String(value || '')); }

function rowToPayment(row) {
  if (!row) return null;
  return {
    id: row.id,
    email: row.email,
    plan: row.plan,
    status: row.status,
    accountName: row.account_name,
    accountNumber: row.account_number,
    networkOrBank: row.network_or_bank,
    reference: row.manual_reference,
    screenshotUrl: row.manual_screenshot_url,
    submittedAt: row.created_at,
    reviewedAt: row.activated_at,
    reviewedByAdmin: row.manual_reviewed_by,
    rejectionReason: row.manual_rejection_reason,
    sessionId: row.id,
  };
}

async function ensureSchema() {
  const db = sql();
  await db`ALTER TABLE scan_sessions ADD COLUMN IF NOT EXISTS payment_method TEXT NOT NULL DEFAULT 'MANUAL'`;
  await db`ALTER TABLE scan_sessions ADD COLUMN IF NOT EXISTS account_name TEXT`;
  await db`ALTER TABLE scan_sessions ADD COLUMN IF NOT EXISTS account_number TEXT`;
  await db`ALTER TABLE scan_sessions ADD COLUMN IF NOT EXISTS network_or_bank TEXT`;
  await db`ALTER TABLE scan_sessions ADD COLUMN IF NOT EXISTS manual_reference TEXT`;
  await db`ALTER TABLE scan_sessions ADD COLUMN IF NOT EXISTS manual_screenshot_url TEXT`;
  await db`ALTER TABLE scan_sessions ADD COLUMN IF NOT EXISTS manual_reviewed_by TEXT`;
  await db`ALTER TABLE scan_sessions ADD COLUMN IF NOT EXISTS manual_rejection_reason TEXT`;
}

async function submit({ email, planCode, accountName, accountNumber, networkOrBank, reference, screenshotUrl, ipAddress }) {
  assertCleanField(accountName, 'Account name');
  assertCleanField(reference, 'Reference');
  await ensureSchema();
  if (!email || !String(email).trim()) throw new ApiError('email is required', 400);
  if (!accountName || !String(accountName).trim()) throw new ApiError('accountName is required', 400);
  if (!accountNumber || !String(accountNumber).trim()) throw new ApiError('accountNumber is required', 400);
  if (!networkOrBank || !String(networkOrBank).trim()) throw new ApiError('networkOrBank is required', 400);
  if (!reference || !String(reference).trim()) throw new ApiError('reference is required', 400);
  if (!screenshotUrl || !isValidHttpUrl(screenshotUrl)) throw new ApiError('screenshotUrl must be a valid http(s) URL', 400);
  const plan = scanSessionPlanFromCode(planCode);
  await customerUsers.assertNotDeactivated(email);
  await ban.checkNotBanned(email, ipAddress);
  const db = sql();
  // An active session is still exclusive, but an unresolved payment must not
  // lock the customer out of uploading a corrected or clearer proof again.
  const existing = await db`SELECT id FROM scan_sessions WHERE email = ${email.trim()} AND payment_method = 'MANUAL' AND status = 'ACTIVE' LIMIT 1`;
  if (existing.length) throw new ApiError('An active scan session already exists for this email.', 409);
  const id = 'mss-' + generateId();
  const country = countryForManualSubmission(networkOrBank);
  await db`INSERT INTO scan_sessions (id, email, plan, status, country, payment_method, account_name, account_number, network_or_bank, manual_reference, manual_screenshot_url) VALUES (${id}, ${email.trim().toLowerCase()}, ${plan.name}, 'AWAITING_PAYMENT', ${country}, 'MANUAL', ${accountName.trim()}, ${accountNumber.trim()}, ${networkOrBank.trim()}, ${reference.trim()}, ${screenshotUrl.trim()})`;
  if (ipAddress) await ban.recordSubmissionIp(email.trim(), ipAddress, 'SCAN_SESSION_MANUAL');
  return getById(id);
}

async function getById(id) {
  await ensureSchema();
  const db = sql();
  const rows = await db`SELECT * FROM scan_sessions WHERE id = ${id}`;
  if (!rows[0]) throw new ApiError('Manual scan session not found', 404);
  return rowToPayment(rows[0]);
}

async function status(id) {
  await ensureSchema();
  const session = await scanSession.sessionStatus(id);
  const payment = await getById(id);
  return { ...session, paymentStatus: payment.status, reference: payment.reference, rejectionReason: payment.rejectionReason };
}

async function approve(id, adminUsername) {
  await ensureSchema();
  const db = sql();
  const payment = await getById(id);
  if (payment.status !== 'AWAITING_PAYMENT') throw new ApiError(`This submission has already been ${payment.status}`, 409);
  const plan = SCAN_SESSION_PLAN[payment.plan];
  const activatedAt = new Date();
  const expiresAt = new Date(activatedAt.getTime() + plan.durationMinutes * 60 * 1000);
  const updated = await db`UPDATE scan_sessions SET status='ACTIVE', activated_at=${activatedAt.toISOString()}, expires_at=${expiresAt.toISOString()}, manual_reviewed_by=${adminUsername} WHERE id=${id} AND status='AWAITING_PAYMENT' RETURNING id`;
  if (!updated.length) throw new ApiError('Session was reviewed by another admin', 409);
  const acc = await account.getAccountOrNull(payment.email);
  if (acc) {
    // Commission in the currency actually paid: Nigerian bank-transfer
    // sessions price in Naira (funds.js table), Ghana MoMo in Cedis.
    const country = countryForManualSubmission(payment.networkOrBank);
    const { nairaPriceForScanSessionPlan } = require('./funds');
    const amount = country === 'NG' ? nairaPriceForScanSessionPlan(payment.plan) : plan.amountCedis;
    await commission.recordIfReferred('MANUAL_SCAN_SESSION_' + id, payment.email, null, amount, acc.referredByAdminCode, country === 'NG' ? 'NGN' : 'GHS');
  }
  return getById(id);
}

async function reject(id, adminUsername, reason) {
  await ensureSchema();
  const db = sql();
  const payment = await getById(id);
  if (payment.status !== 'AWAITING_PAYMENT') throw new ApiError(`This submission has already been ${payment.status}`, 409);
  await db`UPDATE scan_sessions SET status='FAILED', manual_reviewed_by=${adminUsername}, manual_rejection_reason=${reason && reason.trim() ? reason.trim() : 'Not specified'} WHERE id=${id} AND status='AWAITING_PAYMENT'`;
  await ban.recordRejectionAndMaybeBan(payment.email);
  return getById(id);
}

async function listAll() {
  await ensureSchema();
  const rows = await sql()`SELECT * FROM scan_sessions WHERE payment_method='MANUAL' ORDER BY created_at DESC`;
  return rows.map(rowToPayment);
}

async function listPending() {
  await ensureSchema();
  const rows = await sql()`SELECT * FROM scan_sessions WHERE payment_method='MANUAL' AND status='AWAITING_PAYMENT' ORDER BY created_at DESC`;
  return rows.map(rowToPayment);
}

async function remove(id) {
  await ensureSchema();
  const db = sql();
  const payment = await getById(id);
  if (['ACTIVE', 'EXPIRED'].includes(payment.status)) throw new ApiError('Active or used scan sessions cannot be deleted', 409);
  await db`DELETE FROM scan_results WHERE purchase_id = ${id}`;
  await db`DELETE FROM scan_sessions WHERE id = ${id}`;
  return { id, deleted: true };
}

module.exports = { submit, getById, status, approve, reject, listAll, listPending, remove };
