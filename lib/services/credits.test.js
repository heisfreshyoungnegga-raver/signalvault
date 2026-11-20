// lib/services/credits.test.js — NEW PACKS (2026-11-20) unit tests.
//
// Pure-function tests only: they do NOT touch the database, so they run
// with no DATABASE_URL set (`bun test` / `npm test` / `node --test`).
// Spend / grant / refund behaviour needs a live Neon DB and is covered
// by the manual smoke checklist in CREDIT-GUIDE.md, not here.
const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const credits = require('./credits');
const engines = require('./engines');

describe('new credit packs (2026-11-20)', () => {
  it('has exactly four packs: GH₵250=4, 300=8, 500=12, 1000=20', () => {
    assert.deepEqual(
      credits.PACKS.map((p) => [p.code, p.credits, p.priceGhs]),
      [
        ['STARTER', 4, 250],
        ['STANDARD', 8, 300],
        ['PREMIUM', 12, 500],
        ['VAULT', 20, 1000],
      ],
    );
  });

  it('leaves NGN prices unset (null) on every pack', () => {
    for (const p of credits.PACKS) assert.equal(p.priceNgn, null);
  });

  it('defaults to PREMIUM (GH₵500 / 12 credits)', () => {
    assert.equal(credits.DEFAULT_PACK.code, 'PREMIUM');
    assert.equal(credits.DEFAULT_PACK.credits, 12);
    assert.equal(credits.DEFAULT_PACK.priceGhs, 500);
  });

  it('costs 4 credits per play', () => {
    assert.equal(credits.COST_PER_USE, 4);
  });

  it('summary() reports the default pack and 4/play', () => {
    const s = credits.summary(12);
    assert.equal(s.balance, 12);
    assert.equal(s.costPerUse, 4);
    assert.equal(s.packCredits, 12);
    assert.equal(s.packPriceGhs, 500);
    assert.equal(s.packPriceNgn, null);
    assert.equal(Math.floor(s.balance / s.costPerUse), 3);
  });
});

describe('creditsForPayment — exact-match grants only', () => {
  it('grants the exact tier credits for each GHS tier price', () => {
    assert.equal(credits.creditsForPayment({ currency: 'GHS', amountGhs: 250 }), 4);
    assert.equal(credits.creditsForPayment({ currency: 'GHS', amountGhs: 300 }), 8);
    assert.equal(credits.creditsForPayment({ currency: 'GHS', amountGhs: 500 }), 12);
    assert.equal(credits.creditsForPayment({ currency: 'GHS', amountGhs: 1000 }), 20);
  });

  it('grants 0 for the old GH₵400 pack and any non-tier amount', () => {
    assert.equal(credits.creditsForPayment({ currency: 'GHS', amountGhs: 400 }), 0);
    assert.equal(credits.creditsForPayment({ currency: 'GHS', amountGhs: 800 }), 0);
    assert.equal(credits.creditsForPayment({ currency: 'GHS', amountGhs: 550 }), 0);
    assert.equal(credits.creditsForPayment({ currency: 'GHS', amountGhs: null }), 0);
  });

  it('grants 0 for every NGN payment — NGN prices are not set', () => {
    assert.equal(credits.creditsForPayment({ currency: 'NGN', amountNgn: 47000 }), 0);
    assert.equal(credits.creditsForPayment({ currency: 'NGN', amountNgn: 94000 }), 0);
    assert.equal(credits.creditsForPayment({ currency: 'NGN', amountNgn: 188000 }), 0);
  });
});

describe('Aviator-only engine registry (2026-11-20)', () => {
  it('registers exactly one engine: aviator', () => {
    assert.deepEqual(engines.GAMES.map((g) => g.id), ['aviator']);
    assert.equal(engines.getGame('aviator').name, 'Aviator');
  });

  it('rejects every removed engine id', () => {
    for (const id of ['sporty-jet', 'sportykick', 'sportyhero', 'super-hero', 'test-flight']) {
      assert.equal(engines.getGame(id), null, `${id} must not resolve`);
      assert.equal(engines.gameDetail(id), null, `${id} must have no detail`);
    }
  });

  it('lists only Aviator (lobby + /api/engines source of truth)', () => {
    assert.deepEqual(engines.listGames().map((g) => g.id), ['aviator']);
  });
});
