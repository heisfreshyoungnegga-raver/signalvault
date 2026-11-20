// lib/services/simulator.js — SUPERADMIN USER-FLOW SIMULATOR
// Staff-only QA tool, built on the VirtuWinUi superadmin simulation
// pattern (lib/services/superAdminSimulator.js in virtuwinUi):
//   - a staff page walks the EXACT user journey, step by step;
//   - the payment step is faked (no gateway call, no money moves);
//   - the downstream pipeline is REAL (real lobby, real game pages,
//     real engines, real 45-minute windows);
//   - simulated state is namespaced so it can never leak into real data.
//
// VirtuWinUi namespaces by SIMULATOR_EMAIL + sim- ids inside the REAL
// tables. SignalVault goes one step stronger: simulated state lives in its
// OWN tables (sim_runs / sim_payments / sim_game_windows). A simulated
// identity never appears in users, sky_users, manual_payments,
// game_passes or game_windows, so real admin queues, real wallets and
// real game data contain zero simulator records by construction.
//
// Lifecycle (mirrors the scan simulator's create -> approve/fail):
//   start  -> sim run + sim identity + sim token (SA-guarded endpoint)
//   pay    -> SIMULATED manual-payment row (PENDING, no ImgBB, no queue)
//   approve-> mints a 45-minute sim window for that game (same clock as
//             real windows: env GAME_WINDOW_MINUTES, default 45)
//   decline-> payment REJECTED, nothing granted
// The SA then browses the real lobby / game pages AS the sim identity:
// the sim token resolves through the session middleware, so the real
// components render with sim entitlement and the real engines enforce
// sim windows. Staff-only: tokens are only ever issued by a
// requireSuperAdmin endpoint, and a sim token grants nothing outside
// the simulator's own tables.
const { sql } = require('../db');
const { ApiError } = require('../util');
const gameWindows = require('./gameWindows');

const SIM_IDENTITY_PREFIX = 'sim-';
const SIM_TOKEN_PREFIX = 'simtok_';

function randomHex(n) {
  const crypto = require('crypto');
  return crypto.randomBytes(Math.ceil(n / 2)).toString('hex').slice(0, n);
}

let schemaReady;
async function ensureSchema() {
  if (!schemaReady) {
    schemaReady = (async () => {
      const db = sql();
      await db`
        CREATE TABLE IF NOT EXISTS sim_runs (
          id            TEXT PRIMARY KEY,
          sa_username   TEXT NOT NULL,
          sim_identity  TEXT NOT NULL UNIQUE,
          sim_token     TEXT NOT NULL UNIQUE,
          status        TEXT NOT NULL DEFAULT 'ACTIVE',
          created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
          expires_at    TIMESTAMPTZ NOT NULL
        )`;
      await db`
        CREATE TABLE IF NOT EXISTS sim_payments (
          id          TEXT PRIMARY KEY,
          run_id      TEXT NOT NULL,
          game        TEXT NOT NULL,
          status      TEXT NOT NULL DEFAULT 'PENDING',
          created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
          reviewed_at TIMESTAMPTZ,
          -- Manual-payment form fields, mirrored from the real game-pass
          -- purchase (no screenshot: simulated payments never upload one).
          country        TEXT,
          account_name   TEXT,
          account_number TEXT,
          network_or_bank TEXT,
          reference      TEXT,
          amount         INTEGER,
          currency       TEXT
        )`;
      // Tables created by the earlier simulator build lack these columns.
      await db`ALTER TABLE sim_payments ADD COLUMN IF NOT EXISTS country TEXT`;
      await db`ALTER TABLE sim_payments ADD COLUMN IF NOT EXISTS account_name TEXT`;
      await db`ALTER TABLE sim_payments ADD COLUMN IF NOT EXISTS account_number TEXT`;
      await db`ALTER TABLE sim_payments ADD COLUMN IF NOT EXISTS network_or_bank TEXT`;
      await db`ALTER TABLE sim_payments ADD COLUMN IF NOT EXISTS reference TEXT`;
      await db`ALTER TABLE sim_payments ADD COLUMN IF NOT EXISTS amount INTEGER`;
      await db`ALTER TABLE sim_payments ADD COLUMN IF NOT EXISTS currency TEXT`;
      await db`
        CREATE TABLE IF NOT EXISTS sim_game_windows (
          identity    TEXT NOT NULL,
          game        TEXT NOT NULL,
          started_at  TIMESTAMPTZ NOT NULL,
          expires_at  TIMESTAMPTZ NOT NULL,
          intro_seen  BOOLEAN NOT NULL DEFAULT false,
          PRIMARY KEY (identity, game)
        )`;
      await db`CREATE INDEX IF NOT EXISTS idx_sim_runs_token ON sim_runs(sim_token)`;
      await db`CREATE INDEX IF NOT EXISTS idx_sim_payments_run ON sim_payments(run_id)`;
      // Simulated scan access + scan history. LEGACY tables from the
      // 45-minute window model — kept for history only. Since the
      // 2026-11-06 credit cutover, sim scans gate + spend on the sim
      // credit wallet (sim_credit_balances), exactly like the real
      // model. Sim analyses run the real AI pipeline on sim rails
      // (lib/services/simScanService.js) — no real scan record anywhere.
      await db`
        CREATE TABLE IF NOT EXISTS sim_scan_access (
          identity    TEXT PRIMARY KEY,
          granted_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
          scans_used  INTEGER NOT NULL DEFAULT 0,
          scans_max   INTEGER NOT NULL DEFAULT 10,
          window_started_at TIMESTAMPTZ,
          window_expires_at TIMESTAMPTZ
        )`;
      await db`ALTER TABLE sim_scan_access ADD COLUMN IF NOT EXISTS scans_used INTEGER NOT NULL DEFAULT 0`;
      await db`ALTER TABLE sim_scan_access ADD COLUMN IF NOT EXISTS scans_max INTEGER NOT NULL DEFAULT 10`;
      await db`ALTER TABLE sim_scan_access ADD COLUMN IF NOT EXISTS window_started_at TIMESTAMPTZ`;
      await db`ALTER TABLE sim_scan_access ADD COLUMN IF NOT EXISTS window_expires_at TIMESTAMPTZ`;
      await db`
        CREATE TABLE IF NOT EXISTS sim_scans (
          id          TEXT PRIMARY KEY,
          identity    TEXT NOT NULL,
          slip_name   TEXT,
          result      JSONB NOT NULL,
          created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
        )`;
      await db`CREATE INDEX IF NOT EXISTS idx_sim_scans_identity ON sim_scans(identity, created_at DESC)`;
      // simEntitlement reads this (line ~305); it used to exist only
      // after the first markIntroSeenSim call — a fresh DB would 500
      // the entitlement read. Self-heal it here like everything else.
      await db`
        CREATE TABLE IF NOT EXISTS sim_intro_seen (
          identity  TEXT NOT NULL,
          game      TEXT NOT NULL,
          seen_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
          PRIMARY KEY (identity, game)
        )`;
    })();
  }
  return schemaReady;
}

async function startRun(saUsername) {
  await ensureSchema();
  const db = sql();
  const id = 'simrun-' + randomHex(12);
  const simIdentity = SIM_IDENTITY_PREFIX + randomHex(8);
  const simToken = SIM_TOKEN_PREFIX + randomHex(32);
  const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
  await db`
    INSERT INTO sim_runs (id, sa_username, sim_identity, sim_token, status, expires_at)
    VALUES (${id}, ${saUsername}, ${simIdentity}, ${simToken}, 'ACTIVE', ${expiresAt})
  `;
  return { runId: id, simIdentity, simToken, expiresAt };
}

async function getRun(runId) {
  await ensureSchema();
  const db = sql();
  const rows = await db`SELECT * FROM sim_runs WHERE id = ${runId}`;
  if (!rows[0]) throw new ApiError('Simulator run not found', 404);
  return rows[0];
}

async function resolveSimToken(token) {
  if (!token || !token.startsWith(SIM_TOKEN_PREFIX)) return null;
  await ensureSchema();
  const db = sql();
  const rows = await db`SELECT * FROM sim_runs WHERE sim_token = ${token}`;
  const run = rows[0];
  if (!run || run.status !== 'ACTIVE') return null;
  if (new Date() > new Date(run.expires_at)) return null;
  return run;
}

// The simulated manual-payment form mirrors the real credit-pack
// purchase: country, sender account name/number, network/bank,
// reference. The amount is the real default-pack price (GH₵500;
// Nigeria amount is null — NGN packs are not set). No screenshot,
// no transfer, no real record — this row lives in sim_payments only.
function toPayment(row) {
  return {
    id: row.id,
    runId: row.run_id,
    game: row.game,
    status: row.status,
    country: row.country || null,
    accountName: row.account_name || null,
    accountNumber: row.account_number || null,
    networkOrBank: row.network_or_bank || null,
    reference: row.reference || null,
    amount: row.amount != null ? Number(row.amount) : null,
    currency: row.currency || null,
  };
}

async function simPay(runId, game, details = {}) {
  const run = await getRun(runId);
  if (run.status !== 'ACTIVE') throw new ApiError('Simulator run is not active', 409);
  // 'scan' is a sim-only product (the Instant Virtuals front door), not
  // a window game — it skips the known-game check and is granted as
  // scan access on approval instead of a 45-minute window.
  if (game !== 'scan' && !gameWindows.isKnownGame(game)) throw new ApiError(`Unknown game '${game}'`, 400);
  const country = details.country === 'nigeria' ? 'nigeria' : 'ghana';
  const db = sql();
  const id = 'simpay-' + randomHex(12);
  const credits = require('./credits');
  // Sim mirrors the real default pack (PREMIUM GH₵500). NGN has no
  // pack price set, so the sim NG amount is null like a real NG row.
  const simAmount = country === 'nigeria' ? null : credits.DEFAULT_PACK.priceGhs;
  await db`
    INSERT INTO sim_payments (id, run_id, game, status, country, account_name, account_number, network_or_bank, reference, amount, currency)
    VALUES (${id}, ${runId}, ${game}, 'PENDING', ${country}, ${String(details.accountName || '').trim() || null}, ${String(details.accountNumber || '').trim() || null}, ${String(details.networkOrBank || '').trim() || null}, ${String(details.reference || '').trim() || null}, ${simAmount}, ${country === 'nigeria' ? 'NGN' : 'GHS'})
  `;
  const rows = await db`SELECT * FROM sim_payments WHERE id = ${id}`;
  return toPayment(rows[0]);
}

async function simApprove(paymentId) {
  await ensureSchema();
  const db = sql();
  const rows = await db`SELECT * FROM sim_payments WHERE id = ${paymentId}`;
  const payment = rows[0];
  if (!payment) throw new ApiError('Simulated payment not found', 404);
  if (payment.status !== 'PENDING') throw new ApiError(`Simulated payment is not PENDING (current: ${payment.status})`, 409);
  const run = await getRun(payment.run_id);
  // Status flips first (source of truth), then the sim credit grant.
  await db`
    UPDATE sim_payments SET status = 'APPROVED', reviewed_at = ${new Date().toISOString()}
    WHERE id = ${paymentId}
  `;
  // NEW PACKS (2026-11-20): approval grants the default pack's
  // sim credits (PREMIUM GH₵500 → 12 sim credits = 3 plays at
  // 4 credits per play) to the run's sim wallet — one wallet for
  // every game + scan, mirroring the real model. No sim window /
  // sim scan grant is minted any more, and top-ups stack. The grant
  // dedupes on its ref, so a retry is safe.
  // Best-effort: a credit failure must never roll back an approval.
  try {
    const credits = require('./credits');
    await credits.grantSimCredits(run.sim_identity, credits.DEFAULT_PACK.credits, { reason: payment.game === 'scan' ? 'SIM_SCAN' : 'SIM_PASS', ref: 'SIM_' + paymentId });
  } catch (err) {
    console.error('[simulator] sim credit grant failed:', err && err.message);
  }
  return { ...toPayment(payment), status: 'APPROVED' };
}

async function simDecline(paymentId) {
  await ensureSchema();
  const db = sql();
  const rows = await db`SELECT * FROM sim_payments WHERE id = ${paymentId}`;
  const payment = rows[0];
  if (!payment) throw new ApiError('Simulated payment not found', 404);
  if (payment.status !== 'PENDING') throw new ApiError(`Simulated payment is not PENDING (current: ${payment.status})`, 409);
  await db`
    UPDATE sim_payments SET status = 'REJECTED', reviewed_at = ${new Date().toISOString()}
    WHERE id = ${paymentId}
  `;
  return { ...toPayment(payment), status: 'REJECTED' };
}

/** Sim grant window minutes: same SCAN_GRANT_MINUTES env as the real
 *  model, default 45. Kept local (no real-service import) so the sim
 *  module stays dependency-free. Sim scan stages (simScanService.js)
 *  reuse this for the finalize consume window. */
function simGrantMinutes() {
  const n = parseFloat(process.env.SCAN_GRANT_MINUTES, 10);
  return Number.isFinite(n) && n > 0 ? n : 45;
}

/** Grant state for one sim_scan_access row — mirrors scanPurchase.grantState. */
function simGrantState(row, nowMs) {
  const now = nowMs != null ? nowMs : Date.now();
  if (!row) {
    return { state: 'no-grant', scansUsed: 0, scansMax: 10, scansLeft: 0, windowStartedAt: null, windowExpiresAt: null, secondsLeft: 0, started: false };
  }
  const max = row.scans_max != null ? Number(row.scans_max) : 10;
  const used = row.scans_used != null ? Number(row.scans_used) : 0;
  const base = { scansUsed: used, scansMax: max, scansLeft: Math.max(0, max - used), windowStartedAt: row.window_started_at || null, windowExpiresAt: row.window_expires_at || null };
  if (used >= max) return { ...base, state: 'used-up', scansLeft: 0, secondsLeft: 0, started: !!row.window_started_at };
  if (row.window_expires_at && now >= new Date(row.window_expires_at).getTime()) {
    return { ...base, state: 'expired', secondsLeft: 0, started: true };
  }
  if (!row.window_started_at) {
    // Approval-anchored derivation, mirroring scanPurchase.grantState:
    // rows approved before windows were minted at approval carry NULL
    // window columns; their window is granted_at -> granted_at +
    // simGrantMinutes, so old grants read expired, never fresh.
    const anchor = row.granted_at;
    if (anchor) {
      const startMs = new Date(anchor).getTime();
      const expMs = startMs + simGrantMinutes() * 60 * 1000;
      const derived = {
        windowStartedAt: new Date(startMs).toISOString(),
        windowExpiresAt: new Date(expMs).toISOString(),
      };
      if (now >= expMs) {
        return { ...base, ...derived, state: 'expired', secondsLeft: 0, started: true };
      }
      return { ...base, ...derived, state: 'active', secondsLeft: Math.max(0, Math.floor((expMs - now) / 1000)), started: true };
    }
    return { ...base, state: 'not-started', secondsLeft: Math.round(simGrantMinutes() * 60), started: false };
  }
  return { ...base, state: 'active', secondsLeft: Math.max(0, Math.floor((new Date(row.window_expires_at).getTime() - now) / 1000)), started: true };
}

async function listSimScans(simIdentity) {
  await ensureSchema();
  const db = sql();
  const rows = await db`SELECT * FROM sim_scans WHERE identity = ${simIdentity} ORDER BY created_at DESC LIMIT 20`;
  return rows.map((r) => ({ id: r.id, slipName: r.slip_name, createdAt: r.created_at, ...r.result }));
}

/** AccountUser-shaped entitlement for a sim identity (plans + games maps).
 * CREDIT model (2026-11-20): the sim wallet is the only gate — balance
 * >= 4 credits (COST_PER_USE) unlocks every game + scan, below that
 * everything locks.
 * Legacy sim windows / sim scan grants grant nothing. */
async function simEntitlement(simIdentity) {
  await ensureSchema();
  const credits = require('./credits');
  const balance = await credits.simBalanceFor(simIdentity);
  const db = sql();
  const seenRows = await db`SELECT game FROM sim_intro_seen WHERE identity = ${simIdentity}`;
  const seen = {};
  for (const r of seenRows) seen[r.game] = true;
  const active = balance >= credits.COST_PER_USE;
  const plans = {};
  const games = {};
  for (const game of gameWindows.ALL_GAMES) {
    if (active) plans[game] = { plan: 'CREDITS', secondsLeft: 0, expiresAt: null, introSeen: !!seen[game] };
    games[game] = {
      state: active ? 'active' : 'locked',
      plan: active ? 'CREDITS' : null,
      startedAt: null,
      expiresAt: null,
      secondsLeft: 0,
      introSeen: !!seen[game],
      creditsLeft: balance,
    };
  }
  return {
    name: simIdentity,
    email: simIdentity,
    username: simIdentity,
    plans,
    games,
    credits: credits.summary(balance),
    scanAccess: active,
    scanGrant: { state: active ? 'active' : 'no-grant', scansUsed: 0, scansMax: 0, scansLeft: 0, windowStartedAt: null, windowExpiresAt: null, secondsLeft: 0, started: false },
    simulated: true,
  };
}

/** Same contract as gameWindows.requireActive, against sim credits. */
async function requireSimActive(simIdentity, game) {
  await ensureSchema();
  const credits = require('./credits');
  await credits.requireSimCredits(simIdentity);
}

async function markIntroSeenSim(simIdentity, game) {
  await ensureSchema();
  const db = sql();
  await db`
    CREATE TABLE IF NOT EXISTS sim_intro_seen (
      identity    TEXT NOT NULL,
      game        TEXT NOT NULL,
      seen_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
      PRIMARY KEY (identity, game)
    )`;
  await db`
    INSERT INTO sim_intro_seen (identity, game) VALUES (${String(simIdentity)}, ${String(game)})
    ON CONFLICT (identity, game) DO NOTHING
  `;
  return { ok: true };
}

async function expireRun(runId) {
  await ensureSchema();
  const db = sql();
  await getRun(runId);
  await db`UPDATE sim_runs SET status = 'EXPIRED' WHERE id = ${runId}`;
  return { runId, status: 'EXPIRED' };
}

async function listRuns() {
  await ensureSchema();
  const db = sql();
  const rows = await db`SELECT id, sa_username, sim_identity, status, created_at, expires_at FROM sim_runs ORDER BY created_at DESC LIMIT 50`;
  return rows;
}

module.exports = {
  SIM_IDENTITY_PREFIX,
  SIM_TOKEN_PREFIX,
  ensureSchema,
  startRun,
  getRun,
  resolveSimToken,
  simPay,
  simApprove,
  simDecline,
  simEntitlement,
  simGrantState,
  simGrantMinutes,
  listSimScans,
  requireSimActive,
  markIntroSeenSim,
  expireRun,
  listRuns,
};
