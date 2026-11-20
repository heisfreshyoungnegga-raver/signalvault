// lib/services/gameWindows.js — CREDIT gate for games (owner spec,
// 2026-11-20: four credit tiers GH₵250 → 4, GH₵300 → 8, GH₵500 → 12,
// GH₵1,000 → 20 (NGN prices not set), 4 credits per play).
//
// THE model: every game is pay-first, but the currency is CREDITS, not
// time. A manual-payment approval grants credits to the wallet
// (lib/services/credits.js); there are NO 45-minute windows any more.
//   - balance >= 4  -> every game is 'active' (one wallet, all games)
//   - balance < 4   -> every game is 'locked' (out of credits)
//   - each crash round / bottle spin / mines game spends 4 at its own
//     spend point (rounds/next, bottle/next, mines/play) — the gate
//     here (requireActive) only CHECKS, it never spends.
//   - legacy game_windows rows are kept for history but grant NOTHING:
//     a user with only an old window reads locked. Everyone starts at
//     0 credits (owner rule: no grandfathering).
//   - the engine-entry intro now plays once per game per account,
//     tracked in game_intro_seen (no longer tied to a window row).
// Staff never reach this gate (assertGameAccess bypasses staff first).
const { sql } = require('../db');
const { ApiError } = require('../util');
const { GAMES } = require('./engines');

/** Pass-only games: real predictor pages with no engine registry entry. */
const PASS_ONLY_GAMES = ['mines', 'bottle'];

/** Every game key the window system governs — mirrors entitlement. */
const ALL_GAMES = [...GAMES.map((g) => g.id), ...PASS_ONLY_GAMES];

function windowMinutes() {
  const n = parseInt(process.env.GAME_WINDOW_MINUTES, 10);
  return Number.isFinite(n) && n > 0 ? n : 45;
}

let schemaReady;
async function ensureSchema() {
  if (!schemaReady) {
    schemaReady = (async () => {
      const db = sql();
      await db`
        CREATE TABLE IF NOT EXISTS game_windows (
          identity    TEXT NOT NULL,
          game        TEXT NOT NULL,
          plan        TEXT NOT NULL DEFAULT 'PREMIUM',
          source      TEXT NOT NULL,
          source_ref  TEXT,
          started_at  TIMESTAMPTZ NOT NULL,
          expires_at  TIMESTAMPTZ NOT NULL,
          intro_seen  BOOLEAN NOT NULL DEFAULT false,
          PRIMARY KEY (identity, game)
        )`;
      await db`
        CREATE TABLE IF NOT EXISTS game_intro_seen (
          identity    TEXT NOT NULL,
          game        TEXT NOT NULL,
          seen_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
          PRIMARY KEY (identity, game)
        )`;
    })().catch((err) => { schemaReady = null; throw err; });
  }
  return schemaReady;
}

function isKnownGame(game) {
  return ALL_GAMES.includes(String(game));
}

/**
 * LEGACY — kept for history/back-compat only. New approvals NEVER mint
 * windows; they grant credits instead (credits.js). Do not call from
 * new code.
 */
async function grantWindow(identity, game, { plan = 'PREMIUM', source, sourceRef = null, start = new Date() } = {}) {
  await ensureSchema();
  if (!identity || !isKnownGame(game)) return null;
  const startedAt = start instanceof Date ? start : new Date(start);
  const expiresAt = new Date(startedAt.getTime() + windowMinutes() * 60 * 1000);
  const db = sql();
  await db`
    INSERT INTO game_windows (identity, game, plan, source, source_ref, started_at, expires_at, intro_seen)
    VALUES (${String(identity)}, ${String(game)}, ${plan}, ${source}, ${sourceRef}, ${startedAt.toISOString()}, ${expiresAt.toISOString()}, false)
    ON CONFLICT (identity, game) DO UPDATE SET
      plan = EXCLUDED.plan,
      source = EXCLUDED.source,
      source_ref = EXCLUDED.source_ref,
      started_at = EXCLUDED.started_at,
      expires_at = EXCLUDED.expires_at,
      intro_seen = false
  `;
  return { game: String(game), startedAt: startedAt.toISOString(), expiresAt: expiresAt.toISOString() };
}

/** LEGACY — see grantWindow. */
async function grantAllGames(identity, { source = 'PREMIUM', sourceRef = null, start = new Date() } = {}) {
  await ensureSchema();
  const out = [];
  for (const game of ALL_GAMES) {
    out.push(await grantWindow(identity, game, { plan: 'PREMIUM', source, sourceRef, start }));
  }
  return out;
}

async function introSeenMap(identities) {
  await ensureSchema();
  const keys = [...new Set((identities || []).filter(Boolean).map(String))];
  const seen = {};
  if (!keys.length) return seen;
  const db = sql();
  for (const key of keys) {
    const rows = await db`SELECT game FROM game_intro_seen WHERE identity = ${key}`;
    for (const r of rows) seen[r.game] = true;
    // Legacy rows: an intro seen under a window counts as seen too.
    const legacy = await db`SELECT game FROM game_windows WHERE identity = ${key} AND intro_seen = true`;
    for (const r of legacy) seen[r.game] = true;
  }
  return seen;
}

/**
 * Full per-game state map for every governed game, from the credit
 * wallet: balance >= 4 credits -> 'active' for ALL games (one wallet);
 * below that -> 'locked'. No 'expired' state exists any more — credits
 * never expire. `creditsLeft` rides along so the client can show the
 * balance and stop the engine the moment it hits 0.
 */
async function statesFor(identities) {
  const credits = require('./credits');
  const balance = await credits.balanceForIdentities(identities);
  const seen = await introSeenMap(identities);
  const active = balance >= credits.COST_PER_USE;
  const states = {};
  for (const game of ALL_GAMES) {
    states[game] = {
      state: active ? 'active' : 'locked',
      plan: active ? 'CREDITS' : null,
      startedAt: null,
      expiresAt: null,
      secondsLeft: 0,
      introSeen: !!seen[game],
      creditsLeft: balance,
    };
  }
  return states;
}

/** LEGACY — window rows no longer mean anything; kept for callers. */
async function hasPremiumWindows(identities) {
  await ensureSchema();
  const keys = [...new Set((identities || []).filter(Boolean).map(String))];
  if (!keys.length) return false;
  const db = sql();
  for (const key of keys) {
    const rows = await db`SELECT 1 FROM game_windows WHERE identity = ${key} AND source = 'PREMIUM' LIMIT 1`;
    if (rows.length) return true;
  }
  return false;
}

/**
 * The enforcement gate for in-engine actions (check only — never
 * spends). Throws 403 CREDITS_EXHAUSTED when the wallet holds fewer
 * than 4 credits. The spend happens at the play's own endpoint
 * (rounds/next, bottle/next, mines/play).
 */
async function requireActive(identities, game) {
  const credits = require('./credits');
  const balance = await credits.requireCreditsForIdentities(identities);
  const seen = await introSeenMap(identities);
  return {
    state: 'active',
    plan: 'CREDITS',
    startedAt: null,
    expiresAt: null,
    secondsLeft: 0,
    introSeen: !!seen[String(game)],
    creditsLeft: balance,
  };
}

/** The engine-entry intro plays once per game per account. */
async function markIntroSeen(identities, game) {
  await ensureSchema();
  const keys = [...new Set((identities || []).filter(Boolean).map(String))];
  if (!keys.length || !isKnownGame(game)) return { ok: false };
  const db = sql();
  for (const key of keys) {
    await db`
      INSERT INTO game_intro_seen (identity, game) VALUES (${key}, ${String(game)})
      ON CONFLICT (identity, game) DO NOTHING
    `;
  }
  return { ok: true };
}

module.exports = {
  ALL_GAMES,
  PASS_ONLY_GAMES,
  windowMinutes,
  ensureSchema,
  isKnownGame,
  grantWindow,
  grantAllGames,
  statesFor,
  hasPremiumWindows,
  requireActive,
  markIntroSeen,
};
