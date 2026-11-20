// api/virtuals.js — Instant Virtuals HTTP routes (mounted at /api/virtuals).
// Public reads (round / table / results) need no session so anyone can
// watch the board; betting requires a REAL session — sim sessions are
// rejected with 403 on every betting endpoint, they must never touch
// real credits.
const express = require('express');
const { ok } = require('../lib/util');
const { requireSession } = require('../lib/middleware/sessionAuth');
const credits = require('../lib/services/credits');
const skyAccount = require('../lib/services/skyAccount');
const virtuals = require('../lib/services/virtuals');

const router = express.Router();

function h(fn) {
  return (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
}

function rejectSim(req, res) {
  if (req.userSession && req.userSession.sim) {
    return res.status(403).json({
      success: false,
      message: 'Simulator sessions cannot place real bets',
      data: null,
      code: 'SIM_NOT_ALLOWED',
    });
  }
  return null;
}

async function identityFor(req) {
  const skyUser = await skyAccount.findByUsername(req.userSession.username).catch(() => null);
  const identities = [req.userSession.username, skyUser && skyUser.email].filter(Boolean);
  return credits.keyForIdentities(identities);
}

// Current round: phase, countdowns, fixtures + odds, live minute/scores.
// ?full=1 also returns full-time scores during the live feed (Skip to results).
router.get('/round', h(async (req, res) => {
  const round = await virtuals.getRound(Date.now(), { full: req.query.full === '1' });
  res.json(ok('Virtuals round', round));
}));

// Recently settled rounds, with the seed input revealed for verification.
router.get('/results', h(async (req, res) => {
  res.json(ok('Virtuals results', await virtuals.getResults()));
}));

// League tables from all settled results.
router.get('/table', h(async (req, res) => {
  res.json(ok('Virtuals table', await virtuals.getTable()));
}));

// Own bets (settles the due round first so statuses are fresh).
router.get('/bets', requireSession, h(async (req, res) => {
  if (rejectSim(req, res)) return;
  const identity = await identityFor(req);
  res.json(ok('Virtuals bets', await virtuals.listBets(identity)));
}));

// Place a bet (real sessions only).
router.post('/bets', requireSession, h(async (req, res) => {
  if (rejectSim(req, res)) return;
  const identity = await identityFor(req);
  const bet = await virtuals.placeBet(identity, req.body || {});
  res.json(ok('Bet placed', bet));
}));

module.exports = router;
