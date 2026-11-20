// lib/services/credits.js — CREDIT WALLET (owner spec, 2026-11-06;
// FOUR TIERS from 2026-11-17 — see PACKS below)
//
// THE model:
//   - Four credit packs (single PACKS table, one line per tier):
//       GH₵250 → 20 credits (NGN 47,000) · GH₵300 → 25 (NGN 56,000)
//       GH₵500 → 40 (NGN 94,000) · GH₵1,000 → 80 (NGN 188,000)
//     GH₵500 / 40 credits is the default tier (packCredits etc.).
//   - Every use costs 5 credits: one completed slip scan, one crash
//     round, one bottle spin, one mines game. Failed scans cost nothing
//     (the spend happens only after a completed analysis, exactly like
//     the old consume-after-success rule); a round/spin spend happens
//     before the draw and is refunded if the draw itself errors.
//   - Credits NEVER expire and top-ups STACK on the balance.
//   - Legacy in-flight rows still earn on the OLD single-pack ratio
//     (GH₵400 / NGN 75,000 → 30 credits): GH₵800 earns 60, GH₵550
//     earns 41, NGN 75,000 earns 30 — see creditsForPayment().
//   - At 0 credits (balance < 5) the user is out: every game/scan gate
//     answers 403 CREDITS_EXHAUSTED and the client kicks them out of
//     the game to the pay-again page. No grandfathering: old 45-minute
//     windows and unused scan grants grant NOTHING after this lands —
//     everyone starts at 0 (his established rule).
//   - Staff (admin / super admin) NEVER spend and NEVER gate.
//   - Sim wallets are SEPARATE tables (sim_credit_balances /
//     sim_credit_ledger), keyed by sim identity, so simulator play can
//     never touch or leak into real money.
//
// Identity: the canonical key is the LOWER-CASED EMAIL for real users
// (every approval path carries an email; casino usernames resolve to
// their account email). Sim keys are the sim identity as issued
// (e.g. "sim-…"). A ledger row is written for every grant/spend so
// any balance can be audited; grants dedupe on `ref` (approval ids)
// so a double-approval can never double-credit.
const { sql } = require('../db');
const { ApiError } = require('../util');

/**
 * FOUR TIERS (2026-11-17) — the single source of truth for credit
 * packs. One line per tier; adjust a price here and every rail
 * (manual, per-game pass, scan buy) prices from it via
 * creditsForPayment(). Codes double as the plan codes in lib/util.js
 * PLAN / SCAN_PLAN and in funds.js PLAN_NAIRA / SCAN_PLAN_NAIRA.
 */
const PACKS = [
  { code: 'STARTER', credits: 20, priceGhs: 250, priceNgn: 47000 },
  { code: 'STANDARD', credits: 25, priceGhs: 300, priceNgn: 56000 },
  { code: 'PREMIUM', credits: 40, priceGhs: 500, priceNgn: 94000 },
  { code: 'VAULT', credits: 80, priceGhs: 1000, priceNgn: 188000 },
];
/** Default tier: GH₵500 / 40 credits (what packCredits etc. report). */
const DEFAULT_PACK = PACKS[2];

/**
 * LEGACY single-pack ratio (GH₵400 / NGN 75,000 → 30 credits) — kept
 * ONLY as the proportional fallback for in-flight rows paid before the
 * four-tier cutover (GH₵800 → 60, GH₵550 → 41, NGN 75,000 → 30).
 * The simulator also still grants this pack (simulator.js).
 */
const PACK_CREDITS = 30;
/** Ghana legacy pack price, cedis. */
const PACK_PRICE_GHS = 400;
/** Nigeria legacy pack price, naira. */
const PACK_PRICE_NGN = 75000;
/** Cost of one use: one scan, one round, one spin, one mines game. */
const COST_PER_USE = 5;
/** Error code the client watches for the out-of-credits kick. */
const OUT_OF_CREDITS_CODE = 'CREDITS_EXHAUSTED';

function outOfCreditsError() {
  return new ApiError(
    'Out of credits. Top up credits to keep playing — each scan or play costs 5 credits.',
    403,
    OUT_OF_CREDITS_CODE
  );
}

let schemaReady = null;
async function ensureSchema() {
  if (schemaReady) return schemaReady;
  schemaReady = (async () => {
    const db = sql();
    await db`
      CREATE TABLE IF NOT EXISTS credit_balances (
        identity    TEXT PRIMARY KEY,
        balance     INTEGER NOT NULL DEFAULT 0,
        updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
      )`;
    await db`
      CREATE TABLE IF NOT EXISTS credit_ledger (
        id            TEXT PRIMARY KEY,
        identity      TEXT NOT NULL,
        delta         INTEGER NOT NULL,
        reason        TEXT NOT NULL,
        ref           TEXT,
        balance_after INTEGER NOT NULL,
        created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
      )`;
    await db`CREATE INDEX IF NOT EXISTS credit_ledger_identity_idx ON credit_ledger (identity, created_at DESC)`;
    await db`CREATE UNIQUE INDEX IF NOT EXISTS credit_ledger_ref_idx ON credit_ledger (ref) WHERE ref IS NOT NULL`;
    await db`
      CREATE TABLE IF NOT EXISTS sim_credit_balances (
        identity    TEXT PRIMARY KEY,
        balance     INTEGER NOT NULL DEFAULT 0,
        updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
      )`;
    await db`
      CREATE TABLE IF NOT EXISTS sim_credit_ledger (
        id            TEXT PRIMARY KEY,
        identity      TEXT NOT NULL,
        delta         INTEGER NOT NULL,
        reason        TEXT NOT NULL,
        ref           TEXT,
        balance_after INTEGER NOT NULL,
        created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
      )`;
    await db`CREATE UNIQUE INDEX IF NOT EXISTS sim_credit_ledger_ref_idx ON sim_credit_ledger (ref) WHERE ref IS NOT NULL`;
  })().catch((err) => { schemaReady = null; throw err; });
  return schemaReady;
}

/** Canonical wallet key: lower-cased email (or sim identity as-is). */
function canonicalKey(identity) {
  return String(identity || '').trim().toLowerCase();
}

/**
 * Resolve the wallet key for a set of identity strings (casino username
 * and/or email, as assertGameAccess/entitlement already collect them):
 * the email wins; a bare username resolves to its account email; a
 * username with no account falls back to itself. Lazy require of
 * skyAccount — credits is required by gameWindows, which skyAccount
 * (via skyPayments) also requires, so a top-level require would cycle.
 */
async function keyForIdentities(identities) {
  const keys = [...new Set((identities || []).filter(Boolean).map(String))];
  const email = keys.find((k) => k.includes('@'));
  if (email) return canonicalKey(email);
  if (!keys.length) return '';
  try {
    const skyAccount = require('./skyAccount');
    const user = await skyAccount.findByUsername(keys[0]).catch(() => null);
    if (user && user.email) return canonicalKey(user.email);
  } catch { /* fall through to the raw key */ }
  return canonicalKey(keys[0]);
}

function summary(balance) {
  return {
    balance: Number(balance) || 0,
    costPerUse: COST_PER_USE,
    // Default tier (GH₵500 / 40 credits) — old clients read these.
    packCredits: DEFAULT_PACK.credits,
    packPriceGhs: DEFAULT_PACK.priceGhs,
    packPriceNgn: DEFAULT_PACK.priceNgn,
    // Full tier list for new clients.
    packs: PACKS.map((p) => ({ ...p })),
  };
}

// ── Real wallet ──────────────────────────────────────────────────────────

async function balanceFor(identity) {
  await ensureSchema();
  const key = canonicalKey(identity);
  if (!key) return 0;
  const db = sql();
  const rows = await db`SELECT balance FROM credit_balances WHERE identity = ${key}`;
  return rows[0] ? Number(rows[0].balance) : 0;
}

async function balanceForIdentities(identities) {
  return balanceFor(await keyForIdentities(identities));
}

/**
 * Credits earned for a payment, from what was actually paid.
 * Exact tier match wins: GH₵250 → 20, GH₵300 → 25, GH₵500 → 40,
 * GH₵1,000 → 80 (NGN 47,000 / 56,000 / 94,000 / 188,000 likewise).
 * Anything else falls back to the legacy single-pack ratio
 * (GH₵400 / NGN 75,000 → 30), so an in-flight GH₵800 purchase
 * approved after the cutover earns 60 credits, GH₵550 earns 41,
 * and NGN 75,000 earns 30.
 */
function creditsForPayment({ currency, amountGhs, amountNgn }) {
  if (currency === 'NGN') {
    const paid = Number(amountNgn);
    if (Number.isFinite(paid) && paid > 0) {
      const exact = PACKS.find((p) => p.priceNgn === paid);
      if (exact) return exact.credits;
      return Math.max(1, Math.round((paid / PACK_PRICE_NGN) * PACK_CREDITS));
    }
    return DEFAULT_PACK.credits;
  }
  const paid = Number(amountGhs);
  if (Number.isFinite(paid) && paid > 0) {
    const exact = PACKS.find((p) => p.priceGhs === paid);
    if (exact) return exact.credits;
    return Math.max(1, Math.round((paid / PACK_PRICE_GHS) * PACK_CREDITS));
  }
  return DEFAULT_PACK.credits;
}

/**
 * Grant credits. Idempotent on `ref` (approval ids): a second grant
 * with the same ref returns the current balance without crediting
 * twice. Returns the new balance.
 */
async function grantCredits(identity, amount, { reason, ref } = {}) {
  await ensureSchema();
  const key = canonicalKey(identity);
  if (!key) throw new ApiError('No account identity for credit grant', 400);
  const n = Math.floor(Number(amount));
  if (!Number.isFinite(n) || n <= 0) throw new ApiError('Credit grant must be a positive number', 400);
  const db = sql();
  if (ref) {
    const seen = await db`SELECT id FROM credit_ledger WHERE ref = ${String(ref)} LIMIT 1`;
    if (seen.length) return balanceFor(key);
  }
  const { generateId } = require('../util');
  const rows = await db`
    INSERT INTO credit_balances (identity, balance, updated_at)
    VALUES (${key}, ${n}, now())
    ON CONFLICT (identity) DO UPDATE SET balance = credit_balances.balance + ${n}, updated_at = now()
    RETURNING balance
  `;
  const after = Number(rows[0].balance);
  try {
    await db`
      INSERT INTO credit_ledger (id, identity, delta, reason, ref, balance_after)
      VALUES (${generateId()}, ${key}, ${n}, ${String(reason || 'GRANT')}, ${ref ? String(ref) : null}, ${after})
      ON CONFLICT DO NOTHING
    `;
  } catch (err) {
    console.error('[credits] ledger write failed (balance already granted):', err && err.message);
  }
  return after;
}

/**
 * Spend exactly COST_PER_USE, atomically: the UPDATE only lands when
 * the balance covers it, so two concurrent last-credit plays can never
 * both succeed. Throws 403 CREDITS_EXHAUSTED when the balance is
 * short — nothing is deducted and nothing is ledgered.
 */
async function spendCredits(identity, { reason, ref } = {}) {
  await ensureSchema();
  const key = canonicalKey(identity);
  if (!key) throw outOfCreditsError();
  const db = sql();
  const rows = await db`
    UPDATE credit_balances SET balance = balance - ${COST_PER_USE}, updated_at = now()
    WHERE identity = ${key} AND balance >= ${COST_PER_USE}
    RETURNING balance
  `;
  if (!rows.length) throw outOfCreditsError();
  const after = Number(rows[0].balance);
  const { generateId } = require('../util');
  try {
    await db`
      INSERT INTO credit_ledger (id, identity, delta, reason, ref, balance_after)
      VALUES (${generateId()}, ${key}, ${-COST_PER_USE}, ${String(reason || 'SPEND')}, ${ref ? String(ref) : null}, ${after})
      ON CONFLICT DO NOTHING
    `;
  } catch (err) {
    console.error('[credits] ledger write failed (spend already deducted):', err && err.message);
  }
  return after;
}

/**
 * Spend an arbitrary amount of credits, atomically (same pattern as
 * spendCredits, but variable stake instead of the fixed COST_PER_USE).
 * Used by Instant Virtuals bets: min stake 5 credits, win pays
 * stake x odds. Throws 403 CREDITS_EXHAUSTED when the balance is short.
 */
async function spendAmount(identity, amount, { reason, ref } = {}) {
  await ensureSchema();
  const key = canonicalKey(identity);
  if (!key) throw outOfCreditsError();
  const n = Math.floor(Number(amount));
  if (!Number.isFinite(n) || n <= 0) throw new ApiError('Spend amount must be a positive number', 400);
  const db = sql();
  const rows = await db`
    UPDATE credit_balances SET balance = balance - ${n}, updated_at = now()
    WHERE identity = ${key} AND balance >= ${n}
    RETURNING balance
  `;
  if (!rows.length) throw outOfCreditsError();
  const after = Number(rows[0].balance);
  const { generateId } = require('../util');
  try {
    await db`
      INSERT INTO credit_ledger (id, identity, delta, reason, ref, balance_after)
      VALUES (${generateId()}, ${key}, ${-n}, ${String(reason || 'SPEND')}, ${ref ? String(ref) : null}, ${after})
      ON CONFLICT DO NOTHING
    `;
  } catch (err) {
    console.error('[credits] ledger write failed (spend already deducted):', err && err.message);
  }
  return after;
}

/** Check-only gate (no spend): throws CREDITS_EXHAUSTED under 5. */
async function requireCredits(identity) {
  const balance = await balanceFor(identity);
  if (balance < COST_PER_USE) throw outOfCreditsError();
  return balance;
}

async function requireCreditsForIdentities(identities) {
  return requireCredits(await keyForIdentities(identities));
}

async function spendCreditsForIdentities(identities, opts) {
  return spendCredits(await keyForIdentities(identities), opts);
}

// ── Sim wallet (same rules, separate tables) ─────────────────────────────

async function simBalanceFor(identity) {
  await ensureSchema();
  const key = canonicalKey(identity);
  if (!key) return 0;
  const db = sql();
  const rows = await db`SELECT balance FROM sim_credit_balances WHERE identity = ${key}`;
  return rows[0] ? Number(rows[0].balance) : 0;
}

async function grantSimCredits(identity, amount, { reason, ref } = {}) {
  await ensureSchema();
  const key = canonicalKey(identity);
  if (!key) throw new ApiError('No sim identity for credit grant', 400);
  const n = Math.floor(Number(amount));
  if (!Number.isFinite(n) || n <= 0) throw new ApiError('Credit grant must be a positive number', 400);
  const db = sql();
  if (ref) {
    const seen = await db`SELECT id FROM sim_credit_ledger WHERE ref = ${String(ref)} LIMIT 1`;
    if (seen.length) return simBalanceFor(key);
  }
  const { generateId } = require('../util');
  const rows = await db`
    INSERT INTO sim_credit_balances (identity, balance, updated_at)
    VALUES (${key}, ${n}, now())
    ON CONFLICT (identity) DO UPDATE SET balance = sim_credit_balances.balance + ${n}, updated_at = now()
    RETURNING balance
  `;
  const after = Number(rows[0].balance);
  try {
    await db`
      INSERT INTO sim_credit_ledger (id, identity, delta, reason, ref, balance_after)
      VALUES (${generateId()}, ${key}, ${n}, ${String(reason || 'GRANT')}, ${ref ? String(ref) : null}, ${after})
      ON CONFLICT DO NOTHING
    `;
  } catch (err) {
    console.error('[credits] sim ledger write failed (balance already granted):', err && err.message);
  }
  return after;
}

async function spendSimCredits(identity, { reason, ref } = {}) {
  await ensureSchema();
  const key = canonicalKey(identity);
  if (!key) throw outOfCreditsError();
  const db = sql();
  const rows = await db`
    UPDATE sim_credit_balances SET balance = balance - ${COST_PER_USE}, updated_at = now()
    WHERE identity = ${key} AND balance >= ${COST_PER_USE}
    RETURNING balance
  `;
  if (!rows.length) throw outOfCreditsError();
  const after = Number(rows[0].balance);
  const { generateId } = require('../util');
  try {
    await db`
      INSERT INTO sim_credit_ledger (id, identity, delta, reason, ref, balance_after)
      VALUES (${generateId()}, ${key}, ${-COST_PER_USE}, ${String(reason || 'SPEND')}, ${ref ? String(ref) : null}, ${after})
      ON CONFLICT DO NOTHING
    `;
  } catch (err) {
    console.error('[credits] sim ledger write failed (spend already deducted):', err && err.message);
  }
  return after;
}

async function requireSimCredits(identity) {
  const balance = await simBalanceFor(identity);
  if (balance < COST_PER_USE) throw outOfCreditsError();
  return balance;
}

module.exports = {
  PACKS,
  DEFAULT_PACK,
  PACK_CREDITS,
  PACK_PRICE_GHS,
  PACK_PRICE_NGN,
  COST_PER_USE,
  OUT_OF_CREDITS_CODE,
  ensureSchema,
  canonicalKey,
  keyForIdentities,
  summary,
  balanceFor,
  balanceForIdentities,
  creditsForPayment,
  grantCredits,
  spendCredits,
  spendAmount,
  requireCredits,
  requireCreditsForIdentities,
  spendCreditsForIdentities,
  simBalanceFor,
  grantSimCredits,
  spendSimCredits,
  requireSimCredits,
};
