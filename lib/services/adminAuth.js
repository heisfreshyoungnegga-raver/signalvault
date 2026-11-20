// lib/services/adminAuth.js — port of service/AdminAuthService.java
const { sql } = require('../db');
const { ApiError, generateToken } = require('../util');
const adminService = require('./admin');

function rowToSession(row) {
  if (!row) return null;
  return {
    token: row.token,
    username: row.username,
    role: row.role,
    loginAt: row.login_at,
    expiresAt: row.expires_at,
    active: row.active,
  };
}

function isExpired(session) {
  return new Date() > new Date(session.expiresAt);
}

async function login(username, password, requiredRole) {
  const db = sql();
  const admin = await adminService.authenticate(username, password);

  if (requiredRole && admin.role !== requiredRole) {
    throw new ApiError(`This login is for ${requiredRole} accounts only`, 403);
  }

  const token = generateToken();
  const now = new Date();
  const durationHours = Number(process.env.ADMIN_SESSION_DURATION_HOURS || 12);
  const expiresAt = new Date(now.getTime() + durationHours * 3600 * 1000);

  await db`
    INSERT INTO admin_sessions (token, username, role, login_at, expires_at, active)
    VALUES (${token}, ${admin.username}, ${admin.role}, ${now.toISOString()}, ${expiresAt.toISOString()}, true)
  `;

  return { token, username: admin.username, role: admin.role, loginAt: now, expiresAt };
}

async function logout(token) {
  const db = sql();
  const rows = await db`SELECT * FROM admin_sessions WHERE token = ${token}`;
  if (!rows[0]) throw new ApiError('Session not found', 404);
  await db`UPDATE admin_sessions SET active = false WHERE token = ${token}`;
}

async function validate(token) {
  const db = sql();
  const rows = await db`SELECT * FROM admin_sessions WHERE token = ${token}`;
  const session = rowToSession(rows[0]);
  if (!session) throw new ApiError('Invalid or missing admin session token', 401);
  if (!session.active) throw new ApiError('Admin session has been logged out', 401);
  if (isExpired(session)) {
    await db`UPDATE admin_sessions SET active = false WHERE token = ${token}`;
    throw new ApiError('Admin session expired, please log in again', 401);
  }

  const admin = await adminService.getByUsername(session.username);
  if (!admin.active) {
    await db`UPDATE admin_sessions SET active = false WHERE token = ${token}`;
    throw new ApiError('This admin account has been deactivated', 403);
  }

  return session;
}

module.exports = { login, logout, validate };
