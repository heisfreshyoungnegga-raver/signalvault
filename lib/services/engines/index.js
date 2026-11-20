// lib/services/engines/index.js — the SignalVault prediction-engine
// registry. Six games, six live engines, each with its own history,
// stats and prediction model. Engines are singletons (one per serverless
// container) and pre-seeded with 120 rounds so every stat is meaningful
// from the very first request.
const { CrashEngine } = require('./crash-engine');
const { PenaltyEngine } = require('./penalty-engine');
const { ActionEngine } = require('./action-engine');

const GAMES = [
  {
    id: 'sporty-jet',
    name: 'Sporty Jet',
    tag: 'Crash',
    provider: 'SportyBet',
    image: '/games/sporty-jet.png',
    blurb: 'Cash out before the jet flies away — AI reads the rounds for you.',
    engine: new CrashEngine({ id: 'sporty-jet', name: 'Jet Engine', game: 'Sporty Jet', seed: 7, serverSeed: 'darkweb-demo-jet-v1' }),
  },
  {
    id: 'aviator',
    name: 'Aviator',
    tag: 'Crash',
    provider: 'Spribe',
    image: '/games/aviator.png',
    blurb: 'The legendary red plane — AI times your cash-out to the round.',
    engine: new CrashEngine({ id: 'aviator', name: 'Aviator Engine', game: 'Aviator', seed: 42, serverSeed: 'darkweb-demo-aviator-v1' }),
  },
  {
    id: 'sportykick',
    name: 'SportyKick',
    tag: 'Penalty',
    provider: 'SportyBet',
    image: '/games/sportykick.png',
    blurb: 'Penalty shootout predictions, round by round.',
    engine: new PenaltyEngine({ id: 'sportykick', name: 'Kick Engine', game: 'SportyKick', seed: 13 }),
  },
  {
    id: 'sportyhero',
    name: 'SportyHero',
    tag: 'Crash',
    provider: 'SportyBet',
    image: '/games/sportyhero.png',
    blurb: 'The hero takes off — cash out before he flies away. 32-bit provably-fair crash.',
    engine: new CrashEngine({ id: 'sportyhero', name: 'Hero Engine', game: 'SportyHero', seed: 99, serverSeed: 'darkweb-demo-hero-v1', variant: 'hero32' }),
  },
  {
    id: 'super-hero',
    name: 'Super Hero',
    tag: 'Action',
    provider: 'SportyBet',
    image: '/games/super-hero.png',
    blurb: 'Super Hero rounds decoded into clear predictions.',
    engine: new ActionEngine({ id: 'super-hero', name: 'Super Engine', game: 'Super Hero', seed: 5 }),
  },
  {
    id: 'test-flight',
    name: 'Test Flight',
    tag: 'Crash · Lab',
    provider: 'SignalVault Lab',
    image: '/games/test-flight.png',
    blurb: 'Sandbox crash lab — tune the RTP and stress-test the predictor.',
    engine: new CrashEngine({ id: 'test-flight', name: 'Lab Engine', game: 'Test Flight', seed: 123, serverSeed: 'darkweb-demo-lab-v1', rtp: 0.97 }),
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
