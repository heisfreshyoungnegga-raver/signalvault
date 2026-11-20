// lib/services/skyPayments.js — the casino-side MANUAL rail: the
// per-game predictor passes (single Premium plan). The frontend
// (src/routes/pricing.tsx) calls /api/plans/pay/*; this service is the
// layer behind it.
//
// Manual is the only payment rail (owner decision, 2026-10-22 — every
// gateway integration was removed): the user transfers the plan amount
// to the published receiving details (Ghana MoMo / Nigeria bank), submits
// their payment proof here, and an admin approves it from the review
// queue. Approval is the ONLY thing that activates a pass, and the
// status-scoped UPDATE in approvePass makes activation happen exactly
// once. The retired gateway columns (shinobipay_* / pycue_*) stay on the
// table for historical rows — nothing writes them any more.
//
// Pass timers start at approval (settled_at) — a settled pass mints a
// 45-minute access window (lib/services/gameWindows.js) that runs on
// the wall clock whether or not the player opens the game.
const { sql } = require('../db');
const { ApiError, generateId, assertCleanField, countryForManualSubmission } = require('../util');
const ban = require('./ban');
const commission = require('./commission');
const { getGame, GAMES } = require('./engines');
const gameWindows = require('./gameWindows');

/** The credit-pack catalogue — mirrors the frontend's PLAN_FALLBACK
 * and credits.js PACKS. FOUR TIERS (2026-11-17): GH₵250 → 20 credits,
 * GH₵300 → 25, GH₵500 → 40, GH₵1,000 → 80 (NGN 47,000 / 56,000 /
 * 94,000 / 188,000). Legacy 'PREMIUM' rows (old GH₵400 pack) still
 * resolve — their stored amount drives the credit grant. */
const GAME_PLANS = {
  STARTER: { plan: 'STARTER', amountCedis: 250 },
  STANDARD: { plan: 'STANDARD', amountCedis: 300 },
  PREMIUM: { plan: 'PREMIUM', amountCedis: 500 },
  VAULT: { plan: 'VAULT', amountCedis: 1000 },
};

/**
 * Pass-only games: real games with their own predictor pages but no engine
 * registry entry (their generation is not a server crash engine). A Premium
 * pass can be bought for them exactly like for an engine game.
 */
const PASS_ONLY_GAMES = new Set(['mines', 'bottle']);

let schemaReady;
async function ensureSchema() {
  if (!schemaReady) {
    schemaReady = (async () => {
      const db = sql();
      await db`
        CREATE TABLE IF NOT EXISTS game_passes (
          id                  TEXT PRIMARY KEY,
          username            TEXT NOT NULL,
          email               TEXT NOT NULL,
          game                TEXT NOT NULL,
          plan                TEXT NOT NULL,
          amount              INTEGER NOT NULL,
          currency            TEXT NOT NULL DEFAULT 'GHS',
          status              TEXT NOT NULL DEFAULT 'PENDING',
          shinobipay_reference  TEXT,
          shinobipay_intent_id  TEXT,
          pycue_reference       TEXT,
          pycue_transaction_id  TEXT,
          ip_address          TEXT,
          created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
          settled_at          TIMESTAMPTZ,
          expires_at          TIMESTAMPTZ
        )`;
      // Manual-proof columns (the manual rail's submission + review data).
      await db`ALTER TABLE game_passes ADD COLUMN IF NOT EXISTS account_name TEXT`;
      await db`ALTER TABLE game_passes ADD COLUMN IF NOT EXISTS account_number TEXT`;
      await db`ALTER TABLE game_passes ADD COLUMN IF NOT EXISTS network_or_bank TEXT`;
      await db`ALTER TABLE game_passes ADD COLUMN IF NOT EXISTS reference TEXT`;
      await db`ALTER TABLE game_passes ADD COLUMN IF NOT EXISTS screenshot_url TEXT`;
      await db`ALTER TABLE game_passes ADD COLUMN IF NOT EXISTS reviewed_at TIMESTAMPTZ`;
      await db`ALTER TABLE game_passes ADD COLUMN IF NOT EXISTS reviewed_by_admin TEXT`;
      await db`ALTER TABLE game_passes ADD COLUMN IF NOT EXISTS rejection_reason TEXT`;
    })().catch((err) => { schemaReady = null; throw err; });
  }
  return schemaReady;
}

function plansCatalogue() {
  const minutes = gameWindows.windowMinutes();
  const { PACKS } = require('./credits');
  const { nairaPriceForPlan } = require('./funds');
  return Object.values(GAME_PLANS).map((p) => ({
    plan: p.plan,
    minutes,
    hours: minutes / 60,
    amountCedis: p.amountCedis,
    credits: (PACKS.find((t) => t.code === p.plan) || {}).credits ?? null,
    priceNgn: nairaPriceForPlan(p.plan),
  }));
}

function isValidHttpUrl(value) {
  return /^https?:\/\//i.test(String(value || ''));
}

function rowToPass(row) {
  if (!row) return null;
  return {
    id: row.id,
    username: row.username,
    email: row.email,
    game: row.game,
    plan: row.plan,
    amount: Number(row.amount),
    currency: row.currency,
    status: row.status,
    accountName: row.account_name,
    accountNumber: row.account_number,
    networkOrBank: row.network_or_bank,
    reference: row.reference,
    screenshotUrl: row.screenshot_url,
    submittedAt: row.created_at,
    reviewedAt: row.reviewed_at,
    reviewedByAdmin: row.reviewed_by_admin,
    rejectionReason: row.rejection_reason,
    settledAt: row.settled_at,
    expiresAt: row.expires_at,
  };
}

async function getPassRaw(id) {
  const db = sql();
  const rows = await db`SELECT * FROM game_passes WHERE id = ${id}`;
  return rows[0] || null;
}

async function getPassById(id) {
  await ensureSchema();
  const pass = rowToPass(await getPassRaw(id));
  if (!pass) throw new ApiError('Plan payment not found', 404);
  return pass;
}

// ── Per-game passes — manual proof submission ───────────────────────────────

async function initPass(skyUser, { game, plan, accountName, accountNumber, networkOrBank, reference, screenshotUrl }, ipAddress) {
  await ensureSchema();
  // Defense in depth beside the session gate: a deactivated account
  // cannot submit a new game pass even with a live session token.
  if (skyUser && skyUser.active === false) {
    throw new ApiError('This account has been deactivated.', 403);
  }
  const planDef = GAME_PLANS[String(plan || '')];
  if (!planDef) throw new ApiError('Unknown plan: ' + plan, 400);
  if (!game || (!getGame(String(game)) && !PASS_ONLY_GAMES.has(String(game)))) throw new ApiError('Unknown game: ' + game, 400);
  assertCleanField(accountName, 'Account name');
  assertCleanField(reference, 'Reference');
  if (!accountName || !String(accountName).trim()) throw new ApiError('accountName is required', 400);
  if (!accountNumber || !String(accountNumber).trim()) throw new ApiError('accountNumber is required', 400);
  if (!networkOrBank || !String(networkOrBank).trim()) throw new ApiError('networkOrBank is required', 400);
  if (!reference || !String(reference).trim()) throw new ApiError('reference is required', 400);
  if (!screenshotUrl || !isValidHttpUrl(screenshotUrl)) throw new ApiError('screenshotUrl must be a valid http(s) URL', 400);
  await ban.checkNotBanned(skyUser.email, ipAddress);

  const country = countryForManualSubmission(networkOrBank);
  const id = generateId();
  const db = sql();
  await db`
    INSERT INTO game_passes
      (id, username, email, game, plan, amount, currency, status,
       account_name, account_number, network_or_bank, reference, screenshot_url, ip_address)
    VALUES
      (${id}, ${skyUser.username}, ${skyUser.email}, ${String(game)}, ${planDef.plan}, ${planDef.amountCedis},
       ${country === 'NG' ? 'NGN' : 'GHS'}, 'PENDING',
       ${String(accountName).trim()}, ${String(accountNumber).trim()}, ${String(networkOrBank).trim()},
       ${String(reference).trim()}, ${String(screenshotUrl).trim()}, ${ipAddress || null})
  `;
  if (ipAddress) await ban.recordSubmissionIp(skyUser.email, ipAddress, 'GAME_PASS_MANUAL');
  return { id, status: 'PENDING' };
}

async function statusPass(id, username) {
  await ensureSchema();
  const pass = rowToPass(await getPassRaw(id));
  if (!pass || pass.username !== username) throw new ApiError('Plan payment not found', 404);
  const data = {
    id: pass.id, status: pass.status, amount: pass.amount, currency: pass.currency,
    game: pass.game, plan: pass.plan, submittedAt: pass.submittedAt, reviewedAt: pass.reviewedAt,
  };
  if (pass.status === 'REJECTED') data.rejectionReason = pass.rejectionReason;
  return data;
}

// ── Admin review queue ──────────────────────────────────────────────────────

async function listAll() {
  await ensureSchema();
  const db = sql();
  const rows = await db`SELECT * FROM game_passes ORDER BY created_at DESC`;
  return rows.map(rowToPass);
}

async function listPending() {
  await ensureSchema();
  const db = sql();
  const rows = await db`SELECT * FROM game_passes WHERE status = 'PENDING' ORDER BY created_at DESC`;
  return rows.map(rowToPass);
}

async function approvePass(id, adminUsername) {
  await ensureSchema();
  const db = sql();
  const pass = await getPassById(id);
  if (pass.status !== 'PENDING') {
    throw new ApiError(`This submission has already been ${pass.status}`, 409);
  }
  const planDef = GAME_PLANS[pass.plan];
  if (!planDef) throw new ApiError('Unknown plan on this pass: ' + pass.plan, 400);
  const now = new Date();
  const expiresAt = new Date(now.getTime() + gameWindows.windowMinutes() * 60 * 1000);
  // Status-scoped update: exactly one approval can ever land, even if two
  // admins review the same submission at the same moment.
  const updated = await db`
    UPDATE game_passes
    SET status = 'APPROVED', settled_at = ${now.toISOString()}, expires_at = ${expiresAt.toISOString()},
        reviewed_at = ${now.toISOString()}, reviewed_by_admin = ${adminUsername}
    WHERE id = ${id} AND status = 'PENDING'
    RETURNING id
  `;
  if (!updated.length) throw new ApiError('This submission was reviewed by another admin', 409);

  // FOUR TIERS (2026-11-17): approval grants the tier's exact credits
  // — GH₵250 → 20, GH₵300 → 25, GH₵500 → 40, GH₵1,000 → 80. Credits
  // earned follow what was actually paid, so an in-flight GH₵800 pass
  // earns 60 credits via the proportional fallback while a legacy
  // GH₵400 / NGN 75,000 pack earns 30. Best-effort: a credit failure
  // must never roll back an approval that already landed.
  try {
    const credits = require('./credits');
    const { nairaPriceForPlan: nairaForPass } = require('./funds');
    const earned = credits.creditsForPayment({
      currency: pass.currency,
      amountGhs: pass.amount,
      amountNgn: pass.currency === 'NGN' ? nairaForPass(pass.plan) : null,
    });
    await credits.grantCredits(pass.email, earned, { reason: 'PASS', ref: 'MANUAL_PASS_' + id });
  } catch (err) {
    console.error('[skyPayments] credit grant failed for pass', id + ':', err && err.message);
  }

  // Referral commission, same as the other manual rails. Nigerian passes
  // are priced in Naira for commission purposes (funds.js naira table);
  // the pass amount column itself stays the catalogue figure.
  const skyAccount = require('./skyAccount');
  const skyUser = await skyAccount.findByUsername(pass.username).catch(() => null);
  const { nairaPriceForPlan } = require('./funds');
  const amount = pass.currency === 'NGN' ? nairaPriceForPlan(pass.plan) : pass.amount;
  await commission.recordIfReferred(
    'MANUAL_PASS_' + id,
    pass.email,
    { name: pass.plan },
    amount,
    skyUser ? skyUser.referredByAdminCode : null,
    pass.currency === 'NGN' ? 'NGN' : 'GHS'
  );
  return getPassById(id);
}

async function rejectPass(id, adminUsername, reason) {
  await ensureSchema();
  const db = sql();
  const pass = await getPassById(id);
  if (pass.status !== 'PENDING') {
    throw new ApiError(`This submission has already been ${pass.status}`, 409);
  }
  const now = new Date().toISOString();
  await db`
    UPDATE game_passes
    SET status = 'REJECTED', rejection_reason = ${reason && String(reason).trim() ? String(reason).trim() : 'Not specified'},
        reviewed_at = ${now}, reviewed_by_admin = ${adminUsername}
    WHERE id = ${id} AND status = 'PENDING'
  `;
  // Same deposit-rejection ban gate as the other manual rails.
  await ban.recordRejectionAndMaybeBan(pass.email);
  return getPassById(id);
}

async function removePass(id) {
  await ensureSchema();
  const db = sql();
  const pass = await getPassById(id);
  if (pass.status === 'APPROVED') throw new ApiError('Approved passes cannot be deleted', 409);
  await db`DELETE FROM game_passes WHERE id = ${id}`;
  return { id, deleted: true };
}

// ── Entitlement (what the lobby + pricing pages render) ─────────────────────

/**
 * The frontend's AccountUser payment state for one account, built on
 * the CREDIT wallet (lib/services/credits.js, 2026-11-06):
 *   plans — every game with balance >= 5 credits, in the shape the
 *           frontend has always consumed ({plan, secondsLeft} +
 *           window metadata; secondsLeft is 0 — credits never expire).
 *   games — the full per-game state map for every governed game:
 *           {state: locked|active, expiresAt, secondsLeft, introSeen,
 *           creditsLeft}. No 'expired' state exists any more.
 *   credits — the wallet summary {balance, costPerUse, packCredits,
 *           packPriceGhs, packPriceNgn} the lobby/headers render.
 * Legacy windows/subscriptions grant nothing here — the wallet is the
 * only gate. Any failure must never break the lobby.
 */
async function entitlementFor(username) {
  await ensureSchema();
  await gameWindows.ensureSchema();
  const skyAccount = require('./skyAccount');
  const skyUser = await skyAccount.findByUsername(username).catch(() => null);
  const identities = [username, skyUser && skyUser.email].filter(Boolean);

  let games = {};
  let balance = 0;
  try {
    games = await gameWindows.statesFor(identities);
    const credits = require('./credits');
    balance = await credits.balanceForIdentities(identities);
  } catch {
    games = {};
    for (const game of gameWindows.ALL_GAMES) {
      games[game] = { state: 'locked', plan: null, startedAt: null, expiresAt: null, secondsLeft: 0, introSeen: false, creditsLeft: 0 };
    }
  }
  const plans = {};
  for (const [game, st] of Object.entries(games)) {
    if (st.state !== 'active') continue;
    plans[game] = {
      plan: st.plan || 'CREDITS',
      secondsLeft: st.secondsLeft,
      expiresAt: st.expiresAt,
      introSeen: st.introSeen,
    };
  }
  const credits = require('./credits');
  return { plans, games, credits: credits.summary(balance) };
}

module.exports = {
  GAME_PLANS,
  ensureSchema,
  plansCatalogue,
  initPass,
  statusPass,
  getPassById,
  listAll,
  listPending,
  approvePass,
  rejectPass,
  removePass,
  entitlementFor,
};
