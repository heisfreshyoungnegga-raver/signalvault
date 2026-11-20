// lib/services/ai.test.js — openrouter/free ONLY (owner order 2026-11-20).
//
// No model is hardcoded anywhere: every AI attempt (first read,
// transcribe, gap-fill, verification, recovery, simulator scan) goes
// through the OpenRouter free auto-router, 'openrouter/free', with key
// rotation across up to 4 configured accounts as the only fallback.
//
// Pure-function tests only: they do NOT touch the database or the
// network, so they run with no DATABASE_URL and no API keys set
// (`bun test` / `npm test` / `node --test`). Real OpenRouter calls
// need live keys and are covered by the manual smoke checklist in
// CREDIT-GUIDE.md, not here.
const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const ai = require('./ai');

function withKeys(csv, fn) {
  const prevList = process.env.AI_OPENROUTER_API_KEYS;
  const prevSingle = process.env.AI_OPENROUTER_API_KEY;
  process.env.AI_OPENROUTER_API_KEYS = csv;
  delete process.env.AI_OPENROUTER_API_KEY;
  return Promise.resolve()
    .then(fn)
    .finally(() => {
      if (prevList === undefined) delete process.env.AI_OPENROUTER_API_KEYS;
      else process.env.AI_OPENROUTER_API_KEYS = prevList;
      if (prevSingle === undefined) delete process.env.AI_OPENROUTER_API_KEY;
      else process.env.AI_OPENROUTER_API_KEY = prevSingle;
    });
}

describe('AI models — openrouter/free only (2026-11-20)', () => {
  it('exports exactly one model string: openrouter/free', () => {
    assert.equal(ai.OPENROUTER_MODEL, 'openrouter/free');
    assert.equal(ai.FIRST_READ_MODELS, undefined);
    assert.equal(ai.VERIFY_MODELS, undefined);
  });

  it('builds one openrouter/free attempt for a single key', async () => {
    await withKeys('sk-or-test-key-1', async () => {
      const chain = await ai.buildAttemptChain({});
      assert.equal(chain.length, 1);
      assert.equal(chain[0].model, 'openrouter/free');
      assert.equal(chain[0].providerId, 'openrouter');
      assert.equal(chain[0].baseUrl, 'https://openrouter.ai/api/v1');
      assert.equal(chain[0].apiKey, 'sk-or-test-key-1');
    });
  });

  it('builds one openrouter/free attempt per key for two keys', async () => {
    await withKeys('sk-or-test-key-1,sk-or-test-key-2', async () => {
      const chain = await ai.buildAttemptChain({});
      assert.equal(chain.length, 2);
      for (const attempt of chain) assert.equal(attempt.model, 'openrouter/free');
      assert.deepEqual(
        chain.map((a) => a.apiKey),
        ['sk-or-test-key-1', 'sk-or-test-key-2'],
      );
      assert.notEqual(chain[0].label, chain[1].label);
    });
  });

  it('caps the chain at 4 accounts', async () => {
    await withKeys('k1,k2,k3,k4,k5,k6', async () => {
      const chain = await ai.buildAttemptChain({});
      assert.equal(chain.length, 4);
      for (const attempt of chain) assert.equal(attempt.model, 'openrouter/free');
    });
  });

  it('builds no attempts when no keys are configured', async () => {
    await withKeys('', async () => {
      const chain = await ai.buildAttemptChain({});
      assert.deepEqual(chain, []);
    });
  });

  it('verification candidates are openrouter/free only, for any serving model', () => {
    assert.deepEqual(ai.verificationCandidates('openrouter/free'), ['openrouter/free']);
    assert.deepEqual(ai.verificationCandidates('some-other-model'), ['openrouter/free']);
    assert.deepEqual(ai.verificationCandidates(null), ['openrouter/free']);
  });

  it('ai.js contains no other model id or vendor string', () => {
    const src = fs.readFileSync(path.join(__dirname, 'ai.js'), 'utf8');
    for (const banned of [
      'dots-studio',
      'dots-3',
      'nemotron',
      'deepseek',
      'qwen',
      'meta-llama',
      'gemini',
      'anthropic',
      'claude',
      'mistral',
      'FIRST_READ_MODELS',
      'VERIFY_MODELS',
    ]) {
      assert.ok(!src.toLowerCase().includes(banned.toLowerCase()), `ai.js still mentions ${banned}`);
    }
    // Colon-form ":free" model ids (vendor/model:free) must be gone
    // entirely; the only model string is the slash-form 'openrouter/free'.
    const colonFree = src.match(/[a-z0-9/_.-]+:free/gi) || [];
    assert.deepEqual(colonFree, [], 'ai.js must not contain any vendor:model:free id');
    assert.ok(src.includes('openrouter/free'), 'openrouter/free should appear in ai.js');
  });
});
