// lib/services/stats.js — port of service/StatsService.java
// Aggregates revenue across four payment rails: Paystack, manual, AkwaPay
// subscriptions, AkwaPay scan purchases. Only counts confirmed deposits.
//
// CRITICAL FIX: this file previously always looked up PLAN[plan].amountCedis
// or SCAN_PLAN[scan_plan].amountCedis for every row, including MANUAL rows
// submitted by Nigerian users paying in Naira — silently mislabeling a
// Naira payment as if it were the same number of Cedis and adding it into
// the same "Deposits Today" total shown on the superadmin dashboard. This
// is the exact bug behind "GHS 600 / 2 payments" appearing for two
// Nigerian BASIC scan-purchase approvals that were never GHS at all.
// Now uses the same GHS/NGN split as funds.js: GHS-only totals for
// deposits, with Nigerian manual rows counted separately (or flagged
// "unpriced" rather than guessed at) and never summed into the GHS figure.
// COUNTFIX (2026-10-24): two bugs made the superadmin dashboard show 0
// for deposits AND payment counts after real approvals:
//  (1) sumGHS did unguarded PLAN[row.plan].amountCedis lookups — any
//      approved row carrying a legacy plan code (TWO_HOUR, BASIC, …,
//      common on prod from the port era) threw TypeError, which took
//      down the WHOLE /api/superadmin/stats handler, so the dashboard's
//      `?? 0` fallbacks rendered 0 for every card, counts included.
//      All plan lookups below are now null-safe: unknown plans are
//      skipped (counted, never priced) instead of crashing the endpoint.
//  (2) Whole rails were never read at all: pricing passes (game_passes),
//      mines purchases (mines_purchases), legacy manual scan sessions
//      (scan_sessions MANUAL + activated), and Ghana manual scan
//      purchases (which fell in neither the GHS nor the NGN sums).
//      They are now counted. Sim tables (sim_*) are still never read.
const { sql } = require('../db');
const { PLAN, SCAN_PLAN, countryForManualSubmission, storedOrLegacyGhs, legacyGhsForPlan } = require('../util');
const { nairaPriceForPlan, nairaPriceForScanPlan } = require('./funds');

function ghsAmountForManualSubscription(row) {
  const country = countryForManualSubmission(row.network_or_bank);
  // Stored amount for new rows; legacy GHS 550 for rows predating the
  // amount column — never the current 800 constant for an old sale.
  return country === 'NG' ? null : storedOrLegacyGhs(row.amount_cedis, row.plan);
}
function ghsAmountForManualScan(row) {
  const country = countryForManualSubmission(row.network_or_bank);
  return country === 'NG' ? null : storedOrLegacyGhs(row.amount_cedis, row.scan_plan);
}
function ngnAmountForManualSubscription(row) {
  const country = countryForManualSubmission(row.network_or_bank);
  return country === 'NG' ? nairaPriceForPlan(row.plan) : null;
}
function ngnAmountForManualScan(row) {
  const country = countryForManualSubmission(row.network_or_bank);
  return country === 'NG' ? nairaPriceForScanPlan(row.scan_plan) : null;
}

/** GHS-only deposit sum for a given window. Manual rows are only included if they're Ghanaian. Unknown plans are skipped, never thrown on. */
function sumGHS({ paystack, manual, akwapaySub, akwapayScan, manualScanGH = [], passesGHS = [], mines = [] }) {
  const sum1 = paystack.reduce((s, r) => s + (legacyGhsForPlan(r.plan) || 0), 0);
  const sum2 = manual.reduce((s, r) => s + (ghsAmountForManualSubscription(r) || 0), 0);
  const sum3 = akwapaySub.reduce((s, r) => {
    const real = r.paid_amount_cedis != null ? Number(r.paid_amount_cedis) : null;
    return s + ((real != null && real > 0) ? real : (legacyGhsForPlan(r.plan) || 0));
  }, 0);
  const sum4 = akwapayScan.reduce((s, r) => {
    const real = r.paid_amount_cedis != null ? Number(r.paid_amount_cedis) : null;
    return s + ((real != null && real > 0) ? real : (legacyGhsForPlan(r.scan_plan) || 0));
  }, 0);
  // Ghana manual scan purchases: previously in NEITHER sum (only AKWAPAY
  // scans entered sum4; NGN sums only take NG manual scans).
  const sum5 = manualScanGH.reduce((s, r) => s + (ghsAmountForManualScan(r) || 0), 0);
  // Pricing passes store their own amount + currency — use it as recorded.
  const sum6 = passesGHS.reduce((s, r) => s + (Number(r.amount) || 0), 0);
  // Mines purchases store amount_cedis.
  const sum7 = mines.reduce((s, r) => s + (Number(r.amount_cedis) || 0), 0);
  return sum1 + sum2 + sum3 + sum4 + sum5 + sum6 + sum7;
}

/** NGN-only deposit sum — Nigerian manual rows only (AkwaPay is Ghana-only, Paystack has no NG rail here). */
function sumNGN({ manual, manualScan, passesNGN = [] }) {
  const sub = (manual || []).reduce((s, r) => s + (ngnAmountForManualSubscription(r) || 0), 0);
  const scan = (manualScan || []).reduce((s, r) => s + (ngnAmountForManualScan(r) || 0), 0);
  const passes = (passesNGN || []).reduce((s, r) => s + (Number(r.amount) || 0), 0);
  return sub + scan + passes;
}

/** Ghana manual-scan rows out of an APPROVED scan_purchases fetch. */
function ghManualScans(scanRows) {
  return (scanRows || []).filter((r) => r.payment_method === 'MANUAL' && countryForManualSubmission(r.network_or_bank) === 'GH');
}

async function depositsOn(dateStr) {
  const db = sql();
  const [paystack, manual, akwapaySub, akwapayScan, passes, minesRows] = await Promise.all([
    db`SELECT plan FROM payment_transactions WHERE status = 'SUCCESS' AND verified_at IS NOT NULL AND verified_at::date = ${dateStr}::date`,
    db`SELECT plan, network_or_bank, amount_cedis FROM manual_payments WHERE status = 'APPROVED' AND reviewed_at IS NOT NULL AND reviewed_at::date = ${dateStr}::date`,
    db`SELECT plan, paid_amount_cedis FROM akwapay_payments WHERE status = 'APPROVED' AND reviewed_at IS NOT NULL AND reviewed_at::date = ${dateStr}::date`,
    db`SELECT scan_plan, network_or_bank, payment_method, paid_amount_cedis, amount_cedis FROM scan_purchases WHERE status = 'APPROVED' AND reviewed_at IS NOT NULL AND reviewed_at::date = ${dateStr}::date`,
    db`SELECT amount, currency FROM game_passes WHERE status = 'APPROVED' AND reviewed_at IS NOT NULL AND reviewed_at::date = ${dateStr}::date`,
    db`SELECT amount_cedis FROM mines_purchases WHERE status = 'APPROVED' AND reviewed_at IS NOT NULL AND reviewed_at::date = ${dateStr}::date`,
  ]);
  const akwapayScanOnly = akwapayScan.filter((r) => r.payment_method === 'AKWAPAY');
  return sumGHS({ paystack, manual, akwapaySub, akwapayScan: akwapayScanOnly, manualScanGH: ghManualScans(akwapayScan), passesGHS: passes.filter((r) => r.currency === 'GHS'), mines: minesRows });
}

/** Same window as depositsOn(), but the Nigerian Naira total instead of GHS. Never add this to depositsOn()'s result — different currencies. */
async function depositsOnNGN(dateStr) {
  const db = sql();
  const [manual, manualScan, passes] = await Promise.all([
    db`SELECT plan, network_or_bank, amount_cedis FROM manual_payments WHERE status = 'APPROVED' AND reviewed_at IS NOT NULL AND reviewed_at::date = ${dateStr}::date`,
    db`SELECT scan_plan, network_or_bank FROM scan_purchases WHERE status = 'APPROVED' AND reviewed_at IS NOT NULL AND reviewed_at::date = ${dateStr}::date AND payment_method = 'MANUAL'`,
    db`SELECT amount FROM game_passes WHERE status = 'APPROVED' AND reviewed_at IS NOT NULL AND reviewed_at::date = ${dateStr}::date AND currency = 'NGN'`,
  ]);
  return sumNGN({ manual, manualScan, passesNGN: passes });
}

async function depositsSince(sinceIso) {
  const db = sql();
  const [paystack, manual, akwapaySub, akwapayScan, passes, minesRows] = await Promise.all([
    db`SELECT plan FROM payment_transactions WHERE status = 'SUCCESS' AND verified_at >= ${sinceIso}`,
    db`SELECT plan, network_or_bank, amount_cedis FROM manual_payments WHERE status = 'APPROVED' AND reviewed_at >= ${sinceIso}`,
    db`SELECT plan, paid_amount_cedis FROM akwapay_payments WHERE status = 'APPROVED' AND reviewed_at >= ${sinceIso}`,
    db`SELECT scan_plan, network_or_bank, payment_method, paid_amount_cedis, amount_cedis FROM scan_purchases WHERE status = 'APPROVED' AND reviewed_at >= ${sinceIso}`,
    db`SELECT amount, currency FROM game_passes WHERE status = 'APPROVED' AND reviewed_at >= ${sinceIso}`,
    db`SELECT amount_cedis FROM mines_purchases WHERE status = 'APPROVED' AND reviewed_at >= ${sinceIso}`,
  ]);
  const akwapayScanOnly = akwapayScan.filter((r) => r.payment_method === 'AKWAPAY');
  return sumGHS({ paystack, manual, akwapaySub, akwapayScan: akwapayScanOnly, manualScanGH: ghManualScans(akwapayScan), passesGHS: passes.filter((r) => r.currency === 'GHS'), mines: minesRows });
}

async function depositsSinceNGN(sinceIso) {
  const db = sql();
  const [manual, manualScan, passes] = await Promise.all([
    db`SELECT plan, network_or_bank, amount_cedis FROM manual_payments WHERE status = 'APPROVED' AND reviewed_at >= ${sinceIso}`,
    db`SELECT scan_plan, network_or_bank FROM scan_purchases WHERE status = 'APPROVED' AND reviewed_at >= ${sinceIso} AND payment_method = 'MANUAL'`,
    db`SELECT amount FROM game_passes WHERE status = 'APPROVED' AND reviewed_at >= ${sinceIso} AND currency = 'NGN'`,
  ]);
  return sumNGN({ manual, manualScan, passesNGN: passes });
}

async function totalDepositsAllTime() {
  const db = sql();
  const [paystack, manual, akwapaySub, akwapayScan, passes, minesRows] = await Promise.all([
    db`SELECT plan FROM payment_transactions WHERE status = 'SUCCESS' AND verified_at IS NOT NULL`,
    db`SELECT plan, network_or_bank, amount_cedis FROM manual_payments WHERE status = 'APPROVED' AND reviewed_at IS NOT NULL`,
    db`SELECT plan, paid_amount_cedis FROM akwapay_payments WHERE status = 'APPROVED' AND reviewed_at IS NOT NULL`,
    db`SELECT scan_plan, network_or_bank, payment_method, paid_amount_cedis, amount_cedis FROM scan_purchases WHERE status = 'APPROVED' AND reviewed_at IS NOT NULL`,
    db`SELECT amount, currency FROM game_passes WHERE status = 'APPROVED' AND reviewed_at IS NOT NULL`,
    db`SELECT amount_cedis FROM mines_purchases WHERE status = 'APPROVED' AND reviewed_at IS NOT NULL`,
  ]);
  const akwapayScanOnly = akwapayScan.filter((r) => r.payment_method === 'AKWAPAY');
  return sumGHS({ paystack, manual, akwapaySub, akwapayScan: akwapayScanOnly, manualScanGH: ghManualScans(akwapayScan), passesGHS: passes.filter((r) => r.currency === 'GHS'), mines: minesRows });
}

async function totalDepositsAllTimeNGN() {
  const db = sql();
  const [manual, manualScan, passes] = await Promise.all([
    db`SELECT plan, network_or_bank, amount_cedis FROM manual_payments WHERE status = 'APPROVED' AND reviewed_at IS NOT NULL`,
    db`SELECT scan_plan, network_or_bank FROM scan_purchases WHERE status = 'APPROVED' AND reviewed_at IS NOT NULL AND payment_method = 'MANUAL'`,
    db`SELECT amount FROM game_passes WHERE status = 'APPROVED' AND reviewed_at IS NOT NULL AND currency = 'NGN'`,
  ]);
  return sumNGN({ manual, manualScan, passesNGN: passes });
}

async function successfulPaymentCount() {
  const db = sql();
  const [a, b, c, d, e, f, g] = await Promise.all([
    db`SELECT COUNT(*) c FROM payment_transactions WHERE status = 'SUCCESS' AND verified_at IS NOT NULL`,
    db`SELECT COUNT(*) c FROM manual_payments WHERE status = 'APPROVED' AND reviewed_at IS NOT NULL`,
    db`SELECT COUNT(*) c FROM akwapay_payments WHERE status = 'APPROVED' AND reviewed_at IS NOT NULL`,
    db`SELECT COUNT(*) c FROM scan_purchases WHERE status = 'APPROVED' AND reviewed_at IS NOT NULL`,
    db`SELECT COUNT(*) c FROM game_passes WHERE status = 'APPROVED' AND reviewed_at IS NOT NULL`,
    db`SELECT COUNT(*) c FROM mines_purchases WHERE status = 'APPROVED' AND reviewed_at IS NOT NULL`,
    db`SELECT COUNT(*) c FROM scan_sessions WHERE payment_method = 'MANUAL' AND activated_at IS NOT NULL AND status IN ('ACTIVE', 'EXPIRED')`,
  ]);
  return Number(a[0].c) + Number(b[0].c) + Number(c[0].c) + Number(d[0].c) + Number(e[0].c) + Number(f[0].c) + Number(g[0].c);
}

async function successfulPaymentCountOn(dateStr) {
  const db = sql();
  const [a, b, c, d, e, f, g] = await Promise.all([
    db`SELECT COUNT(*) c FROM payment_transactions WHERE status = 'SUCCESS' AND verified_at::date = ${dateStr}::date`,
    db`SELECT COUNT(*) c FROM manual_payments WHERE status = 'APPROVED' AND reviewed_at::date = ${dateStr}::date`,
    db`SELECT COUNT(*) c FROM akwapay_payments WHERE status = 'APPROVED' AND reviewed_at::date = ${dateStr}::date`,
    db`SELECT COUNT(*) c FROM scan_purchases WHERE status = 'APPROVED' AND reviewed_at::date = ${dateStr}::date`,
    db`SELECT COUNT(*) c FROM game_passes WHERE status = 'APPROVED' AND reviewed_at::date = ${dateStr}::date`,
    db`SELECT COUNT(*) c FROM mines_purchases WHERE status = 'APPROVED' AND reviewed_at::date = ${dateStr}::date`,
    db`SELECT COUNT(*) c FROM scan_sessions WHERE payment_method = 'MANUAL' AND activated_at::date = ${dateStr}::date AND status IN ('ACTIVE', 'EXPIRED')`,
  ]);
  return Number(a[0].c) + Number(b[0].c) + Number(c[0].c) + Number(d[0].c) + Number(e[0].c) + Number(f[0].c) + Number(g[0].c);
}

// ── Country/currency breakdown (2026-10-24) ─────────────────────────────
// Same approved rows as the totals above, split Ghana vs Nigeria vs
// unclassified — so the SA dashboard can show both countries instead of
// GHS cards only. INVARIANTS (asserted on the rig):
//   breakdown.ghana.depositsGHS === the legacy GHS deposit total, and
//   breakdown.nigeria.depositsNGN === the legacy NGN deposit total, for
//   the same window — the split never re-prices a row, it only sorts rows
//   into buckets using the codebase's EXISTING classification:
//   • manual_payments / manual scan_purchases: countryForManualSubmission
//     (closed GH network list → Ghana, anything else → Nigeria by design).
//   • payment_transactions (Paystack) + akwapay_payments + AKWAPAY scans:
//     Ghana — Paystack has no NG rail here, AkwaPay is Ghana-only.
//   • game_passes: stored currency column (GHS → Ghana, NGN → Nigeria).
//   • mines_purchases: Ghana — amount_cedis is the only price in code;
//     no NG price table exists for mines, so mines rows are NOT re-sorted
//     by network (that would move cedis-priced rows into Nigeria).
//   • legacy manual scan_sessions: COUNTS ONLY, never priced — exactly as
//     today's sums treat them — classified by the country stored at
//     submit, else network, else unclassified.
//   • scan_purchases with a payment_method other than MANUAL/AKWAPAY, and
//     game_passes with a currency other than GHS/NGN: unclassified
//     (counted, never guessed into a country, never priced).
//   • ghana.payments + nigeria.payments + unclassified.payments === the
//     legacy successful-payment count for the same window.
// UNPRICED (never 0-presented-as-real): a row classified to a country
// whose amount has no price source in code — Nigerian manual
// subscriptions on plan PREMIUM (PLAN_NAIRA has TWO_HOUR/THREE_HOUR/
// FIVE_HOUR only), or any row on an unknown legacy plan code — is
// counted in that country's payments AND in unpricedPayments, and
// contributes nothing to the deposit sum.
function emptyBreakdown() {
  return {
    ghana: { depositsGHS: 0, payments: 0, unpricedPayments: 0 },
    nigeria: { depositsNGN: 0, payments: 0, unpricedPayments: 0 },
    unclassified: { payments: 0 },
  };
}

function classifyRails({ paystack, manual, akwapaySub, akwapayScan, passes, mines, sessions }) {
  const b = emptyBreakdown();
  const gh = (amt) => { b.ghana.payments++; if (amt == null) b.ghana.unpricedPayments++; else b.ghana.depositsGHS += amt; };
  const ng = (amt) => { b.nigeria.payments++; if (amt == null) b.nigeria.unpricedPayments++; else b.nigeria.depositsNGN += amt; };
  const un = () => { b.unclassified.payments++; };
  for (const r of paystack) gh(legacyGhsForPlan(r.plan));
  for (const r of manual) {
    if (countryForManualSubmission(r.network_or_bank) === 'NG') ng(nairaPriceForPlan(r.plan));
    else gh(storedOrLegacyGhs(r.amount_cedis, r.plan));
  }
  for (const r of akwapaySub) {
    const real = r.paid_amount_cedis != null ? Number(r.paid_amount_cedis) : null;
    gh((real != null && real > 0) ? real : legacyGhsForPlan(r.plan));
  }
  for (const r of akwapayScan) {
    const real = r.paid_amount_cedis != null ? Number(r.paid_amount_cedis) : null;
    const ghsAmt = (real != null && real > 0) ? real : storedOrLegacyGhs(r.amount_cedis, r.scan_plan);
    if (r.payment_method === 'AKWAPAY') gh(ghsAmt);
    else if (r.payment_method === 'MANUAL') {
      if (countryForManualSubmission(r.network_or_bank) === 'NG') ng(nairaPriceForScanPlan(r.scan_plan));
      else gh(ghsAmt);
    } else un();
  }
  for (const r of passes) {
    if (r.currency === 'GHS') gh(Number(r.amount) || 0);
    else if (r.currency === 'NGN') ng(Number(r.amount) || 0);
    else un();
  }
  for (const r of mines) gh(Number(r.amount_cedis) || 0);
  for (const r of sessions) {
    if (r.country === 'NG') b.nigeria.payments++;
    else if (r.country === 'GH') b.ghana.payments++;
    else if (r.network_or_bank) {
      if (countryForManualSubmission(r.network_or_bank) === 'NG') b.nigeria.payments++;
      else b.ghana.payments++;
    } else un();
  }
  return b;
}

async function breakdownOn(dateStr) {
  const db = sql();
  const [paystack, manual, akwapaySub, akwapayScan, passes, mines, sessions] = await Promise.all([
    db`SELECT plan FROM payment_transactions WHERE status = 'SUCCESS' AND verified_at IS NOT NULL AND verified_at::date = ${dateStr}::date`,
    db`SELECT plan, network_or_bank, amount_cedis FROM manual_payments WHERE status = 'APPROVED' AND reviewed_at IS NOT NULL AND reviewed_at::date = ${dateStr}::date`,
    db`SELECT plan, paid_amount_cedis FROM akwapay_payments WHERE status = 'APPROVED' AND reviewed_at IS NOT NULL AND reviewed_at::date = ${dateStr}::date`,
    db`SELECT scan_plan, network_or_bank, payment_method, paid_amount_cedis, amount_cedis FROM scan_purchases WHERE status = 'APPROVED' AND reviewed_at IS NOT NULL AND reviewed_at::date = ${dateStr}::date`,
    db`SELECT amount, currency FROM game_passes WHERE status = 'APPROVED' AND reviewed_at IS NOT NULL AND reviewed_at::date = ${dateStr}::date`,
    db`SELECT amount_cedis FROM mines_purchases WHERE status = 'APPROVED' AND reviewed_at IS NOT NULL AND reviewed_at::date = ${dateStr}::date`,
    db`SELECT country, network_or_bank FROM scan_sessions WHERE payment_method = 'MANUAL' AND activated_at IS NOT NULL AND activated_at::date = ${dateStr}::date AND status IN ('ACTIVE', 'EXPIRED')`,
  ]);
  return classifyRails({ paystack, manual, akwapaySub, akwapayScan, passes, mines, sessions });
}

async function breakdownSince(sinceIso) {
  const db = sql();
  const [paystack, manual, akwapaySub, akwapayScan, passes, mines, sessions] = await Promise.all([
    db`SELECT plan FROM payment_transactions WHERE status = 'SUCCESS' AND verified_at >= ${sinceIso}`,
    db`SELECT plan, network_or_bank, amount_cedis FROM manual_payments WHERE status = 'APPROVED' AND reviewed_at >= ${sinceIso}`,
    db`SELECT plan, paid_amount_cedis FROM akwapay_payments WHERE status = 'APPROVED' AND reviewed_at >= ${sinceIso}`,
    db`SELECT scan_plan, network_or_bank, payment_method, paid_amount_cedis, amount_cedis FROM scan_purchases WHERE status = 'APPROVED' AND reviewed_at >= ${sinceIso}`,
    db`SELECT amount, currency FROM game_passes WHERE status = 'APPROVED' AND reviewed_at >= ${sinceIso}`,
    db`SELECT amount_cedis FROM mines_purchases WHERE status = 'APPROVED' AND reviewed_at >= ${sinceIso}`,
    db`SELECT country, network_or_bank FROM scan_sessions WHERE payment_method = 'MANUAL' AND activated_at >= ${sinceIso} AND status IN ('ACTIVE', 'EXPIRED')`,
  ]);
  return classifyRails({ paystack, manual, akwapaySub, akwapayScan, passes, mines, sessions });
}

async function breakdownAllTime() {
  const db = sql();
  const [paystack, manual, akwapaySub, akwapayScan, passes, mines, sessions] = await Promise.all([
    db`SELECT plan FROM payment_transactions WHERE status = 'SUCCESS' AND verified_at IS NOT NULL`,
    db`SELECT plan, network_or_bank, amount_cedis FROM manual_payments WHERE status = 'APPROVED' AND reviewed_at IS NOT NULL`,
    db`SELECT plan, paid_amount_cedis FROM akwapay_payments WHERE status = 'APPROVED' AND reviewed_at IS NOT NULL`,
    db`SELECT scan_plan, network_or_bank, payment_method, paid_amount_cedis, amount_cedis FROM scan_purchases WHERE status = 'APPROVED' AND reviewed_at IS NOT NULL`,
    db`SELECT amount, currency FROM game_passes WHERE status = 'APPROVED' AND reviewed_at IS NOT NULL`,
    db`SELECT amount_cedis FROM mines_purchases WHERE status = 'APPROVED' AND reviewed_at IS NOT NULL`,
    db`SELECT country, network_or_bank FROM scan_sessions WHERE payment_method = 'MANUAL' AND activated_at IS NOT NULL AND status IN ('ACTIVE', 'EXPIRED')`,
  ]);
  return classifyRails({ paystack, manual, akwapaySub, akwapayScan, passes, mines, sessions });
}

module.exports = {
  depositsOn, depositsOnNGN,
  depositsSince, depositsSinceNGN,
  totalDepositsAllTime, totalDepositsAllTimeNGN,
  successfulPaymentCount, successfulPaymentCountOn,
  breakdownOn, breakdownSince, breakdownAllTime,
};
