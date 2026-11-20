// lib/services/engines/base-engine.js — shared skeleton every prediction
// engine inherits: ring-buffer round history, prediction grading, and
// rolling accuracy stats. Concrete engines only implement:
//   - simulateRound() -> outcome object for one round
//   - analyze(history) -> prediction object for the NEXT round
//   - gradeOutcome(prediction, outcome) -> true (hit) | false (miss)
const { makeRng, round2 } = require('./rng');

const MAX_HISTORY = 500;

class BaseEngine {
  constructor({ id, name, game, seed = null }) {
    this.id = id;
    this.name = name;
    this.game = game;
    this.rand = makeRng(seed);
    this.history = [];          // newest last: { n, outcome, ts }
    this.pending = null;        // prediction awaiting its round result
    this.roundNo = 0;
    this.stats = { predictions: 0, hits: 0, streak: 0, bestStreak: 0 };
  }

  /** Push a simulated round through the engine: grades the pending
   *  prediction, records the outcome, returns the new round + analysis. */
  tick() {
    const outcome = this.simulateRound();
    this.roundNo += 1;
    const round = { n: this.roundNo, outcome, ts: Date.now() };

    if (this.pending) {
      const hit = this.gradeOutcome(this.pending, outcome);
      this.stats.predictions += 1;
      if (hit) {
        this.stats.hits += 1;
        this.stats.streak += 1;
        this.stats.bestStreak = Math.max(this.stats.bestStreak, this.stats.streak);
      } else {
        this.stats.streak = 0;
      }
      round.graded = { hit, prediction: this.pending.summary };
    }

    this.history.push(round);
    if (this.history.length > MAX_HISTORY) this.history.shift();

    const prediction = this.analyze(this.history);
    prediction.round = this.roundNo + 1;
    prediction.engine = this.id;
    this.pending = prediction;
    return { round, prediction };
  }

  /** Current prediction without advancing the simulation. */
  currentPrediction() {
    if (!this.pending) this.tick();
    return { ...this.pending, round: this.roundNo + 1, engine: this.id };
  }

  getHistory(limit = 30) {
    return this.history.slice(-limit).reverse();
  }

  getStats() {
    const { predictions, hits, streak, bestStreak } = this.stats;
    return {
      engine: this.id,
      rounds: this.roundNo,
      predictions,
      hits,
      accuracy: predictions ? round2((hits / predictions) * 100) : 0,
      streak,
      bestStreak,
    };
  }

  /** Pre-fill history so stats look alive from the first request. */
  seedHistory(n = 120) {
    for (let i = 0; i < n; i++) this.tick();
    return this;
  }

  // -- to be implemented by subclasses -------------------------------------
  simulateRound() { throw new Error('simulateRound() not implemented'); }
  analyze(/* history */) { throw new Error('analyze() not implemented'); }
  gradeOutcome(/* prediction, outcome */) { throw new Error('gradeOutcome() not implemented'); }
}

module.exports = { BaseEngine, MAX_HISTORY };
