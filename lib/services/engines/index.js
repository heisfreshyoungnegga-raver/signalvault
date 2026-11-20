// lib/services/engines/index.js — the SignalVault prediction-engine
// registry. Aviator ONLY (owner order 2026-11-20): the other five engines
// (Sporty Jet, SportyKick, SportyHero, Super Hero, Test Flight) were
// removed, along with lib/services/engines/penalty-engine.js and
// action-engine.js. The registry is a singleton (one per serverless
// container) and pre-seeded with 120 rounds so every stat is meaningful
// from the very first request.
const { CrashEngine } = require('./crash-engine');

const GAMES = [
  {
    id: 'aviator',
    name: 'Aviator',
    tag: 'Crash',
    provider: 'Spribe',
    image: '/games/aviator.png',
    blurb: 'The legendary red plane — AI times your cash-out to the round.',
    engine: new CrashEngine({ id: 'aviator', name: 'Aviator Engine', game: 'Aviator', seed: 42, serverSeed: 'darkweb-demo-aviator-v1' }),
  },
];

// Pre-seed on first require so stats are alive immediately.
for (const g of GAMES) g.engine.seedHistory(120);

function getGame(id) {
  return GAMES.find((g) => g.id === id) || null;
}

function listGames() {
  return GAMES.map((g) => ({
    id: g.id,
    name: g.name,
    tag: g.tag,
    provider: g.provider,
    image: g.image,
    blurb: g.blurb,
    stats: g.engine.getStats(),
    prediction: g.engine.currentPrediction(),
  }));
}

function gameDetail(id) {
  const g = getGame(id);
  if (!g) return null;
  return {
    id: g.id,
    name: g.name,
    tag: g.tag,
    provider: g.provider,
    image: g.image,
    blurb: g.blurb,
    stats: g.engine.getStats(),
    prediction: g.engine.currentPrediction(),
    history: g.engine.getHistory(20),
  };
}

module.exports = { GAMES, getGame, listGames, gameDetail };
