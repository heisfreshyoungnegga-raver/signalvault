// lib/services/session.js — port of service/SessionService.java
const { sql } = require('../db');
const { ApiError, generateToken } = require('../util');
const account = require('./account');
const ban = require('./ban');

function rowToSession(row) {
  if (!row) return null;
  return {
    token: row.token,
    username: row.username,
    loginAt: row.login_at,
    expiresAt: row.expires_at,
    ipAddress: row.ip_address,
    active: row.active,
  };
}

function isExpired(session) {
  return new Date() > new Date(session.expiresAt);
}

function secondsRemaining(session) {
  const secs = Math.floor((new Date(session.expiresAt).getTime() - Date.now()) / 1000);
  return Math.max(secs, 0);
}

async function findByToken(token) {
  const db = sql();
  const rows = await db`SELECT * FROM sessions WHERE token = ${token}`;
  return rowToSession(rows[0]);
}

/** Used by the reconciliation/cleanup cron. */
async function forceLogout(session) {
  const db = sql();
  await db`UPDATE sessions SET active = false WHERE token = ${session.token}`;

  const acc = await account.findByUsername(session.username);
  if (acc) {
    const updates = {};
    if (acc.activeSessionToken === session.token) {
      await db`UPDATE users SET active_session_token = NULL WHERE username = ${session.username}`;
    }
    if (account.isWindowExpired(acc)) {
      await db`UPDATE users SET subscription_consumed = true WHERE username = ${session.username}`;
    }
  }
}

async function expireIfNeeded(acc) {
  if (!acc.activeSessionToken) return;
  const existing = await findByToken(acc.activeSessionToken);
  if (existing && existing.active && isExpired(existing)) {
    await forceLogout(existing);
  }
}

async function login(username, password, ipAddress) {
  await ban.checkNotBanned(username, ipAddress);
  // Record the email<->IP link on every successful-so-far login attempt,
  // same reasoning as account.register() — keeps the identity graph
  // complete so bans propagate correctly across email/IP changes.
  if (ipAddress) await ban.recordIdentityContact(username, ipAddress, 'LOGIN');
  const db = sql();
  const acc = await account.findByUsername(username);
  if (!acc) throw new ApiError('Invalid username or password', 401);
  if (acc.active === false) throw new ApiError('This account has been deactivated.', 403);

  if (!account.isPaid(acc)) {
    throw new ApiError('This account has not paid for a plan yet. Please subscribe first.', 403);
  }
  if (acc.password !== password) {
    throw new ApiError('Invalid username or password', 401);
  }

  await expireIfNeeded(acc);
  const fresh = await account.findByUsername(username);

  if (fresh.subscriptionConsumed || account.isWindowExpired(fresh)) {
    throw new ApiError('Your subscription time has expired. Please pay again to continue.', 403);
  }

  if (fresh.activeSessionToken) {
    const existing = await findByToken(fresh.activeSessionToken);
    if (existing && existing.active && !isExpired(existing)) {
      throw new ApiError('This account is already logged in on another device. Log out there first.', 409);
    }
  }

  const { PLAN } = require('../util');
  const planDef = PLAN[fresh.plan];
  let usageExpiresAt = fresh.usageExpiresAt;
  if (!usageExpiresAt) {
    usageExpiresAt = new Date(Date.now() + planDef.hours * 3600 * 1000);
    await db`UPDATE users SET usage_expires_at = ${usageExpiresAt.toISOString()} WHERE username = ${username}`;
  }

  const token = generateToken();
  const now = new Date();
  const sessionExpiry = usageExpiresAt;

  await db`
    INSERT INTO sessions (token, username, login_at, expires_at, ip_address, active)
    VALUES (${token}, ${username}, ${now.toISOString()}, ${new Date(sessionExpiry).toISOString()}, ${ipAddress}, true)
  `;
  await db`UPDATE users SET active_session_token = ${token} WHERE username = ${username}`;

  return { token, username, loginAt: now, expiresAt: sessionExpiry };
}

async function logout(token) {
  const db = sql();
  const session = await findByToken(token);
  if (!session) throw new ApiError('Session not found', 404);

  await db`UPDATE sessions SET active = false WHERE token = ${token}`;

  const acc = await account.findByUsername(session.username);
  if (acc && acc.activeSessionToken === token) {
    await db`UPDATE users SET active_session_token = NULL WHERE username = ${session.username}`;
    if (account.isWindowExpired(acc)) {
      await db`UPDATE users SET subscription_consumed = true WHERE username = ${session.username}`;
    }
  }
}

async function validate(token) {
  const session = await findByToken(token);
  if (!session) throw new ApiError('Invalid or missing session token', 401);
  if (!session.active) throw new ApiError('Session has been logged out', 401);
  if (isExpired(session)) {
    await forceLogout(session);
    throw new ApiError('Your time limit has been reached. You have been logged out.', 401);
  }
  // Superadmin deactivation kills live sessions too: a deactivated
  // casino account fails every requireSession route from here on.
  // Guarded — a missing sky_users table/column must never break sessions.
  try {
    const db = sql();
    const rows = await db`SELECT active FROM sky_users WHERE username = ${session.username} LIMIT 1`;
    if (rows[0] && rows[0].active === false) {
      throw new ApiError('This account has been deactivated.', 403);
    }
  } catch (err) {
    if (err instanceof ApiError) throw err;
  }
  return session;
}

async function findAll() {
  const db = sql();
  const rows = await db`SELECT * FROM sessions`;
  return rows.map(rowToSession);
}

module.exports = { login, logout, validate, findByToken, forceLogout, findAll, isExpired, secondsRemaining };
