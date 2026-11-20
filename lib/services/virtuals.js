// lib/services/virtuals.js — Instant Virtuals: real virtual football.
//
// Deterministic, stateless, provably-fair style. Vercel serverless has no
// in-memory scheduler, so EVERYTHING derives from wall-clock time:
//
//   roundId  = floor(epochMs / ROUND_MS)          (180s cycle)
//   phase    = betting (first 155s) -> live feed (last 25s)
//   fixtures, odds, scores, events = pure functions of
//   SHA-256(serverSeed + ':' + roundId) feeding a mulberry32 RNG.
//
// Nothing is invented outside the generator: a fixture, team, result or
// odd that is not produced by generateRound(roundId) does not exist.
// The seed INPUT is committed up front (seedHash in the round payload)
// and revealed once the round is settled, so anyone can re-run the
// generator and verify the round.
//
// Betting: real sessions only (sim sessions are rejected in the router).
// Min stake 5 credits; stake spent via credits.spendAmount
// (ref VIRTUAL_STAKE_<betId>), wins paid via credits.grantCredits
// (ref VIRTUAL_WIN_<betId>, idempotent). Settlement is LAZY —
// settle-on-read: any virtuals read settles the previous round first,
// so no background job is needed. A bet insert that fails after the
// spend is refunded (ref VIRTUAL_REFUND_<betId>).
const crypto = require('crypto');
const { sql } = require('../db');
const { ApiError, generateId } = require('../util');
const credits = require('./credits');

/** One round every 3 minutes. */
const ROUND_MS = 180000;
/** Betting window inside the cycle; the last 25s are the live feed. */
const BETTING_MS = 155000;
const FEED_MS = ROUND_MS - BETTING_MS;
/** Overround: implied probabilities sum to ~1.08. */
const OVERROUND = 1.08;
/** Minimum stake, credits. */
const MIN_STAKE = 5;

const SERVER_SEED = process.env.VIRTUALS_SERVER_SEED || 'signalvault-virtuals-v1';

// ── Fictional leagues (invented clubs only — no real teams) ────────────────
const LEAGUES = [
  {
    id: 'gold-coast',
    name: 'Gold Coast Premier',
    teams: [
      { name: 'Accra Comets', strength: 88 },
      { name: 'Kumasi Stars', strength: 84 },
      { name: 'Tema Harbour', strength: 81 },
      { name: 'Cape Coast Waves', strength: 78 },
      { name: 'Takoradi Anchors', strength: 76 },
      { name: 'Ho Volcanoes', strength: 73 },
      { name: 'Sunyani Royals', strength: 71 },
      { name: 'Koforidua United', strength: 69 },
    ],
  },
  {
    id: 'volta',
    name: 'Volta League',
    teams: [
      { name: 'Hohoe Falcons', strength: 82 },
      { name: 'Keta Sharks', strength: 79 },
      { name: 'Aflao Border', strength: 75 },
      { name: 'Kpando Lions', strength: 72 },
      { name: 'Sogakope Rovers', strength: 70 },
      { name: 'Denu Strikers', strength: 67 },
    ],
  },
  {
    id: 'ashanti',
    name: 'Ashanti League',
    teams: [
      { name: 'Obuasi Miners', strength: 83 },
      { name: 'Mampong Chiefs', strength: 80 },
      { name: 'Ejisu Warriors', strength: 77 },
      { name: 'Bekwai Eagles', strength: 74 },
      { name: 'Konongo Rangers', strength: 71 },
      { name: 'Agogo Spartans', strength: 68 },
    ],
  },
];

// ── Seeded RNG ─────────────────────────────────────────────────────────────
function mulberry32(a) {
  return function () {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function seedInput(roundId) {
  return `${SERVER_SEED}:${roundId}`;
}
function seedHash(roundId) {
  return crypto.createHash('sha256').update(seedInput(roundId)).digest('hex');
}
function rngFor(roundId) {
  const hash = seedHash(roundId);
  return mulberry32(parseInt(hash.slice(0, 8), 16));
}

/** Poisson sample (Knuth) from the seeded RNG. */
function poisson(rng, lambda) {
  const L = Math.exp(-lambda);
  let k = 0;
  let p = 1;
  do {
    k += 1;
    p *= rng();
  } while (p > L);
  return k - 1;
}

function roundOdds(p) {
  return Math.round((1 / (p * OVERROUND)) * 100) / 100;
}

/** 1X2 + Over/Under 2.5 probabilities from Poisson scorelines 0..8, plus the
 *  extra markets SportyBet shoppers expect: Double Chance, Both Teams To
 *  Score, and the 6 most likely Correct Scores — all from the SAME grid,
 *  so every market on a match is one consistent price book. */
function oddsFor(homeStrength, awayStrength) {
  const ratio = homeStrength / awayStrength;
  const homeLambda = Math.min(3.2, Math.max(0.4, 1.45 * Math.pow(ratio, 1.2)));
  const awayLambda = Math.min(3.2, Math.max(0.4, 1.1 * Math.pow(1 / ratio, 1.2)));
  const pois = (lambda, k) => (Math.exp(-lambda) * Math.pow(lambda, k)) / factorial(k);
  let pH = 0;
  let pD = 0;
  let pA = 0;
  let pOver = 0;
  let pGG = 0;
  const scorelines = [];
  for (let h = 0; h <= 8; h += 1) {
    for (let a = 0; a <= 8; a += 1) {
      const p = pois(homeLambda, h) * pois(awayLambda, a);
      if (h > a) pH += p;
      else if (h === a) pD += p;
      else pA += p;
      if (h + a >= 3) pOver += p;
      if (h >= 1 && a >= 1) pGG += p;
      scorelines.push({ score: `${h}-${a}`, p });
    }
  }
  scorelines.sort((x, y) => y.p - x.p);
  return {
    home: roundOdds(pH),
    draw: roundOdds(pD),
    away: roundOdds(pA),
    over25: roundOdds(pOver),
    under25: roundOdds(1 - pOver),
    dc1x: roundOdds(pH + pD),
    dc12: roundOdds(pH + pA),
    dcx2: roundOdds(pD + pA),
    gg: roundOdds(pGG),
    ng: roundOdds(1 - pGG),
    cs: scorelines.slice(0, 6).map((s) => ({ score: s.score, odds: roundOdds(s.p) })),
    homeLambda,
    awayLambda,
  };
}
const FACT = [1, 1, 2, 6, 24, 120, 720, 5040, 40320];
function factorial(n) {
  return FACT[n];
}

// ── Round generator (pure) ─────────────────────────────────────────────────
/**
 * Generate a whole round from its id. Deterministic: same roundId always
 * yields the same fixtures, odds, scores and goal minutes.
 */
function generateRound(roundId) {
  const rng = rngFor(roundId);
  const leagues = LEAGUES.map((league) => {
    const shuffled = league.teams.slice();
    for (let i = shuffled.length - 1; i > 0; i -= 1) {
      const j = Math.floor(rng() * (i + 1));
      [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
    }
    const matches = [];
    for (let i = 0; i + 1 < shuffled.length; i += 2) {
      const home = shuffled[i];
      const away = shuffled[i + 1];
      const odds = oddsFor(home.strength, away.strength);
      const homeGoals = poisson(rng, odds.homeLambda);
      const awayGoals = poisson(rng, odds.awayLambda);
      const events = [];
      for (let g = 0; g < homeGoals; g += 1) {
        events.push({ minute: 1 + Math.floor(rng() * 90), team: 'home', type: 'goal' });
      }
      for (let g = 0; g < awayGoals; g += 1) {
        events.push({ minute: 1 + Math.floor(rng() * 90), team: 'away', type: 'goal' });
      }
      events.sort((a, b) => a.minute - b.minute);
      matches.push({
        id: `${roundId}:${league.id}:${matches.length}`,
        leagueId: league.id,
        home: home.name,
        away: away.name,
        homeStrength: home.strength,
        awayStrength: away.strength,
        odds: {
          home: odds.home,
          draw: odds.draw,
          away: odds.away,
          over25: odds.over25,
          under25: odds.under25,
          dc1x: odds.dc1x,
          dc12: odds.dc12,
          dcx2: odds.dcx2,
          gg: odds.gg,
          ng: odds.ng,
          cs: odds.cs,
        },
        homeGoals,
        awayGoals,
        events,
      });
    }
    return { id: league.id, name: league.name, matches };
  });
  return {
    roundId,
    seedHash: seedHash(roundId),
    leagues,
    matches: leagues.flatMap((l) => l.matches),
  };
}

/** Live score of a generated match at a given match minute. */
function liveScore(match, minute) {
  let h = 0;
  let a = 0;
  for (const e of match.events) {
    if (e.minute > minute) break;
    if (e.team === 'home') h += 1;
    else a += 1;
  }
  return { home: h, away: a };
}

/** Round timing for a wall-clock instant. */
function roundTiming(nowMs) {
  const roundId = Math.floor(nowMs / ROUND_MS);
  const roundStart = roundId * ROUND_MS;
  const offset = nowMs - roundStart;
  const betting = offset < BETTING_MS;
  return {
    roundId,
    roundStartAt: roundStart,
    bettingEndsAt: roundStart + BETTING_MS,
    feedEndsAt: roundStart + ROUND_MS,
    phase: betting ? 'betting' : 'live',
    countdownMs: betting ? roundStart + BETTING_MS - nowMs : roundStart + ROUND_MS - nowMs,
    feedElapsedMs: betting ? 0 : offset - BETTING_MS,
    minute: betting ? 0 : Math.min(90, 1 + Math.floor(((offset - BETTING_MS) * 90) / FEED_MS)),
  };
}

// ── Schema (self-healing, like the other services) ─────────────────────────
let schemaReady = null;
async function ensureSchema() {
  if (schemaReady) return schemaReady;
  schemaReady = (async () => {
    const db = sql();
    await db`
      CREATE TABLE IF NOT EXISTS virtual_results (
        round_id  BIGINT NOT NULL,
        match_id  TEXT NOT NULL,
        league_id TEXT NOT NULL,
        home      TEXT NOT NULL,
        away      TEXT NOT NULL,
        home_goals INT NOT NULL,
        away_goals INT NOT NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        PRIMARY KEY (round_id, match_id)
      )`;
    await db`
      CREATE TABLE IF NOT EXISTS virtual_bets (
        id          TEXT PRIMARY KEY,
        identity    TEXT NOT NULL,
        round_id    BIGINT NOT NULL,
        match_id    TEXT NOT NULL,
        league_id   TEXT NOT NULL,
        market      TEXT NOT NULL,
        selection   TEXT NOT NULL,
        odds        NUMERIC(8,2) NOT NULL,
        stake       INT NOT NULL,
        status      TEXT NOT NULL DEFAULT 'PENDING',
        payout      INT NOT NULL DEFAULT 0,
        created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
      )`;
    await db`CREATE INDEX IF NOT EXISTS virtual_bets_identity_idx ON virtual_bets (identity, created_at DESC)`;
    await db`CREATE INDEX IF NOT EXISTS virtual_bets_round_idx ON virtual_bets (round_id, status)`;
    await db`CREATE INDEX IF NOT EXISTS virtual_results_round_idx ON virtual_results (round_id)`;
  })().catch((err) => { schemaReady = null; throw err; });
  return schemaReady;
}

// ── Settlement (lazy, idempotent) ──────────────────────────────────────────
function betWon(bet, result) {
  if (!result) return false;
  // Generated matches carry homeGoals/awayGoals; DB rows home_goals/away_goals.
  const hg = Number(result.home_goals ?? result.homeGoals);
  const ag = Number(result.away_goals ?? result.awayGoals);
  if (bet.market === '1X2') {
    if (bet.selection === 'H') return hg > ag;
    if (bet.selection === 'D') return hg === ag;
    if (bet.selection === 'A') return hg < ag;
    return false;
  }
  if (bet.market === 'OU25') {
    if (bet.selection === 'OVER') return hg + ag >= 3;
    if (bet.selection === 'UNDER') return hg + ag <= 2;
    return false;
  }
  if (bet.market === 'DC') {
    if (bet.selection === '1X') return hg >= ag;
    if (bet.selection === '12') return hg !== ag;
    if (bet.selection === 'X2') return hg <= ag;
    return false;
  }
  if (bet.market === 'BTTS') {
    if (bet.selection === 'GG') return hg >= 1 && ag >= 1;
    if (bet.selection === 'NG') return !(hg >= 1 && ag >= 1);
    return false;
  }
  if (bet.market === 'CS') {
    const m = /^(\d+)-(\d+)$/.exec(String(bet.selection));
    if (!m) return false;
    return hg === Number(m[1]) && ag === Number(m[2]);
  }
  return false;
}

// ── Speed: generated rounds are pure + deterministic, so cache them in
// memory (a round is 10 matches — recomputing SHA-256 + Poisson odds per
// read is cheap but pointless), and remember which rounds this instance
// already settled so repeat reads skip the database entirely.
const roundCache = new Map();
function cachedGenerateRound(roundId) {
  let gen = roundCache.get(roundId);
  if (!gen) {
    gen = generateRound(roundId);
    roundCache.set(roundId, gen);
    // Only the current + previous round are ever read; drop older ones.
    for (const key of roundCache.keys()) {
      if (key < roundId - 1) roundCache.delete(key);
    }
  }
  return gen;
}
const settledRounds = new Set();

/**
 * Settle one round: persist its results (idempotent upsert) and pay every
 * pending bet. Safe to call repeatedly — a win is granted first (grantCredits
 * dedupes on VIRTUAL_WIN_<betId>) and the bet is then claimed from PENDING
 * to WON/LOST, so a second settle can never double-credit.
 *
 * SPEED: every virtuals read calls settleDue, and the old code ran the full
 * settle on every single read — schema DDL + 10 SEQUENTIAL result INSERTs
 * + pending-bet scan ≈ 15 Neon round-trips ≈ 1.4s warm, 2.5s cold, on a
 * 2.5KB response. That is why the cards took forever to load. Now: an
 * in-memory fast path, then two cheap existence checks; the 10 INSERTs
 * only run once per round (in parallel), and only when results are missing.
 */
async function settleRound(roundId) {
  if (settledRounds.has(roundId)) return { roundId, settled: 0, won: 0, paid: 0, skipped: true };
  const db = sql();
  const gen = cachedGenerateRound(roundId);
  // ONE probe query on the hot path: are results stored, are bets pending?
  // (The old code ran schema DDL + 10 sequential INSERTs + a scan per read.)
  const probeSql = db`SELECT EXISTS(SELECT 1 FROM virtual_results WHERE round_id = ${roundId}) AS has_results, EXISTS(SELECT 1 FROM virtual_bets WHERE round_id = ${roundId} AND status = 'PENDING') AS has_pending`;
  let probe;
  try {
    probe = await probeSql;
  } catch (err) {
    // Tables may not exist yet on a fresh DB — create them, then retry once.
    await ensureSchema();
    probe = await db`SELECT EXISTS(SELECT 1 FROM virtual_results WHERE round_id = ${roundId}) AS has_results, EXISTS(SELECT 1 FROM virtual_bets WHERE round_id = ${roundId} AND status = 'PENDING') AS has_pending`;
  }
  const { has_results: hasResults, has_pending: hasPending } = probe[0];
  if (!hasResults) {
    await Promise.all(gen.matches.map((m) => db`
      INSERT INTO virtual_results (round_id, match_id, league_id, home, away, home_goals, away_goals)
      VALUES (${roundId}, ${m.id}, ${m.leagueId}, ${m.home}, ${m.away}, ${m.homeGoals}, ${m.awayGoals})
      ON CONFLICT (round_id, match_id) DO NOTHING
    `));
  }
  if (!hasPending) {
    settledRounds.add(roundId);
    return { roundId, settled: 0, won: 0, paid: 0, skipped: true };
  }
  const pending = await db`SELECT * FROM virtual_bets WHERE round_id = ${roundId} AND status = 'PENDING'`;
  let settled = 0;
  let won = 0;
  let paid = 0;
  for (const bet of pending) {
    const result = gen.matches.find((m) => m.id === bet.match_id);
    const isWon = betWon(bet, result);
    const payout = isWon ? Math.round(Number(bet.stake) * Number(bet.odds)) : 0;
    if (isWon) {
      await credits.grantCredits(bet.identity, payout, {
        reason: 'VIRTUAL_WIN',
        ref: `VIRTUAL_WIN_${bet.id}`,
      });
      won += 1;
      paid += payout;
    }
    const claimed = await db`
      UPDATE virtual_bets SET status = ${isWon ? 'WON' : 'LOST'}, payout = ${payout}
      WHERE id = ${bet.id} AND status = 'PENDING'
      RETURNING id
    `;
    if (claimed.length) settled += 1;
  }
  settledRounds.add(roundId);
  return { roundId, settled, won, paid };
}

/** Settle every round that has fully ended (in practice: the last one). */
async function settleDue(nowMs = Date.now()) {
  const { roundId } = roundTiming(nowMs);
  if (roundId <= 0) return null;
  return settleRound(roundId - 1);
}

// ── Reads ──────────────────────────────────────────────────────────────────
function publicMatch(m, timing, full) {
  const out = {
    id: m.id,
    leagueId: m.leagueId,
    home: m.home,
    away: m.away,
    homeStrength: m.homeStrength,
    awayStrength: m.awayStrength,
    odds: m.odds,
  };
  if (timing.phase === 'live') {
    const minute = timing.minute;
    const score = liveScore(m, minute);
    out.minute = minute;
    out.liveHomeGoals = score.home;
    out.liveAwayGoals = score.away;
    out.events = m.events.filter((e) => e.minute <= minute);
    if (full) {
      out.finalHomeGoals = m.homeGoals;
      out.finalAwayGoals = m.awayGoals;
      out.events = m.events;
      out.final = true;
    }
  }
  return out;
}

/** Current round: fixtures + odds + phase + countdowns. */
async function getRound(nowMs = Date.now(), { full = false } = {}) {
  await settleDue(nowMs);
  const timing = roundTiming(nowMs);
  const gen = cachedGenerateRound(timing.roundId);
  return {
    roundId: timing.roundId,
    phase: timing.phase,
    roundStartAt: timing.roundStartAt,
    bettingEndsAt: timing.bettingEndsAt,
    feedEndsAt: timing.feedEndsAt,
    countdownMs: timing.countdownMs,
    minute: timing.phase === 'live' ? timing.minute : 0,
    seedHash: gen.seedHash,
    leagues: gen.leagues.map((l) => ({
      id: l.id,
      name: l.name,
      matches: l.matches.map((m) => publicMatch(m, timing, full)),
    })),
  };
}

/** Recently settled rounds, with the seed input revealed for verification. */
async function getResults(limitRounds = 5) {
  await settleDue();
  await ensureSchema();
  const db = sql();
  const rows = await db`
    SELECT DISTINCT round_id FROM virtual_results
    ORDER BY round_id DESC LIMIT ${limitRounds}
  `;
  const rounds = [];
  for (const row of rows) {
    const roundId = Number(row.round_id);
    const gen = generateRound(roundId);
    const results = await db`
      SELECT * FROM virtual_results WHERE round_id = ${roundId} ORDER BY match_id
    `;
    const byId = new Map(results.map((r) => [r.match_id, r]));
    rounds.push({
      roundId,
      seed: seedInput(roundId),
      seedHash: gen.seedHash,
      leagues: gen.leagues.map((l) => ({
        id: l.id,
        name: l.name,
        matches: l.matches.map((m) => {
          const r = byId.get(m.id);
          return {
            id: m.id,
            leagueId: m.leagueId,
            home: m.home,
            away: m.away,
            homeGoals: r ? Number(r.home_goals) : m.homeGoals,
            awayGoals: r ? Number(r.away_goals) : m.awayGoals,
            odds: m.odds,
            events: m.events,
          };
        }),
      })),
    });
  }
  return { rounds };
}

/** League tables, aggregated from all settled results — with last-5 form
 *  (W/D/L, oldest → newest) the way SportyBet's Ranking shows it. Rows
 *  arrive newest-first (round_id DESC) so the first 5 hits per team are
 *  its form; they are reversed for display. */
async function getTable() {
  await settleDue();
  await ensureSchema();
  const db = sql();
  const rows = await db`SELECT round_id, league_id, home, away, home_goals, away_goals FROM virtual_results ORDER BY round_id DESC`;
  const tables = new Map();
  const blank = (team) => ({ team, played: 0, won: 0, drawn: 0, lost: 0, gf: 0, ga: 0, gd: 0, points: 0, form: [] });
  for (const league of LEAGUES) {
    const map = new Map(league.teams.map((t) => [t.name, blank(t.name)]));
    tables.set(league.id, { id: league.id, name: league.name, rows: map });
  }
  for (const r of rows) {
    const table = tables.get(r.league_id);
    if (!table) continue;
    const home = table.rows.get(r.home);
    const away = table.rows.get(r.away);
    if (!home || !away) continue;
    const hg = Number(r.home_goals);
    const ag = Number(r.away_goals);
    home.played += 1;
    away.played += 1;
    home.gf += hg;
    home.ga += ag;
    away.gf += ag;
    away.ga += hg;
    if (hg > ag) { home.won += 1; away.lost += 1; home.points += 3; home.form.push('W'); away.form.push('L'); }
    else if (hg === ag) { home.drawn += 1; away.drawn += 1; home.points += 1; home.form.push('D'); away.form.push('D'); }
    else { away.won += 1; home.lost += 1; away.points += 3; home.form.push('L'); away.form.push('W'); }
  }
  return {
    tables: [...tables.values()].map((t) => ({
      id: t.id,
      name: t.name,
      rows: [...t.rows.values()]
        .map((r) => ({ ...r, gd: r.gf - r.ga, form: r.form.slice(0, 5).reverse().join('') }))
        .sort((a, b) => b.points - a.points || b.gd - a.gd || b.gf - a.gf || a.team.localeCompare(b.team)),
    })),
  };
}

/** Own bets, newest first (settles the due round first). */
async function listBets(identity, limit = 50) {
  await settleDue();
  await ensureSchema();
  const db = sql();
  const rows = await db`
    SELECT * FROM virtual_bets WHERE identity = ${String(identity).toLowerCase()}
    ORDER BY created_at DESC LIMIT ${limit}
  `;
  return rows.map((r) => ({
    id: r.id,
    roundId: Number(r.round_id),
    matchId: r.match_id,
    leagueId: r.league_id,
    market: r.market,
    selection: r.selection,
    odds: Number(r.odds),
    stake: Number(r.stake),
    status: r.status,
    payout: Number(r.payout),
    createdAt: r.created_at,
  }));
}

// ── Betting ────────────────────────────────────────────────────────────────
/**
 * Place a bet. Validates everything server-side against the generator
 * (round open, match/market/selection exist, stake integer >= 5) and
 * takes the odds from the generator, never the client. Spends first,
 * then inserts; an insert failure refunds the stake.
 */
async function placeBet(identity, { roundId, matchId, market, selection, stake }) {
  await ensureSchema();
  const key = credits.canonicalKey(identity);
  if (!key) throw new ApiError('No account identity for bet', 400);
  const nowMs = Date.now();
  const timing = roundTiming(nowMs);
  if (Number(roundId) !== timing.roundId) {
    throw new ApiError('That round is no longer open for betting', 400, 'ROUND_CLOSED');
  }
  if (timing.phase !== 'betting') {
    throw new ApiError('Betting is closed — the live feed is running', 400, 'ROUND_CLOSED');
  }
  const gen = cachedGenerateRound(timing.roundId);
  const match = gen.matches.find((m) => m.id === matchId);
  if (!match) throw new ApiError('Unknown match for this round', 400, 'BAD_MATCH');
  let odds = null;
  if (market === '1X2') {
    if (selection === 'H') odds = match.odds.home;
    else if (selection === 'D') odds = match.odds.draw;
    else if (selection === 'A') odds = match.odds.away;
  } else if (market === 'OU25') {
    if (selection === 'OVER') odds = match.odds.over25;
    else if (selection === 'UNDER') odds = match.odds.under25;
  } else if (market === 'DC') {
    if (selection === '1X') odds = match.odds.dc1x;
    else if (selection === '12') odds = match.odds.dc12;
    else if (selection === 'X2') odds = match.odds.dcx2;
  } else if (market === 'BTTS') {
    if (selection === 'GG') odds = match.odds.gg;
    else if (selection === 'NG') odds = match.odds.ng;
  } else if (market === 'CS') {
    const entry = (match.odds.cs || []).find((c) => c.score === selection);
    if (entry) odds = entry.odds;
  }
  if (odds == null) throw new ApiError('Unknown market or selection', 400, 'BAD_MARKET');
  const nStake = Number(stake);
  if (!Number.isInteger(nStake) || nStake < MIN_STAKE) {
    throw new ApiError(`Minimum stake is ${MIN_STAKE} credits`, 400, 'BAD_STAKE');
  }
  const betId = generateId();
  await credits.spendAmount(key, nStake, {
    reason: 'VIRTUAL_STAKE',
    ref: `VIRTUAL_STAKE_${betId}`,
  });
  try {
    const db = sql();
    await db`
      INSERT INTO virtual_bets (id, identity, round_id, match_id, league_id, market, selection, odds, stake, status, payout)
      VALUES (${betId}, ${key}, ${timing.roundId}, ${match.id}, ${match.leagueId}, ${market}, ${selection}, ${odds}, ${nStake}, 'PENDING', 0)
    `;
  } catch (err) {
    await credits.grantCredits(key, nStake, {
      reason: 'VIRTUAL_REFUND',
      ref: `VIRTUAL_REFUND_${betId}`,
    }).catch(() => {});
    throw err;
  }
  const balance = await credits.balanceFor(key);
  return {
    id: betId,
    roundId: timing.roundId,
    matchId: match.id,
    leagueId: match.leagueId,
    market,
    selection,
    odds,
    stake: nStake,
    status: 'PENDING',
    balance,
  };
}

module.exports = {
  ROUND_MS,
  BETTING_MS,
  FEED_MS,
  OVERROUND,
  MIN_STAKE,
  LEAGUES,
  generateRound,
  roundTiming,
  seedInput,
  seedHash,
  ensureSchema,
  settleRound,
  settleDue,
  getRound,
  getResults,
  getTable,
  listBets,
  placeBet,
};
