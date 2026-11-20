// lib/services/manualPayment.js — port of service/ManualPaymentService.java
const { sql } = require('../db');
const { ApiError, generateId, planFromCode, assertCleanField, countryForManualSubmission, storedOrLegacyGhs } = require('../util');
const account = require('./account');
const commission = require('./commission');
const ban = require('./ban');
const customerUsers = require('./customerUsers');

// Self-healing schema (same pattern as skyPayments.ensureSchema): this
// table is otherwise created only by lib/schema.sql, so the review queues
// fail on databases where the full schema was never run.
let schemaReady = null;
async function ensureSchema() {
  if (schemaReady) return schemaReady;
  schemaReady = (async () => {
    const db = sql();
    await db`
      CREATE TABLE IF NOT EXISTS manual_payments (
        id                  TEXT PRIMARY KEY,
        email               TEXT NOT NULL,
        plan                TEXT NOT NULL,
        account_name        TEXT NOT NULL,
        account_number      TEXT NOT NULL,
        network_or_bank     TEXT NOT NULL,
        reference           TEXT NOT NULL,
        screenshot_url      TEXT NOT NULL,
        status              TEXT NOT NULL DEFAULT 'PENDING',
        rejection_reason    TEXT,
        password_revealed   BOOLEAN NOT NULL DEFAULT false,
        submitted_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
        reviewed_at         TIMESTAMPTZ,
        reviewed_by_admin   TEXT
      )`;
      // PRICE CHANGE (2026-10-24): new submits store the amount actually
      // charged (GHS 800 for Ghana; NULL for Nigeria — NGN is priced via
      // PLAN_NAIRA, never a cedi figure). Rows predating this column have
      // NULL and are priced as legacy GHS 550 via storedOrLegacyGhs().
      await db`ALTER TABLE manual_payments ADD COLUMN IF NOT EXISTS amount_cedis INTEGER`;
  })().catch((err) => { schemaReady = null; throw err; });
  return schemaReady;
}

function rowToPayment(row) {
  if (!row) return null;
  return {
    id: row.id,
    email: row.email,
    plan: row.plan,
    accountName: row.account_name,
    accountNumber: row.account_number,
    networkOrBank: row.network_or_bank,
    reference: row.reference,
    screenshotUrl: row.screenshot_url,
    status: row.status,
    amountCedis: row.amount_cedis != null ? Number(row.amount_cedis) : null,
    rejectionReason: row.rejection_reason,
    passwordRevealed: row.password_revealed,
    submittedAt: row.submitted_at,
    reviewedAt: row.reviewed_at,
    reviewedByAdmin: row.reviewed_by_admin,
  };
}

function isValidHttpUrl(value) {
  return /^https?:\/\//i.test(value);
}

async function submit(email, planCode, accountName, accountNumber, networkOrBank, reference, screenshotUrl, ipAddress) {
  assertCleanField(accountName, 'Account name');
  assertCleanField(reference, 'Reference');
  const db = sql();
  // Deactivation blocks new purchases before the registration gate, so a
  // deactivated account gets the deactivation message, not "not registered".
  await customerUsers.assertNotDeactivated(email);
  await ban.checkNotBanned(email, ipAddress);
  if (!(await account.canPurchase(email))) {
    throw new ApiError(`Cannot submit payment: ${email} is not registered yet.`, 409);
  }
  const plan = planFromCode(planCode);

  if (!screenshotUrl || !screenshotUrl.trim()) throw new ApiError('A payment screenshot link is required', 400);
  if (!accountName || !accountName.trim()) throw new ApiError('accountName is required', 400);
  if (!accountNumber || !accountNumber.trim()) throw new ApiError('accountNumber is required', 400);
  if (!networkOrBank || !networkOrBank.trim()) throw new ApiError('networkOrBank is required', 400);
  if (!reference || !reference.trim()) throw new ApiError('reference is required', 400);

  const trimmedUrl = screenshotUrl.trim();
  if (!isValidHttpUrl(trimmedUrl)) throw new ApiError('screenshotUrl must be a valid http(s) URL', 400);

  const id = generateId();
  await db`
    INSERT INTO manual_payments (id, email, plan, account_name, account_number, network_or_bank, reference, screenshot_url, status, amount_cedis)
    VALUES (${id}, ${email}, ${plan.name}, ${accountName.trim()}, ${accountNumber.trim()}, ${networkOrBank.trim()}, ${reference.trim()}, ${trimmedUrl}, 'PENDING', ${countryForManualSubmission(networkOrBank.trim()) === 'GH' ? plan.amountCedis : null})
  `;
  if (ipAddress) await ban.recordSubmissionIp(email, ipAddress, 'MANUAL_SUBSCRIPTION');
  return getById(id);
}

async function getById(id) {
  const db = sql();
  const rows = await db`SELECT * FROM manual_payments WHERE id = ${id}`;
  const payment = rowToPayment(rows[0]);
  if (!payment) throw new ApiError('Manual payment submission not found', 404);
  return payment;
}

async function listAll() {
  const db = sql();
  const rows = await db`SELECT * FROM manual_payments ORDER BY submitted_at DESC`;
  return rows.map(rowToPayment);
}

async function listPending() {
  const db = sql();
  const rows = await db`SELECT * FROM manual_payments WHERE status = 'PENDING' ORDER BY submitted_at DESC`;
  return rows.map(rowToPayment);
}

async function listForEmail(email) {
  const db = sql();
  const rows = await db`SELECT * FROM manual_payments WHERE email = ${email} ORDER BY submitted_at DESC`;
  return rows.map(rowToPayment);
}

async function checkStatus(id) {
  const db = sql();
  const payment = await getById(id);

  let password = null;
  if (payment.status === 'APPROVED' && !payment.passwordRevealed) {
    const acc = await account.getAccountOrNull(payment.email);
    if (acc && acc.password) {
      password = acc.password;
      await db`UPDATE manual_payments SET password_revealed = true WHERE id = ${id}`;
    }
  }
  return { payment, password };
}

async function approve(id, adminUsername) {
  await ensureSchema();
  const db = sql();
  const payment = await getById(id);
  if (payment.status !== 'PENDING') {
    throw new ApiError(`This submission has already been ${payment.status}`, 409);
  }

  const { PLAN, countryForManualSubmission } = require('../util');
  const plan = PLAN[payment.plan];
  const acc = await account.assignSubscription(payment.email, plan);

  // FOUR TIERS (2026-11-17): approval grants credits to the wallet —
  // no windows are minted any more. Credits earned follow what was
  // actually paid, so an in-flight GH₵800 subscription earns 60
  // credits while a fresh tier amount earns its tier credits
  // (legacy GH₵400 / NGN 75,000 earns 30).
  // Best-effort: a credit failure must never roll back an approval.
  const { nairaPriceForPlan: nairaForManual } = require('./funds');
  const countryForGrant = countryForManualSubmission(payment.networkOrBank);
  try {
    const credits = require('./credits');
    const earned = credits.creditsForPayment({
      currency: countryForGrant === 'NG' ? 'NGN' : 'GHS',
      amountGhs: payment.amountCedis,
      amountNgn: countryForGrant === 'NG' ? nairaForManual(payment.plan) : null,
    });
    await credits.grantCredits(payment.email, earned, { reason: 'MANUAL', ref: 'MANUAL_' + payment.id });
  } catch (err) {
    console.error('[manualPayment] credit grant failed:', err && err.message);
  }

  // CRITICAL FIX: a Nigerian manual (bank-transfer) subscription is paid in
  // Naira, not Cedis — previously this always recorded plan.amountCedis
  // (a Cedi figure) as the commission base regardless of country, silently
  // crediting referral admins on the wrong currency's number. Now uses the
  // real Naira price for NG submissions and tags the commission row NGN.
  const { nairaPriceForPlan } = require('./funds');
  const country = countryForManualSubmission(payment.networkOrBank);
  // Commission base = amount actually paid: stored amount for new rows,
  // legacy GHS 550 for rows predating the amount column — never the
  // current 800 constant for an old 550 sale.
  const amount = country === 'NG' ? nairaPriceForPlan(payment.plan) : storedOrLegacyGhs(payment.amountCedis, payment.plan);
  const currency = country === 'NG' ? 'NGN' : 'GHS';

  await commission.recordIfReferred(
    'MANUAL_' + payment.id,
    payment.email,
    plan,
    amount,
    acc.referredByAdminCode,
    currency
  );

  const now = new Date().toISOString();
  await db`
    UPDATE manual_payments SET status = 'APPROVED', reviewed_at = ${now}, reviewed_by_admin = ${adminUsername}
    WHERE id = ${id}
  `;
  return getById(id);
}

async function reject(id, adminUsername, reason) {
  const db = sql();
  const payment = await getById(id);
  if (payment.status !== 'PENDING') {
    throw new ApiError(`This submission has already been ${payment.status}`, 409);
  }
  const now = new Date().toISOString();
  await db`
    UPDATE manual_payments
    SET status = 'REJECTED', rejection_reason = ${reason && reason.trim() ? reason : 'Not specified'}, reviewed_at = ${now}, reviewed_by_admin = ${adminUsername}
    WHERE id = ${id}
  `;
  // Deposit-rejection ban gate: 3 combined rejections across every deposit
  // type (manual subscription / scan / mines) permanently bans the email
  // and every IP it has ever submitted a deposit from.
  await ban.recordRejectionAndMaybeBan(payment.email);
  return getById(id);
}

async function remove(id) {
  const db = sql();
  const payment = await getById(id);
  if (payment.status === 'APPROVED') throw new ApiError('Approved payments cannot be deleted', 409);
  await db`DELETE FROM manual_payments WHERE id = ${id}`;
  return { id, deleted: true };
}

module.exports = { ensureSchema, submit, getById, listAll, listPending, listForEmail, checkStatus, approve, reject, remove };
