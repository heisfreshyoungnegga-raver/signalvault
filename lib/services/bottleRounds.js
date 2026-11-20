// lib/services/bottleRounds.js — Spin da Bottle pinned pattern + consumption.
//
// The superadmin pins exactly 10 calls (UP/DOWN) via the settings key
// `bottle_round_calls` (see settings.js). Players consume the pattern
// SERVER-SIDE in order: every POST /api/bottle/next takes the next call
// from one shared position counter (platform_settings key
// `bottle_round_position`), so all users stay in sync — this fixes
// VirtuWin's per-client in-memory index, which drifted between clients.
// The sequence cycles 1→10→1 until the pattern is changed or cleared;
// setting or clearing a pattern restarts the sequence at round 1.
// With no pattern set, nextCall() reports mode "ai" and the client-side
// heuristic predictor calls the round (as in the source game).
const { sql } = require('../db');
const { ApiError } = require('../util');
const settings = require('./settings');

const POSITION_KEY = 'bottle_round_position';
const PATTERN_LENGTH = 10;

async function readPosition() {
  const db = sql();
  const rows = await db`
    SELECT setting_value FROM platform_settings WHERE setting_key = ${POSITION_KEY}
  `;
  const value = rows[0] && rows[0].setting_value;
  const pos = value && typeof value === 'object' ? Number(value.position) : NaN;
  return Number.isInteger(pos) && pos >= 0 && pos < PATTERN_LENGTH ? pos : 0;
}

/** Pattern + where the shared sequence currently stands (admin views). */
async function getPattern() {
  const pattern = await settings.getBottleRounds();
  const position = pattern.calls ? await readPosition() : 0;
  return { ...pattern, nextRound: pattern.calls ? position + 1 : null };
}

/** Set (exactly 10 × UP/DOWN) or clear (null) the pattern — superadmin. */
async function setPattern(calls, updatedBy) {
  let normalized = null;
  if (calls != null) {
    if (
      !Array.isArray(calls) ||
      calls.length !== PATTERN_LENGTH ||
      !calls.every((c) => c === 'UP' || c === 'DOWN')
    ) {
      throw new ApiError(`Provide exactly ${PATTERN_LENGTH} calls, each UP or DOWN — or null to clear.`, 400);
    }
    normalized = calls.slice();
  }
  const saved = await settings.setBottleRounds(normalized, updatedBy);
  // A fresh (or cleared) pattern restarts the shared sequence at round 1.
  const db = sql();
  await db`DELETE FROM platform_settings WHERE setting_key = ${POSITION_KEY}`;
  return { ...saved, nextRound: normalized ? 1 : null };
}

/**
 * Consume the next pinned call, in order, for every player.
 * The position bump is a single atomic upsert: concurrent draws serialize
 * on the row and each receives a distinct slot in the sequence.
 * Returns { mode: 'pattern', call, round, of, confidence } or { mode: 'ai' }.
 */
async function nextCall() {
  const { calls } = await settings.getBottleRounds();
  if (!calls) return { mode: 'ai' };
  const db = sql();
  const rows = await db`
    INSERT INTO platform_settings (setting_key, setting_value, updated_at)
    VALUES (${POSITION_KEY}, ${JSON.stringify({ position: 1 })}::jsonb, now())
    ON CONFLICT (setting_key) DO UPDATE SET
      setting_value = jsonb_build_object(
        'position',
        (COALESCE((platform_settings.setting_value->>'position')::int, 0) + 1) % ${PATTERN_LENGTH}
      ),
      updated_at = now()
    RETURNING (setting_value->>'position')::int AS new_position
  `;
  const newPosition = rows[0].new_position;
  // new_position points at the NEXT slot; the slot just served is one back.
  const servedIndex = (newPosition + PATTERN_LENGTH - 1) % PATTERN_LENGTH;
  return {
    mode: 'pattern',
    call: calls[servedIndex],
    round: servedIndex + 1,
    of: PATTERN_LENGTH,
    // Synthetic confidence, same 72–93 band the source game displays.
    confidence: 72 + Math.floor(Math.random() * 22),
  };
}

module.exports = { getPattern, setPattern, nextCall, PATTERN_LENGTH };
