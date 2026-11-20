const { ApiError } = require('../util');

const OPENROUTER_BASE_URL = 'https://openrouter.ai/api/v1';
const MAX_ACCOUNTS_PER_PROVIDER = 4;
const ATTEMPT_TIMEOUT_SECONDS = 6;
const DEFAULT_MAX_TOKENS = 512;
// First-read model chain (owner-approved 25 Oct 2026, Proposal A from
// the VirtuWinUi compare). The first read tries the free auto-router
// first, then falls back to two pinned proven free models — dots (8/8
// teams, 4.5s) and nano-omni (8/8, 9.5s) on the 24 Oct clean-slip test.
// The router alone is not a second opinion: it misroutes (the
// nemotron content-safety moderation model, returning no JSON),
// misreads, and truncates, and retrying keys on the same router string
// repeats the same failure. A different model is a genuinely new
// reading. Pinned models only — never fetch the /models list (the
// standing rule survives in that form). OpenRouter-only, free-only, no
// new provider, no paid model. Verification stays pinned to a model
// DIFFERENT from the one that actually served the first read
// (VERIFY_MODELS below). Per-attempt cap is 20s for full coverage
// (6s for capped plans): with 3 keys the worst first-read chain is
// 9x20s, and maxDuration is 300s, so no staged invocation can be
// killed mid-chain.
const OPENROUTER_MODEL = 'openrouter/free';
const FIRST_READ_MODELS = [
  OPENROUTER_MODEL,
  'dots-studio/dots-3-note-preview:free',
  'nvidia/nemotron-3-nano-omni-30b-a3b-reasoning:free',
];

function splitCsv(raw) {
  if (!raw || !raw.trim()) return [];
  // Keys are usually pasted as a list, and the separator varies:
  // commas, newlines, spaces, or semicolons. Splitting on commas
  // alone turned a newline-pasted list into ONE invalid key, which
  // 401'd every attempt and surfaced to the user as a 502 — so split
  // on all of them. Duplicates collapse (same key twice = one key).
  return [...new Set(raw.split(/[,\s;]+/).map((s) => s.trim()).filter(Boolean))];
}

function resolveAccountKeys(providerId) {
  const keys = splitCsv(process.env[`AI_${providerId.toUpperCase()}_API_KEYS`] || '');
  if (keys.length) return keys.slice(0, MAX_ACCOUNTS_PER_PROVIDER);
  const single = process.env[`AI_${providerId.toUpperCase()}_API_KEY`] || '';
  return single ? [single] : [];
}

async function buildOpenRouterAttempts(maxTokens) {
  const apiKeys = resolveAccountKeys('openrouter');
  if (!apiKeys.length) {
    console.log('[ai] openrouter: no api keys configured, skipping');
    return [];
  }
  // First-read fallback chain, key-major: for each key, the router
  // first, then dots, then nano-omni. Stop at the first success. A
  // failed attempt never poisons the next one: every attempt gets the
  // same downscaled blob and the same prompt (built once by the
  // caller), only the model string changes.
  const attempts = [];
  apiKeys.forEach((apiKey, accountIdx) => {
    const keyTag = apiKeys.length > 1 ? `#${accountIdx + 1}` : '';
    for (const model of FIRST_READ_MODELS) {
      attempts.push({
        providerId: 'openrouter',
        label: `openrouter${keyTag}/${model}`,
        baseUrl: OPENROUTER_BASE_URL,
        apiKey,
        model,
        shape: 'OPENAI_VISION',
        maxTokens,
      });
    }
  });
  console.log(`[ai] openrouter: ${apiKeys.length} account(s), first-read chain [${FIRST_READ_MODELS.join(' -> ')}], ${attempts.length} attempt(s) built`);
  return attempts;
}

async function buildAttemptChain(plan) {
  const maxTokens = plan && plan.maxPicks < 0 ? 4096 : DEFAULT_MAX_TOKENS;

  // OpenRouter only, first-read fallback chain — see
  // FIRST_READ_MODELS above. The same chain feeds the single-call
  // path, the staged transcribe/gap-fill stages, and (as base
  // attempts) verification; verification itself still overrides the
  // model per candidate, so the chain costs verification nothing.
  const openrouterAttempts = await buildOpenRouterAttempts(maxTokens);
  console.log(`[ai] chain composition: openrouter=${openrouterAttempts.length} (free auto-router only)`);
  return openrouterAttempts;
}

function buildPrompt(plan) {
  const coverageInstruction = plan.maxPicks < 0
    ? 'Analyze EVERY pick/game/section on the slip (full coverage).'
    : `The user's plan only covers up to ${plan.maxPicks} picks. Analyze at most the first ${plan.maxPicks} picks/sections on the slip, in the order they appear, and leave the rest out entirely.`;

  return `You are looking at an image of a sports betting slip containing one or more picks.

1. Count and identify every distinct pick/section on the slip, in printed order.
2. TRANSCRIPTION RULES — READ FIRST. Transcribe team names EXACTLY as printed on the slip: copy the visible text character for character, in the slip's own order. NEVER invent, complete, guess, or "correct" a team name from football knowledge, and NEVER add a fixture that is not visibly printed on this slip. Do NOT fill in famous fixtures from memory: only what is printed on THIS slip counts. If either team name or the market on a pick is not clearly readable, set that pick's prediction to "unreadable" and do NOT guess the missing part — an honest "unreadable" is always better than a guessed fixture.
3. ${coverageInstruction}
4. For each READABLE analyzed pick, commit to exactly ONE team as your pick. Never hedge between two outcomes, never say both teams could win, and never just restate the market printed on the slip as your own analysis.
5. Provide:
   - teamName        : "Home Team vs Away Team" copied exactly as printed on the slip (never completed from memory)
   - winningTeamName : the SINGLE team name you predict will win (or "Draw" if you predict a draw) — must be one of the two team names in teamName, or exactly "Draw"
   - prediction      : 1 (home win), X (draw), or 2 (away win) — must agree with winningTeamName
   - accuracyPercent : integer 0-100 reflecting your genuine confidence in this specific pick (not the slip odds, not a default value)
   - reason          : 1-2 sentences (~25 words) of fixture-specific analytics explaining why THIS team wins: name both teams and cite recent form, home/away record, head-to-head, or odds visible on the slip for THESE teams. Never a generic line that could fit any fixture, never a restatement of the odds alone

Respond with ONLY a single JSON object matching exactly this shape:
{
  "totalPicksDetected": <integer>,
  "picks": [
    {
      "sectionIndex":    <integer, 1-based>,
      "teamName":        "<Home Team vs Away Team>",
      "winningTeamName": "<exact name of the one team you pick, or 'Draw'>",
      "originalPick":    "<market/selection printed on slip, if legible>",
      "prediction":      "<1 | X | 2 | unreadable>",
      "accuracyPercent": <integer 0-100>,
      "reason":          "<1-2 sentences of fixture-specific analytics: both teams named, one concrete factor cited>"
    }
  ]
  }`;
}

const SYSTEM_PROMPT = `You are SignalVault AI, an elite football betting analyst who reads virtual betting slips from images.

Rules:
- The image is a virtual football betting slip containing multiple fixtures.
- Inspect the image and identify every visible match, in printed order.
- For each fixture you can clearly read, commit to exactly ONE winning team (or a draw). Never hedge, never present two possible outcomes, never say "could go either way" in your reason. If you cannot read a fixture clearly, use "unreadable" instead of committing — never commit to a fixture you cannot read.
- Do NOT default to picking the home team out of habit. Weigh the odds shown, implied probabilities, recognizable team strength/form, and football reasoning independently for every fixture — some picks should be away wins or draws when the analysis supports it. A slip where you picked the home team on every single fixture is a signal you are not analyzing individually; vary your picks based on genuine signal.
- winningTeamName must be the literal name of one of the two teams in the fixture, or the word "Draw" — never a code, never both names, never blank.
- Provide an accuracyPercent (0-100) reflecting your genuine confidence in this specific pick. Use 80-95 for strong signals, 60-79 for moderate, below 60 for uncertain. Vary this number based on how clear-cut each individual fixture actually is — do not reuse the same number for every pick.
- Every reason must be fixture-specific analytics for THESE two teams: name both teams and cite at least one concrete factor — recent form, home/away record, head-to-head, or odds visible on the slip. A reason that could be pasted onto any fixture ("stronger squad", "recent results favor", "momentum indicates") is not analysis and must not be used. Vary the reasoning genuinely from fixture to fixture, like the picks themselves.
- If image quality prevents reading a fixture, set prediction to "unreadable", winningTeamName to "unreadable", and accuracyPercent to 0.
- Transcribe ONLY what is visibly printed. Never fabricate, complete, or "correct" fixtures, team names, or odds from football knowledge — guessing a plausible famous fixture is worse than admitting you cannot read it. If you cannot read a fixture clearly, you MUST use "unreadable" instead of guessing.

Return ONLY a single valid JSON object. No markdown, no code fences, no text outside the JSON.`;

function isThinkingModel(model) {
  return false;
}

function buildOpenAiVisionBody(dataUri, prompt, model, maxTokens) {
  console.log(`[ai] buildOpenAiVisionBody: model=${model} maxTokens=${maxTokens} dataUriLength=${dataUri.length}`);
  return {
    model,
    messages: [
      { role: 'system', content: SYSTEM_PROMPT },
      {
        role: 'user',
        content: [
          { type: 'text', text: prompt },
          { type: 'image_url', image_url: { url: dataUri } },
        ],
      },
    ],
    temperature: 0.4,
    top_p: 0.9,
    max_tokens: maxTokens,
    stream: false,
    // OpenRouter's free auto-router can land on a "thinking" model (DeepSeek
    // R1, Qwen QwQ, etc.) that spends the entire max_tokens budget on
    // internal reasoning and returns content: null with finish_reason:
    // "length" — observed directly in production. reasoning:{effort:"none"}
    // is OpenRouter's documented unified switch to disable this on any model
    // that supports it; it's a no-op on models that don't, so it's safe to
    // always send. See https://openrouter.ai/docs/use-cases/reasoning-tokens
    reasoning: { effort: 'none' },
  };
}

function buildGeminiOpenAiVisionBody(dataUri, prompt, model, maxTokens) {
  const thinking = isThinkingModel(model);
  console.log(`[ai] buildGeminiOpenAiVisionBody: model=${model} maxTokens=${maxTokens} isThinkingModel=${thinking} dataUriLength=${dataUri.length}`);
  const body = {
    model,
    messages: [
      { role: 'system', content: SYSTEM_PROMPT },
      {
        role: 'user',
        content: [
          { type: 'text', text: prompt },
          { type: 'image_url', image_url: { url: dataUri } },
        ],
      },
    ],
    temperature: 0.4,
    top_p: 0.9,
    max_tokens: maxTokens,
    stream: false,
  };
  if (thinking) {
    body.max_tokens = Math.max(maxTokens * 8, 2048);
    body.reasoning_effort = 'low';
    console.log(`[ai] buildGeminiOpenAiVisionBody: thinking model, raised max_tokens to ${body.max_tokens} and set reasoning_effort=low`);
  }
  return body;
}

function buildCloudflareBody(dataUri, base64Raw, prompt, shape, maxTokens) {
  console.log(`[ai] buildCloudflareBody: shape=${shape} maxTokens=${maxTokens} base64Length=${base64Raw.length}`);
  if (shape === 'CF_MOONDREAM') {
    const raw = Buffer.from(base64Raw, 'base64');
    return {
      task: 'query',
      image: Array.from(raw),
      question: prompt,
      max_tokens: maxTokens,
    };
  }
  if (shape === 'CF_LLAMA_VISION') {
    return {
      messages: [
        { role: 'system', content: 'You are a helpful assistant.' },
        { role: 'user', content: prompt },
      ],
      image: base64Raw,
      max_tokens: maxTokens,
    };
  }
  return {
    messages: [
      {
        role: 'user',
        content: [
          { type: 'text', text: prompt },
          { type: 'image_url', image_url: { url: dataUri } },
        ],
      },
    ],
    max_tokens: maxTokens,
  };
}

function extractJson(content) {
  let s = content.trim();
  if (s.startsWith('```')) {
    const nl = s.indexOf('\n');
    if (nl !== -1) s = s.slice(nl + 1);
    const end = s.lastIndexOf('```');
    if (end !== -1) s = s.slice(0, end);
  }
  const start = s.indexOf('{');
  const end = s.lastIndexOf('}');
  return start !== -1 && end !== -1 && end > start ? s.slice(start, end + 1) : s;
}

function deriveConfidence(pct) {
  if (pct >= 80) return 'High';
  if (pct >= 60) return 'Medium';
  return 'Low';
}

function deriveAccuracy(conf) {
  switch ((conf || '').toLowerCase()) {
    case 'high': return 85;
    case 'medium': return 65;
    case 'low': return 45;
    default: return 0;
  }
}

function parseModelResponse(content, plan) {
  const analysis = { totalPicksDetected: 0, predictions: [], rawModelOutput: null };
  const jsonText = extractJson(content);
  try {
    const root = JSON.parse(jsonText);
    analysis.totalPicksDetected = root.totalPicksDetected ?? root.totalMatches ?? 0;

    let picksNode = Array.isArray(root.picks) ? root.picks : (Array.isArray(root.predictions) ? root.predictions : null);
    const cap = plan.maxPicks < 0 ? Infinity : plan.maxPicks;

    if (Array.isArray(picksNode)) {
      let count = 0;
      for (const n of picksNode) {
        if (count >= cap) break;
        const teamName = n.teamName || n.matchLabel || '';
        const winningTeamName = n.winningTeamName || '';
        let pct = n.accuracyPercent;
        if (pct === undefined || pct === null || pct < 0) pct = deriveAccuracy(n.confidence);
        const confidence = n.confidence || deriveConfidence(pct);
        const reason = n.reason || n.analysis || '';

        analysis.predictions.push({
          sectionIndex: n.sectionIndex ?? n.matchNumber ?? count + 1,
          teamName,
          matchLabel: teamName,
          winningTeamName,
          originalPick: n.originalPick || '',
          prediction: n.prediction || '',
          accuracyPercent: pct,
          confidence,
          reason,
          analysis: reason,
        });
        count++;
      }
    }
    if (!analysis.totalPicksDetected) analysis.totalPicksDetected = analysis.predictions.length;
  } catch (err) {
    console.log(`[ai] parseModelResponse: JSON.parse failed: ${err.message}. jsonText (first 500 chars): ${jsonText.slice(0, 500)}`);
    analysis.rawModelOutput = content;
  }
  return analysis;
}

function buildUrlForAttempt(attempt) {
  if (attempt.providerId === 'cloudflare') {
    return `${attempt.baseUrl}/${attempt.model}`;
  }
  return `${attempt.baseUrl}/chat/completions`;
}

function buildHeadersForAttempt(attempt) {
  const headers = {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${attempt.apiKey}`,
  };
  if (attempt.providerId === 'openrouter') {
    headers['HTTP-Referer'] = process.env.APP_PLATFORM_FRONTEND_URL || process.env.APP_FRONTEND_BASE_URL || 'https://www.predatorgh.xyz';
    headers['X-Title'] = 'SignalVault AI Slip Scanner';
  }
  return headers;
}

function extractContentFromResponse(json, attempt) {
  if (json.error) {
    throw new Error(`provider error: ${JSON.stringify(json.error).slice(0, 400)}`);
  }

  if (attempt.shape === 'CF_LLAMA_VISION' || attempt.shape === 'CF_MOONDREAM') {
    const result = json.result;
    const text = result && (result.response || result.description || result.answer);
    if (!text || !String(text).trim()) {
      throw new Error(`empty or unrecognized cloudflare response shape. raw: ${JSON.stringify(json).slice(0, 300)}`);
    }
    return String(text);
  }

  const choices = json.choices;
  if (!choices || !choices.length) {
    throw new Error(`no choices in response. raw: ${JSON.stringify(json).slice(0, 300)}`);
  }
  const choice = choices[0];
  const message = choice.message || {};
  let content = message.content;

  if ((!content || !String(content).trim()) && choice.finish_reason === 'length' && message.reasoning) {
    throw new Error(
      `model spent its entire token budget on internal reasoning and produced no visible answer ` +
      `(finish_reason=length, this is a "thinking" model auto-picked by the free router). ` +
      `reasoning preview: ${String(message.reasoning).slice(0, 200)}`
    );
  }

  if (!content || !String(content).trim()) {
    throw new Error(`empty message content. raw choice: ${JSON.stringify(choice).slice(0, 300)}`);
  }
  return String(content);
}

async function callProvider(attempt, dataUri, base64Raw, prompt, timeoutMs) {
  const body = buildOpenAiVisionBody(dataUri, prompt, attempt.model, attempt.maxTokens);

  const url = buildUrlForAttempt(attempt);
  const headers = buildHeadersForAttempt(attempt);

  console.log(`[ai] ${attempt.label}: POST ${url} (timeout ${timeoutMs}ms)`);

  const controller = new AbortController();
  const timer = setTimeout(() => {
    console.log(`[ai] ${attempt.label}: aborting, ${timeoutMs}ms timeout reached`);
    controller.abort();
  }, timeoutMs);

  const fetchStart = Date.now();
  let res;
  try {
    res = await fetch(url, {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
      signal: controller.signal,
    });
  } catch (err) {
    const elapsed = Date.now() - fetchStart;
    console.log(`[ai] ${attempt.label}: fetch threw after ${elapsed}ms: ${err.name}: ${err.message}`);
    throw new Error(`${err.name}: ${err.message}`);
  } finally {
    clearTimeout(timer);
  }

  const fetchElapsed = Date.now() - fetchStart;
  console.log(`[ai] ${attempt.label}: HTTP ${res.status} received after ${fetchElapsed}ms`);

  const text = await res.text();
  if (!res.ok) {
    console.log(`[ai] ${attempt.label}: non-OK body: ${text.slice(0, 500)}`);
    throw new Error(`HTTP ${res.status}: ${text.slice(0, 500)}`);
  }

  let json;
  try {
    json = JSON.parse(text);
  } catch {
    console.log(`[ai] ${attempt.label}: response was not valid JSON: ${text.slice(0, 300)}`);
    throw new Error('returned a non-JSON response');
  }

  // The serving model matters: for openrouter/free the request model is
  // the router, but the response model is the actual underlying model
  // that read the slip — the verification read must differ from it.
  return { content: extractContentFromResponse(json, attempt), model: (json && typeof json.model === 'string' && json.model) || null };
}

const REAL_CALLS = new Set(['1', 'X', '2']);

function isRealCall(prediction) {
  return REAL_CALLS.has(String(prediction || ''));
}

// Printed positions (1-based) that have no prediction yet. A pick is
// never silently dropped: anything still missing after gap-fill becomes
// an explicit 'unpredicted' entry, never an omission.
function missingPositions(analysis) {
  const total = analysis.totalPicksDetected || 0;
  if (!total || total <= 0) return [];
  const covered = new Set();
  for (const p of analysis.predictions) {
    const idx = Number(p.sectionIndex);
    if (Number.isFinite(idx) && idx >= 1 && idx <= total) covered.add(idx);
  }
  const missing = [];
  for (let i = 1; i <= total; i++) if (!covered.has(i)) missing.push(i);
  return missing;
}

function buildGapFillPrompt(totalDetected, missing) {
  return `You are looking at the SAME sports betting slip image again. You previously analysed it, but ${missing.length} pick(s) are still missing a prediction. The slip has ${totalDetected} picks in total, in printed order.\n\nAnalyze ONLY the picks at these printed positions: ${missing.join(', ')}.\n\nTranscribe team names EXACTLY as printed; never invent or complete a team from memory. If a requested pick is not clearly readable, return it with prediction "unreadable" rather than guessing.\n\nFor each of those picks, commit to exactly ONE team as your pick (1 = home win, X = draw, 2 = away win), with the same fixture-specific analytics reason rule as before (name both teams, cite form/home-away/head-to-head/visible odds for THESE teams; never a generic line). Do NOT re-analyse the other picks, do NOT add picks beyond this list.\n\nRespond with ONLY a single JSON object matching exactly this shape:\n{\n  "totalPicksDetected": ${totalDetected},\n  "picks": [\n    {\n      "sectionIndex": <integer, the printed position of this pick>,\n      "teamName": "<Home Team vs Away Team>",\n      "winningTeamName": "<exact name of the one team you pick, or 'Draw'>",\n      "originalPick": "<market/selection printed on slip, if legible>",\n      "prediction": "<1 | X | 2 | unreadable>",\n      "accuracyPercent": <integer 0-100>,\n      "reason": "<1-2 sentences of fixture-specific analytics: both teams named, one concrete factor cited>"\n    }\n  ]\n}`;
}

// --- Transcription trustworthiness (anti-guessing) ---------------------
// A free vision model will happily "read" a famous fixture into a blurry
// row. Nothing downstream can recover from an invented team, so the
// pipeline defends at three points: strict prompts (above), parser
// guards (sanitizePredictions), and a second, prediction-free read of
// the same image that must agree on the teams (verifyTranscription).
// That second read MUST come from a different model than the first read
// (VERIFY_MODELS below): a second read from the same model pool tends to
// repeat the same confident misread, which no agreement check can catch.
// A guessed team presented confidently is the bug; an honest
// "unreadable" or a visible "check this one" flag is the fix.

function normalizeTeamName(name) {
  return String(name || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim().replace(/\s+/g, ' ');
}

function teamTokens(name) {
  return normalizeTeamName(name).split(' ').filter((t) => t && t !== 'vs');
}

// Strict on purpose: a different opponent must NEVER pass, even if it
// shares one team ("Arsenal vs Chelsea" vs "Arsenal vs Tottenham" fails).
// Abbreviation variance ("Man City" vs "Manchester City") fails too —
// it lands on the flagged path, not silently presented as fact.
function teamsMatch(a, b) {
  const na = normalizeTeamName(a);
  const nb = normalizeTeamName(b);
  if (!na || !nb) return false;
  if (na === nb) return true;
  if (na.includes(nb) || nb.includes(na)) return true;
  const ta = teamTokens(a);
  const tb = teamTokens(b);
  if (!ta.length || !tb.length) return false;
  const [short, long] = ta.length <= tb.length ? [ta, tb] : [tb, ta];
  return short.every((t) => long.includes(t));
}

// The predicted winner must be one side of the fixture (or Draw).
// Side-aware so "Arsenal FC" still matches the "Arsenal" side.
function winnerMatchesTeam(winner, teamName) {
  if (!winner) return false;
  if (String(winner).trim().toLowerCase() === 'draw') return true;
  if (teamsMatch(winner, teamName)) return true;
  // Same separator set as the frontend parseFixture: slips print
  // "HOME - AWAY" as often as "HOME vs AWAY".
  const sides = String(teamName).split(/\s+(?:vs\.?|-|–|—)\s+/i);
  return sides.some((side) => teamsMatch(winner, side));
}

const UNREADABLE_REASON = 'The AI could not read the teams on this row clearly — shown as unreadable rather than guessed.';

function toUnreadable(p, reason) {
  const out = {
    ...p,
    matchLabel: p.teamName ? p.matchLabel : `Pick #${p.sectionIndex}`,
    winningTeamName: 'unreadable',
    prediction: 'unreadable',
    accuracyPercent: 0,
    confidence: 'Unreadable',
    reason,
    analysis: reason,
  };
  // A demoted row must never keep a recovered flag: it has no call, so
  // there is nothing to mark as recovered (the coverage count and the
  // card note both key off recovered === true on real calls only).
  delete out.recovered;
  return out;
}

// Parser guards: model output that cannot be trusted as a real call is
// demoted to an explicit unreadable row — never passed through as fact.
function sanitizePredictions(predictions) {
  return (predictions || []).map((p) => {
    if (p.prediction === 'unpredicted') return p;
    const teamName = String(p.teamName || '').trim();
    if (!teamName) {
      return toUnreadable({ ...p, matchLabel: `Pick #${p.sectionIndex}` }, UNREADABLE_REASON);
    }
    if (isRealCall(p.prediction)) {
      const win = String(p.winningTeamName || '').trim();
      if (!win || win.toLowerCase() === 'unreadable') {
        return toUnreadable(p, 'The AI gave a pick without a readable winning team — shown as unreadable rather than guessed.');
      }
      if (!winnerMatchesTeam(win, teamName)) {
        return toUnreadable(p, 'The AI’s pick did not match the teams it read — shown as unreadable rather than guessed.');
      }
      return p;
    }
    if (p.prediction !== 'unreadable') {
      return toUnreadable(p, 'The AI’s answer for this row was not usable — shown as unreadable rather than guessed.');
    }
    return p;
  });
}

// Second, prediction-free read of the same image: list ONLY the fixtures
// visibly printed, in order. The "TRANSCRIPTION CHECK" marker lets rig
// stubs branch on this call; it carries no product meaning. The prompt
// deliberately states NO pick count: telling the verifier how many picks
// the first read found primes it to invent fixtures up to that count
// (count-anchoring) instead of judging the image cold.
function buildVerificationPrompt() {
  return `TRANSCRIPTION CHECK — You are looking at the SAME sports betting slip image again. Do NOT predict anything, do NOT analyse form, do NOT pick winners.\n\nList ONLY the fixtures visibly printed on the slip, in printed order. For each fixture write the two team names EXACTLY as printed and the market/selection printed for it. If any fixture is not clearly readable, write "UNREADABLE" for its teamName — never guess, never complete a blurry name from memory, never add a fixture that is not visibly printed.\n\nRespond with ONLY a single JSON object matching exactly this shape:\n{\n  "fixtures": [\n    {\n      "sectionIndex": <integer, 1-based printed position>,\n      "teamName": "<Home Team vs Away Team exactly as printed, or UNREADABLE>",\n      "originalPick": "<market/selection printed on slip, or empty>"\n    }\n  ]\n}`;
}

function parseVerification(content) {
  try {
    const root = JSON.parse(extractJson(content));
    const list = Array.isArray(root.fixtures) ? root.fixtures : (Array.isArray(root.picks) ? root.picks : null);
    if (!Array.isArray(list)) return null;
    return list.map((f, i) => ({
      sectionIndex: Number(f.sectionIndex) || i + 1,
      teamName: String(f.teamName || '').trim(),
      originalPick: String(f.originalPick || '').trim(),
    }));
  } catch {
    return null;
  }
}

// Proven free models for the verification read. Both scored 8/8 teams on
// the 24 Oct clean-slip test (dots 4.5s, nano-omni 9.5s). The first read
// still uses the openrouter/free auto-router; ONLY the verification
// model is pinned — and pinned to differ from the first read's serving
// model. OpenRouter-only, free-only, no new provider, no paid model.
// If the serving model is one of these two, the other is the only
// diverse choice; if it is anything else (or unknown), dots is tried
// first and nano-omni is the fallback — every candidate differs from the
// serving model by construction.
const VERIFY_MODELS = [
  'dots-studio/dots-3-note-preview:free',
  'nvidia/nemotron-3-nano-omni-30b-a3b-reasoning:free',
];

function verificationCandidates(servingModel) {
  return VERIFY_MODELS.filter((m) => m !== servingModel);
}

// Applies the verification read to an analysis in place. Rules:
// - verification fixture UNREADABLE (or blank) at a position → that pick
//   is demoted to unreadable (no prediction, not counted).
// - verification fixture DIFFERENT teams at a position → pick kept but
//   flagged 'mismatch' (frontend shows "check this one", never confident).
// - position absent from the verification list → 'unverified' (absence of
//   evidence is not evidence of invention; truncation is not a verdict).
// - verification call/parse failure → every real pick 'unverified' and
//   the scan still succeeds (a failed double-check must not burn a scan).
// Diversity is enforced, not left to router luck: every candidate model
// differs from the first read's serving model. If all candidates fail,
// the caller flags picks unverified (same as a failed double-check).
async function verifyTranscription(attempt, dataUri, imageBase64, analysis, attemptTimeoutMs, servingModel) {
  const vPrompt = buildVerificationPrompt();
  const candidates = verificationCandidates(servingModel);
  let lastErr = null;
  for (const model of candidates) {
    try {
      const vAttempt = { ...attempt, model, label: `${attempt.label}/verify:${model}` };
      const vRes = await callProvider(vAttempt, dataUri, imageBase64, vPrompt, Math.min(attemptTimeoutMs, 20000));
      const fixtures = parseVerification(vRes.content);
      if (!fixtures) throw new Error('unparseable verification output');
      const byIndex = new Map();
      for (const f of fixtures) if (!byIndex.has(f.sectionIndex)) byIndex.set(f.sectionIndex, f);
      for (const p of analysis.predictions) {
        if (!isRealCall(p.prediction)) continue;
        const v = byIndex.get(Number(p.sectionIndex));
        if (!v) {
          p.verification = 'unverified';
          continue;
        }
        const vt = v.teamName;
        if (!vt || vt.toUpperCase() === 'UNREADABLE') {
          const demoted = toUnreadable(p, 'A second read of your slip could not confirm the teams on this row — shown as unreadable rather than guessed.');
          demoted.verification = 'unreadable';
          Object.assign(p, demoted);
        } else if (!teamsMatch(p.teamName, vt)) {
          p.verification = 'mismatch';
          p.verificationNote = 'Check this one — the teams were hard to read, confirm against your slip.';
        } else {
          p.verification = 'verified';
        }
      }
      return;
    } catch (err) {
      lastErr = err;
      console.log(`[ai] verification via ${model} failed: ${err.message}`);
    }
  }
  throw lastErr || new Error('verification unavailable');
}

// --- Winner recovery (second look at demoted rows) -------------------
// Chuks's order, 25 Oct 2026: every READABLE fixture must get a winner
// call (1/X/2 — win, lose or draw) based on analytics. A row the first
// read could see but not settle must not silently stay "Not predicted"
// when a focused second look can settle it. Guardrail (standing rule):
// NEVER invent fixtures. Recovery only applies to rows whose teams are
// already readable (both sides present in teamName); rows with
// unreadable/blank teams stay Not predicted, full stop — no recovery
// call is ever made for a fixture the pipeline cannot name.
// Mechanics: one batched call listing ONLY the eligible fixtures, on a
// model different from the serving model where possible (the same
// diverse candidates as verification), bounded to a single candidate +
// 15s — recovery is a bonus pass, never a slow retry loop. A returned
// pick is accepted only if it is a real 1/X/2 call, its winner matches
// one side of the row's fixture, and its teamName matches the row's
// fixture; anything else leaves the row untouched. Recovered rows get
// recovered=true plus a coverage-note line, and verification still
// runs AFTER recovery, so a recovered call is double-checked exactly
// like any other call (a verifier that cannot read the teams demotes
// it back to unreadable). Recovery failure never fails the scan.
function recoveryEligible(p) {
  if (isRealCall(p.prediction)) return false;
  if (p.prediction === 'unpredicted') return false;
  const teamName = String(p.teamName || '').trim();
  if (!teamName || teamName.toUpperCase() === 'UNREADABLE') return false;
  const sides = teamName.split(/\s+(?:vs\.?|-|–|—)\s+/i);
  return sides.length === 2 && sides.every((s) => s.trim().length > 0);
}

function buildRecoveryPrompt(targets) {
  const list = targets.map((p) => `  - position ${p.sectionIndex}: ${p.teamName}`).join('\n');
  return `SECOND LOOK — You are looking at the SAME sports betting slip image again. The first read could see the teams below but could not settle a winner for them. For EACH fixture listed, commit to exactly ONE winner (1 = home win, X = draw, 2 = away win) with a confidence and a fixture-specific reason. Base each call on analytics for THESE teams: recent form, home/away record, head-to-head, and the odds if visible on the slip. Each reason must name both teams and cite at least one fixture-specific factor — a generic line that could fit any fixture is not acceptable. If you cannot read a listed fixture clearly, return it with prediction "unreadable" — never guess.\n\nFixtures:\n${list}\n\nRespond with ONLY a single JSON object matching exactly this shape:\n{\n  "picks": [\n    {\n      "sectionIndex": <integer, the printed position of this pick>,\n      "teamName": "<Home Team vs Away Team>",\n      "winningTeamName": "<exact name of the one team you pick, or 'Draw'>",\n      "prediction": "<1 | X | 2 | unreadable>",\n      "accuracyPercent": <integer 0-100>,\n      "reason": "<1-2 sentences of fixture-specific analytics: both teams named, one concrete factor cited>"\n    }\n  ]\n}`;
}

async function recoverWinners(imageBase64, imageMediaType, plan, analysis, attemptTimeoutMs, servingModel) {
  const targets = analysis.predictions.filter(recoveryEligible);
  if (!targets.length) return { recovered: 0 };
  const dataUri = `data:${imageMediaType};base64,${imageBase64}`;
  const prompt = buildRecoveryPrompt(targets);
  const candidates = verificationCandidates(servingModel);
  const model = candidates[0];
  if (!model) return { recovered: 0 };
  const attempts = await buildAttemptChain(plan);
  const base = attempts[0];
  if (!base) return { recovered: 0 };
  try {
    const rAttempt = { ...base, model, label: `${base.label}/recover:${model}` };
    const res = await callProvider(rAttempt, dataUri, imageBase64, prompt, Math.min(attemptTimeoutMs, 15000));
    const recovered = parseModelResponse(res.content, plan);
    const byIndex = new Map();
    for (const p of recovered.predictions || []) {
      const idx = Number(p.sectionIndex);
      if (Number.isFinite(idx) && !byIndex.has(idx)) byIndex.set(idx, p);
    }
    let count = 0;
    for (const row of targets) {
      const cand = byIndex.get(Number(row.sectionIndex));
      if (!cand || !isRealCall(cand.prediction)) continue;
      const win = String(cand.winningTeamName || '').trim();
      if (!win || win.toLowerCase() === 'unreadable') continue;
      if (!teamsMatch(cand.teamName, row.teamName)) continue;
      if (!winnerMatchesTeam(win, row.teamName)) continue;
      const pct = Number(cand.accuracyPercent) || 0;
      row.winningTeamName = win;
      row.prediction = String(cand.prediction);
      row.accuracyPercent = pct;
      row.confidence = cand.confidence || deriveConfidence(pct);
      row.reason = cand.reason || cand.analysis || row.reason;
      row.analysis = row.reason;
      row.recovered = true;
      delete row.verification;
      delete row.verificationNote;
      count++;
    }
    console.log(`[ai] recoverWinners via ${model}: ${count}/${targets.length} row(s) recovered`);
    return { recovered: count };
  } catch (err) {
    console.log(`[ai] recoverWinners via ${model} failed: ${err.message} — rows stay Not predicted`);
    return { recovered: 0 };
  }
}

// First-read failure taxonomy — ANY of these falls through to the next
// model in the chain (never a hard failure until the chain is spent):
// timeout (AbortController), HTTP error, non-JSON response, a
// moderation-model response ("User Safety: safe" — no JSON, so the
// parse yields zero picks), or an empty/truncated transcription
// (parses to zero picks). A response that parses to picks IS usable
// even if it covers fewer picks than detected — the gap-fill stage
// exists for exactly that, and falling back on a partial read would
// burn the chain for nothing.
function firstReadUsable(analysis) {
  return Array.isArray(analysis.predictions) && analysis.predictions.length > 0;
}

async function analyzeSlip(imageBase64, imageMediaType, plan) {
  const chainBuildStart = Date.now();
  const attempts = await buildAttemptChain(plan);
  console.log(`[ai] chain built in ${Date.now() - chainBuildStart}ms: ${attempts.length} total attempt(s)`);

  if (!attempts.length) {
    console.error('[ai] no attempts available: no provider has an api key/account configured');
    throw new ApiError(
      'AI scanning is not configured: no OpenRouter API key is set. Set AI_OPENROUTER_API_KEYS (or AI_OPENROUTER_API_KEY).',
      503
    );
  }

  console.log(`[ai] scan plan: ${attempts.map((a) => a.label).join(' | ')}`);

  const dataUri = `data:${imageMediaType};base64,${imageBase64}`;
  const prompt = buildPrompt(plan);
  const scanStart = Date.now();

  const failures = [];
  const attemptTimeoutMs = plan.maxPicks < 0 ? 20000 : ATTEMPT_TIMEOUT_SECONDS * 1000;
  for (let i = 0; i < attempts.length; i++) {
    const attempt = attempts[i];
    const attemptStart = Date.now();
    const elapsedSoFar = attemptStart - scanStart;

    console.log(`[ai] === attempt ${i + 1}/${attempts.length}: ${attempt.label} (${elapsedSoFar}ms elapsed so far) ===`);

    try {
      const firstRes = await callProvider(attempt, dataUri, imageBase64, prompt, attemptTimeoutMs);
      const content = firstRes.content;
      const servingModel = firstRes.model;
      const callElapsed = Date.now() - attemptStart;
      console.log(`[ai] ${attempt.label}: got ${content.length} char response in ${callElapsed}ms. preview: ${content.slice(0, 200).replace(/\n/g, ' ')}`);

      const analysis = parseModelResponse(content, plan);

      // Whole-slip guarantee (full-coverage plans only; capped plans
      // intentionally cover only their first N picks). If the model
      // reported more picks than it predicted, retry ONLY the missing
      // positions (up to 2 rounds) before accepting a partial result.
      if (plan.maxPicks < 0) {
        let missing = missingPositions(analysis);
        for (let round = 0; round < 2 && missing.length; round++) {
          try {
            const gapPrompt = buildGapFillPrompt(analysis.totalPicksDetected, missing);
            const gapRes = await callProvider(attempt, dataUri, imageBase64, gapPrompt, attemptTimeoutMs);
            const gap = parseModelResponse(gapRes.content, plan);
            const fresh = gap.predictions || [];
            const missingSet = new Set(missing);
            const used = new Set();
            for (const entry of fresh) {
              const idx = Number(entry.sectionIndex);
              if (missingSet.has(idx) && !used.has(idx)) {
                analysis.predictions.push(entry);
                used.add(idx);
              }
            }
            for (const entry of fresh) {
              if (used.size >= missing.length) break;
              const idx = Number(entry.sectionIndex);
              if (missingSet.has(idx)) continue;
              const next = missing.find((m) => !used.has(m));
              if (next === undefined) break;
              analysis.predictions.push({ ...entry, sectionIndex: next });
              used.add(next);
            }
            console.log(`[ai] ${attempt.label}: gap-fill round ${round + 1}: ${used.size} pick(s) recovered for positions [${[...used].join(',')}]`);
            missing = missingPositions(analysis);
          } catch (gapErr) {
            console.log(`[ai] ${attempt.label}: gap-fill round ${round + 1} failed: ${gapErr.message}`);
            break;
          }
        }
        // Anything still missing is listed EXPLICITLY as unpredicted —
        // never omitted, never faked into a 1/X/2 call.
        for (const idx of missing) {
          analysis.predictions.push({
            sectionIndex: idx,
            teamName: '',
            matchLabel: `Pick #${idx}`,
            winningTeamName: '',
            originalPick: '',
            prediction: 'unpredicted',
            accuracyPercent: 0,
            confidence: 'Unpredicted',
            reason: 'The AI could not analyse this pick after retries.',
            analysis: 'The AI could not analyse this pick after retries.',
          });
        }
        analysis.predictions.sort((a, b) => (Number(a.sectionIndex) || 0) - (Number(b.sectionIndex) || 0));
      }

      // Parser guards run on every plan: untrustworthy model output is
      // demoted to explicit unreadable rows before anything is stored.
      analysis.predictions = sanitizePredictions(analysis.predictions);

      // Winner recovery (same second-look pass as the staged pipeline):
      // readable teams with a demoted winner get one focused attempt
      // on a different model; unreadable teams are never recovered.
      // Verification below still double-checks any recovered call.
      try {
        await recoverWinners(imageBase64, imageMediaType, plan, analysis, attemptTimeoutMs, servingModel);
      } catch (rErr) {
        console.log(`[ai] ${attempt.label}: recovery pass failed (${rErr.message}) — rows stay Not predicted`);
      }

      // Transcription verification: a second, prediction-free read must
      // agree on the teams. It never fails the scan — a failed
      // double-check flags picks as not double-checked instead of
      // burning the user's scan.
      if (analysis.predictions.some((p) => isRealCall(p.prediction))) {
        try {
          await verifyTranscription(attempt, dataUri, imageBase64, analysis, attemptTimeoutMs, servingModel);
        } catch (vErr) {
          console.log(`[ai] ${attempt.label}: verification pass failed (${vErr.message}) — keeping picks, flagged as not double-checked`);
          for (const p of analysis.predictions) {
            if (isRealCall(p.prediction) && !p.verification) p.verification = 'unverified';
          }
        }
      }

      if (!firstReadUsable(analysis)) {
        console.log(`[ai] ${attempt.label}: parsed 0 predictions, full raw output: ${content.slice(0, 800)}`);
        throw new Error(`unparseable output: ${content.slice(0, 300)}`);
      }

      analysis.providerUsed = attempt.providerId;
      analysis.modelUsed = attempt.model;

      const totalElapsed = Date.now() - scanStart;
      const realCalls = analysis.predictions.filter((p) => isRealCall(p.prediction)).length;
      console.log(`[ai] SUCCESS on attempt ${i + 1}/${attempts.length} (${attempt.label}): ${analysis.predictions.length} pick(s) listed (${realCalls} real calls), total scan time ${totalElapsed}ms`);
      return analysis;

    } catch (err) {
      const attemptElapsed = Date.now() - attemptStart;
      console.error(`[ai] FAILED attempt ${i + 1}/${attempts.length} (${attempt.label}) after ${attemptElapsed}ms: ${err.message}`);
      failures.push(`${attempt.label} (${attemptElapsed}ms) -> ${err.message}`);
    }
  }

  const totalElapsed = Date.now() - scanStart;
  console.error(`[ai] ALL ${attempts.length} ATTEMPT(S) FAILED after ${totalElapsed}ms total`);
  failures.forEach((f, idx) => console.error(`[ai]   ${idx + 1}. ${f}`));

  const hadRateLimit = failures.some((failure) => /429|rate.?limit|quota/i.test(failure));
  const message = hadRateLimit
    ? 'AI scanning is temporarily busy because the free OpenRouter models are rate-limited. Please wait a minute and try again.'
    : 'AI scanning is temporarily unavailable for the free vision models. Please try again shortly.';
  throw new ApiError(message, 502);
}

// --- Staged scan pipeline (async, past the 60s function wall) --------
// The single-call analyzeSlip above can run ~110s (30s first read + 2x30s
// gap-fill + 20s verification), which Vercel kills at 60s with no result.
// The staged endpoints (see /api/scan/stage/*) run each step as its own
// invocation, each comfortably under 60s, with the client orchestrating
// and showing real stage progress. These helpers share the exact prompts,
// parsing, gap-fill merge, sanitize, and diverse verification of the
// single-call path — no second implementation of the AI logic.
// A failed stage never consumes anything: consumption happens only in
// the finalize stage, after a completed analysis (same rule as analyze).

// Stage 1: first read only. Tries attempts (keys) in order; the first
// success wins and reports which model actually served it, because the
// verification stage must differ from that model.
async function transcribeFirst(imageBase64, imageMediaType, plan) {
  const attempts = await buildAttemptChain(plan);
  if (!attempts.length) {
    console.error('[ai] no attempts available: no provider has an api key/account configured');
    throw new ApiError(
      'AI scanning is not configured: no OpenRouter API key is set. Set AI_OPENROUTER_API_KEYS (or AI_OPENROUTER_API_KEY).',
      503
    );
  }
  const dataUri = `data:${imageMediaType};base64,${imageBase64}`;
  const prompt = buildPrompt(plan);
  const attemptTimeoutMs = plan.maxPicks < 0 ? 20000 : ATTEMPT_TIMEOUT_SECONDS * 1000;
  const failures = [];
  for (let i = 0; i < attempts.length; i++) {
    const attempt = attempts[i];
    try {
      const res = await callProvider(attempt, dataUri, imageBase64, prompt, attemptTimeoutMs);
      const analysis = parseModelResponse(res.content, plan);
      if (!firstReadUsable(analysis)) {
        throw new Error(`unparseable output: ${res.content.slice(0, 300)}`);
      }
      analysis.providerUsed = attempt.providerId;
      analysis.modelUsed = attempt.model;
      return { analysis, servingModel: res.model, attemptTimeoutMs };
    } catch (err) {
      console.log(`[ai] transcribeFirst attempt ${i + 1}/${attempts.length} (${attempt.label}) failed: ${err.message}`);
      failures.push(`${attempt.label} -> ${err.message}`);
    }
  }
  const hadRateLimit = failures.some((failure) => /429|rate.?limit|quota/i.test(failure));
  throw new ApiError(
    hadRateLimit
      ? 'AI scanning is temporarily busy because the free OpenRouter models are rate-limited. Please wait a minute and try again.'
      : 'AI scanning is temporarily unavailable for the free vision models. Please try again shortly.',
    502
  );
}

// Stage 2 (one round): fill ONLY the still-missing positions. A provider
// failure is NON-fatal (mirrors analyzeSlip's break): the caller keeps
// the partial picks and the verify stage lists the rest as unpredicted.
async function gapFillOnce(imageBase64, imageMediaType, plan, analysis) {
  const missing = missingPositions(analysis);
  if (!missing.length) return { recovered: [], failed: false };
  const attempts = await buildAttemptChain(plan);
  const dataUri = `data:${imageMediaType};base64,${imageBase64}`;
  const attemptTimeoutMs = plan.maxPicks < 0 ? 20000 : ATTEMPT_TIMEOUT_SECONDS * 1000;
  for (const attempt of attempts) {
    try {
      const gapPrompt = buildGapFillPrompt(analysis.totalPicksDetected, missing);
      const res = await callProvider(attempt, dataUri, imageBase64, gapPrompt, attemptTimeoutMs);
      const gap = parseModelResponse(res.content, plan);
      const fresh = gap.predictions || [];
      const missingSet = new Set(missing);
      const used = new Set();
      for (const entry of fresh) {
        const idx = Number(entry.sectionIndex);
        if (missingSet.has(idx) && !used.has(idx)) {
          analysis.predictions.push(entry);
          used.add(idx);
        }
      }
      for (const entry of fresh) {
        if (used.size >= missing.length) break;
        const idx = Number(entry.sectionIndex);
        if (missingSet.has(idx)) continue;
        const next = missing.find((m) => !used.has(m));
        if (next === undefined) break;
        analysis.predictions.push({ ...entry, sectionIndex: next });
        used.add(next);
      }
      console.log(`[ai] gapFillOnce: ${used.size} pick(s) recovered for positions [${[...used].join(',')}]`);
      return { recovered: [...used], failed: false };
    } catch (err) {
      console.log(`[ai] gapFillOnce attempt (${attempt.label}) failed: ${err.message}`);
    }
  }
  return { recovered: [], failed: true };
}

// Stage 3: unpredicted-fill for still-missing positions + sanitize +
// diverse verification. Verification failure (all diverse candidates
// failed on every key) flags picks unverified but never fails the stage
// — a failed double-check must not burn a scan.
async function verifyAnalysis(imageBase64, imageMediaType, plan, predictions, totalPicksDetected, servingModel) {
  const analysis = {
    totalPicksDetected: totalPicksDetected || 0,
    predictions: (predictions || []).map((p) => ({ ...p })),
  };
  for (const idx of missingPositions(analysis)) {
    analysis.predictions.push({
      sectionIndex: idx,
      teamName: '',
      matchLabel: `Pick #${idx}`,
      winningTeamName: '',
      originalPick: '',
      prediction: 'unpredicted',
      accuracyPercent: 0,
      confidence: 'Unpredicted',
      reason: 'The AI could not analyse this pick after retries.',
      analysis: 'The AI could not analyse this pick after retries.',
    });
  }
  analysis.predictions.sort((a, b) => (Number(a.sectionIndex) || 0) - (Number(b.sectionIndex) || 0));
  analysis.predictions = sanitizePredictions(analysis.predictions);
  // Winner recovery before verification: readable teams with a demoted
  // winner get one focused second look (different model where
  // possible). Verification below then double-checks recovered calls
  // exactly like any other call. Never fails the stage.
  const recoverTimeoutMs = plan.maxPicks < 0 ? 20000 : ATTEMPT_TIMEOUT_SECONDS * 1000;
  try {
    await recoverWinners(imageBase64, imageMediaType, plan, analysis, recoverTimeoutMs, servingModel);
  } catch (rErr) {
    console.log(`[ai] recoverWinners failed unexpectedly: ${rErr.message} — rows stay Not predicted`);
  }
  if (analysis.predictions.some((p) => isRealCall(p.prediction))) {
    const attempts = await buildAttemptChain(plan);
    const dataUri = `data:${imageMediaType};base64,${imageBase64}`;
    const attemptTimeoutMs = plan.maxPicks < 0 ? 20000 : ATTEMPT_TIMEOUT_SECONDS * 1000;
    let verified = false;
    for (const attempt of attempts) {
      try {
        await verifyTranscription(attempt, dataUri, imageBase64, analysis, attemptTimeoutMs, servingModel);
        verified = true;
        break;
      } catch (vErr) {
        console.log(`[ai] verifyAnalysis attempt (${attempt.label}) failed (${vErr.message}) — trying next key`);
      }
    }
    if (!verified) {
      for (const p of analysis.predictions) {
        if (isRealCall(p.prediction) && !p.verification) p.verification = 'unverified';
      }
    }
  }
  return analysis;
}

module.exports = { analyzeSlip, transcribeFirst, gapFillOnce, verifyAnalysis, recoverWinners, recoveryEligible, VERIFY_MODELS, FIRST_READ_MODELS, verificationCandidates, firstReadUsable, isRealCall, normalizeTeamName, teamsMatch, winnerMatchesTeam, sanitizePredictions };
