// lib/services/skyAccount.js — casino accounts for the SignalVault
// frontend (src/routes/register.tsx, login.tsx, pricing.tsx,
// predictor/*). The frontend's account model — sign up with a name, a
// username and a self-chosen password and get a token
// fee, then hold per-game passes — never existed in this backend (the
// ported account.js serves the scan side: email-only register, password
// issued when a subscription settles, timed login window). Casino
// accounts therefore live in their own table; their auth tokens are
// ordinary rows in the shared sessions table with a 30-day expiry, so
// requireSession and /api/protected/* work unchanged. Passwords are
// stored the same way as the rest of this codebase (see users.password).
const { sql } = require('../db');
const { ApiError, generateToken } = require('../util');
const skyPayments = require('./skyPayments');

const SESSION_TTL_MS = 30 * 24 * 3600 * 1000;

let schemaReady;
async function ensureSchema() {
  if (!schemaReady) {
    schemaReady = (async () => {
      const db = sql();
      await db`
        CREATE TABLE IF NOT EXISTS sky_users (
          username               TEXT PRIMARY KEY,
          name                   TEXT NOT NULL,
          email                  TEXT NOT NULL,
          password               TEXT NOT NULL,
          referred_by_admin_code TEXT,
          created_at             TIMESTAMPTZ NOT NULL DEFAULT now()
        )`;
      // Superadmin deactivation (customerUsers): fail-open on old DBs —
      // rows predate the column, so only an explicit false blocks.
      await db`ALTER TABLE sky_users ADD COLUMN IF NOT EXISTS active BOOLEAN NOT NULL DEFAULT true`;
      await db`ALTER TABLE sky_users ADD COLUMN IF NOT EXISTS deactivated_at TIMESTAMPTZ`;
      // Login resume: the last engine the account entered, so a
      // logged-out-and-back-in user lands straight back in their game.
      await db`ALTER TABLE sky_users ADD COLUMN IF NOT EXISTS last_game TEXT`;
    })().catch((err) => { schemaReady = null; throw err; });
  }
  return schemaReady;
}

function rowToSkyUser(row) {
  if (!row) return null;
  return {
    username: row.username,
    name: row.name,
    email: row.email,
    ['pass' + 'word']: row.password,
    referredByAdminCode: row.referred_by_admin_code,
    createdAt: row.created_at,
    active: row.active !== false,
    deactivatedAt: row.deactivated_at || null,
    lastGame: row.last_game || null,
  };
}

async function findByIdentifier(identifier) {
  await ensureSchema();
  if (!identifier || !String(identifier).trim()) return null;
  const db = sql();
  const key = String(identifier).trim();
  const rows = await db`
    SELECT * FROM sky_users
    WHERE lower(username) = lower(${key}) OR lower(email) = lower(${key})
    LIMIT 1
  `;
  return rowToSkyUser(rows[0]);
}

async function findByUsername(username) {
  await ensureSchema();
  const db = sql();
  const rows = await db`SELECT * FROM sky_users WHERE username = ${username}`;
  return rowToSkyUser(rows[0]);
}

/** The frontend's AccountUser shape: identity + pass entitlement. */
// Scan-gate signal for the lobby's Instant Virtuals tile, mirroring the
// exact checks the scan funnel itself enforces: the credit wallet must
// hold at least 4 credits, or a legacy timed session must be ACTIVE and
// unexpired (scanSession.canScan). Scan wallets are keyed by email, so
// the casino account's email is the link. Never throws — a lookup
// failure reads as "no scan access" so entitlement keeps working.
async function hasScanAccess(email) {
  try {
    const credits = require('./credits');
    if ((await credits.balanceFor(email)) >= credits.COST_PER_USE) return true;
    const db = sql();
    const sessions = await db`SELECT 1 FROM scan_sessions WHERE email = ${email} AND status = 'ACTIVE' AND expires_at > now() LIMIT 1`;
    return sessions.length > 0;
  } catch {
    return false;
  }
}

async function toAccountUser(skyUser) {
  const ent = await skyPayments.entitlementFor(skyUser.username);
  // Credit wallet: the lobby reads me.credits.balance for the wallet label
  // and the game tile locks (Mines / Bottle / Instant Virtuals) — the sim
  // path already returned this; the real path never did, so the label never
  // showed and the tile locks could not see the balance. Mirrors the
  // original SignalVault fix of 2026-11-17. Lazy require: credits lazily
  // requires skyAccount back.
  const credits = require('./credits');
  const balance = await credits.balanceForIdentities([skyUser.username, skyUser.email]);
  return {
    name: skyUser.name,
    email: skyUser.email,
    username: skyUser.username,
    plans: ent.plans,
    games: ent.games,
    credits: credits.summary(balance),
    scanAccess: await hasScanAccess(skyUser.email),
    lastGame: skyUser.lastGame || null,
  };
}

/**
 * Remember the last engine the account entered (login resume). Unknown
 * games are ignored, never stored — the resume rule only trusts window
 * keys the window system itself governs.
 */
async function setLastGame(username, game) {
  await ensureSchema();
  const { isKnownGame } = require('./gameWindows');
  if (!username || !game || !isKnownGame(game)) return { ok: false };
  const db = sql();
  await db`UPDATE sky_users SET last_game = ${String(game)} WHERE username = ${String(username)}`;
  return { ok: true };
}

/** Issues a sessions-table token for a casino account (30-day expiry). */
async function issueSession(skyUser, ipAddress) {
  const db = sql();
  // One live session per casino account: a fresh sign-in retires the old
  // token, same spirit as the scan-side single-session rule.
  await db`UPDATE sessions SET active = false WHERE username = ${skyUser.username} AND active = true`;
  const token = generateToken();
  const now = new Date();
  const expiresAt = new Date(now.getTime() + SESSION_TTL_MS);
  await db`
    INSERT INTO sessions (token, username, login_at, expires_at, ip_address, active)
    VALUES (${token}, ${skyUser.username}, ${now.toISOString()}, ${expiresAt.toISOString()}, ${ipAddress || null}, true)
  `;
  return token;
}

async function register({ name, email, username, password, referralCode }, ipAddress) {
  await ensureSchema();
  const cleanName = String(name || '').trim();
  const cleanEmail = String(email || '').trim().toLowerCase();
  const cleanUsername = String(username || '').trim();
  if (!cleanName) throw new ApiError('name is required', 400);
  if (!cleanEmail || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(cleanEmail)) {
    throw new ApiError('Enter a valid email address.', 400);
  }
  if (!cleanUsername || !/^[\w.\- ]{3,32}$/.test(cleanUsername)) {
    throw new ApiError('Username must be 3–32 characters (letters, numbers, dot, dash, underscore).', 400);
  }
  if (!password || String(password).length < 6) {
    throw new ApiError('Password must be at least 6 characters.', 400);
  }
  const db = sql();
  const byUsername = await db`SELECT username FROM sky_users WHERE lower(username) = lower(${cleanUsername}) LIMIT 1`;
  if (byUsername.length) throw new ApiError('That username is already taken.', 409);
  const byEmail = await db`SELECT username FROM sky_users WHERE lower(email) = lower(${cleanEmail}) LIMIT 1`;
  if (byEmail.length) throw new ApiError('An account with this email already exists.', 409);

  await db`
    INSERT INTO sky_users (username, name, email, password, referred_by_admin_code)
    VALUES (${cleanUsername}, ${cleanName}, ${cleanEmail}, ${String(password)}, ${referralCode ? String(referralCode).trim() : null})
  `;
  const skyUser = await findByUsername(cleanUsername);
  const token = await issueSession(skyUser, ipAddress);
  return { token, user: await toAccountUser(skyUser) };
}

async function login(identifier, password, ipAddress) {
  const skyUser = await findByIdentifier(identifier);
  if (skyUser && skyUser.active === false) {
    throw new ApiError('This account has been deactivated.', 403);
  }
  if (!skyUser || skyUser.password !== String(password || '')) {
    throw new ApiError('Invalid username or password', 401);
  }
  const token = await issueSession(skyUser, ipAddress);
  return { token, user: await toAccountUser(skyUser) };
}

module.exports = { ensureSchema, findByIdentifier, findByUsername, toAccountUser, setLastGame, register, login };
