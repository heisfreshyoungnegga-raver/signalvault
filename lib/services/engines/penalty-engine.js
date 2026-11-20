// lib/services/engines/penalty-engine.js — prediction engine for SportyKick
// (penalty shootout). Keepers are creatures of habit: the engine profiles
// each keeper's dive distribution and each shooter's placement pattern,
// then recommends the corner with the highest empirical goal rate.
//
// A prediction HITS when the recommended corner scores.
const { BaseEngine } = require('./base-engine');
const { pickWeighted, clamp, round2 } = require('./rng');
const { wilsonCI } = require('./stats');

const DIRS = ['left', 'center', 'right'];
const HEIGHTS = ['upper', 'middle', 'lower'];
// Placement heights: shots favour the low corners (harder for keepers).
const HEIGHT_WEIGHTS = [['upper', 0.2], ['middle', 0.35], ['lower', 0.45]];
const ZONES = [
  'upper-left', 'upper-center', 'upper-right',
  'middle-left', 'middle-center', 'middle-right',
  'lower-left', 'lower-center', 'lower-right',
];
const WINDOW = 60;

class PenaltyEngine extends BaseEngine {
  simulateRound() {
    // Keeper has a persistent bias (re-rolled slowly); shooter is uniform-ish.
    if (!this.keeperBias || this.rand() < 0.02) {
      this.keeperBias = {
        left: 0.25 + this.rand() * 0.25,
        center: 0.1 + this.rand() * 0.15,
        right: 0.25 + this.rand() * 0.25,
      };
    }
    const b = this.keeperBias;
    const keeper = pickWeighted(this.rand, DIRS.map((d) => [d, b[d]]));
    const shooter = pickWeighted(this.rand, DIRS.map((d) => [d, d === 'center' ? 0.25 : 0.375]));
    // Keeper saves it if he picks the shooter's corner (85% of the time —
    // even a guessed-right dive can be beaten by placement).
    const goal = keeper !== shooter || this.rand() > 0.85;
    // The 9-zone goal mouth: each shot also has a height, so the zone is
    // `upper-left`, `middle-center`, etc. The keeper dives at a direction
    // (covering the full vertical band); the height is a placement choice.
    const height = pickWeighted(this.rand, HEIGHT_WEIGHTS);
    return { keeper, shooter, height, zone: `${height}-${shooter}`, goal };
  }

  analyze(history) {
    const w = history.slice(-WINDOW);
    const reasoning = [];

    const dives = { left: 0, center: 0, right: 0 };
    const shots = { left: 0, center: 0, right: 0 };
    const goals = { left: 0, center: 0, right: 0 };
    for (const r of w) {
      const o = r.outcome;
      dives[o.keeper] += 1;
      shots[o.shooter] += 1;
      if (o.goal) goals[o.shooter] += 1;
    }
    const n = w.length || 1;
    // P(goal | shoot d) ≈ empirical, shrunk toward the global average.
    const globalGoal = w.filter((r) => r.outcome.goal).length / n;
    const corners = DIRS.map((d) => {
      const s = shots[d] || 1;
      const shrunk = (goals[d] + globalGoal * 8) / (s + 8);
      const keeperDivePct = round2((dives[d] / n) * 100);
      return { direction: d, goalRate: round2(shrunk * 100), keeperDivePct, shots: shots[d] };
    }).sort((a, b) => b.goalRate - a.goalRate);

    const pick = corners[0];
    const runnerUp = corners[1];
    reasoning.push(
      `Keeper dives ${pick.direction.toUpperCase()} only ${pick.keeperDivePct}% of the time — lowest coverage of the three corners.`
    );
    if (pick.goalRate - runnerUp.goalRate >= 8) {
      reasoning.push(
        `Clear edge: shooting ${pick.direction} scores ${pick.goalRate}% vs ${runnerUp.goalRate}% for ${runnerUp.direction} over the last ${n} kicks.`
      );
    } else {
      reasoning.push(`Keeper reads are tight (top two corners within ${round2(pick.goalRate - runnerUp.goalRate)}%) — edge is thin, stake small.`);
    }

    let confidence = 52 + Math.min(14, n / 6);
    if (pick.goalRate - runnerUp.goalRate >= 8) confidence += 10;
    if (pick.keeperDivePct < 28) confidence += 6;
    confidence = clamp(Math.round(confidence), 50, 90);

    const edge = round2(pick.goalRate - runnerUp.goalRate);
    const factors = [
      {
        name: 'Corner edge',
        score: clamp(Math.round(50 + edge * 4), 0, 100),
        weight: 40,
        direction: edge >= 8 ? 'bullish' : edge >= 3 ? 'neutral' : 'bearish',
        detail: `${pick.direction} scores ${pick.goalRate}% vs ${runnerUp.goalRate}% for ${runnerUp.direction}`,
      },
      {
        name: 'Keeper blind spot',
        score: clamp(Math.round(100 - pick.keeperDivePct * 2), 0, 100),
        weight: 30,
        direction: pick.keeperDivePct < 28 ? 'bullish' : pick.keeperDivePct < 36 ? 'neutral' : 'bearish',
        detail: `Keeper covers ${pick.direction} only ${pick.keeperDivePct}% of kicks`,
      },
      {
        name: 'Sample depth',
        score: clamp(Math.round((n / 60) * 100), 0, 100),
        weight: 20,
        direction: n >= 40 ? 'bullish' : 'neutral',
        detail: `${n} kicks profiled`,
      },
      {
        name: 'Global scoring',
        score: clamp(Math.round(globalGoal * 100), 0, 100),
        weight: 10,
        direction: 'neutral',
        detail: `${round2(globalGoal * 100)}% of all kicks score`,
      },
    ];

    return {
      type: 'penalty',
      summary: `Shoot ${pick.direction.toUpperCase()} — ${pick.goalRate}% goal rate`,
      direction: pick.direction,
      goalRate: pick.goalRate,
      factors,
      corners,
      keeperProfile: {
        left: round2((dives.left / n) * 100),
        center: round2((dives.center / n) * 100),
        right: round2((dives.right / n) * 100),
      },
      confidence,
      riskLevel: confidence >= 70 ? 'Low' : confidence >= 60 ? 'Medium' : 'High',
      stakePct: round2((confidence >= 70 ? 3 : 2) * (confidence / 70)),
      reasoning,
    };
  }

  /**
   * 9-zone goal-mouth breakdown over the trailing `window` rounds. For each
   * zone (e.g. `upper-left`): shots taken, goals scored, the empirical
   * goal rate with a Wilson interval — the same honest treatment the
   * 3-direction analyze() gets, at finer resolution.
   */
  zoneStats(window = 120) {
    const w = this.history.slice(-Math.max(1, Math.floor(window) || 120));
    const shots = {};
    const goals = {};
    for (const z of ZONES) { shots[z] = 0; goals[z] = 0; }
    for (const r of w) {
      const z = r.outcome.zone;
      if (shots[z] === undefined) continue; // legacy rounds have no zone
      shots[z] += 1;
      if (r.outcome.goal) goals[z] += 1;
    }
    const zones = ZONES.map((zone) => {
      const wi = wilsonCI(goals[zone], shots[zone]);
      return {
        zone,
        shots: shots[zone],
        goals: goals[zone],
        goalRate: shots[zone] ? round2((goals[zone] / shots[zone]) * 100) : 0,
        wilson: { lower: round2(wi.lower * 100), upper: round2(wi.upper * 100) },
      };
    });
    return { window, sampleSize: w.length, zones };
  }

  gradeOutcome(prediction, outcome) {
    // Zone predictions (from zoneStats-based calls): HITS when the exact
    // zone is taken and scores.
    if (prediction && prediction.zone) {
      return outcome.zone === prediction.zone && outcome.goal === true;
    }
    // Counterfactual grade: would shooting the recommended corner have
    // beaten THIS keeper dive? Yes if the keeper went elsewhere; if he
    // read it, only if placement beats him (the sim's 15% head-on rate).
    if (outcome.keeper !== prediction.direction) return true;
    return outcome.shooter === prediction.direction && outcome.goal;
  }
}

module.exports = { PenaltyEngine };
