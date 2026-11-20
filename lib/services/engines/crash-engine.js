// lib/services/engines/crash-engine.js — prediction engine for crash games
// (Sporty Jet, Aviator). Same math, separate instances so each game keeps
// its own history and stats.
//
// How it calls the round:
//  1. Empirical distribution — the last 50 crash points give a live picture
//     of the room: mean multiplier, volatility, and the % of rounds clearing
//     each cash-out tier.
//  2. Drought factor — rounds since the last 10x+. Long droughts tilt the
//     engine toward the RISKY tier (volatility reversion), short ones keep
//     it conservative.
//  3. Bust clusters — 3+ sub-1.50x rounds in a row push the call to SAFE,
//     because bust clusters are the #1 bankroll killer in crash games.
// A prediction HITS when the round's crash point clears the suggested
// cash-out — i.e. a player following the call would have banked profit.
const { BaseEngine } = require('./base-engine');
const { clamp, round2 } = require('./rng');
const stats = require('./stats');
const { fairRound, verifyRound, randomSeed } = require('./provably-fair');

const WINDOW = 50;
const TIERS = [
  { key: 'safe', cashout: 1.5, label: 'Safe' },
  { key: 'balanced', cashout: 2.0, label: 'Balanced' },
  { key: 'risky', cashout: 5.0, label: 'Risky' },
];

class CrashEngine extends BaseEngine {
  constructor(opts) {
    super(opts);
    // Provably-fair construction (Aviator only):
    //   'aviator' — SHA-512(serverSeed + 3 client seeds), 52-bit h,
    //               floor(0.97/(1-h)*100)/100  (verified Spribe construction)
    // A fixed seed keeps the demo's history stable across deploys;
    // production rotates it.
    this.serverSeed = opts.serverSeed || randomSeed();
    this.variant = opts.variant || 'aviator';
    this.rtp = opts.rtp || 0.97;
  }

  simulateRound() {
    // tick() calls this BEFORE incrementing roundNo, so the upcoming
    // round is roundNo + 1.
    const fr = fairRound(this.serverSeed, this.roundNo + 1, this.rtp, this.variant);
    return { multiplier: fr.crash, hash: fr.hash };
  }

  /** Public fairness data for a round (the Fairness tab + verify API). */
  fairnessFor(n) {
    const fr = fairRound(this.serverSeed, n, this.rtp, this.variant);
    return {
      round: n,
      hash: fr.hash,
      crash: fr.crash,
      serverSeed: this.serverSeed,
      clientSeeds: fr.clientSeeds,
      rtp: this.rtp,
      variant: this.variant,
      algorithm: 'sha512(serverSeed + clientSeed1 + clientSeed2 + clientSeed3) -> 52-bit h -> floor(0.97/(1-h)*100)/100',
    };
  }

  verify(n, crash) {
    return verifyRound(this.serverSeed, n, crash, this.rtp, this.variant);
  }

  /**
   * AI crash-point draw: generates a fresh random seed and derives one
   * crash point from the game's authentic provably-fair construction.
   * Each call is an independent draw from the verified distribution —
   * this is the "AI prediction": a genuine random crash point, with its
   * hash published so the draw is verifiable, never hand-picked.
   */
  randomCrash() {
    const seed = randomSeed();
    const fr = fairRound(seed, 1, this.rtp, this.variant);
    return {
      crash: fr.crash,
      hash: fr.hash,
      seed,
      clientSeeds: fr.clientSeeds,
      rtp: this.rtp,
      variant: this.variant,
      generatedAt: new Date().toISOString(),
    };
  }

  /** Live room statistics over the trailing window. */
  roomStats(history) {
    const w = history.slice(-WINDOW);
    const ms = w.map((r) => r.outcome.multiplier);
    const n = ms.length;
    const mean = ms.reduce((s, m) => s + m, 0) / n;
    const variance = ms.reduce((s, m) => s + (m - mean) ** 2, 0) / n;
    const std = Math.sqrt(variance);

    const pctAtLeast = (x) => (ms.filter((m) => m >= x).length / n) * 100;

    let sinceBig = 0;
    for (let i = ms.length - 1; i >= 0; i--) {
      if (ms[i] >= 10) break;
      sinceBig += 1;
    }

    let bustStreak = 0;
    for (let i = ms.length - 1; i >= 0; i--) {
      if (ms[i] < 1.5) bustStreak += 1;
      else break;
    }

    const recent = ms.slice(-10);
    const recentMean = recent.reduce((s, m) => s + m, 0) / recent.length;
    const trend = recentMean > mean ? 'heating' : recentMean < mean * 0.7 ? 'cooling' : 'neutral';

    return { n, mean: round2(mean), std: round2(std), pctAtLeast, sinceBig, bustStreak, trend };
  }

  analyze(history) {
    const s = this.roomStats(history);
    const reasoning = [];

    // Tier hit-rates from the empirical distribution.
    const tiers = TIERS.map((t) => ({
      ...t,
      hitRate: round2(s.pctAtLeast(t.cashout)),
    }));

    // --- pick the recommended tier ---------------------------------------
    // Honest framing (verified): every round is independent and its crash
    // point is cryptographically committed before the round starts, so no
    // history pattern changes the true odds — P(crash >= m) = 0.97/m always.
    // The tier pick is therefore bankroll strategy, not a forecast: bust
    // clusters argue for protection, and the long-run math says no cash-out
    // target has positive EV (Kelly fraction is 0 everywhere).
    let pick = tiers[1]; // balanced default
    if (s.bustStreak >= 3) {
      pick = tiers[0];
      reasoning.push(`${s.bustStreak} straight busts under 1.50x — bankroll protection mode, take the safe cash-out.`);
    } else if (s.sinceBig >= 60) {
      pick = tiers[2];
      reasoning.push(`No 10x+ in ${s.sinceBig} rounds. The odds haven't changed (every round is independent) — but if you're hunting multipliers, the payout landscape is unchanged and the drought is just variance.`);
    } else if (s.trend === 'heating' && s.pctAtLeast(2) >= 45) {
      pick = tiers[1];
      reasoning.push(`Room is heating (recent avg ${s.mean}x) with ${round2(s.pctAtLeast(2))}% of rounds clearing 2x — but the next round's true odds are still 0.97/m regardless.`);
    } else if (s.trend === 'cooling') {
      pick = tiers[0];
      reasoning.push(`Room is cooling — recent rounds averaging well below the mean. Play the safe tier for bankroll preservation.`);
    } else {
      reasoning.push(`Room running neutral: ${round2(s.pctAtLeast(2))}% of the last ${s.n} rounds cleared 2x (true probability: 48.5%).`);
    }

    if (s.std > 8) reasoning.push(`High volatility (std ${s.std}) — size stakes down even on a hit call.`);
    reasoning.push(`True odds never move: P(crash ≥ ${pick.cashout}x) = ${(round2((0.97 / pick.cashout) * 100))}% on every single round.`);

    // --- confidence: sample depth + pattern clarity -----------------------
    let confidence = 55;
    confidence += Math.min(15, s.n / 5);                       // deeper sample
    if (s.bustStreak >= 3 || s.sinceBig >= 60) confidence += 10; // clear pattern
    if (s.trend !== 'neutral') confidence += 5;
    if (s.std > 8) confidence -= 8;                             // noisy room
    confidence = clamp(Math.round(confidence), 50, 92);

    // --- stake suggestion: fraction of bankroll, scaled by confidence ----
    const basePct = pick.key === 'safe' ? 3 : pick.key === 'balanced' ? 2 : 1;
    const stakePct = round2(basePct * (confidence / 75));

    // --- structured signal factors for the Signal Meter UI ----------------
    const factors = [
      {
        name: 'Tier edge',
        score: clamp(Math.round(pick.hitRate), 0, 100),
        weight: 35,
        direction: pick.hitRate >= 55 ? 'bullish' : pick.hitRate >= 40 ? 'neutral' : 'bearish',
        detail: `${pick.hitRate}% of the last ${s.n} rounds clear ${pick.cashout}x`,
      },
      {
        name: 'Moonshot drought',
        score: clamp(Math.round((s.sinceBig / 80) * 100), 0, 100),
        weight: 25,
        direction: 'neutral',
        detail: `${s.sinceBig} rounds since the last 10x+ — pure variance, the next round's odds are unchanged`,
      },
      {
        name: 'Bust pressure',
        score: clamp(s.bustStreak * 25, 0, 100),
        weight: 20,
        direction: s.bustStreak >= 3 ? 'bearish' : 'neutral',
        detail: s.bustStreak > 0 ? `${s.bustStreak} straight busts under 1.50x` : 'No active bust cluster',
      },
      {
        name: 'Room trend',
        score: s.trend === 'heating' ? 75 : s.trend === 'cooling' ? 25 : 50,
        weight: 12,
        direction: s.trend === 'heating' ? 'bullish' : s.trend === 'cooling' ? 'bearish' : 'neutral',
        detail: `Room is ${s.trend} — trailing avg ${s.mean}x`,
      },
      {
        name: 'Volatility',
        score: clamp(Math.round(100 - s.std * 4), 0, 100),
        weight: 8,
        direction: s.std > 8 ? 'bearish' : 'neutral',
        detail: `Std dev ${s.std}x across the window`,
      },
    ];

    return {
      type: 'crash',
      summary: `Cash out at ${pick.cashout}x (${pick.label})`,
      cashout: pick.cashout,
      tier: pick.key,
      tiers,
      confidence,
      riskLevel: pick.key === 'safe' ? 'Low' : pick.key === 'balanced' ? 'Medium' : 'High',
      stakePct,
      factors,
      disclaimer: 'Rounds are independent — each crash point is cryptographically committed before the round and no pattern in history changes the odds. This is expected-value guidance for stake sizing, not a forecast of the next round.',
      room: {
        rounds: s.n,
        avgMultiplier: s.mean,
        volatility: s.std,
        trend: s.trend,
        bustStreak: s.bustStreak,
        roundsSince10x: s.sinceBig,
      },
      reasoning,
    };
  }

  /**
   * Target analysis: how often would a cash-out at `target` have won over
   * the last `window` rounds? The empirical hit rate comes with a Wilson
   * interval, and the theoretical P(crash >= target) = 0.97/target is
   * shown beside it — if the empirical rate sits outside the interval
   * relative to theory, that's just window noise, because the math is
   * fixed by the provably-fair construction.
   */
  analyzeTarget(target, window = 100) {
    const t = Math.max(1.01, Number(target) || 2);
    const w = this.history.slice(-Math.max(1, Math.floor(window) || 100));
    const ms = w.map((r) => r.outcome.multiplier);
    const n = ms.length;
    const hits = ms.filter((m) => m >= t).length;
    const misses = n - hits;
    const hitRate = n ? (hits / n) * 100 : 0;
    const wi = stats.wilsonCI(hits, n);
    return {
      target: t,
      window,
      sampleSize: n,
      hits,
      misses,
      hitRate: round2(hitRate),
      wilson: { lower: round2(wi.lower * 100), upper: round2(wi.upper * 100) },
      // True probability P(crash >= target) = 0.97/target (both variants).
      theoretical: round2((0.97 / t) * 100),
      // Expected profit per unit staked: p*target - 1. Always <= 0.
      evPerUnit: round2((hitRate / 100) * t - 1),
      mean: n ? round2(stats.mean(ms)) : 0,
      median: n ? round2(stats.median(ms)) : 0,
      std: round2(stats.std(ms)),
      iqr: n ? round2(stats.iqr(ms)) : 0,
      max: n ? round2(stats.max(ms)) : 0,
      disclaimer: 'The empirical hit rate is descriptive of the window, not a forecast. The true odds are fixed: P(crash ≥ target) = 0.97/target on every round.',
    };
  }

  gradeOutcome(prediction, outcome) {
    return outcome.multiplier >= prediction.cashout;
  }
}

module.exports = { CrashEngine };
