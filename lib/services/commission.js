// lib/services/commission.js — port of service/CommissionService.java
const { sql } = require('../db');
const { ApiError, generateId } = require('../util');

// Self-healing schema: commission_records is created ONLY by lib/schema.sql
// (no service creates it), so a database where the full schema was never
// run — e.g. a prod Neon that grew table-by-table via service
// ensureSchemas — makes every commission query (including the superadmin
// admins list) fail with 500 "relation commission_records does not exist".
// Creating it here (same pattern as skyPayments.ensureSchema) makes the
// endpoint work on any database instead of depending on a manual schema run.
let schemaReady = null;
async function ensureSchema() {
  if (schemaReady) return schemaReady;
  schemaReady = (async () => {
    const db = sql();
    await db`
      CREATE TABLE IF NOT EXISTS commission_records (
        id                     TEXT PRIMARY KEY,
        payment_reference      TEXT NOT NULL,
        admin_username         TEXT NOT NULL,
        referred_user_email    TEXT NOT NULL,
        plan                   TEXT,
        amount_cedis           INT NOT NULL,
        admin_share_cedis      DOUBLE PRECISION NOT NULL,
        platform_share_cedis   DOUBLE PRECISION NOT NULL,
        created_at             TIMESTAMPTZ NOT NULL DEFAULT now(),
        paid_out               BOOLEAN NOT NULL DEFAULT false,
        paid_out_at            TIMESTAMPTZ,
        payout_id              TEXT
      )`;
    await db`ALTER TABLE commission_records ADD COLUMN IF NOT EXISTS currency TEXT NOT NULL DEFAULT 'GHS'`;
    // The admins-list referral counts read users.referred_by_admin_code.
    // Prod users tables predating that column must not 500 the list (or
    // the admin stats endpoint, which counts the same column). Heal it
    // here; if the users table itself is missing, the guarded counts
    // below degrade to 0 instead of throwing — no users, no referrals.
    try {
      await db`ALTER TABLE users ADD COLUMN IF NOT EXISTS referred_by_admin_code TEXT`;
    } catch { /* users table missing entirely — counts fall back to [] below */ }
  })().catch((err) => { schemaReady = null; throw err; });
  return schemaReady;
}

function rowToCommission(row) {
  if (!row) return null;
  return {
    id: row.id,
    paymentReference: row.payment_reference,
    adminUsername: row.admin_username,
    referredUserEmail: row.referred_user_email,
    plan: row.plan,
    amountCedis: row.amount_cedis,
    adminShareCedis: Number(row.admin_share_cedis),
    platformShareCedis: Number(row.platform_share_cedis),
    currency: row.currency || 'GHS',
    createdAt: row.created_at,
    paidOut: row.paid_out,
    paidOutAt: row.paid_out_at,
    payoutId: row.payout_id,
    status: row.paid_out ? 'PAID' : 'PENDING', // computed — there's no dedicated status column, paidOut is the source of truth
  };
}

function rowToPayout(row) {
  if (!row) return null;
  return {
    id: row.id,
    adminUsername: row.admin_username,
    totalAmountCedis: Number(row.total_amount_cedis),
    commissionCount: row.commission_count,
    paidAt: row.paid_at,
    paidByUsername: row.paid_by_username,
    currency: row.currency || 'GHS',
    status: row.status || 'PAID', // PENDING | PAID | REJECTED
    requestedAt: row.requested_at,
    rejectedAt: row.rejected_at,
    rejectedByUsername: row.rejected_by_username,
    rejectionReason: row.rejection_reason || null,
  };
}

/**
 * Called right after a payment is verified successful. No-op if no valid referral.
 * `amount` and `currency` must match — e.g. a Nigerian manual payment should
 * pass its real Naira amount with currency='NGN', never a Cedi placeholder
 * value under a 'GHS' label. Defaults to 'GHS' for every existing call site
 * (Paystack, AkwaPay subscriptions/scans/sessions), which are all genuinely
 * Cedi-denominated.
 */
async function recordIfReferred(paymentReference, userEmail, plan, amount, referralCode, currency = 'GHS') {
  if (!referralCode || !referralCode.trim()) return;
  await ensureSchema();
  if (amount == null) {
    // No known price for this plan/currency combination (see funds.js's
    // SCAN_PLAN_NAIRA comment) — refuse to record a commission on a guessed
    // number rather than silently mis-crediting an admin.
    console.error('commission.recordIfReferred: refusing to record — no price known for', { paymentReference, plan, currency });
    return;
  }
  const db = sql();

  const admins = await db`SELECT * FROM admins WHERE referral_code = ${referralCode}`;
  const admin = admins[0];
  if (!admin || !admin.active) return;

  const adminShare = amount * (admin.admin_share_percent / 100.0);
  const platformShare = amount - adminShare;

  await db`
    INSERT INTO commission_records
      (id, payment_reference, admin_username, referred_user_email, plan, amount_cedis, admin_share_cedis, platform_share_cedis, currency)
    VALUES
      (${generateId()}, ${paymentReference}, ${admin.username}, ${userEmail}, ${plan ? plan.name : null}, ${amount}, ${adminShare}, ${platformShare}, ${currency})
  `;
}

async function listForAdmin(adminUsername) {
  await ensureSchema();
  const db = sql();
  const rows = await db`SELECT * FROM commission_records WHERE admin_username = ${adminUsername} ORDER BY created_at DESC`;
  return rows.map(rowToCommission);
}

async function listAll() {
  await ensureSchema();
  const db = sql();
  const rows = await db`SELECT * FROM commission_records ORDER BY created_at DESC`;
  return rows.map(rowToCommission);
}

/** Scan-side users referred by one admin code (0 when the users table is absent). */
async function referredUserCount(referralCode) {
  await ensureSchema();
  const db = sql();
  try {
    const rows = await db`SELECT COUNT(*)::int AS n FROM users WHERE referred_by_admin_code = ${referralCode}`;
    return rows[0] ? rows[0].n : 0;
  } catch {
    return 0;
  }
}

// CRITICAL FIX: every function below used to sum admin_share_cedis across
// ALL rows for an admin regardless of currency. If an admin ever earned
// both a GHS commission (Paystack/AkwaPay) and an NGN commission (Nigerian
// manual payment), these would silently add a Naira figure into a Cedi
// total. Every function now takes an explicit `currency` param (defaulting
// to 'GHS', which is what every existing call site actually wants) and
// filters by it, so GHS and NGN commissions are always summed separately.

async function earnedOn(adminUsername, dateStr, currency = 'GHS') {
  await ensureSchema();
  const db = sql();
  const rows = await db`
    SELECT COALESCE(SUM(admin_share_cedis), 0) AS total
    FROM commission_records
    WHERE admin_username = ${adminUsername} AND created_at::date = ${dateStr}::date AND currency = ${currency}
  `;
  return Number(rows[0].total);
}

async function earnedSince(adminUsername, sinceIso, currency = 'GHS') {
  await ensureSchema();
  const db = sql();
  const rows = await db`
    SELECT COALESCE(SUM(admin_share_cedis), 0) AS total
    FROM commission_records
    WHERE admin_username = ${adminUsername} AND created_at >= ${sinceIso} AND currency = ${currency}
  `;
  return Number(rows[0].total);
}

async function totalEarned(adminUsername, currency = 'GHS') {
  await ensureSchema();
  const db = sql();
  const rows = await db`
    SELECT COALESCE(SUM(admin_share_cedis), 0) AS total
    FROM commission_records WHERE admin_username = ${adminUsername} AND currency = ${currency}
  `;
  return Number(rows[0].total);
}

async function totalPending(adminUsername, currency = 'GHS') {
  await ensureSchema();
  const db = sql();
  const rows = await db`
    SELECT COALESCE(SUM(admin_share_cedis), 0) AS total
    FROM commission_records WHERE admin_username = ${adminUsername} AND paid_out = false AND currency = ${currency}
  `;
  return Number(rows[0].total);
}

async function totalPaidOut(adminUsername, currency = 'GHS') {
  await ensureSchema();
  const db = sql();
  const rows = await db`
    SELECT COALESCE(SUM(admin_share_cedis), 0) AS total
    FROM commission_records WHERE admin_username = ${adminUsername} AND paid_out = true AND currency = ${currency}
  `;
  return Number(rows[0].total);
}

/** Direct payout kept as a thin wrapper over request+approve (see below). */
async function payoutAdmin(adminUsername, paidByUsername, currency = 'GHS') {
  // C9/C7: a direct payout used to run its own non-atomic check-then-act
  // code. It now goes through the same safe path as a requested payout:
  // reserve the commissions, then approve — so it cannot double-pay or
  // orphan a PENDING request. Throws if a request is already pending.
  const request = await requestPayout(adminUsername, currency);
  return approvePayoutRequest(request.id, paidByUsername);
}

async function payoutsForAdmin(adminUsername) {
  const db = sql();
  const rows = await db`SELECT * FROM payout_records WHERE admin_username = ${adminUsername} ORDER BY requested_at DESC`;
  return rows.map(rowToPayout);
}

/** Admin-initiated payout request — reserves the commissions (C8). */
async function requestPayout(adminUsername, currency = 'GHS') {
  const db = sql();
  const payoutId = generateId();
  // C8: ONE statement — reserve exactly the unpaid, unreserved commissions
  // for this payout and create the PENDING record from precisely those
  // rows, so the payout total can never drift from what approval will mark
  // paid. The uniq_pending_payout index (schema.sql) makes a second PENDING
  // request for the same admin/currency fail instead of double-reserving.
  const rows = await db`
    WITH reserved AS (
      UPDATE commission_records
         SET payout_id = ${payoutId}
       WHERE admin_username = ${adminUsername}
         AND currency = ${currency}
         AND paid_out = false
         AND payout_id IS NULL
      RETURNING admin_share_cedis
    )
    INSERT INTO payout_records
      (id, admin_username, total_amount_cedis, commission_count, currency, status, paid_at)
    SELECT ${payoutId}, ${adminUsername}, COALESCE(SUM(admin_share_cedis), 0), COUNT(*), ${currency}, 'PENDING', NULL
      FROM reserved
    HAVING COUNT(*) > 0
    RETURNING *`;
  if (!rows[0]) {
    // Either nothing is pending, or everything pending is already reserved
    // by an open request.
    const existing = await db`
      SELECT id FROM payout_records
      WHERE admin_username = ${adminUsername} AND currency = ${currency} AND status = 'PENDING'`;
    if (existing.length > 0) {
      throw new ApiError(`You already have a pending ${currency} payout request awaiting review`, 400);
    }
    throw new ApiError(`No pending ${currency} commission to request payout for`, 400);
  }
  return rowToPayout(rows[0]);
}

/** Superadmin approval — atomic, pays only the reserved commissions (C7). */
async function approvePayoutRequest(payoutId, approvedByUsername) {
  const db = sql();
  const now = new Date().toISOString();
  // C7: one transaction. The status flips only if the request is still
  // PENDING — two simultaneous approvals cannot both succeed (the loser
  // gets a 409) — and only THIS payout's reserved commissions are marked
  // paid, never commissions earned after the request was made.
  const [updated] = await db.transaction([
    db`UPDATE payout_records
          SET status = 'PAID', paid_at = ${now}, paid_by_username = ${approvedByUsername}
        WHERE id = ${payoutId} AND status = 'PENDING'
        RETURNING *`,
    db`UPDATE commission_records
          SET paid_out = true, paid_out_at = ${now}
        WHERE payout_id = ${payoutId} AND paid_out = false`,
  ]);
  if (!updated.length) throw new ApiError('Payout request not found or already processed', 409);
  return rowToPayout(updated[0]);
}

/** Superadmin rejection — releases reservations, stores the reason (C7/L3). */
async function rejectPayoutRequest(payoutId, rejectedByUsername, reason) {
  const db = sql();
  const now = new Date().toISOString();
  // One transaction: flip only if still PENDING, store the reason (L3 —
  // it used to be collected from the admin UI and silently dropped), and
  // release the reserved commissions so the admin can request again.
  const [updated] = await db.transaction([
    db`UPDATE payout_records
          SET status = 'REJECTED', rejected_at = ${now}, rejected_by_username = ${rejectedByUsername},
              rejection_reason = ${reason || null}
        WHERE id = ${payoutId} AND status = 'PENDING'
        RETURNING *`,
    db`UPDATE commission_records SET payout_id = NULL WHERE payout_id = ${payoutId} AND paid_out = false`,
  ]);
  if (!updated.length) throw new ApiError('Payout request not found or already processed', 409);
  return rowToPayout(updated[0]);
}

async function pendingPayoutRequests() {
  const db = sql();
  const rows = await db`SELECT * FROM payout_records WHERE status = 'PENDING' ORDER BY requested_at ASC`;
  return rows.map(rowToPayout);
}

async function allPayouts(adminUsername) {
  const db = sql();
  const rows = adminUsername
    ? await db`SELECT * FROM payout_records WHERE admin_username = ${adminUsername} ORDER BY requested_at DESC`
    : await db`SELECT * FROM payout_records ORDER BY requested_at DESC`;
  return rows.map(rowToPayout);
}

module.exports = {
  ensureSchema,
  recordIfReferred,
  listForAdmin,
  listAll,
  referredUserCount,
  earnedOn,
  earnedSince,
  totalEarned,
  totalPending,
  totalPaidOut,
  payoutAdmin,
  payoutsForAdmin,
  allPayouts,
  requestPayout,
  approvePayoutRequest,
  rejectPayoutRequest,
  pendingPayoutRequests,
};
