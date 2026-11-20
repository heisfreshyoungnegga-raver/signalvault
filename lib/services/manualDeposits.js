// lib/services/manualDeposits.js — combined manual-deposit review queue.
//
// One list across the three manual rails — manual-payment subscriptions
// (manual_payments), scan Buy submissions (scan_purchases), and pricing
// game passes (game_passes) — split by country for the staff tabs (Ghana
// MoMo / Nigeria bank transfer). Approval and rejection DELEGATE to each
// rail's own service, so activation semantics are exactly what each rail
// already defines (manual → subscription + Premium windows; scan → scan
// access; pricing → the game's 45-minute window), including each rail's
// PENDING-only guard (double-approve → 409, no double activation).
//
// Country comes from countryForManualSubmission(networkOrBank): there is
// no dedicated country column on any of the three tables, and the forms
// only send closed-list values (MTN/Telecel/AirtelTigo for Ghana, the
// Nigerian bank list for Nigeria), so the derivation is exact for real
// submissions. Sim deposits live in separate sim_* tables and are never
// read here, so they can never appear in these tabs.
//
// Amounts are what each flow tells the user to pay: manual → the plan's
// catalogue GHS amount (the manual-payment amount line shows GHS for both
// countries); scan → GHS plan amount for Ghana, NGN 75,000 for Nigeria
// (the Buy flow's Nigeria scan figure); pricing → the stored amount +
// currency, exactly as submitted.

const { ApiError, PLAN, SCAN_PLAN, countryForManualSubmission } = require('../util');
const manualPayment = require('./manualPayment');
const scanPurchase = require('./scanPurchase');
const skyPayments = require('./skyPayments');

// Nigeria scan figure — mirrors the Buy flow's amount card / plan select
// label (see src/routes/scan.tsx), display-only like that rule.
const NG_SCAN_AMOUNT = 75000;

const SOURCES = ['manual', 'scan', 'pricing'];

function countryOf(networkOrBank) {
  return countryForManualSubmission(networkOrBank) === 'GH' ? 'GH' : 'NG';
}

function base(row, source, extra) {
  const country = countryOf(row.networkOrBank);
  return {
    id: row.id,
    source,
    email: row.email,
    accountName: row.accountName,
    accountNumber: row.accountNumber,
    networkOrBank: row.networkOrBank,
    reference: row.reference,
    screenshotUrl: row.screenshotUrl,
    status: row.status,
    rejectionReason: row.rejectionReason || null,
    submittedAt: row.submittedAt,
    reviewedAt: row.reviewedAt || null,
    reviewedByAdmin: row.reviewedByAdmin || null,
    country,
    rail: country === 'GH' ? 'MoMo' : 'Bank transfer',
    ...extra,
  };
}

function manualRow(p) {
  const plan = PLAN[p.plan] || { name: p.plan, amountCedis: 0 };
  return base(p, 'manual', {
    plan: p.plan,
    game: null,
    gameLabel: 'Premium (all games)',
    amount: plan.amountCedis,
    currency: 'GHS',
  });
}

function scanRow(p) {
  const plan = SCAN_PLAN[p.scanPlan] || { name: p.scanPlan, amountCedis: 550 };
  const country = countryOf(p.networkOrBank);
  return base(p, 'scan', {
    plan: p.scanPlan,
    game: null,
    gameLabel: 'AI slip scan',
    amount: country === 'NG' ? NG_SCAN_AMOUNT : plan.amountCedis,
    currency: country === 'NG' ? 'NGN' : 'GHS',
  });
}

function pricingRow(p) {
  return base(p, 'pricing', {
    plan: p.plan,
    game: p.game,
    gameLabel: p.game,
    amount: p.amount,
    currency: p.currency,
  });
}

const MAPPERS = { manual: manualRow, scan: scanRow, pricing: pricingRow };

async function ensureSchemas() {
  await Promise.all([
    manualPayment.ensureSchema(),
    scanPurchase.ensureSchema(),
    skyPayments.ensureSchema(),
  ]);
}

/** Combined list, newest first; country 'GH' | 'NG' filters, anything else returns all. */
async function listAll(country) {
  await ensureSchemas();
  const [manual, scans, passes] = await Promise.all([
    manualPayment.listAll(),
    scanPurchase.listAll(),
    skyPayments.listAll(),
  ]);
  let rows = [
    ...manual.map(manualRow),
    ...scans.map(scanRow),
    ...passes.map(pricingRow),
  ];
  if (country === 'GH' || country === 'NG') rows = rows.filter((r) => r.country === country);
  rows.sort((a, b) => new Date(b.submittedAt).getTime() - new Date(a.submittedAt).getTime());
  return rows;
}

async function getById(source, id) {
  if (!SOURCES.includes(source)) throw new ApiError('Unknown deposit source', 404);
  const row =
    source === 'manual'
      ? await manualPayment.getById(id)
      : source === 'scan'
        ? await scanPurchase.getById(id)
        : await skyPayments.getPassById(id);
  return MAPPERS[source](row);
}

async function approve(source, id, adminUsername) {
  if (!SOURCES.includes(source)) throw new ApiError('Unknown deposit source', 404);
  const out =
    source === 'manual'
      ? await manualPayment.approve(id, adminUsername)
      : source === 'scan'
        ? await scanPurchase.approve(id, adminUsername)
        : await skyPayments.approvePass(id, adminUsername);
  return MAPPERS[source](out);
}

async function reject(source, id, adminUsername, reason) {
  if (!SOURCES.includes(source)) throw new ApiError('Unknown deposit source', 404);
  const out =
    source === 'manual'
      ? await manualPayment.reject(id, adminUsername, reason)
      : source === 'scan'
        ? await scanPurchase.reject(id, adminUsername, reason)
        : await skyPayments.rejectPass(id, adminUsername, reason);
  return MAPPERS[source](out);
}

module.exports = { listAll, getById, approve, reject, SOURCES };
