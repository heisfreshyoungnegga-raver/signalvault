// lib/services/engines/action-engine.js — prediction engine for Super Hero
// (zone-strike action game). Each round one of five zones goes hot and pays
// the round multiplier; a bonus spin can trigger on top. The engine tracks
// hot-zone frequencies and bonus droughts, then calls the zone with the
// strongest empirical edge.
//
// A prediction HITS when the called zone goes hot.
const { BaseEngine } = require('./base-engine');
const { pickWeighted, clamp, round2 } = require('./rng');
const { wilsonCI } = require('./stats');

const ZONES = ['alpha', 'beta', 'gamma', 'delta', 'omega'];
const WINDOW = 60;

class ActionEngine extends BaseEngine {
  simulateRound() {
    if (!this.zoneHeat || this.rand() < 0.03) {
      // Zone weights drift slowly — the "hot table" moves between zones.
      const base = ZONES.map(() => 0.6 + this.rand() * 0.8);
      this.zoneHeat = base;
    }
    const hot = pickWeighted(this.rand, ZONES.map((z, i) => [z, this.zoneHeat[i]]));
    const multiplier = round2(1.5 + this.rand() * 8);
    const bonus = this.rand() < 0.08;
    return { hot, multiplier, bonus };
  }

  analyze(history) {
    const w = history.slice(-WINDOW);
    const n = w.length || 1;
    const reasoning = [];

    const hits = { alpha: 0, beta: 0, gamma: 0, delta: 0, omega: 0 };
    let bonuses = 0;
    let sinceBonus = 0;
    for (const r of w) {
      hits[r.outcome.hot] += 1;
      if (r.outcome.bonus) { bonuses += 1; sinceBonus = 0; }
      else sinceBonus += 1;
    }
    // Shrink toward uniform (20% each) so thin samples don't overreact.
    const zones = ZONES.map((z) => {
      const freq = (hits[z] + 4) / (n + 20);
      return { zone: z, hotPct: round2(freq * 100), rawHits: hits[z] };
    }).sort((a, b) => b.hotPct - a.hotPct);

    const pick = zones[0];
    const edge = round2(pick.hotPct - 20); // edge over uniform
    reasoning.push(
      `Zone ${pick.zone.toUpperCase()} is running hot at ${pick.hotPct}% of the last ${n} rounds (${edge >= 0 ? '+' : ''}${edge}% over random).`
    );
    if (edge >= 6) reasoning.push(`Strong table bias — this is the engine's highest-conviction call.`);
    else if (edge <= 1) reasoning.push(`Table is flat with no real bias — this is a low-edge call, keep stakes minimum.`);

    const bonusRate = round2((bonuses / n) * 100);
    if (sinceBonus >= 25) {
      reasoning.push(`No bonus spin in ${sinceBonus} rounds (avg rate ${bonusRate}%) — bonus is overdue, worth a side stake.`);
    } else {
      reasoning.push(`Bonus spins landing at ${bonusRate}% — nothing unusual.`);
    }

    let confidence = 50 + Math.min(14, n / 6);
    if (edge >= 6) confidence += 12;
    else if (edge >= 3) confidence += 6;
    if (sinceBonus >= 25) confidence += 4;
    confidence = clamp(Math.round(confidence), 48, 88);

    const factors = [
      {
        name: 'Zone bias',
        score: clamp(Math.round(50 + edge * 6), 0, 100),
        weight: 40,
        direction: edge >= 6 ? 'bullish' : edge >= 3 ? 'neutral' : 'bearish',
        detail: `${pick.zone.toUpperCase()} hot ${pick.hotPct}% (${edge >= 0 ? '+' : ''}${edge}% over random)`,
      },
      {
        name: 'Bonus drought',
        score: clamp(Math.round((sinceBonus / 30) * 100), 0, 100),
        weight: 25,
        direction: sinceBonus >= 25 ? 'bullish' : 'neutral',
        detail: sinceBonus >= 25 ? `${sinceBonus} rounds since last bonus — overdue` : `${sinceBonus} rounds since last bonus`,
      },
      {
        name: 'Table stability',
        score: clamp(Math.round(100 - Math.abs(zones[0].hotPct - zones[4].hotPct) * 3), 0, 100),
        weight: 20,
        direction: 'neutral',
        detail: `Spread ${round2(zones[0].hotPct - zones[4].hotPct)}% between hottest and coldest zone`,
      },
      {
        name: 'Sample depth',
        score: clamp(Math.round((n / 60) * 100), 0, 100),
        weight: 15,
        direction: n >= 40 ? 'bullish' : 'neutral',
        detail: `${n} rounds in the window`,
      },
    ];

    return {
      type: 'action',
      summary: `Strike zone ${pick.zone.toUpperCase()} — hot ${pick.hotPct}% of rounds`,
      zone: pick.zone,
      factors,
      hotPct: pick.hotPct,
      edgeOverRandom: edge,
      zones,
      bonus: { ratePct: bonusRate, roundsSince: sinceBonus, overdue: sinceBonus >= 25 },
      confidence,
      riskLevel: edge >= 6 ? 'Low' : edge >= 3 ? 'Medium' : 'High',
      stakePct: round2((edge >= 6 ? 2.5 : 1.5) * (confidence / 70)),
      reasoning,
    };
  }

  /**
   * Per-zone hot-rate metrics over the trailing `window` rounds, with a
   * Wilson interval and a shrinkage-smoothed rate.
   *
   * smoothedRate pulls the raw hot rate toward the uniform prior (20% —
   * five zones) with `minSamples` of prior weight:
   *   smoothed = (hotCount + minSamples*0.2) / (rounds + minSamples)
   * so thin samples can't masquerade as a real edge.
   */
  zoneMetrics(window = 120, minSamples = 5) {
    const w = this.history.slice(-Math.max(1, Math.floor(window) || 120));
    const prior = minSamples * 0.2; // uniform prior weight per zone
    const zones = ZONES.map((zone) => {
      const hotCount = w.filter((r) => r.outcome.hot === zone).length;
      const rounds = w.length;
      const wi = wilsonCI(hotCount, rounds);
      const smoothed = rounds ? (hotCount + prior) / (rounds + minSamples) : 0.2;
      return {
        zone,
        rounds,
        hotCount,
        hotRate: rounds ? round2((hotCount / rounds) * 100) : 0,
        wilson: { lower: round2(wi.lower * 100), upper: round2(wi.upper * 100) },
        smoothedRate: round2(smoothed * 100),
      };
    });
    return { window, sampleSize: w.length, zones };
  }

  gradeOutcome(prediction, outcome) {
    return outcome.hot === prediction.zone;
  }
}

module.exports = { ActionEngine };
