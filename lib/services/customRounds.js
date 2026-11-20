// lib/services/customRounds.js — admin-settable next-10-rounds overrides.
//
// Admins (via the "Round Customization" tab) can set the next 10 crash
// multipliers per game. The predictor (useCrashRun) checks this table first
// and uses the custom rounds in order; when exhausted or absent it falls back
// to local provably-fair generation.
//
// Rounds are consumed FIFO: each draw atomically deletes the lowest
// round_index (single DELETE...RETURNING, so a round is never dealt
// twice). When the queue empties the game reverts to random generation
// until the admin sets new rounds. Simulator sessions never draw from
// this table — the /api/rounds/next handler returns null for sim tokens.
const { sql } = require('../db');
const { ApiError } = require('../util');

const MAX_ROUNDS = 10;
const MIN_CRASH = 1.0;
const MAX_CRASH = 1000;

async function ensureSchema() {
  const db = sql();
  await db`
    CREATE TABLE IF NOT EXISTS custom_rounds (
      game_id      TEXT NOT NULL,
      round_index  INT  NOT NULL,
      crash_point  DOUBLE PRECISION NOT NULL,
      set_by       TEXT,
      created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
      PRIMARY KEY (game_id, round_index)
    )
  `;
  await db`CREATE INDEX IF NOT EXISTS idx_custom_rounds_game ON custom_rounds(game_id, round_index)`;
}

function validateCrashPoints(points) {
  if (!Array.isArray(points) || points.length === 0 || points.length > MAX_ROUNDS) {
    throw new ApiError(`Provide 1–${MAX_ROUNDS} crash multipliers.`, 400);
  }
  return points.map((p, i) => {
    const v = Number(p);
    if (!Number.isFinite(v) || v < MIN_CRASH || v > MAX_CRASH) {
      throw new ApiError(`Round ${i + 1}: multiplier must be between ${MIN_CRASH}x and ${MAX_CRASH}x.`, 400);
    }
    return Math.round(v * 100) / 100;
  });
}

/** Replace the custom queue for a game (admin). */
async function setRounds(gameId, points, setBy) {
  await ensureSchema();
  const clean = validateCrashPoints(points);
  const db = sql();
  await db`DELETE FROM custom_rounds WHERE game_id = ${String(gameId)}`;
  for (let i = 0; i < clean.length; i++) {
    await db`
      INSERT INTO custom_rounds (game_id, round_index, crash_point, set_by)
      VALUES (${String(gameId)}, ${i}, ${clean[i]}, ${setBy || null})
    `;
  }
  return listRounds(gameId);
}

/** List the queued custom rounds for a game (in order). */
async function listRounds(gameId) {
  await ensureSchema();
  const db = sql();
  const rows = await db`
    SELECT round_index, crash_point, set_by, created_at
    FROM custom_rounds WHERE game_id = ${String(gameId)}
    ORDER BY round_index ASC
  `;
  return rows.map((r) => ({
    index: r.round_index,
    crash: Number(r.crash_point),
    setBy: r.set_by,
    createdAt: r.created_at,
  }));
}

/** Clear the custom queue for a game (admin) — reverts to random. */
async function clearRounds(gameId) {
  await ensureSchema();
  const db = sql();
  await db`DELETE FROM custom_rounds WHERE game_id = ${String(gameId)}`;
  return { cleared: true };
}

/**
 * Draw the next round for a game. Returns { crash, custom: true } if a
 * custom round was consumed, or null if the queue is empty (caller falls
 * back to local generation).
 *
 * The consume is a single atomic DELETE...RETURNING of the head row, so
 * concurrent draws can never return the same round twice. No index
 * shifting: ORDER BY round_index keeps FIFO order across gaps, and
 * setRounds re-bases indices on every save.
 */
async function drawNext(gameId) {
  await ensureSchema();
  const db = sql();
  const taken = await db`
    DELETE FROM custom_rounds WHERE ctid = (
      SELECT ctid FROM custom_rounds
      WHERE game_id = ${String(gameId)}
      ORDER BY round_index ASC LIMIT 1
    )
    RETURNING crash_point
  `;
  if (!taken.length) return null;
  const crash = Number(taken[0].crash_point);
  const remaining = await db`SELECT COUNT(*)::int AS n FROM custom_rounds WHERE game_id = ${String(gameId)}`;
  return { crash, custom: true, remaining: remaining[0]?.n ?? 0 };
}

module.exports = { ensureSchema, setRounds, listRounds, clearRounds, drawNext, MAX_ROUNDS };
