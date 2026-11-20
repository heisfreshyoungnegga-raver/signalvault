// lib/middleware/adminAuth.js — port of filter/AdminAuthFilter.java
const adminAuthService = require('../services/adminAuth');
const { fail } = require('../util');

/** Requires ADMIN or SUPER_ADMIN. Attaches req.adminSession. */
async function requireAdmin(req, res, next) {
  const header = req.headers.authorization;
  const token = header && header.startsWith('Bearer ') ? header.slice(7) : null;
  if (!token) return res.status(401).json(fail('Missing Authorization Bearer token'));

  try {
    req.adminSession = await adminAuthService.validate(token);
    next();
  } catch (err) {
    res.status(err.status || 401).json(fail(err.message));
  }
}

/** Requires SUPER_ADMIN specifically. */
async function requireSuperAdmin(req, res, next) {
  const header = req.headers.authorization;
  const token = header && header.startsWith('Bearer ') ? header.slice(7) : null;
  if (!token) return res.status(401).json(fail('Missing Authorization Bearer token'));

  try {
    const session = await adminAuthService.validate(token);
    if (session.role !== 'SUPER_ADMIN') {
      return res.status(403).json(fail('Super admin access required'));
    }
    req.adminSession = session;
    next();
  } catch (err) {
    res.status(err.status || 401).json(fail(err.message));
  }
}

module.exports = { requireAdmin, requireSuperAdmin };
