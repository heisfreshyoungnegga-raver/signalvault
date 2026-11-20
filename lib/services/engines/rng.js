// lib/services/engines/rng.js — deterministic PRNG + distribution helpers.
// A seeded stream keeps demos reproducible; production uses Math.random.
function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function makeRng(seed) {
  if (seed == null) return Math.random;
  return mulberry32(seed);
}

/** Standard crash-game bust point (bustabit-style, ~3% house edge). */
function crashPoint(rand) {
  const r = rand();
  if (r < 0.03) return 1.0; // instant bust
  const m = 0.97 / (1 - r);
  return Math.max(1.0, Math.floor(m * 100) / 100);
}

function pickWeighted(rand, entries) {
  // entries: [[value, weight], ...]
  const total = entries.reduce((s, e) => s + e[1], 0);
  let x = rand() * total;
  for (const [v, w] of entries) {
    x -= w;
    if (x <= 0) return v;
  }
  return entries[entries.length - 1][0];
}

function clamp(n, lo, hi) {
  return Math.min(hi, Math.max(lo, n));
}

function round2(n) {
  return Math.round(n * 100) / 100;
}

module.exports = { mulberry32, makeRng, crashPoint, pickWeighted, clamp, round2 };
