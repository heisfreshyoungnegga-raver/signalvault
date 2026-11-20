// lib/services/scanPurchase.js — port of service/ScanPurchaseService.java
//
// CREDIT MODEL (owner spec, 2026-11-06 — replaces the 2026-10-24
// 45-minute / 10-slip grant model): every APPROVED scan purchase
// grants credits to the wallet (lib/services/credits.js): NEW PACKS
// (2026-11-20) GH₵250 → 4, GH₵300 → 8, GH₵500 → 12, GH₵1,000 → 20
// credits (NGN prices not set — exact-match grants only). Each
// COMPLETED analysis spends 4 credits, atomically, AFTER the AI call
// succeeds — failed analyses consume NOTHING. Credits never expire
// and top-ups stack. The old grant machinery below (grantState,
// validGrantsForEmail, consumeAfterSuccess, scans_used/window columns)
// is kept for HISTORY and for the legacy grant summary only; the live
// scan gate (scanService) reads the wallet, and old grants grant
// NOTHING after the cutover — everyone starts at 0 credits.
//
// This is NOT the legacy SESSION_550 product (scan_sessions: 60-min
// timed unlimited scans, separate plan code + submit flow + analyze
// endpoint). Sessions are left exactly alone.
const { sql } = require('../db');
const { ApiError, generateId, scanPlanFromCode, assertCleanField, countryForManualSubmission } = require('../util');
const ban = require('./ban');
const customerUsers = require('./customerUsers');

/** Scans per grant — the owner's "10 slips" figure. */
const SCAN_GRANT_MAX = 10;

/** Grant window minutes: env SCAN_GRANT_MINUTES, default 45 (mirrors
 *  gameWindows.windowMinutes; fractional values allowed so rig runs
 *  can compress the window for expiry tests). */
function grantMinutes() {
  const n = parseFloat(process.env.SCAN_GRANT_MINUTES, 10);
  return Number.isFinite(n) && n > 0 ? n : 45;
}

// Self-healing schema (same pattern as skyPayments.ensureSchema): this
// table is otherwise created only by lib/schema.sql, so the review queues
// fail on databases where the full schema was never run.
let schemaReady = null;
async function ensureSchema() {
  if (schemaReady) return schemaReady;
  schemaReady = (async () => {
    const db = sql();
    await db`
      CREATE TABLE IF NOT EXISTS scan_purchases (
        id                  TEXT PRIMARY KEY,
        email               TEXT NOT NULL,
        scan_plan           TEXT NOT NULL,
        payment_method      TEXT NOT NULL,
        account_name        TEXT,
        account_number      TEXT,
        network_or_bank     TEXT,
        reference           TEXT,
        screenshot_url      TEXT,
        akwapay_reference   TEXT UNIQUE,
        akwapay_intent_id   TEXT,
        status              TEXT NOT NULL DEFAULT 'PENDING',
        submitted_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
        reviewed_at         TIMESTAMPTZ,
        reviewed_by_admin   TEXT,
        rejection_reason    TEXT,
        used_at             TIMESTAMPTZ,
        scans_used          INTEGER NOT NULL DEFAULT 0,
        scans_max           INTEGER NOT NULL DEFAULT 10,
        window_started_at   TIMESTAMPTZ,
        window_expires_at   TIMESTAMPTZ
      )`;
    // Self-heal tables created before the grant model: defaults above
    // convert APPROVED-but-unused rows into fresh 10-scan grants.
    await db`ALTER TABLE scan_purchases ADD COLUMN IF NOT EXISTS scans_used INTEGER NOT NULL DEFAULT 0`;
    await db`ALTER TABLE scan_purchases ADD COLUMN IF NOT EXISTS scans_max INTEGER NOT NULL DEFAULT 10`;
    await db`ALTER TABLE scan_purchases ADD COLUMN IF NOT EXISTS window_started_at TIMESTAMPTZ`;
    await db`ALTER TABLE scan_purchases ADD COLUMN IF NOT EXISTS window_expires_at TIMESTAMPTZ`;
    // PRICE CHANGE (2026-10-24): see manualPayment.js — new submits store
    // the Ghana amount charged (800); NULL for Nigeria and for all rows
    // predating this column (legacy GHS 550 via storedOrLegacyGhs()).
    await db`ALTER TABLE scan_purchases ADD COLUMN IF NOT EXISTS amount_cedis INTEGER`;
    // MONITORING FIX: the superadmin monitoring handler selects
    // paid_amount_cedis from this table, but the column arrived only via
    // a lib/schema.sql ALTER — a table created by this ensureSchema
    // (the normal prod path) lacks it and 500s monitoring with 42703.
    await db`ALTER TABLE scan_purchases ADD COLUMN IF NOT EXISTS paid_amount_cedis NUMERIC`;
  })().catch((err) => { schemaReady = null; throw err; });
  return schemaReady;
}

function rowToPurchase(row) {
  if (!row) return null;
  return {
    id: row.id,
    email: row.email,
    scanPlan: row.scan_plan,
    paymentMethod: row.payment_method,
    accountName: row.account_name,
    accountNumber: row.account_number,
    networkOrBank: row.network_or_bank,
    reference: row.reference,
    screenshotUrl: row.screenshot_url,
    akwapayReference: row.akwapay_reference,
    akwapayIntentId: row.akwapay_intent_id,
    amountCedis: row.amount_cedis != null ? Number(row.amount_cedis) : null,
    status: row.status,
    submittedAt: row.submitted_at,
    reviewedAt: row.reviewed_at,
    reviewedByAdmin: row.reviewed_by_admin,
    rejectionReason: row.rejection_reason,
    usedAt: row.used_at,
    scansUsed: row.scans_used != null ? Number(row.scans_used) : 0,
    scansMax: row.scans_max != null ? Number(row.scans_max) : SCAN_GRANT_MAX,
    windowStartedAt: row.window_started_at,
    windowExpiresAt: row.window_expires_at,
  };
}

/**
 * Grant state for one purchase row. Pure function of the row + now:
 *  - awaiting   — PENDING (admin review outstanding)
 *  - rejected   — REJECTED
 *  - used-up    — legacy USED, or scans_used reached scans_max
 *  - expired    — APPROVED, window started and its wall clock ran out
 *  - not-started— APPROVED with no window and no approval timestamp
 *    (unreachable in practice: submitted_at is NOT NULL, so approval
 *    always anchors a derived window — kept as a fallback)
 *  - active     — APPROVED, window running, scans left
 *  - no-grant   — no such purchase
 * secondsLeft is the live remainder; for rows whose window was never
 * minted (approved before approval-minting), the window is derived
 * from approval time (reviewed_at, else submitted_at).
 */
function grantState(p, nowMs) {
  const now = nowMs != null ? nowMs : Date.now();
  if (!p) {
    return { state: 'no-grant', scansUsed: 0, scansMax: SCAN_GRANT_MAX, scansLeft: 0, windowStartedAt: null, windowExpiresAt: null, secondsLeft: 0, started: false };
  }
  const max = p.scansMax != null ? p.scansMax : SCAN_GRANT_MAX;
  const used = p.scansUsed != null ? p.scansUsed : 0;
  const base = { scansUsed: used, scansMax: max, scansLeft: Math.max(0, max - used), windowStartedAt: p.windowStartedAt || null, windowExpiresAt: p.windowExpiresAt || null };
  if (p.status === 'PENDING') return { ...base, state: 'awaiting', secondsLeft: 0, started: false };
  if (p.status === 'REJECTED') return { ...base, state: 'rejected', scansLeft: 0, secondsLeft: 0, started: false };
  if (p.status === 'USED') return { ...base, state: 'used-up', scansLeft: 0, secondsLeft: 0, started: !!p.windowStartedAt };
  if (used >= max) return { ...base, state: 'used-up', scansLeft: 0, secondsLeft: 0, started: !!p.windowStartedAt };
  if (p.windowExpiresAt && now >= new Date(p.windowExpiresAt).getTime()) {
    return { ...base, state: 'expired', secondsLeft: 0, started: true };
  }
  if (!p.windowStartedAt) {
    // Approval-anchored derivation (2026-11-02): rows approved before
    // windows were minted at approval carry NULL window columns. Their
    // window is approval time -> approval + grantMinutes, so every
    // caller agrees even before the lazy backfill persists it — and an
    // old grant can never look fresh.
    const anchor = p.reviewedAt || p.submittedAt;
    if (anchor) {
      const startMs = new Date(anchor).getTime();
      const expMs = startMs + grantMinutes() * 60 * 1000;
      const derived = {
        windowStartedAt: new Date(startMs).toISOString(),
        windowExpiresAt: new Date(expMs).toISOString(),
      };
      if (now >= expMs) {
        return { ...base, ...derived, state: 'expired', secondsLeft: 0, started: true };
      }
      return { ...base, ...derived, state: 'active', secondsLeft: Math.max(0, Math.floor((expMs - now) / 1000)), started: true };
    }
    return { ...base, state: 'not-started', secondsLeft: Math.round(grantMinutes() * 60), started: false };
  }
  return { ...base, state: 'active', secondsLeft: Math.max(0, Math.floor((new Date(p.windowExpiresAt).getTime() - now) / 1000)), started: true };
}

/** Valid grants for an email (APPROVED, scans left, window unexpired),
 *  earliest-expiring first. Before reading, the lazy backfill mints
 *  approval-anchored windows for pre-change APPROVED rows whose window
 *  columns are still NULL (anchor: reviewed_at, else submitted_at) —
 *  without it those rows would stay valid forever AND consume's
 *  COALESCE would resurrect them with a fresh first-use window.
 *  Idempotent: minted rows never match the WHERE clause again. */
async function validGrantsForEmail(email) {
  await ensureSchema();
  const db = sql();
  const minutes = grantMinutes();
  await db`
    UPDATE scan_purchases
    SET window_started_at = COALESCE(reviewed_at, submitted_at),
        window_expires_at = COALESCE(reviewed_at, submitted_at) + (INTERVAL '1 minute' * ${minutes})
    WHERE status = 'APPROVED'
      AND window_started_at IS NULL
      AND window_expires_at IS NULL
      AND lower(email) = lower(${String(email || '').trim()})
  `;
  const rows = await db`
    SELECT * FROM scan_purchases
    WHERE lower(email) = lower(${String(email || '').trim()})
      AND status = 'APPROVED'
      AND scans_used < scans_max
      AND (window_expires_at IS NULL OR window_expires_at > now())
    ORDER BY (window_expires_at IS NULL), window_expires_at ASC NULLS LAST, reviewed_at ASC NULLS LAST, submitted_at ASC
  `;
  return rows.map(rowToPurchase);
}

/** The grant the next analysis would consume, or null. */
async function bestValidGrant(email) {
  const grants = await validGrantsForEmail(email);
  return grants[0] || null;
}

/** True when the email has any grant with time + uses left. */
async function hasValidGrant(email) {
  return (await bestValidGrant(email)) !== null;
}

/**
 * Atomically consume one scan AFTER a completed analysis. The UPDATE
 * itself is the claim: it increments scans_used and flips the 10th
 * scan's purchase to USED — all guarded by the same WHERE clause, so
 * two concurrent claims on the last scan cannot both succeed. The
 * window is minted at approval, so the COALESCE on the window columns
 * is only a safety net for rows that predate minting (the backfill in
 * validGrantsForEmail normally mints them first). Returns the consumed
 * purchase row, or null when no valid grant remained (caller must then
 * NOT store a result).
 */
async function consumeAfterSuccess(email) {
  await ensureSchema();
  const db = sql();
  const candidates = await validGrantsForEmail(email);
  const nowIso = new Date().toISOString();
  const expIso = new Date(Date.now() + grantMinutes() * 60 * 1000).toISOString();
  for (const cand of candidates) {
    const rows = await db`
      UPDATE scan_purchases
      SET scans_used = scans_used + 1,
          window_started_at = COALESCE(window_started_at, ${nowIso}),
          window_expires_at = COALESCE(window_expires_at, ${expIso}),
          status = CASE WHEN scans_used + 1 >= scans_max THEN 'USED' ELSE status END,
          used_at = CASE WHEN scans_used + 1 >= scans_max THEN ${nowIso} ELSE used_at END
      WHERE id = ${cand.id}
        AND status = 'APPROVED'
        AND scans_used < scans_max
        AND (window_expires_at IS NULL OR window_expires_at > now())
      RETURNING *
    `;
    if (rows[0]) return rowToPurchase(rows[0]);
  }
  return null;
}

/**
 * Grant summary for the /api/scan/grant endpoint + /scan-slip panel.
 * `grant` is the next-to-consume grant (earliest-expiring valid); `named`
 * is the requested purchase's own state when it belongs to this email.
 */
async function grantSummaryForEmail(email, purchaseId) {
  await ensureSchema();
  const cleanEmail = String(email || '').trim();
  let named = null;
  if (purchaseId) {
    try {
      const p = await getById(purchaseId);
      if (p && p.email.toLowerCase() === cleanEmail.toLowerCase()) {
        named = { purchaseId: p.id, ...grantState(p) };
      }
    } catch {
      named = null;
    }
  }
  const valid = await validGrantsForEmail(cleanEmail);
  const best = valid[0] || null;
  const bestState = best ? grantState(best) : null;
  const state = bestState ? bestState.state : (named ? named.state : 'no-grant');
  // Top-level numbers describe the next-to-consume grant; when none is
  // valid they fall back to the named purchase (so a used-up/expired
  // lookup reports its real counts instead of zeroes).
  const primary = bestState || named;
  // CREDIT WALLET (2026-11-06): the scan gate reads the wallet, not
  // the legacy grant rows above (kept for history). `credits` is what
  // the /scan-slip panel renders now.
  const credits = require('./credits');
  const balance = await credits.balanceFor(cleanEmail);
  return {
    email: cleanEmail,
    purchaseId: purchaseId || null,
    state,
    grant: best ? { purchaseId: best.id, ...bestState } : null,
    named,
    validGrants: valid.length,
    totalScansLeft: valid.reduce((sum, g) => sum + Math.max(0, (g.scansMax ?? SCAN_GRANT_MAX) - (g.scansUsed ?? 0)), 0),
    scansLeft: primary ? primary.scansLeft : 0,
    scansUsed: primary ? primary.scansUsed : 0,
    scansMax: primary ? primary.scansMax : SCAN_GRANT_MAX,
    windowStartedAt: primary ? primary.windowStartedAt : null,
    windowExpiresAt: primary ? primary.windowExpiresAt : null,
    secondsLeft: primary ? primary.secondsLeft : 0,
    credits: credits.summary(balance),
  };
}

function isValidHttpUrl(value) {
  return /^https?:\/\//i.test(value);
}

async function canSubmit(email) {
  return true;
}

async function submit(email, scanPlanCode, accountName, accountNumber, networkOrBank, reference, screenshotUrl, ipAddress) {
  assertCleanField(accountName, 'Account name');
  assertCleanField(reference, 'Reference');
  const db = sql();
  if (!email || !email.trim()) throw new ApiError('email is required', 400);
  await customerUsers.assertNotDeactivated(email);
  await ban.checkNotBanned(email, ipAddress);
  const plan = scanPlanFromCode(scanPlanCode);

  if (!screenshotUrl || !screenshotUrl.trim()) throw new ApiError('A payment screenshot link is required', 400);
  if (!accountName || !accountName.trim()) throw new ApiError('accountName is required', 400);
  if (!accountNumber || !accountNumber.trim()) throw new ApiError('accountNumber is required', 400);
  if (!networkOrBank || !networkOrBank.trim()) throw new ApiError('networkOrBank is required', 400);
  if (!reference || !reference.trim()) throw new ApiError('reference is required', 400);

  const trimmedUrl = screenshotUrl.trim();
  if (!isValidHttpUrl(trimmedUrl)) throw new ApiError('screenshotUrl must be a valid http(s) URL', 400);

  const id = generateId();
  await db`
    INSERT INTO scan_purchases (id, email, scan_plan, payment_method, account_name, account_number, network_or_bank, reference, screenshot_url, status, amount_cedis)
    VALUES (${id}, ${email.trim()}, ${plan.name}, 'MANUAL', ${accountName.trim()}, ${accountNumber.trim()}, ${networkOrBank.trim()}, ${reference.trim()}, ${trimmedUrl}, 'PENDING', ${countryForManualSubmission(networkOrBank.trim()) === 'GH' ? plan.amountCedis : null})
  `;
  if (ipAddress) await ban.recordSubmissionIp(email.trim(), ipAddress, 'SCAN');
  return getById(id);
}

async function getById(id) {
  const db = sql();
  const rows = await db`SELECT * FROM scan_purchases WHERE id = ${id}`;
  const purchase = rowToPurchase(rows[0]);
  if (!purchase) throw new ApiError('Scan purchase not found', 404);
  return purchase;
}

async function listAll() {
  const db = sql();
  const rows = await db`SELECT * FROM scan_purchases ORDER BY submitted_at DESC`;
  return rows.map(rowToPurchase);
}

async function listPending() {
  const db = sql();
  const rows = await db`SELECT * FROM scan_purchases WHERE status = 'PENDING' ORDER BY submitted_at DESC`;
  return rows.map(rowToPurchase);
}

async function listForEmail(email) {
  const db = sql();
  const rows = await db`SELECT * FROM scan_purchases WHERE email = ${email} ORDER BY submitted_at DESC`;
  return rows.map(rowToPurchase);
}

async function approve(id, adminUsername) {
  const db = sql();
  const purchase = await getById(id);
  if (purchase.status !== 'PENDING') {
    throw new ApiError(`This submission has already been ${purchase.status}`, 409);
  }
  const now = new Date().toISOString();
  // Status flips first (source of truth), then the credit grant —
  // the grant dedupes on its ref, so a retry after a crash is safe.
  await db`
    UPDATE scan_purchases SET status = 'APPROVED', reviewed_at = ${now}, reviewed_by_admin = ${adminUsername}
    WHERE id = ${id}
  `;
  // NEW PACKS (2026-11-20): approval grants credits to the wallet —
  // no scan window is minted any more. Exact tier match only: GH₵250 → 4,
  // GH₵300 → 8, GH₵500 → 12, GH₵1,000 → 20. Any other amount (or any
  // NGN payment — NGN prices are not set) earns 0 and grants nothing.
  // The window columns are kept for history only; the scan gate reads
  // the wallet. Best-effort: a credit failure must never roll back an
  // approval.
  const { countryForManualSubmission } = require('../util');
  const { nairaPriceForScanPlan } = require('./funds');
  const scanCountry = countryForManualSubmission(purchase.networkOrBank || '');
  try {
    const credits = require('./credits');
    const earned = credits.creditsForPayment({
      currency: scanCountry === 'NG' ? 'NGN' : 'GHS',
      amountGhs: purchase.amountCedis,
      amountNgn: scanCountry === 'NG' ? nairaPriceForScanPlan(purchase.scanPlan) : null,
    });
    if (earned > 0) {
      await credits.grantCredits(purchase.email, earned, { reason: 'SCAN', ref: 'SCAN_' + purchase.id });
    } else {
      console.warn('[scanPurchase] no credit grant for purchase', purchase.id + ': amount is not a current tier price (NGN packs are not set)');
    }
  } catch (err) {
    console.error('[scanPurchase] credit grant failed:', err && err.message);
  }
  return getById(id);
}

async function reject(id, adminUsername, reason) {
  const db = sql();
  const purchase = await getById(id);
  if (purchase.status !== 'PENDING') {
    throw new ApiError(`This submission has already been ${purchase.status}`, 409);
  }
  const now = new Date().toISOString();
  await db`
    UPDATE scan_purchases
    SET status = 'REJECTED', rejection_reason = ${reason && reason.trim() ? reason : 'Not specified'}, reviewed_at = ${now}, reviewed_by_admin = ${adminUsername}
    WHERE id = ${id}
  `;
  await ban.recordRejectionAndMaybeBan(purchase.email);
  return getById(id);
}

/**
 * Legacy single-use consumer, kept for API compatibility. The grant
 * model no longer calls this from analyze (consumption now happens in
 * consumeAfterSuccess, after a completed analysis). Only used to retire
 * a purchase outright; prefer the grant flow for new code.
 */
async function markUsed(id) {
  const db = sql();
  const purchase = await getById(id);
  if (purchase.status !== 'APPROVED') {
    throw new ApiError(`This scan purchase is not ready to use (status: ${purchase.status})`, 409);
  }
  const now = new Date().toISOString();
  await db`UPDATE scan_purchases SET status = 'USED', used_at = ${now} WHERE id = ${id}`;
  return getById(id);
}

async function remove(id) {
  const db = sql();
  const purchase = await getById(id);
  if (['APPROVED', 'USED'].includes(purchase.status)) throw new ApiError('Approved or used scan purchases cannot be deleted', 409);
  await db`DELETE FROM scan_results WHERE purchase_id = ${id}`;
  await db`DELETE FROM scan_purchases WHERE id = ${id}`;
  return { id, deleted: true };
}

module.exports = { ensureSchema, canSubmit, submit, getById, listAll, listPending, listForEmail, approve, reject, markUsed, remove, SCAN_GRANT_MAX, grantMinutes, grantState, validGrantsForEmail, bestValidGrant, hasValidGrant, consumeAfterSuccess, grantSummaryForEmail };
