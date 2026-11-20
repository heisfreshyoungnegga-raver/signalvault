// lib/services/engines/provably-fair.js — provably-fair round generation,
// the same construction real crash games (bustabit, Spribe Aviator) use.
//
//   roundHash(n) = sha256(serverSeed + ":" + n)
//   crashPoint   = f(roundHash)          // deterministic, verifiable
//
// Anyone holding the server seed can recompute every round's crash point
// and check it matches what was published — that's the "provably fair"
// guarantee. The demo reveals the seed per engine so every round on the
// dashboard can be independently verified in the Fairness tab.
const crypto = require('crypto');

function sha256hex(str) {
  return crypto.createHash('sha256').update(str, 'utf8').digest('hex');
}

/** Deterministic round hash for round n of a seed (SHA-256 chain). */
function roundHash(serverSeed, n) {
  return sha256hex(`${serverSeed}:${n}`);
}

/**
 * Authentic Aviator-style round hash: SHA-512 over the server seed plus the
 * first three client seeds of the round (the first three bettors). The demo
 * simulates the three client seeds deterministically per round.
 */
function sha512hex(str) {
  return crypto.createHash('sha512').update(str, 'utf8').digest('hex');
}

function aviatorRoundHash(serverSeed, n) {
  const c1 = sha256hex(`${serverSeed}:client:1:${n}`).slice(0, 16);
  const c2 = sha256hex(`${serverSeed}:client:2:${n}`).slice(0, 16);
  const c3 = sha256hex(`${serverSeed}:client:3:${n}`).slice(0, 16);
  return {
    hash: sha512hex(serverSeed + c1 + c2 + c3),
    clientSeeds: [c1, c2, c3],
  };
}

/**
 * Crash multiplier from a hash — Aviator/Spribe construction (verified):
 *   hash = SHA512(serverSeed + clientSeed1 + clientSeed2 + clientSeed3)
 *   hs   = first 13 hex chars as int (52 bits); h = hs / 2^52
 *   crash = floor(97 / (1 - h)) / 100, min 1.00
 * The 3% edge emerges naturally: ~1 in 33 rounds busts instantly at 1.00x,
 * P(crash >= m) = 0.97/m, ~52% bust below 1.5x, ~48.5% reach 2x.
 */
function crashPointFromHash(hash, rtp = 0.97) {
  const hs = parseInt(hash.slice(0, 13), 16); // 52 bits
  const h = hs / 2 ** 52;
  const edge = 1 - rtp;
  const m = ((1 - edge) * 100) / (1 - h) / 100;
  return Math.max(1.0, Math.floor(m * 100) / 100);
}

/**
 * Sporty Hero construction (reverse-engineered from 10,000 ground-truth
 * seeds, pizzatipz/sportyhero-study):
 *   crash = max(1.00, round(0.97 * 2^32 / (2^32 - decimal), 2))
 * where decimal = first 8 hex chars (32 bits) as int.
 * 3% house edge with a 3.48% instant-bust point mass at 1.00x; the tail is
 * log-normal on (x-1), and rounds are provably independent (zero autocorrelation).
 */
function crashPointFromHash32(hash, rtp = 0.97) {
  const decimal = parseInt(hash.slice(0, 8), 16); // 32 bits
  const m = (rtp * 2 ** 32) / (2 ** 32 - decimal);
  return Math.max(1.0, Math.round(m * 100) / 100);
}

/**
 * Full verifiable round: hash, crash point, and the inputs to recompute it.
 * variant: 'aviator' (SHA-512 multi-seed, 52-bit) | 'hero32' (SHA-256, 32-bit
 * Sporty Hero construction) | 'sha256' (legacy SHA-256 chain, 52-bit).
 */
function fairRound(serverSeed, n, rtp = 0.97, variant = 'aviator') {
  let hash, clientSeeds;
  if (variant === 'aviator') {
    ({ hash, clientSeeds } = aviatorRoundHash(serverSeed, n));
  } else {
    hash = roundHash(serverSeed, n);
    clientSeeds = [];
  }
  const crash = variant === 'hero32'
    ? crashPointFromHash32(hash, rtp)
    : crashPointFromHash(hash, rtp);
  return { n, hash, crash, serverSeed, clientSeeds, rtp, variant };
}

/** Recompute and check a published round. Returns { valid, recomputed }. */
function verifyRound(serverSeed, n, expectedCrash, rtp = 0.97, variant = 'aviator') {
  const recomputed = fairRound(serverSeed, n, rtp, variant);
  return {
    valid: recomputed.crash === expectedCrash,
    recomputed,
  };
}

function randomSeed(bytes = 16) {
  return crypto.randomBytes(bytes).toString('hex');
}

module.exports = {
  sha256hex, sha512hex, roundHash, aviatorRoundHash,
  crashPointFromHash, crashPointFromHash32,
  fairRound, verifyRound, randomSeed,
};
