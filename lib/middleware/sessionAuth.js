// lib/middleware/sessionAuth.js — port of filter/SessionAuthFilter.java
const sessionService = require('../services/session');
const simulator = require('../services/simulator');
const { fail } = require('../util');

async function requireSession(req, res, next) {
  const header = req.headers.authorization;
  const token = header && header.startsWith('Bearer ') ? header.slice(7) : null;
  if (!token) return res.status(401).json(fail('Missing Authorization Bearer token'));

  // Superadmin user-flow simulator tokens: issued only by a
  // requireSuperAdmin endpoint, resolved against the sim_runs table.
  // A sim identity is NOT a real user — handlers branch on
  // req.userSession.sim and serve sim tables only.
  if (token.startsWith(simulator.SIM_TOKEN_PREFIX)) {
    const run = await simulator.resolveSimToken(token);
    if (!run) return res.status(401).json(fail('Simulator session expired or invalid'));
    req.userSession = {
      username: run.sim_identity,
      sim: true,
      runId: run.id,
      loginAt: run.created_at,
      expiresAt: run.expires_at,
    };
    return next();
  }

  try {
    req.userSession = await sessionService.validate(token);
    next();
  } catch (err) {
    res.status(err.status || 401).json(fail(err.message));
  }
}

module.exports = { requireSession };
