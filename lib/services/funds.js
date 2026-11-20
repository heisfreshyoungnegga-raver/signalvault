// lib/services/funds.js — new reporting layer on top of the four payment
// rails (Paystack, manual, AkwaPay subscription, AkwaPay scan
// purchase/session). Used by the new /api/admin/funds,
// /api/superadmin/funds, and /api/superadmin/transactions endpoints.
const { sql } = require('../db');
const { PLAN, SCAN_PLAN, countryForManualSubmission, storedOrLegacyGhs, legacyGhsForPlan } = require('../util');

// ── Naira price tables ──────────────────────────────────────────────────
// CRITICAL FIX: manual (bank-transfer) payments from Nigeria are charged in
// Naira, not Cedis — see the PLANS_NG / SCAN_PLANS_NG tables in
// public/games.html and public/scan.html. The backend previously had no
// concept of this at all: it always looked up PLAN[plan].amountCedis (a
// Cedi figure) and added it straight into the same running total as
// genuine Cedi payments, silently mixing two different currencies into one
// number. These tables mirror the frontend's real Naira prices so Nigerian
// revenue can be tracked correctly, in its own currency, and NEVER summed
// into a GHS total.
const PLAN_NAIRA = {
  TWO_HOUR:   20000,
  THREE_HOUR: 40000,
  FIVE_HOUR:  60000,
  // LEGACY NGN PRICES (pre-2026-11-20 tiers) — reporting only.
  // These price pre-cutover NG rows in funds reports / commissions.
  // NEW NGN pack prices are NOT SET (credits.js priceNgn is null);
  // do not read this table as the price of a new NGN pack.
  STARTER:   47000,
  STANDARD:  56000,
  PREMIUM:   94000,
  VAULT:     188000,
};
// Manual "single-slip" scan purchases (scan_plan: BASIC/STANDARD/PREMIUM).
// Confirmed real Naira prices — same as the scan-session table below.
// UPDATE (2026-09-05): AkwaPay is down, so this is no longer Nigeria-only —
// Ghana also submits manual scan purchases now (see countryForManualSubmission
// in util.js, which tells a GH manual row apart from an NG one by network
// name). Ghana rows use SCAN_PLAN.amountCedis directly; this table only
// prices the Nigerian (Naira) rows.
const SCAN_PLAN_NAIRA = {
  BASIC:    20000,
  // LEGACY NGN PRICES (pre-2026-11-20 tiers) — reporting only,
  // same note as PLAN_NAIRA: NEW NGN pack prices are NOT SET.
  STARTER:  47000,
  STANDARD: 56000,
  PREMIUM:  94000,
  VAULT:    188000,
};
// Nigeria "manual" flow for scan sessions submits under the SESSION_*
// codes shown in public/scan.html's SCAN_PLANS_NG, mapped onto the same
// BASIC/STANDARD/PREMIUM plan names used everywhere else in this codebase.
const SCAN_SESSION_PLAN_NAIRA = {
  BASIC:    20000,
  STANDARD: 40000,
  PREMIUM:  60000,
};

function nairaPriceForPlan(planName) {
  return PLAN_NAIRA[planName] ?? null;
}
function nairaPriceForScanPlan(planName) {
  return SCAN_PLAN_NAIRA[planName] ?? null;
}
function nairaPriceForScanSessionPlan(planName) {
  return SCAN_SESSION_PLAN_NAIRA[planName] ?? null;
}

// ── Admin: funds generated + commissions earned through their referrals ────
async function fundsForAdmin(adminUsername) {
  const db = sql();
  const records = await db`
    SELECT * FROM commission_records WHERE admin_username = ${adminUsername} ORDER BY created_at DESC
  `;

  // CRITICAL FIX: commission_records now has a currency column (see
  // schema.sql). Previously every row was summed together regardless of
  // currency — an admin with both a GHS commission and an NGN commission
  // would have had them silently added into one meaningless number. GHS
  // and NGN are now totalled completely separately.
  let totalFundsGeneratedGHS = 0, totalCommissionEarnedGHS = 0, totalCommissionPendingGHS = 0, totalCommissionPaidOutGHS = 0;
  let totalFundsGeneratedNGN = 0, totalCommissionEarnedNGN = 0, totalCommissionPendingNGN = 0, totalCommissionPaidOutNGN = 0;
  const byPaymentMethod = {};    // GHS only, for backward compatibility
  const byPlan = {};             // GHS only, for backward compatibility

  for (const r of records) {
    const amount = Number(r.amount_cedis);
    const share = Number(r.admin_share_cedis);
    const currency = r.currency || 'GHS';

    if (currency === 'NGN') {
      totalFundsGeneratedNGN += amount;
      totalCommissionEarnedNGN += share;
      if (r.paid_out) totalCommissionPaidOutNGN += share;
      else totalCommissionPendingNGN += share;
      continue; // NGN rows never touch the GHS breakdowns below
    }

    totalFundsGeneratedGHS += amount;
    totalCommissionEarnedGHS += share;
    if (r.paid_out) totalCommissionPaidOutGHS += share;
    else totalCommissionPendingGHS += share;

    const method = methodFromCommissionReference(r.payment_reference);
    byPaymentMethod[method] = (byPaymentMethod[method] || 0) + amount;

    const planKey = r.plan || 'SCAN_SESSION';
    byPlan[planKey] = (byPlan[planKey] || 0) + amount;
  }

  return {
    adminUsername,
    currency: 'GHS',
    totalFundsGenerated: totalFundsGeneratedGHS,
    totalCommissionEarned: totalCommissionEarnedGHS,
    totalCommissionPending: totalCommissionPendingGHS,
    totalCommissionPaidOut: totalCommissionPaidOutGHS,
    referredPaymentCount: records.length,
    byPaymentMethod,
    byPlan,
    // Nigerian (Naira) commissions — tracked separately, never added into
    // the GHS figures above.
    totalFundsGeneratedNGN,
    totalCommissionEarnedNGN,
    totalCommissionPendingNGN,
    totalCommissionPaidOutNGN,
  };
}

function methodFromCommissionReference(ref) {
  if (ref.startsWith('MANUAL_')) return 'MANUAL';
  if (ref.startsWith('SHINOBIPAY_SCAN_SESSION_')) return 'SHINOBIPAY_SCAN_SESSION';
  if (ref.startsWith('SHINOBIPAY_')) return 'SHINOBIPAY_SUBSCRIPTION';
  if (ref.startsWith('AKWAPAY_SCAN_SESSION_')) return 'AKWAPAY_SCAN_SESSION';
  if (ref.startsWith('AKWAPAY_')) return 'AKWAPAY_SUBSCRIPTION';
  return 'PAYSTACK';
}

// ── Super admin: platform-wide funds, by admin, by payment method, by country
// CRITICAL FIX: previously this function added every row's amount into one
// running `total`, regardless of what currency that row was actually paid
// in. AkwaPay rows are always genuine GHS (Ghana-only mobile money — see
// akwapayCore.js's GH_NETWORK_PREFIXES). But MANUAL rows can be Nigerian
// bank transfers, which are paid in Naira, not Cedis. The old code looked
// up PLAN[plan].amountCedis (a Cedi number) for those Naira payments and
// summed it straight into the same GHS total — silently mixing two
// different currencies together and producing a meaningless number.
// Fix: GHS and NGN are now tracked as two completely separate totals.
// NGN amounts always come from the real Naira price tables above, never
// from amountCedis. Nothing NGN-denominated is ever added into totalFunds.
async function platformFunds() {
  const db = sql();
  // The manual/scan SELECTs below read amount_cedis: heal the column
  // first (function-scope requires — manualPayment lazily requires funds
  // at approve time, so no top-level cycle).
  await require('./manualPayment').ensureSchema();
  await require('./scanPurchase').ensureSchema();

  const [paystack, manual, akwapaySub, akwapayScanRows, manualScanRows, sessionRows, webrabbitRows, commissionRows, shinobiSub, shinobiScanRows] = await Promise.all([
    db`SELECT plan, email FROM payment_transactions WHERE status = 'SUCCESS' AND verified_at IS NOT NULL`,
    db`SELECT plan, email, network_or_bank, amount_cedis FROM manual_payments WHERE status = 'APPROVED' AND reviewed_at IS NOT NULL`,
    db`SELECT plan, email, country, paid_amount_cedis FROM akwapay_payments WHERE status = 'APPROVED' AND reviewed_at IS NOT NULL`,
    db`SELECT scan_plan, email, country, paid_amount_cedis FROM scan_purchases WHERE status = 'APPROVED' AND reviewed_at IS NOT NULL AND payment_method = 'AKWAPAY'`,
    db`SELECT scan_plan, email, network_or_bank, amount_cedis FROM scan_purchases WHERE status = 'APPROVED' AND reviewed_at IS NOT NULL AND payment_method = 'MANUAL'`,
    db`SELECT plan, email, country, paid_amount_cedis, payment_method FROM scan_sessions WHERE status IN ('ACTIVE', 'EXPIRED') AND activated_at IS NOT NULL`,
    db`SELECT amount, country FROM webrabbit_payments WHERE status = 'APPROVED'`,
    db`SELECT * FROM commission_records`,
    db`SELECT plan, email, country, paid_amount_cedis FROM shinobipay_payments WHERE status = 'APPROVED' AND reviewed_at IS NOT NULL`,
    db`SELECT scan_plan, email, country, paid_amount_cedis FROM scan_purchases WHERE status = 'APPROVED' AND reviewed_at IS NOT NULL AND payment_method = 'SHINOBIPAY'`,
  ]);

  // ── GHS side (Paystack + all AkwaPay rails + Ghanaian manual payments) ──
  const byPaymentMethodGHS = { PAYSTACK: 0, MANUAL: 0, AKWAPAY_SUBSCRIPTION: 0, AKWAPAY_SCAN: 0, AKWAPAY_SCAN_SESSION: 0, WEBRABBIT: 0, SHINOBIPAY_SUBSCRIPTION: 0, SHINOBIPAY_SCAN: 0, SHINOBIPAY_SCAN_SESSION: 0 };
  let totalGHS = 0;

  // ── NGN side (Nigerian manual payments only — AkwaPay is Ghana-only) ───
  const byPaymentMethodNGN = { MANUAL: 0, AKWAPAY_SCAN: 0, AKWAPAY_SCAN_SESSION: 0 };
  let totalNGN = 0;
  let unpricedNgnCount = 0; // rows with no known Naira price — flagged, never guessed

  const byCountry = {};       // GHS-only, for backward compatibility with existing dashboards
  const byCountryMethod = {}; // GHS-only, same reason
  function recordGHS(country, method, amt) {
    byPaymentMethodGHS[method] += amt;
    totalGHS += amt;
    byCountry[country] = (byCountry[country] || 0) + amt;
    if (!byCountryMethod[country]) byCountryMethod[country] = { PAYSTACK: 0, MANUAL: 0, AKWAPAY_SUBSCRIPTION: 0, AKWAPAY_SCAN: 0, AKWAPAY_SCAN_SESSION: 0, WEBRABBIT: 0, SHINOBIPAY_SUBSCRIPTION: 0, SHINOBIPAY_SCAN: 0, SHINOBIPAY_SCAN_SESSION: 0 };
    byCountryMethod[country][method] += amt;
  }
  function recordNGN(method, amt) {
    if (amt == null) { unpricedNgnCount++; return; }
    byPaymentMethodNGN[method] += amt;
    totalNGN += amt;
  }

  // Prefer the real amount AkwaPay confirmed was paid (captured at
  // settlement — see schema.sql's paid_amount_cedis) over the static plan
  // price. Falls back to the plan price only for rows settled before this
  // column existed, or in the rare case AkwaPay's response omitted amount.
  function realOrPlanAmount(row, planAmount) {
    const real = row.paid_amount_cedis != null ? Number(row.paid_amount_cedis) : null;
    return (real != null && real > 0) ? real : planAmount;
  }

  // Paystack — always GHS, no phone/bank captured today so country is UNKNOWN
  for (const r of paystack) {
    recordGHS('UNKNOWN', 'PAYSTACK', legacyGhsForPlan(r.plan));
  }

  // Manual subscriptions — GHS if Ghanaian, NGN if Nigerian (real Naira price, never amountCedis)
  for (const r of manual) {
    const country = countryForManualSubmission(r.network_or_bank);
    if (country === 'NG') {
      recordNGN('MANUAL', nairaPriceForPlan(r.plan));
    } else {
      recordGHS(country, 'MANUAL', storedOrLegacyGhs(r.amount_cedis, r.plan));
    }
  }

  // AkwaPay subscriptions — always genuine GHS (mobile money is Ghana-only).
  // Uses the real amount AkwaPay confirms was paid, not the plan price.
  for (const r of akwapaySub) {
    recordGHS(r.country || 'UNKNOWN', 'AKWAPAY_SUBSCRIPTION', realOrPlanAmount(r, legacyGhsForPlan(r.plan)));
  }

  // AkwaPay scan purchases — always genuine GHS. Uses the real confirmed amount.
  for (const r of akwapayScanRows) {
    recordGHS(r.country || 'UNKNOWN', 'AKWAPAY_SCAN', realOrPlanAmount(r, legacyGhsForPlan(r.scan_plan)));
  }

  // Manual scan purchases — GHS if Ghanaian, NGN if Nigerian. No Naira price
  // table exists for these plan codes today (see SCAN_PLAN_NAIRA comment
  // above), so any Nigerian row here is counted as "unpriced" rather than
  // guessed at in the wrong currency.
  for (const r of manualScanRows) {
    const country = countryForManualSubmission(r.network_or_bank);
    if (country === 'NG') {
      recordNGN('AKWAPAY_SCAN', nairaPriceForScanPlan(r.scan_plan));
    } else {
      recordGHS(country, 'AKWAPAY_SCAN', storedOrLegacyGhs(r.amount_cedis, r.scan_plan));
    }
  }

  // ShinobiPay subscriptions + scan purchases — always genuine GHS. Uses the
  // real amount ShinobiPay confirms was paid, captured at settlement.
  for (const r of shinobiSub) {
    recordGHS(r.country || 'UNKNOWN', 'SHINOBIPAY_SUBSCRIPTION', realOrPlanAmount(r, legacyGhsForPlan(r.plan)));
  }
  for (const r of shinobiScanRows) {
    recordGHS(r.country || 'UNKNOWN', 'SHINOBIPAY_SCAN', realOrPlanAmount(r, legacyGhsForPlan(r.scan_plan)));
  }

  // Scan sessions — always genuine GHS (mobile money, Ghana-only). ShinobiPay
  // sessions get their own bucket; everything else keeps the historical one.
  // Uses the real confirmed amount, not the static session-plan price.
  for (const r of sessionRows) {
    const method = r.payment_method === 'SHINOBIPAY' ? 'SHINOBIPAY_SCAN_SESSION' : 'AKWAPAY_SCAN_SESSION';
    recordGHS(r.country || 'UNKNOWN', method, realOrPlanAmount(r, require('../util').SCAN_SESSION_PLAN[r.plan].amountCedis));
  }

  for (const r of webrabbitRows) recordGHS(r.country || 'GH', 'WEBRABBIT', Number(r.amount));

  // Admin/referral breakdown — GHS only (commission_records.currency splits
  // this the same way; direct/no-referral is always computed against the
  // GHS total, since referredTotal here only sums GHS commission rows).
  const byAdmin = {};
  let referredTotal = 0;
  for (const c of commissionRows) {
    if ((c.currency || 'GHS') !== 'GHS') continue; // NGN commissions excluded from this GHS breakdown
    const amt = Number(c.amount_cedis);
    byAdmin[c.admin_username] = (byAdmin[c.admin_username] || 0) + amt;
    referredTotal += amt;
  }
  const direct = Math.max(totalGHS - referredTotal, 0);

  return {
    // GHS figures — safe to sum, everything here really is Cedis.
    totalFunds: totalGHS,
    currency: 'GHS',
    ghanaBalance: byCountry.GH || 0,
    byPaymentMethod: byPaymentMethodGHS,
    byCountry,
    byCountryMethod,
    byAdmin: { ...byAdmin, DIRECT_NO_REFERRAL: direct },

    // NGN figures — deliberately kept separate, never added into totalFunds.
    totalFundsNGN: totalNGN,
    byPaymentMethodNGN,
    unpricedNgnPaymentCount: unpricedNgnCount,

    // Deprecated field kept for any old caller: this used to be a
    // Cedi-mislabeled Naira number (see the bug fixed above). It's zeroed
    // rather than removed so nothing crashes reading it, but nothing
    // should rely on it going forward — use totalFundsNGN instead.
    nigeriaBalance: 0,
  };
}

// ── Super admin: full transaction list across all 4 rails ──────────────────
async function allTransactions({ method, status, limit = 200, offset = 0 } = {}) {
  const db = sql();
  const rows = [];

  if (!method || method === 'PAYSTACK') {
    const txs = await db`SELECT * FROM payment_transactions ORDER BY created_at DESC LIMIT 500`;
    for (const t of txs) {
      rows.push({
        method: 'PAYSTACK',
        id: t.reference,
        email: t.email,
        plan: t.plan,
        amountCedis: legacyGhsForPlan(t.plan),
        amount: legacyGhsForPlan(t.plan),
        currency: 'GHS',
        status: t.status,
        reference: t.reference,
        createdAt: t.created_at,
        settledAt: t.verified_at,
      });
    }
  }
  if (!method || method === 'MANUAL') {
    const txs = await db`SELECT * FROM manual_payments ORDER BY submitted_at DESC LIMIT 500`;
    for (const t of txs) {
      const country = countryForManualSubmission(t.network_or_bank);
      // CRITICAL FIX: a Nigerian manual subscription is paid in Naira, not
      // Cedis. Previously this row always reported PLAN[plan].amountCedis
      // (a Cedi figure, always 1 before the pricing fix) regardless of
      // country, so Nigerian payments looked GHS-denominated everywhere
      // this transaction feeds into. `amount` + `currency` now reflect the
      // real value actually charged; `amountCedis` is kept only for GHS
      // rows and for backward compatibility with older callers.
      const amount = country === 'NG' ? nairaPriceForPlan(t.plan) : storedOrLegacyGhs(t.amount_cedis, t.plan);
      const currency = country === 'NG' ? 'NGN' : 'GHS';
      rows.push({
        method: 'MANUAL',
        id: t.id,
        email: t.email,
        plan: t.plan,
        amountCedis: currency === 'GHS' ? amount : null,
        amount,
        currency,
        status: t.status,
        reference: t.reference,
        accountName: t.account_name,
        accountNumber: t.account_number,
        networkOrBank: t.network_or_bank,
        country,
        screenshotUrl: t.screenshot_url,
        createdAt: t.submitted_at,
        settledAt: t.reviewed_at,
      });
    }
  }
  if (!method || method === 'AKWAPAY_SUBSCRIPTION') {
    const txs = await db`SELECT * FROM akwapay_payments ORDER BY submitted_at DESC LIMIT 500`;
    for (const t of txs) {
      // Prefer the real amount AkwaPay confirmed was paid over the static
      // plan price — see schema.sql's paid_amount_cedis comment.
      const real = t.paid_amount_cedis != null ? Number(t.paid_amount_cedis) : null;
      const amount = (real != null && real > 0) ? real : legacyGhsForPlan(t.plan);
      rows.push({
        method: 'AKWAPAY_SUBSCRIPTION',
        id: t.id,
        email: t.email,
        plan: t.plan,
        amountCedis: amount,
        amount,
        currency: 'GHS',
        confirmedByAkwapay: real != null,
        status: t.status,
        reference: t.reference,
        akwapayIntentId: t.intent_id,
        phone: t.phone,
        network: t.network,
        country: t.country,
        failureReason: t.failure_reason,
        createdAt: t.submitted_at,
        settledAt: t.reviewed_at,
      });
    }
  }
  if (!method || method === 'AKWAPAY_SCAN') {
    const txs = await db`SELECT * FROM scan_purchases WHERE payment_method = 'AKWAPAY' ORDER BY submitted_at DESC LIMIT 500`;
    for (const t of txs) {
      const real = t.paid_amount_cedis != null ? Number(t.paid_amount_cedis) : null;
      const amount = (real != null && real > 0) ? real : legacyGhsForPlan(t.scan_plan);
      rows.push({
        method: 'AKWAPAY_SCAN',
        id: t.id,
        email: t.email,
        scanPlan: t.scan_plan,
        amountCedis: amount,
        amount,
        currency: 'GHS',
        confirmedByAkwapay: real != null,
        status: t.status,
        reference: t.akwapay_reference,
        akwapayIntentId: t.akwapay_intent_id,
        phone: t.phone,
        network: t.network,
        country: t.country,
        createdAt: t.submitted_at,
        settledAt: t.reviewed_at,
        usedAt: t.used_at,
      });
    }
  }
  if (!method || method === 'AKWAPAY_SCAN_MANUAL') {
    const txs = await db`SELECT * FROM scan_purchases WHERE payment_method = 'MANUAL' ORDER BY submitted_at DESC LIMIT 500`;
    for (const t of txs) {
      const country = countryForManualSubmission(t.network_or_bank);
      // CRITICAL FIX: same currency-mixing bug as MANUAL above. Unlike
      // subscriptions, there is currently no Naira price list anywhere in
      // the frontend for these BASIC/STANDARD/PREMIUM scan-purchase codes
      // (public/scan.html's Nigeria flow only offers scan *sessions*, a
      // different plan table). Rather than guess, a Nigerian row here is
      // marked unpriced — amount/amountCedis are null and `unpriced: true`
      // is set, so nothing downstream can accidentally sum it into either
      // currency's total. Fix by adding a real Naira price table if/when
      // this flow is priced for Nigeria.
      const amount = country === 'NG' ? nairaPriceForScanPlan(t.scan_plan) : storedOrLegacyGhs(t.amount_cedis, t.scan_plan);
      const currency = country === 'NG' ? 'NGN' : 'GHS';
      rows.push({
        method: 'MANUAL_SCAN',
        id: t.id,
        email: t.email,
        scanPlan: t.scan_plan,
        amountCedis: currency === 'GHS' ? amount : null,
        amount,
        currency,
        unpriced: amount == null,
        status: t.status,
        reference: t.reference,
        accountName: t.account_name,
        accountNumber: t.account_number,
        networkOrBank: t.network_or_bank,
        country,
        screenshotUrl: t.screenshot_url,
        createdAt: t.submitted_at,
        settledAt: t.reviewed_at,
        usedAt: t.used_at,
      });
    }
  }
  if (!method || method === 'AKWAPAY_SCAN_SESSION') {
    // Only include sessions that have been paid and activated — mirrors the
    // platformFunds() filter of status IN ('ACTIVE', 'EXPIRED'). Pulling in
    // AWAITING_PAYMENT and FAILED rows was causing genuine payments to show as
    // "FAILED" in the transaction list even after crediting succeeded.
    const txs = await db`SELECT * FROM scan_sessions WHERE status IN ('ACTIVE', 'EXPIRED') ORDER BY created_at DESC LIMIT 500`;
    const { SCAN_SESSION_PLAN } = require('../util');
    for (const t of txs) {
      const real = t.paid_amount_cedis != null ? Number(t.paid_amount_cedis) : null;
      const amount = (real != null && real > 0) ? real : SCAN_SESSION_PLAN[t.plan].amountCedis;
      rows.push({
        method: 'AKWAPAY_SCAN_SESSION',
        id: t.id,
        email: t.email,
        plan: t.plan,
        amountCedis: amount,
        amount,
        currency: 'GHS',
        confirmedByAkwapay: real != null,
        status: t.status,
        reference: t.akwapay_reference,
        akwapayIntentId: t.akwapay_intent_id,
        phone: t.phone,
        network: t.network,
        country: t.country,
        scanCount: t.scan_count,
        accountName: t.account_name,
        accountNumber: t.account_number,
        networkOrBank: t.network_or_bank,
        screenshotUrl: t.manual_screenshot_url,
        createdAt: t.created_at,
        settledAt: t.activated_at,
        expiresAt: t.expires_at,
      });
    }
  }

  if (!method || method === 'WEBRABBIT') {
    const txs = await db`SELECT * FROM webrabbit_payments ORDER BY submitted_at DESC LIMIT 500`;
    for (const t of txs) rows.push({
      method: 'WEBRABBIT', id: t.id, email: t.email, plan: t.plan,
      amountCedis: Number(t.amount), amount: Number(t.amount), currency: 'GHS', status: t.status,
      reference: t.rabbit_transaction_id, transactionId: t.rabbit_transaction_id,
      providerTransactionId: t.provider_transaction_id, phone: t.subscriber_number,
      network: t.network, country: 'GH', reason: t.reason, createdAt: t.submitted_at, settledAt: t.settled_at,
    });
  }

  let filtered = rows;
  if (status) filtered = filtered.filter((r) => r.status === status.toUpperCase());
  filtered.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));

  const total = filtered.length;
  const page = filtered.slice(offset, offset + limit);
  return { total, count: page.length, limit, offset, transactions: page };
}

// ── Super admin: day-by-day revenue for the last N days ─────────────────────
// Same currency-safety rules as platformFunds(): AkwaPay rows are always
// genuine GHS; MANUAL rows are GHS or NGN depending on the submitter's
// bank/network, using the real Naira price tables above — never mixed
// together. Each day in the returned array carries its own GHS total,
// NGN total, per-method breakdown, and payment count, so the dashboard can
// render a day-by-day chart without ever silently combining currencies.
function dateKeyUTC(d) {
  return new Date(d).toISOString().slice(0, 10); // 'YYYY-MM-DD', UTC
}

async function dailyFunds(days = 30) {
  const db = sql();
  await require('./manualPayment').ensureSchema();
  await require('./scanPurchase').ensureSchema();
  const parsed = Number(days);
  const n = Number.isFinite(parsed) && parsed > 0 ? Math.min(Math.floor(parsed), 365) : 30;
  const sinceIso = new Date(Date.now() - (n - 1) * 24 * 3600 * 1000).toISOString();

  const [paystack, manual, akwapaySub, akwapayScanRows, manualScanRows, sessionRows, webrabbitRows] = await Promise.all([
    db`SELECT plan, verified_at AS settled_at FROM payment_transactions WHERE status = 'SUCCESS' AND verified_at >= ${sinceIso}`,
    db`SELECT plan, network_or_bank, amount_cedis, reviewed_at AS settled_at FROM manual_payments WHERE status = 'APPROVED' AND reviewed_at >= ${sinceIso}`,
    db`SELECT plan, reviewed_at AS settled_at, paid_amount_cedis FROM akwapay_payments WHERE status = 'APPROVED' AND reviewed_at >= ${sinceIso}`,
    db`SELECT scan_plan, reviewed_at AS settled_at, paid_amount_cedis FROM scan_purchases WHERE status = 'APPROVED' AND reviewed_at >= ${sinceIso} AND payment_method = 'AKWAPAY'`,
    db`SELECT scan_plan, network_or_bank, amount_cedis, reviewed_at AS settled_at FROM scan_purchases WHERE status = 'APPROVED' AND reviewed_at >= ${sinceIso} AND payment_method = 'MANUAL'`,
    db`SELECT plan, activated_at AS settled_at, paid_amount_cedis FROM scan_sessions WHERE status IN ('ACTIVE', 'EXPIRED') AND activated_at >= ${sinceIso}`,
    db`SELECT amount, settled_at FROM webrabbit_payments WHERE status = 'APPROVED' AND settled_at >= ${sinceIso}`,
  ]);

  // Pre-seed every day in the range (even days with zero revenue) so the
  // chart has a continuous x-axis instead of gaps.
  const byDate = {};
  for (let i = 0; i < n; i++) {
    const d = new Date(Date.now() - i * 24 * 3600 * 1000);
    const key = dateKeyUTC(d);
    byDate[key] = {
      date: key,
      totalGHS: 0,
      totalNGN: 0,
      byMethodGHS: { PAYSTACK: 0, MANUAL: 0, AKWAPAY_SUBSCRIPTION: 0, AKWAPAY_SCAN: 0, AKWAPAY_SCAN_SESSION: 0, WEBRABBIT: 0 },
      byMethodNGN: { MANUAL: 0, AKWAPAY_SCAN: 0 },
      paymentCount: 0,
      unpricedNgnCount: 0,
    };
  }

  function bump(settledAt, currency, method, amt) {
    const key = dateKeyUTC(settledAt);
    const bucket = byDate[key];
    if (!bucket) return; // outside the requested window (shouldn't happen given the WHERE clause, but stay safe)
    if (currency === 'NGN') {
      if (amt == null) { bucket.unpricedNgnCount++; return; }
      bucket.totalNGN += amt;
      bucket.byMethodNGN[method] = (bucket.byMethodNGN[method] || 0) + amt;
    } else {
      bucket.totalGHS += amt;
      bucket.byMethodGHS[method] = (bucket.byMethodGHS[method] || 0) + amt;
    }
    bucket.paymentCount++;
  }

  function realOrPlan(row, planAmount) {
    const real = row.paid_amount_cedis != null ? Number(row.paid_amount_cedis) : null;
    return (real != null && real > 0) ? real : planAmount;
  }

  for (const r of paystack) {
    bump(r.settled_at, 'GHS', 'PAYSTACK', legacyGhsForPlan(r.plan));
  }
  for (const r of manual) {
    const country = countryForManualSubmission(r.network_or_bank);
    if (country === 'NG') bump(r.settled_at, 'NGN', 'MANUAL', nairaPriceForPlan(r.plan));
    else bump(r.settled_at, 'GHS', 'MANUAL', storedOrLegacyGhs(r.amount_cedis, r.plan));
  }
  for (const r of akwapaySub) {
    bump(r.settled_at, 'GHS', 'AKWAPAY_SUBSCRIPTION', realOrPlan(r, legacyGhsForPlan(r.plan)));
  }
  for (const r of akwapayScanRows) {
    bump(r.settled_at, 'GHS', 'AKWAPAY_SCAN', realOrPlan(r, legacyGhsForPlan(r.scan_plan)));
  }
  for (const r of manualScanRows) {
    const country = countryForManualSubmission(r.network_or_bank);
    if (country === 'NG') bump(r.settled_at, 'NGN', 'AKWAPAY_SCAN', nairaPriceForScanPlan(r.scan_plan));
    else bump(r.settled_at, 'GHS', 'AKWAPAY_SCAN', storedOrLegacyGhs(r.amount_cedis, r.scan_plan));
  }
  for (const r of sessionRows) {
    bump(r.settled_at, 'GHS', 'AKWAPAY_SCAN_SESSION', realOrPlan(r, require('../util').SCAN_SESSION_PLAN[r.plan].amountCedis));
  }

  for (const r of webrabbitRows) bump(r.settled_at, 'GHS', 'WEBRABBIT', Number(r.amount));

  // Oldest -> newest, so charts render left-to-right in chronological order.
  const daily = Object.values(byDate).sort((a, b) => a.date.localeCompare(b.date));

  const totalGHS = daily.reduce((s, d) => s + d.totalGHS, 0);
  const totalNGN = daily.reduce((s, d) => s + d.totalNGN, 0);

  return { days: n, since: sinceIso, totalGHS, totalNGN, daily };
}

module.exports = {
  fundsForAdmin, platformFunds, allTransactions, dailyFunds,
  nairaPriceForPlan, nairaPriceForScanPlan, nairaPriceForScanSessionPlan,
};
