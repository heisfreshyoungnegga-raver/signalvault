// lib/util.js — port of util/CodeGenerator.java + shared constants/helpers
const crypto = require('crypto');

const ALPHA_NUMERIC = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789';

function randomFrom(alphabet, length) {
  const bytes = crypto.randomBytes(length);
  let out = '';
  for (let i = 0; i < length; i++) {
    out += alphabet[bytes[i] % alphabet.length];
  }
  return out;
}

function generatePassword(length = 10) {
  return randomFrom(ALPHA_NUMERIC, length);
}

function generateReference() {
  return 'SUB_' + crypto.randomUUID().replace(/-/g, '');
}

function generateToken() {
  return crypto.randomUUID().replace(/-/g, '') + crypto.randomUUID().replace(/-/g, '');
}

function generateReferralCode() {
  return 'REF-' + randomFrom(ALPHA_NUMERIC, 6).toUpperCase();
}

// ── Password hashing (C2) — built-in crypto scrypt, no new dependency ──
function hashPassword(pw) {
  const salt = crypto.randomBytes(16);
  const hash = crypto.scryptSync(String(pw), salt, 64);
  return `scrypt$${salt.toString('hex')}$${hash.toString('hex')}`;
}
function verifyPassword(pw, stored) {
  if (!stored || !stored.startsWith('scrypt$')) return false;
  const parts = stored.split('$');
  if (parts.length !== 3) return false;
  const hash = crypto.scryptSync(String(pw), Buffer.from(parts[1], 'hex'), 64);
  const expected = Buffer.from(parts[2], 'hex');
  return hash.length === expected.length && crypto.timingSafeEqual(hash, expected);
}

function generateId() {
  return crypto.randomUUID();
}

// ── ApiException equivalent ─────────────────────────────────────────────
class ApiError extends Error {
  constructor(message, status = 400, code = null) {
    super(message);
    this.status = status;
    // Machine-readable error code (e.g. GAME_LOCKED / GAME_EXPIRED) the
    // client can branch on; surfaced as `code` on the fail envelope.
    this.code = code;
  }
}

// ── Plan enums ───────────────────────────────────────────────────────────
// Credit-pack tiers (2026-11-17): GH₵250 / 300 / 500 / 1,000 — see
// PLAN below and credits.js PACKS. Manual-payment amounts must match —
//
// PRICE CHANGE (2026-10-24): Premium GHS 550 → 800. The constants below
// are the CURRENT price, used for new sales and catalogue displays.
// game_passes stores its amount per row, so pricing passes are exact.
// manual_payments / scan_purchases did NOT store an amount — their sums
// priced rows from these constants. Bumping them naively would rewrite
// history (old GHS 550 sales suddenly summing as 800). So:
//  - new manual/scan submits STORE amount_cedis at submit time;
//  - rows with no stored amount are LEGACY rows, priced at 550, never at
//    the current constant. storedOrLegacyGhs() is the single helper every
//    sum (stats, monitoring, funds, admin summaries, commissions) uses.
const LEGACY_PREMIUM_GHS = 550;
function storedOrLegacyGhs(storedAmount, planName) {
  const stored = storedAmount != null ? Number(storedAmount) : null;
  if (stored != null && stored > 0) return stored;
  return planName === 'PREMIUM' ? LEGACY_PREMIUM_GHS : null;
}
function legacyGhsForPlan(planName) {
  return planName === 'PREMIUM' ? LEGACY_PREMIUM_GHS : null;
}
const PLAN = {
  // FOUR TIERS (2026-11-17) — mirrors credits.js PACKS (same codes,
  // credits, GH₵ + NGN prices). `hours` is legacy bookkeeping only;
  // access is governed by the credit wallet now, not by time.
  // Legacy 'PREMIUM' rows (old GH₵400 pack) still resolve here — their
  // stored amount drives the credit grant, so they still earn 30.
  STARTER: { name: 'STARTER', code: 'STARTER', amountCedis: 250, amountNgn: 47000, credits: 20, hours: 24 },
  STANDARD: { name: 'STANDARD', code: 'STANDARD', amountCedis: 300, amountNgn: 56000, credits: 25, hours: 24 },
  PREMIUM: { name: 'PREMIUM', code: 'PREMIUM', amountCedis: 500, amountNgn: 94000, credits: 40, hours: 24 },
  VAULT: { name: 'VAULT', code: 'VAULT', amountCedis: 1000, amountNgn: 188000, credits: 80, hours: 24 },
};

function planFromCode(code) {
  if (!code) throw new ApiError('Unknown plan: ' + code, 400);
  const upper = code.trim().toUpperCase();
  const found = Object.values(PLAN).find(
    (p) => p.code.toUpperCase() === upper || p.name === upper
  );
  if (!found) throw new ApiError('Unknown plan: ' + code, 400);
  return found;
}

const SCAN_PLAN = {
  // FOUR TIERS (2026-11-17): a scan buy is a credit pack now — same
  // ladder as PLAN (GH₵250 → 20 credits … GH₵1,000 → 80); each
  // completed scan spends 5. Codes SCAN_250/300/500/1000 replace the
  // legacy SCAN_550 code; legacy 'PREMIUM' rows still resolve (their
  // stored amount drives the grant, so they still earn 30).
  STARTER: { name: 'STARTER', code: 'SCAN_250', amountCedis: 250, maxPicks: -1 },
  STANDARD: { name: 'STANDARD', code: 'SCAN_300', amountCedis: 300, maxPicks: -1 },
  PREMIUM: { name: 'PREMIUM', code: 'SCAN_500', amountCedis: 500, maxPicks: -1 },
  VAULT: { name: 'VAULT', code: 'SCAN_1000', amountCedis: 1000, maxPicks: -1 },
};

function scanPlanFromCode(code) {
  if (!code) throw new ApiError('Unknown scan plan: null', 400);
  const upper = code.trim().toUpperCase();
  let found = Object.values(SCAN_PLAN).find(
    (p) => p.code.toUpperCase() === upper || p.name === upper
  );
  if (!found) {
    found = Object.values(SCAN_PLAN).find((p) => String(p.amountCedis) === code.trim());
  }
  if (!found) throw new ApiError('Unknown scan plan: ' + code, 400);
  return found;
}

function scanPlanIsFullCoverage(plan) {
  return plan.maxPicks < 0;
}

const SCAN_SESSION_PLAN = {
  PREMIUM: { name: 'PREMIUM', code: 'SESSION_550', amountCedis: 550, durationMinutes: 60 },
};

// Same list scan.html/games.html use to let a user pick their bank for a
// manual Nigeria payment. There's no dedicated "country" column on
// manual_payments/scan_purchases (no submission form sends one) — this is
// the only way to tell a Nigerian bank-transfer submission apart from a
// Ghana one after the fact, on the backend as well as the frontend.
const NG_BANKS = new Set([
  'Access Bank', 'Fidelity Bank', 'First Bank', 'First City Monument Bank (FCMB)',
  'Guaranty Trust Bank (GTBank)', 'Heritage Bank', 'Keystone Bank', 'Paga',
  'Polaris Bank', 'Providus Bank', 'Stanbic IBTC Bank', 'Standard Chartered Bank',
  'Sterling Bank', 'United Bank for Africa (UBA)', 'Union Bank', 'Wema Bank',
  'Zenith Bank', 'Kuda Bank', 'OPay', 'PalmPay', 'Moniepoint', 'VBank', 'Carbon',
]);
function isNigerianBank(networkOrBank) {
  return NG_BANKS.has(networkOrBank);
}

// AkwaPay (Ghana's automatic mobile-money gateway) is retired — the gateway
// is down and Ghana now submits manual (screenshot) payments too, the same
// way Nigeria always has. This is the set of network labels the Ghana
// manual-payment form sends as `networkOrBank`, so a submission can be told
// apart from a Nigerian bank-transfer row on the backend. Keep this in sync
// with the NETWORKS list in public/games.html and public/scan.html.
const GH_NETWORKS = new Set([
  'MTN Mobile Money', 'Telecel Cash', 'AirtelTigo Money',
]);
function isGhanaMomoNetwork(networkOrBank) {
  return GH_NETWORKS.has(networkOrBank);
}

/**
 * Country for a MANUAL (screenshot) submission.
 *
 * UPDATE (2026-09-05): AkwaPay is down, so Ghana no longer pays
 * automatically — it now submits manual proof-of-payment the same way
 * Nigeria does. There's still no dedicated country column on
 * manual_payments/scan_purchases, so this is how a submission is told
 * apart: match networkOrBank against the closed GH_NETWORKS set first
 * (MTN/Telecel/AirtelTigo — a small, known list), otherwise treat it as
 * Nigerian. Unrecognized/mistyped values fall through to NG rather than
 * silently defaulting to GH, since that was the exact bug this function
 * was rewritten to avoid previously.
 */
function countryForManualSubmission(networkOrBank) {
  if (isGhanaMomoNetwork(networkOrBank)) return 'GH';
  return 'NG';
}

// ── Ghana MoMo network detection ─────────────────────────────────────────
// Ported from the retired gateway cores (they held the only copy). The
// admin scan simulator still needs to label a simulated Ghana payment with
// the network a phone number belongs to; nothing here talks to a gateway.
const GH_NETWORK_PREFIXES = {};
for (const p of ['024', '025', '053', '054', '055', '059']) GH_NETWORK_PREFIXES[p] = 'MTN';
for (const p of ['020', '050']) GH_NETWORK_PREFIXES[p] = 'TELECEL';
for (const p of ['026', '027', '056', '057']) GH_NETWORK_PREFIXES[p] = 'AIRTELTIGO';

/** Local 0-prefixed form of a Ghana number, or null if it doesn't parse. */
function ghLocalPhoneForm(phone) {
  if (!phone) return null;
  const digits = String(phone).replace(/\D/g, '');
  if (digits.startsWith('233') && digits.length === 12) return '0' + digits.slice(3);
  if (digits.length === 10 && digits.startsWith('0')) return digits;
  return null;
}

function detectGhNetworkFromPhone(phone) {
  const local = ghLocalPhoneForm(phone);
  if (!local) return null;
  return GH_NETWORK_PREFIXES[local.slice(0, 3)] || null;
}

function resolveGhNetwork(requested, phone) {
  if (requested && String(requested).trim()) {
    // Accepts both the short codes (MTN / TELECEL / AIRTELTIGO) and the
    // display names the frontends use ("MTN Mobile Money", "Telecel Cash",
    // "AirtelTigo Money") — normalized to letters only.
    const n = String(requested).trim().toUpperCase().replace(/[^A-Z]/g, '');
    if (n.startsWith('MTN')) return 'MTN';
    if (n.startsWith('TELECEL')) return 'TELECEL';
    if (n.startsWith('AIRTELTIGO') || n.startsWith('AIRTEL') || n.startsWith('TIGO')) return 'AIRTELTIGO';
    throw new ApiError('Unknown network. Please choose MTN, Telecel, or AirtelTigo.', 400);
  }
  const detected = detectGhNetworkFromPhone(phone);
  if (detected) return detected;
  throw new ApiError("We couldn't tell which network that number is on. Please choose MTN, Telecel, or AirtelTigo.", 400);
}

function scanSessionPlanFromCode(code) {
  if (!code) throw new ApiError('Unknown scan session plan: null', 400);
  const upper = code.trim().toUpperCase();
  const found = Object.values(SCAN_SESSION_PLAN).find(
    (p) => p.code.toUpperCase() === upper || p.name === upper
  );
  if (!found) throw new ApiError('Unknown scan session plan: ' + code, 400);
  return found;
}

// Map a ScanSessionPlan -> nearest ScanPlan, used by the simulator + session scan.
function mapSessionPlanToScanPlan(sessionPlan) {
  return SCAN_PLAN[sessionPlan.name];
}

// Defence in depth for the admin XSS fixes (C4): customer-submitted
// free-text fields must never carry markup into an admin's browser.
// Rejects angle brackets and caps length; legitimate names/references
// never contain < or >.
function assertCleanField(value, fieldName, maxLen = 200) {
  if (value == null) return value;
  const v = String(value);
  if (v.length > maxLen) throw new ApiError(`${fieldName} is too long`, 400);
  if (/[<>]/.test(v)) throw new ApiError(`${fieldName} contains invalid characters`, 400);
  return v;
}

function ok(message, data) {
  return { success: true, message, data: data === undefined ? null : data };
}

function fail(message, code) {
  const body = { success: false, message, data: null };
  if (code) body.code = code;
  return body;
}

module.exports = {
  hashPassword,
  verifyPassword,
  generatePassword,
  generateReference,
  generateToken,
  generateReferralCode,
  generateId,
  ApiError,
  PLAN,
  planFromCode,
  LEGACY_PREMIUM_GHS,
  storedOrLegacyGhs,
  legacyGhsForPlan,
  SCAN_PLAN,
  scanPlanFromCode,
  scanPlanIsFullCoverage,
  SCAN_SESSION_PLAN,
  scanSessionPlanFromCode,
  mapSessionPlanToScanPlan,
  isNigerianBank,
  isGhanaMomoNetwork,
  countryForManualSubmission,
  detectGhNetworkFromPhone,
  resolveGhNetwork,
  ok,
  fail,
  assertCleanField,
};
