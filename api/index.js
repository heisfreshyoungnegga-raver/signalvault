// api/index.js — the entire backend as one Express app, deployed as a
// single Vercel serverless function. Every route below is a 1:1 port of the
// equivalent Spring Boot @RestController from the original Java backend.
//
// vercel.json rewrites every /api/* request to this file, so Express's own
// router (app.get/post/put on the full "/api/..." path) does the routing —
// there is no [...catchall].js needed.
const express = require('express');
const cors = require('cors');
const multer = require('multer');

const { ok, fail, ApiError, PLAN, SCAN_PLAN, countryForManualSubmission, storedOrLegacyGhs, legacyGhsForPlan } = require('../lib/util');
const { ensureSuperAdminBootstrapped } = require('../lib/bootstrap');

const account = require('../lib/services/account');
const ban = require('../lib/services/ban');
const session = require('../lib/services/session');
const admin = require('../lib/services/admin');
const adminAuth = require('../lib/services/adminAuth');
const commission = require('../lib/services/commission');
const stats = require('../lib/services/stats');
const manualPayment = require('../lib/services/manualPayment');
const manualScanSession = require('../lib/services/manualScanSession');
const scanPurchase = require('../lib/services/scanPurchase');
const minesPurchase = require('../lib/services/minesPurchase');
const monitoringSchema = require('../lib/services/monitoringSchema');
const scanService = require('../lib/services/scanService');
const scanSession = require('../lib/services/scanSession');
const superAdminSimulator = require('../lib/services/superAdminSimulator');
const simulator = require('../lib/services/simulator');
const simScanService = require('../lib/services/simScanService');
const funds = require('../lib/services/funds');
const settings = require('../lib/services/settings');
const skyAccount = require('../lib/services/skyAccount');
const skyPayments = require('../lib/services/skyPayments');
const customerUsers = require('../lib/services/customerUsers');
const gameWindows = require('../lib/services/gameWindows');
const credits = require('../lib/services/credits');
const customRounds = require('../lib/services/customRounds');
const bottleRounds = require('../lib/services/bottleRounds');

const { requireAdmin, requireSuperAdmin } = require('../lib/middleware/adminAuth');
const { requireSession } = require('../lib/middleware/sessionAuth');
const virtualsRouter = require('./virtuals');

const app = express();
app.set('trust proxy', true);
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 10 * 1024 * 1024 } });

app.use(cors({ origin: true, credentials: false }));
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// Ensure the bootstrap super admin exists (cheap no-op after the first call
// in a warm container).
app.use(async (req, res, next) => {
  await ensureSuperAdminBootstrapped();
  next();
});

// ── C11: login rate limiting ─────────────────────────────────────────────
// DB-backed (login_attempts table) because in-memory counters do not work
// on serverless. 5 failed attempts per IP+username in 15 minutes -> 429;
// a successful login clears the counter.
const { sql: rawSql } = require('../lib/db');
let loginAttemptsTableReady = false;
async function ensureLoginAttemptsTable(db) {
  if (loginAttemptsTableReady) return;
  await db`CREATE TABLE IF NOT EXISTS login_attempts (key TEXT PRIMARY KEY, count INT NOT NULL DEFAULT 0, window_start TIMESTAMPTZ NOT NULL DEFAULT now())`;
  loginAttemptsTableReady = true;
}
function loginKey(req, user) {
  const ip = String(req.headers['x-forwarded-for'] || req.ip || 'unknown').split(',')[0].trim();
  return ip + '|' + String(user || '').toLowerCase();
}
async function assertLoginAllowed(key) {
  const db = rawSql();
  await ensureLoginAttemptsTable(db);
  const rows = await db`SELECT count, window_start FROM login_attempts WHERE key = ${key}`;
  if (!rows[0]) return;
  const fresh = Date.now() - new Date(rows[0].window_start).getTime() < 15 * 60 * 1000;
  if (fresh && rows[0].count >= 5) {
    throw new ApiError('Too many failed login attempts. Please try again in a few minutes.', 429);
  }
}
async function recordLoginFailure(key) {
  try {
    const db = rawSql();
    await ensureLoginAttemptsTable(db);
    await db`
      INSERT INTO login_attempts (key, count, window_start) VALUES (${key}, 1, now())
      ON CONFLICT (key) DO UPDATE SET
        count = CASE WHEN login_attempts.window_start < now() - interval '15 minutes' THEN 1 ELSE login_attempts.count + 1 END,
        window_start = CASE WHEN login_attempts.window_start < now() - interval '15 minutes' THEN now() ELSE login_attempts.window_start END`;
  } catch (e) { /* rate limiting must never break login itself */ }
}
async function clearLoginFailures(key) {
  try {
    const db = rawSql();
    await ensureLoginAttemptsTable(db);
    await db`DELETE FROM login_attempts WHERE key = ${key}`;
  } catch (e) { /* ignore */ }
}

// Small helper so route handlers can stay close to the original controller
// methods: wrap an async handler and convert thrown ApiError -> JSON error.
function h(fn) {
  return async (req, res) => {
    console.log(`[api] ${req.method} ${req.originalUrl || req.url}`);
    try {
      await fn(req, res);
    } catch (err) {
      const status = err instanceof ApiError ? err.status : err.status || 500;
      console.error(`[api] ${req.method} ${req.originalUrl || req.url} -> ${status}: ${err.message}`);
      res.status(status).json(fail(err.message || 'Something went wrong', err.code || null));
    }
  };
}

// ============================================================================
// /api/auth — AuthController.java
// ============================================================================

// Lightweight ban check the frontend can poll proactively (page load, and
// on bfcache restore via the `pageshow` event) — not just react to after a
// 403 comes back from some other action. Always checks the caller's IP;
// checks email too if the frontend has one in hand (e.g. already typed
// into the form, or already registered this session). Never throws — it's
// a status check, not a gate — so the frontend can act on the boolean.
app.get('/api/auth/ban-status', h(async (req, res) => {
  const email = req.query.email || null;
  const ip = req.headers['x-forwarded-for'] || req.socket.remoteAddress || '';
  const cleanIp = String(ip).split(',')[0].trim();
  const hit = await ban.isBanned(email, cleanIp);
  res.json(ok('Ban status', { banned: !!hit }));
}));

app.post('/api/auth/register', h(async (req, res) => {
  const body = req.body || {};
  const ip = req.headers['x-forwarded-for'] || req.socket.remoteAddress || '';
  const cleanIp = String(ip).split(',')[0].trim();
  // Casino accounts (frontend register page) sign up with a name, a
  // username and their own password and get a token immediately. The
  // scan-side register below it (email only, no password) is unchanged.
  if (body.password && body.username) {
    const { token, user } = await skyAccount.register(body, cleanIp);
    return res.json(ok('Account created.', { token, user }));
  }
  const { email, referralCode } = body;
  if (!email) throw new ApiError('email is required', 400);
  const acc = await account.register(email, referralCode, cleanIp);
  res.json(ok('Registered. Now pay for a plan to receive your login password.', {
    username: acc.username,
    status: account.isPaid(acc) ? 'PAID' : 'UNPAID',
    referred: !!acc.referredByAdminCode,
  }));
}));

app.post('/api/auth/login', h(async (req, res) => {
  const { username, email, password } = req.body || {};
  const user = username || email;
  if (!user || !password) throw new ApiError('username and password are required', 400);
  const ip = req.headers['x-forwarded-for'] || req.socket.remoteAddress || '';
  const cleanIp = String(ip).split(',')[0].trim();
  // Casino accounts authenticate against sky_users and get their
  // AccountUser back; anything else falls through to the scan-side
  // subscription login below, unchanged.
  const skyUser = await skyAccount.findByIdentifier(user);
  if (skyUser) {
    const { token, user: accountUser } = await skyAccount.login(user, password, cleanIp);
    return res.json(ok('Login successful', { token, user: accountUser }));
  }
  const s = await session.login(user, password, cleanIp);
  res.json(ok('Login successful', {
    token: s.token,
    expiresAt: s.expiresAt,
    secondsRemaining: session.secondsRemaining(s),
  }));
}));

/** The signed-in casino account (identity + pass entitlement). */
app.get('/api/auth/me', requireSession, h(async (req, res) => {
  // Simulator identities resolve to sim entitlement, never a real account.
  if (req.userSession.sim) {
    return res.json(ok('Account (SIMULATED)', await simulator.simEntitlement(req.userSession.username)));
  }
  const skyUser = await skyAccount.findByUsername(req.userSession.username);
  if (!skyUser) throw new ApiError('Account not found', 404);
  res.json(ok('Account', await skyAccount.toAccountUser(skyUser)));
}));

/** Same AccountUser, at the path the casino lobby polls for tile state. */
app.get('/api/games/entitlement', requireSession, h(async (req, res) => {
  if (req.userSession.sim) {
    return res.json(ok('Entitlement (SIMULATED)', await simulator.simEntitlement(req.userSession.username)));
  }
  const skyUser = await skyAccount.findByUsername(req.userSession.username);
  if (!skyUser) {
    return res.json(ok('Entitlement', {
      name: req.userSession.username,
      email: req.userSession.username,
      username: req.userSession.username,
      plans: {},
      games: {},
    }));
  }
  res.json(ok('Entitlement', await skyAccount.toAccountUser(skyUser)));
}));

/**
 * Login resume: the client reports each engine entry so a later login
 * can take the user straight back into their last game. Simulator
 * identities have no login/logout, so the call is a no-op for them.
 * Unknown games are ignored (never stored).
 */
app.post('/api/games/last-played', requireSession, h(async (req, res) => {
  if (req.userSession.sim) return res.json(ok('Last game noted (SIMULATED)', { game: null }));
  const game = String((req.body || {}).game || '');
  const skyUser = await skyAccount.findByUsername(req.userSession.username).catch(() => null);
  if (!skyUser) throw new ApiError('Account not found', 404);
  const out = await skyAccount.setLastGame(skyUser.username, game);
  return res.json(ok('Last game noted', { game: out.ok ? game : null }));
}));

/**
 * The engine-entry intro plays once per access window; the client
 * reports it seen so later entries in the same window skip it.
 */
app.post('/api/games/intro-seen', requireSession, h(async (req, res) => {
  const game = String((req.body || {}).game || '');
  if (req.userSession.sim) {
    await simulator.markIntroSeenSim(req.userSession.username, game);
    return res.json(ok('Intro marked as seen (SIMULATED)', { game }));
  }
  const skyUser = await skyAccount.findByUsername(req.userSession.username).catch(() => null);
  const identities = [req.userSession.username, skyUser && skyUser.email].filter(Boolean);
  await gameWindows.markIntroSeen(identities, game);
  res.json(ok('Intro marked as seen', { game }));
}));

// ── Credit enforcement (2026-11-06, replaces 45-minute windows) ──────────
// In-engine ACTIONS (round ticks, predictor draws/analysis, the FIFO
// bottle + custom-round draws) require at least 5 credits in the
// caller's wallet. Identity comes from the Bearer session when one is
// presented; no session (or no casino account behind it) means no
// credits, which answers CREDITS_EXHAUSTED — the same answer an
// out-of-credits account gets. Throws ApiError(403, CREDITS_EXHAUSTED)
// via the wallet. Returns the spend context for the per-play endpoints:
// { kind: 'real' | 'sim' | 'staff', identity } — staff never spend and
// never gate.
async function assertGameAccess(req, game) {
  const header = req.headers.authorization;
  const token = header && header.startsWith('Bearer ') ? header.slice(7) : null;
  // Simulator tokens enforce SIMULATED credits only — they can never
  // open a real wallet, and real tokens can never open a sim wallet.
  if (token && token.startsWith(simulator.SIM_TOKEN_PREFIX)) {
    const run = await simulator.resolveSimToken(token);
    if (!run) throw new ApiError('Simulator session expired or invalid', 401);
    await simulator.requireSimActive(run.sim_identity, game);
    return { kind: 'sim', identity: run.sim_identity };
  }
  let identities = [];
  if (token) {
    try {
      const s = await session.validate(token);
      const skyUser = await skyAccount.findByUsername(s.username).catch(() => null);
      if (skyUser && skyUser.active === false) {
        throw new ApiError('This account has been deactivated.', 403, 'GAME_LOCKED');
      }
      identities = [s.username, skyUser && skyUser.email].filter(Boolean);
    } catch (err) {
      // A deactivation must surface as itself, not as a generic lock:
      // session.validate throws it, and the generic catch below would
      // otherwise swallow it into GAME_LOCKED.
      if (err instanceof ApiError && err.message === 'This account has been deactivated.') throw err;
      identities = [];
    }
    if (!identities.length) {
      // Staff sessions (admin / super admin tools, e.g. the next-runs
      // preview) are not players — credits never gate them.
      try { await adminAuth.validate(token); return { kind: 'staff', identity: null }; } catch { /* not staff */ }
    }
  }
  await gameWindows.requireActive(identities, game);
  return { kind: 'real', identity: await credits.keyForIdentities(identities) };
}

/**
 * Spend 5 credits for one play (crash round / bottle spin). The spend
 * lands BEFORE the draw so a failed spend never consumes an admin-set
 * custom round; if the draw itself then errors, the 5 are refunded.
 * Staff never spend. Returns the balance after the spend.
 */
async function spendForPlay(ctx, game, ref) {
  if (!ctx || ctx.kind === 'staff') return null;
  if (ctx.kind === 'sim') return credits.spendSimCredits(ctx.identity, { reason: 'PLAY_' + String(game).toUpperCase(), ref });
  return credits.spendCredits(ctx.identity, { reason: 'PLAY_' + String(game).toUpperCase(), ref });
}

async function refundPlay(ctx, game, ref) {
  if (!ctx || ctx.kind === 'staff') return;
  try {
    if (ctx.kind === 'sim') await credits.grantSimCredits(ctx.identity, credits.COST_PER_USE, { reason: 'REFUND_' + String(game).toUpperCase(), ref: 'REFUND_' + ref });
    else await credits.grantCredits(ctx.identity, credits.COST_PER_USE, { reason: 'REFUND_' + String(game).toUpperCase(), ref: 'REFUND_' + ref });
  } catch (err) {
    console.error('[api] play refund failed:', err && err.message);
  }
}

app.post('/api/auth/logout', h(async (req, res) => {
  const header = req.headers.authorization;
  if (!header || !header.startsWith('Bearer ')) throw new ApiError('Missing Authorization Bearer token', 401);
  await session.logout(header.slice(7));
  res.json(ok('Logged out successfully', null));
}));

// ============================================================================
// /api/protected — ProtectedController.java
// ============================================================================
app.get('/api/protected/status', requireSession, h(async (req, res) => {
  const s = req.userSession;
  res.json(ok('Session active', {
    username: s.username,
    loginAt: s.loginAt,
    expiresAt: s.expiresAt,
    secondsRemaining: session.secondsRemaining(s),
  }));
}));

app.get('/api/protected/dashboard', requireSession, h(async (req, res) => {
  const s = req.userSession;
  res.json(ok(`Welcome ${s.username}`, { secondsRemaining: session.secondsRemaining(s) }));
}));

// ============================================================================
// /api/payment — MANUAL payments only (owner decision, 2026-10-22: every
// payment gateway was removed). Ghana pays by MoMo transfer, Nigeria by
// bank transfer; both submit proof here and an admin approves it.
// ============================================================================
app.get('/api/payment/plans', h(async (req, res) => {
  // Credit-pack catalogue — the manual-payment page's plan picker reads
  // this route. Four tiers (2026-11-17): GH₵250 → 20, GH₵300 → 25,
  // GH₵500 → 40, GH₵1,000 → 80 credits (NGN 47,000 / 56,000 / 94,000 /
  // 188,000). The pricing page's per-game passes live at
  // /api/plans/catalogue below; the two catalogues are different products
  // and must not share a route.
  const list = Object.values(PLAN).map((p) => ({
    plan: p.name, code: p.code, hours: p.hours, amountCedis: p.amountCedis,
    credits: p.credits, priceGhs: p.amountCedis, priceNgn: p.amountNgn,
  }));
  res.json(ok('Available plans', list));
}));

// The receiving details every manual buy surface renders ("SEND PAYMENT
// TO" card). Super admins can override them via
// PUT /api/settings/payment-details.
app.get('/api/payment/details', h(async (req, res) => {
  res.json(ok('Manual payment receiving details', await settings.getPaymentDetails()));
}));

app.get('/api/plans/catalogue', h(async (req, res) => {
  // Per-game predictor passes (Bronze/Silver/Gold) for the pricing page.
  res.json(ok('Available game passes', skyPayments.plansCatalogue()));
}));

// Legacy automated checkout endpoints are intentionally retired — there
// is no gateway any more. All customers (Ghana and Nigeria alike) submit
// transfer proof through /api/payment/manual/submit for admin review.
app.post('/api/payment/initialize', h(async () => {
  throw new ApiError('This checkout is retired. Please submit your transfer proof for admin review instead.', 410);
}));

app.get('/api/payment/verify/:reference', h(async () => {
  throw new ApiError('This verification route is retired. Payments are reviewed manually after proof submission.', 410);
}));

// ── Manual payments (subscription) — ManualPaymentController.java ─────────
// Ghana (MoMo transfer) and Nigeria (bank transfer) alike: the customer
// sends the plan amount to the published receiving details, submits their
// proof here, and an admin approves it from the review queue.
app.post('/api/payment/manual/submit', h(async (req, res) => {
  const { email, plan, accountName, accountNumber, networkOrBank, reference, screenshotUrl } = req.body || {};
  const ip = req.headers['x-forwarded-for'] || req.socket.remoteAddress || '';
  const payment = await manualPayment.submit(email, plan, accountName, accountNumber, networkOrBank, reference, screenshotUrl, String(ip).split(',')[0].trim());
  res.json(ok('Payment proof submitted, awaiting admin review', {
    id: payment.id,
    status: payment.status,
    plan: payment.plan,
    submittedAt: payment.submittedAt,
    message: 'Submitted. Save this id - check its status with GET /api/payment/manual/status/{id}.',
  }));
}));

app.get('/api/payment/manual/status/:id', h(async (req, res) => {
  const { payment, password } = await manualPayment.checkStatus(req.params.id);
  const data = {
    id: payment.id,
    status: payment.status,
    plan: payment.plan,
    submittedAt: payment.submittedAt,
    reviewedAt: payment.reviewedAt,
  };
  if (payment.status === 'REJECTED') data.rejectionReason = payment.rejectionReason;
  if (password) {
    data.username = payment.email;
    data.password = password;
    data.message = 'Save this password now - it will not be shown again. Use it to log in.';
  } else if (payment.status === 'APPROVED') {
    data.message = 'Already approved - use the password you saved earlier to log in.';
  }
  res.json(ok('Manual payment status', data));
}));

// ── Per-game passes (manual) ────────────────────────────────────────────────
// The frontend's pricing page calls these paths; the service (skyPayments)
// runs the same manual lifecycle as the other rails: proof submission ->
// PENDING -> admin approval activates the pass. The old one-time gate fee
// endpoints below stay as 410 stubs so stale clients get a clear answer.
async function requireSkyUser(req) {
  const skyUser = await skyAccount.findByUsername(req.userSession.username);
  if (!skyUser) throw new ApiError('Account not found — please register first.', 404);
  return skyUser;
}

app.post('/api/gate/pay/init', requireSession, h(async (req, res) => {
  throw new ApiError('The one-time gate fee has been removed — no payment is needed to enter.', 410);
}));

app.get('/api/gate/pay/status/:id', requireSession, h(async (req, res) => {
  throw new ApiError('The one-time gate fee has been removed.', 410);
}));

app.post('/api/plans/pay/init', requireSession, h(async (req, res) => {
  const skyUser = await requireSkyUser(req);
  const { game, plan, accountName, accountNumber, networkOrBank, reference, screenshotUrl } = req.body || {};
  const ip = req.headers['x-forwarded-for'] || req.socket.remoteAddress || '';
  const result = await skyPayments.initPass(skyUser, { game, plan, accountName, accountNumber, networkOrBank, reference, screenshotUrl }, String(ip).split(',')[0].trim());
  res.json(ok('Payment proof submitted, awaiting admin review', {
    id: result.id,
    status: result.status,
    message: 'Submitted. Your pass activates as soon as an admin approves this payment.',
  }));
}));

app.get('/api/plans/pay/status/:id', requireSession, h(async (req, res) => {
  const skyUser = await requireSkyUser(req);
  const data = await skyPayments.statusPass(req.params.id, skyUser.username);
  res.json(ok('Plan payment status', data));
}));

// ── Games access — RETIRED ──────────────────────────────────────────────────
// The one-time lifetime games-access fee was removed entirely (same call as
// VirtuWin, 20 Oct). Scan access is now governed solely by scan purchases
// and timed scan sessions. These stubs stay so old clients get a clear 410
// instead of a 404; historical games-access payment rows are untouched.
const gamesAccessRetired = h(async (req, res) => {
  throw new ApiError('Games access is no longer sold — scan access now comes from scan plans and sessions.', 410);
});
app.post('/api/games-access/submit', gamesAccessRetired);
app.get('/api/games-access/status/:id', gamesAccessRetired);
app.get('/api/games-access/verify/:token', gamesAccessRetired);
app.get('/api/games-access/authorize', gamesAccessRetired);

// ── C12: image upload proxy ──────────────────────────────────────────────
// The imgbb API key used to sit in public/upload-utils.js where anyone
// could read and abuse it. Uploads now come through here: the key lives
// only in the IMGBB_API_KEY environment variable and never reaches the
// browser. Rotate the old key — it has shipped publicly.
app.post('/api/upload', upload.single('image'), h(async (req, res) => {
  const key = String(process.env.IMGBB_API_KEY || '').trim();
  if (!key) throw new ApiError('Image upload is not configured. Add IMGBB_API_KEY to the Vercel Production environment and redeploy.', 503);
  if (!req.file) throw new ApiError('No image file received', 400);
  if (!/^image\//.test(req.file.mimetype || '')) throw new ApiError('Only image uploads are allowed', 400);

  const form = new FormData();
  form.append('image', new Blob([req.file.buffer], { type: req.file.mimetype }), req.file.originalname || 'upload.jpg');
  const upstream = await fetch('https://api.imgbb.com/1/upload?key=' + encodeURIComponent(key), { method: 'POST', body: form });
  const data = await upstream.json().catch(() => ({}));
  const url = data && data.success && data.data && (data.data.display_url || data.data.url);
  if (!upstream.ok || !url) throw new ApiError('Screenshot upload failed. Please try another image.', 502);
  res.json(ok('Image uploaded', { url }));
}));

// ============================================================================
// /api/engines — SignalVault prediction engines (public read endpoints)
// ============================================================================
const engines = require('../lib/services/engines');

// Every game the engines cover, with live stats + current AI prediction.
app.get('/api/engines', h(async (req, res) => {
  res.json(ok('Prediction engines', engines.listGames()));
}));

// Full engine detail: stats, current prediction, recent rounds.
app.get('/api/engines/:id', h(async (req, res) => {
  const detail = engines.gameDetail(req.params.id);
  if (!detail) throw new ApiError('Unknown game engine', 404);
  res.json(ok('Engine detail', detail));
}));

// Recent rounds for one engine (newest first).
app.get('/api/engines/:id/history', h(async (req, res) => {
  const g = engines.getGame(req.params.id);
  if (!g) throw new ApiError('Unknown game engine', 404);
  const limit = Math.min(100, Math.max(1, parseInt(req.query.limit, 10) || 30));
  res.json(ok('Round history', g.engine.getHistory(limit)));
}));

// Advance the simulation one round: grades the pending prediction against
// the new outcome and returns the fresh prediction. This is what powers the
// live feed on the engine dashboards (production would feed real results).
app.post('/api/engines/:id/tick', h(async (req, res) => {
  const g = engines.getGame(req.params.id);
  if (!g) throw new ApiError('Unknown game engine', 404);
  await assertGameAccess(req, g.id);
  const { round, prediction } = g.engine.tick();
  res.json(ok('Round simulated', { round, prediction, stats: g.engine.getStats() }));
}));

// Provably-fair data for one crash-engine round: the hash, the crash point
// and the server seed, so anyone can recompute and verify the round.
app.get('/api/engines/:id/fairness/:round', h(async (req, res) => {
  const g = engines.getGame(req.params.id);
  if (!g || typeof g.engine.fairnessFor !== 'function')
    throw new ApiError('Fairness proofs are only available for crash engines', 404);
  const n = parseInt(req.params.round, 10);
  if (!Number.isFinite(n) || n < 1 || n > g.engine.roundNo)
    throw new ApiError('Round out of range', 400);
  res.json(ok('Fairness proof', g.engine.fairnessFor(n)));
}));

// AI crash-point draw: one fresh random crash point from the game's
// authentic provably-fair construction. Each call is independent.
app.get('/api/engines/:id/random-crash', h(async (req, res) => {
  const g = engines.getGame(req.params.id);
  if (!g || typeof g.engine.randomCrash !== 'function')
    throw new ApiError('Random crash draws are only available for crash engines', 404);
  await assertGameAccess(req, g.id);
  res.json(ok('AI crash-point draw', { gameId: g.id, ...g.engine.randomCrash() }));
}));

// Recompute a crash-engine round from its seed and check the crash point.
app.post('/api/engines/:id/verify', h(async (req, res) => {
  const g = engines.getGame(req.params.id);
  if (!g || typeof g.engine.verify !== 'function')
    throw new ApiError('Verification is only available for crash engines', 404);
  await assertGameAccess(req, g.id);
  const n = parseInt((req.body || {}).round, 10);
  const crash = Number((req.body || {}).crash);
  if (!Number.isFinite(n) || !Number.isFinite(crash))
    throw new ApiError('round and crash are required', 400);
  res.json(ok('Verification result', g.engine.verify(n, crash)));
}));

// ----------------------------------------------------------------------------
// /api/engines analytics extensions — target analysis, Monte-Carlo simulation,
// 9-zone penalty stats, 5-zone action metrics, saved analysis records.
// ----------------------------------------------------------------------------
const { fairRound } = require('../lib/services/engines/provably-fair');

/** Round to 2 decimals (used for P&L figures in simulation output). */
function round2pnl(n) {
  return Math.round(n * 100) / 100;
}

// Target analysis: how often would a cash-out at `target` have won over the
// trailing window. Crash engines only.
app.post('/api/engines/:id/analyze', h(async (req, res) => {
  const g = engines.getGame(req.params.id);
  if (!g || typeof g.engine.analyzeTarget !== 'function')
    throw new ApiError('Target analysis is not supported for this engine', 400);
  await assertGameAccess(req, g.id);
  const body = req.body || {};
  const target = Number(body.target) || 2;
  const window = Math.min(500, Math.max(1, parseInt(body.window, 10) || 100));
  res.json(ok('Target analysis', {
    gameId: g.id,
    analysis: g.engine.analyzeTarget(target, window),
    timestamp: new Date().toISOString(),
  }));
}));

// Seeded Monte-Carlo: bet `stake` at `target` every round for `rounds`
// rounds. Crash points are drawn from the engine's own provably-fair chain,
// continuing past the current roundNo — the engine's state is never
// mutated, and every draw is a real fairRound that anyone can recompute.
// The `seed` just offsets into the chain (deterministic, seed-varying).
// Crash engines only.
app.post('/api/engines/:id/simulate', h(async (req, res) => {
  const g = engines.getGame(req.params.id);
  if (!g || typeof g.engine.analyzeTarget !== 'function')
    throw new ApiError('Simulation is not supported for this engine', 400);
  await assertGameAccess(req, g.id);
  const body = req.body || {};
  const rounds = Math.min(5000, Math.max(1, parseInt(body.rounds, 10) || 500));
  const target = Math.max(1.01, Number(body.target) || 2);
  const stake = Math.max(0.00000001, Number(body.stake) || 1);
  const seed = body.seed === undefined || body.seed === null ? 0 : parseInt(body.seed, 10) || 0;
  const offset = Math.abs(seed) % 100000;
  const startRound = g.engine.roundNo + 1 + offset;

  let wins = 0;
  let pnl = 0; // cumulative net P&L in stake units
  let peak = 0;
  let maxDrawdown = 0;
  const equityCurve = [0];
  for (let i = 0; i < rounds; i++) {
    // fairRound(serverSeed, roundNo) — the same chain the live game uses.
    const fr = fairRound(g.engine.serverSeed, startRound + i, g.engine.rtp, g.engine.variant);
    if (fr.crash >= target) {
      wins += 1;
      pnl += stake * (target - 1); // cashed out at target
    } else {
      pnl -= stake; // lost the stake
    }
    if (pnl > peak) peak = pnl;
    maxDrawdown = Math.max(maxDrawdown, peak - pnl);
    equityCurve.push(round2pnl(pnl));
  }
  // Downsample the equity curve to <= 200 points (keep first + last).
  const curve = equityCurve.length <= 200
    ? equityCurve
    : equityCurve.filter((_, i) => i % Math.ceil(equityCurve.length / 200) === 0)
        .concat(equityCurve[equityCurve.length - 1]);

  res.json(ok('Simulation complete', {
    gameId: g.id,
    config: { rounds, target, stake, seed, startRound, endRound: startRound + rounds - 1 },
    results: {
      wins,
      losses: rounds - wins,
      winRate: round2pnl((wins / rounds) * 100),
      // True probability P(crash >= target) = 0.97/target — the sanity line.
      theoreticalWinRate: round2pnl((0.97 / target) * 100),
      netPnl: round2pnl(pnl),
      maxDrawdown: round2pnl(maxDrawdown),
      equityCurve: curve,
      disclaimer: 'Monte-Carlo over the engine\'s provably-fair chain. Every round is independent with a fixed 3% house edge — no target has positive EV; netPnl is expected to be negative.',
    },
    timestamp: new Date().toISOString(),
  }));
}));

// 9-zone goal-mouth breakdown for the penalty engine (SportyKick).
app.get('/api/engines/sportykick/zones', h(async (req, res) => {
  const g = engines.getGame('sportykick');
  if (!g) throw new ApiError('Unknown game engine', 404);
  const window = Math.min(500, Math.max(1, parseInt(req.query.window, 10) || 120));
  const zs = g.engine.zoneStats(window);
  res.json(ok('Penalty zone stats', {
    gameId: g.id,
    window,
    sampleSize: zs.sampleSize,
    zones: zs.zones,
  }));
}));

// Per-zone hot-rate metrics for the action engine (Super Hero).
app.get('/api/engines/super-hero/zones', h(async (req, res) => {
  const g = engines.getGame('super-hero');
  if (!g) throw new ApiError('Unknown game engine', 404);
  const window = Math.min(500, Math.max(1, parseInt(req.query.window, 10) || 120));
  const zm = g.engine.zoneMetrics(window);
  res.json(ok('Action zone metrics', {
    gameId: g.id,
    window,
    sampleSize: zm.sampleSize,
    zones: zm.zones,
  }));
}));

// --- saved analysis records (in-memory, newest first, capped at 200) --------
const analyses = [];
let analysisSeq = 1;

app.get('/api/analyses', h(async (req, res) => {
  res.json(ok('Analysis records', analyses.slice().reverse()));
}));

app.post('/api/analyses', h(async (req, res) => {
  const body = req.body || {};
  if (!body.gameId || !body.kind)
    throw new ApiError('gameId and kind are required', 400);
  const record = {
    id: analysisSeq++,
    gameId: String(body.gameId),
    kind: String(body.kind),
    params: body.params || {},
    output: body.output !== undefined ? body.output : null,
    note: body.note !== undefined ? String(body.note) : null,
    createdAt: new Date().toISOString(),
  };
  analyses.push(record);
  if (analyses.length > 200) analyses.splice(0, analyses.length - 200);
  res.json(ok('Analysis saved', record));
}));

// ============================================================================
// /api/admin/auth — AdminAuthController.java (open, no auth required)
// ============================================================================
app.post('/api/admin/auth/login', h(async (req, res) => {
  const { username, email, password } = req.body || {};
  const user = username || email;
  if (!user || !password) throw new ApiError('username and password are required', 400);
  const key = loginKey(req, user);
  await assertLoginAllowed(key);
  try {
    const s = await adminAuth.login(user, password);
    await clearLoginFailures(key);
    res.json(ok('Admin login successful', { token: s.token, role: s.role, expiresAt: s.expiresAt }));
  } catch (err) {
    await recordLoginFailure(key);
    throw err;
  }
}));

app.post('/api/admin/auth/logout', h(async (req, res) => {
  const header = req.headers.authorization;
  if (!header || !header.startsWith('Bearer ')) throw new ApiError('Missing Authorization Bearer token', 401);
  await adminAuth.logout(header.slice(7));
  res.json(ok('Logged out successfully', null));
}));


// ============================================================================
// /api/superadmin/auth — SuperAdminAuthController.java (open, no auth required)
// ============================================================================
app.post('/api/superadmin/auth/login', h(async (req, res) => {
  const { username, email, password } = req.body || {};
  const user = username || email;
  if (!user || !password) throw new ApiError('username and password are required', 400);
  const key = loginKey(req, user);
  await assertLoginAllowed(key);
  try {
    const s = await adminAuth.login(user, password, 'SUPER_ADMIN');
    await clearLoginFailures(key);
    res.json(ok('Super admin login successful', { token: s.token, role: s.role, expiresAt: s.expiresAt }));
  } catch (err) {
    await recordLoginFailure(key);
    throw err;
  }
}));

app.post('/api/superadmin/auth/logout', h(async (req, res) => {
  const header = req.headers.authorization;
  if (!header || !header.startsWith('Bearer ')) throw new ApiError('Missing Authorization Bearer token', 401);
  await adminAuth.logout(header.slice(7));
  res.json(ok('Logged out successfully', null));
}));

// Public read: game pages need the switch state without admin credentials.
app.get('/api/settings/virtual-predictions', h(async (req, res) => {
  res.json(ok('Virtual predictions setting', await settings.getVirtualPredictions()));
}));

// Only a super admin may change the platform-wide switch.
app.put('/api/settings/virtual-predictions', requireSuperAdmin, h(async (req, res) => {
  const body = req.body || {};
  const rawEnabled = body.enabled !== undefined ? body.enabled : (body.on !== undefined ? body.on : body.live);
  if (typeof rawEnabled !== 'boolean') throw new ApiError('enabled must be a boolean', 400);
  res.json(ok('Virtual predictions setting updated', await settings.setVirtualPredictions(rawEnabled, req.adminSession.username)));
}));

// ── Spin da Bottle — superadmin-pinned pattern (next 10 calls) ─────────────
// Public read: the bottle game and staff views need the live pattern.
app.get('/api/settings/bottle-rounds', h(async (req, res) => {
  res.json(ok('Bottle rounds', await bottleRounds.getPattern()));
}));

// Only a super admin may set or clear the pattern.
app.put('/api/settings/bottle-rounds', requireSuperAdmin, h(async (req, res) => {
  const calls = req.body ? req.body.calls : undefined;
  res.json(ok('Bottle rounds updated', await bottleRounds.setPattern(calls === undefined ? null : calls, req.adminSession.username)));
}));

// ── Manual payment receiving details ─────────────────────────────────────
// Public read is /api/payment/details (above); only a super admin may
// change where manual payments are sent.
app.put('/api/settings/payment-details', requireSuperAdmin, h(async (req, res) => {
  res.json(ok('Payment details updated', await settings.setPaymentDetails(req.body || {}, req.adminSession.username)));
}));

// Ordered consumption: each draw takes the next pinned call from the ONE
// shared server-side sequence (all players stay in sync), cycling 1→10→1.
// With no pattern set, data.mode is "ai" and the client's own predictor
// calls the round. One spin = one play = 5 credits, spent here (sim
// wallet for sim tokens; staff never spend).
app.post('/api/bottle/next', h(async (req, res) => {
  const ctx = await assertGameAccess(req, 'bottle');
  const ref = 'BOTTLE_' + Date.now() + '_' + Math.random().toString(36).slice(2, 8);
  const creditsLeft = await spendForPlay(ctx, 'bottle', ref);
  try {
    const d = await bottleRounds.nextCall();
    res.json(ok(d.mode === 'pattern' ? 'Pattern call' : 'No pattern set — AI predictor calls', { ...d, creditsLeft }));
  } catch (err) {
    await refundPlay(ctx, 'bottle', ref);
    throw err;
  }
}));

// ============================================================================
// /api/admin/** (everything below requires ADMIN or SUPER_ADMIN) — AdminController.java
// ============================================================================
function userSummary(u) {
  return {
    username: u.username,
    paid: account.isPaid(u),
    plan: u.plan || null,
    hasActiveSession: !!u.activeSessionToken,
    subscriptionConsumed: u.subscriptionConsumed,
    referredByAdminCode: u.referredByAdminCode,
    createdAt: u.createdAt,
  };
}
function frontendBaseUrl() {
  return process.env.APP_FRONTEND_BASE_URL || 'http://localhost:3000';
}

app.get('/api/admin/me', requireAdmin, h(async (req, res) => {
  const a = await admin.getByUsername(req.adminSession.username);
  res.json(ok('Admin profile', {
    username: a.username,
    role: a.role,
    referralCode: a.referralCode,
    referralLink: `${frontendBaseUrl()}/register?ref=${a.referralCode}`,
    adminSharePercent: a.adminSharePercent,
    platformSharePercent: a.platformSharePercent,
    active: a.active,
    createdAt: a.createdAt,
  }));
}));

app.get('/api/admin/referral', requireAdmin, h(async (req, res) => {
  const a = await admin.getByUsername(req.adminSession.username);
  res.json(ok('Referral link', {
    referralCode: a.referralCode,
    referralLink: `${frontendBaseUrl()}/register?ref=${a.referralCode}`,
    split: `${a.adminSharePercent}/${a.platformSharePercent} (admin/platform)`,
  }));
}));

app.get('/api/admin/users', requireAdmin, h(async (req, res) => {
  const list = (await account.findAll()).map(userSummary);
  res.json(ok(`All users (${list.length})`, list));
}));

app.get('/api/admin/users/referred', requireAdmin, h(async (req, res) => {
  const a = await admin.getByUsername(req.adminSession.username);
  const list = (await account.findAll()).filter((u) => u.referredByAdminCode === a.referralCode).map(userSummary);
  res.json(ok(`Users referred by you (${list.length})`, list));
}));

app.get('/api/admin/stats', requireAdmin, h(async (req, res) => {
  const username = req.adminSession.username;
  const a = await admin.getByUsername(username);
  const today = new Date().toISOString().slice(0, 10);
  const weekStart = new Date(Date.now() - 7 * 24 * 3600 * 1000).toISOString();

  // P1: count in SQL instead of scanning every user row into memory.
  // Same column the admins list counts; healed by commission.ensureSchema
  // (a prod users table predating referred_by_admin_code used to 500
  // this endpoint outright).
  const referredUserCount = await commission.referredUserCount(a.referralCode);

  res.json(ok('Your referral stats', {
    referralCode: a.referralCode,
    split: `${a.adminSharePercent}/${a.platformSharePercent}`,
    referredUserCount,
    commissionEarnedToday: await commission.earnedOn(username, today),
    commissionEarnedThisWeek: await commission.earnedSince(username, weekStart),
    totalCommissionEarned: await commission.totalEarned(username),
    totalCommissionPending: await commission.totalPending(username),
    totalCommissionPaidOut: await commission.totalPaidOut(username),
    currency: 'GHS',
    // Nigerian manual-payment referrals are commissioned in Naira and kept
    // entirely separate from the GHS figures above — see commission.js's
    // currency-scoping fix. Zero for admins with no Nigerian referrals.
    totalCommissionEarnedNGN: await commission.totalEarned(username, 'NGN'),
    totalCommissionPendingNGN: await commission.totalPending(username, 'NGN'),
    totalCommissionPaidOutNGN: await commission.totalPaidOut(username, 'NGN'),
  }));
}));

app.get('/api/admin/commissions', requireAdmin, h(async (req, res) => {
  const records = await commission.listForAdmin(req.adminSession.username);
  res.json(ok(`Commission history (${records.length} records)`, records));
}));

app.get('/api/admin/payouts', requireAdmin, h(async (req, res) => {
  const records = await commission.payoutsForAdmin(req.adminSession.username);
  res.json(ok(`Payout history (${records.length} payouts)`, records));
}));

// Admin requests a payout of their pending commission balance.
// Optional body: { "currency": "NGN" } (defaults to GHS).
// Blocks if a PENDING request for this currency already exists.
app.post('/api/admin/payouts/request', requireAdmin, h(async (req, res) => {
  const currency = (req.body && req.body.currency) ? String(req.body.currency).toUpperCase() : 'GHS';
  const record = await commission.requestPayout(req.adminSession.username, currency);
  res.json(ok('Payout request submitted. Awaiting super-admin approval.', record));
}));

// ── Funds generated through this admin's referrals (NEW) ──────────────────
app.get('/api/admin/funds', requireAdmin, h(async (req, res) => {
  const data = await funds.fundsForAdmin(req.adminSession.username);
  res.json(ok('Funds generated through your referrals, and your commission on them', data));
}));

// ── /api/admin/manual-payments — AdminManualPaymentController.java ────────
function manualPaymentSummary(p) {
  return {
    id: p.id, email: p.email, plan: p.plan, amountCedis: storedOrLegacyGhs(p.amountCedis, p.plan),
    accountName: p.accountName, accountNumber: p.accountNumber, networkOrBank: p.networkOrBank,
    reference: p.reference, screenshotUrl: p.screenshotUrl, status: p.status,
    rejectionReason: p.rejectionReason, submittedAt: p.submittedAt, reviewedAt: p.reviewedAt,
    reviewedByAdmin: p.reviewedByAdmin,
  };
}
app.get('/api/admin/manual-payments', requireAdmin, h(async (req, res) => {
  const list = (await manualPayment.listAll()).map(manualPaymentSummary);
  res.json(ok(`All manual payment submissions (${list.length})`, list));
}));
app.get('/api/admin/manual-payments/pending', requireAdmin, h(async (req, res) => {
  const list = (await manualPayment.listPending()).map(manualPaymentSummary);
  res.json(ok(`Pending manual payment submissions (${list.length})`, list));
}));
app.get('/api/admin/manual-payments/:id', requireAdmin, h(async (req, res) => {
  res.json(ok('Manual payment details', manualPaymentSummary(await manualPayment.getById(req.params.id))));
}));
app.post('/api/admin/manual-payments/:id/approve', requireAdmin, h(async (req, res) => {
  const p = await manualPayment.approve(req.params.id, req.adminSession.username);
  res.json(ok('Approved. The user will see their password next time they check status.', manualPaymentSummary(p)));
}));
app.post('/api/admin/manual-payments/:id/reject', requireAdmin, h(async (req, res) => {
  const reason = req.body ? req.body.reason : null;
  const p = await manualPayment.reject(req.params.id, req.adminSession.username, reason);
  res.json(ok('Rejected', manualPaymentSummary(p)));
}));
app.delete('/api/admin/manual-payments/:id', requireSuperAdmin, h(async (req, res) => {
  res.json(ok('Manual payment deleted', await manualPayment.remove(req.params.id)));
}));

// ── /api/admin/game-passes — manual per-game pass review queue ───────────
function gamePassSummary(p) {
  return {
    id: p.id, username: p.username, email: p.email, game: p.game, plan: p.plan,
    amount: p.amount, amountCedis: p.amount, currency: p.currency,
    accountName: p.accountName, accountNumber: p.accountNumber, networkOrBank: p.networkOrBank,
    reference: p.reference, screenshotUrl: p.screenshotUrl, status: p.status,
    rejectionReason: p.rejectionReason, submittedAt: p.submittedAt, reviewedAt: p.reviewedAt,
    reviewedByAdmin: p.reviewedByAdmin, expiresAt: p.expiresAt,
  };
}
app.get('/api/admin/game-passes', requireAdmin, h(async (req, res) => {
  const list = (await skyPayments.listAll()).map(gamePassSummary);
  res.json(ok(`All game pass submissions (${list.length})`, list));
}));
app.get('/api/admin/game-passes/pending', requireAdmin, h(async (req, res) => {
  const list = (await skyPayments.listPending()).map(gamePassSummary);
  res.json(ok(`Pending game pass submissions (${list.length})`, list));
}));
app.get('/api/admin/game-passes/:id', requireAdmin, h(async (req, res) => {
  res.json(ok('Game pass details', gamePassSummary(await skyPayments.getPassById(req.params.id))));
}));
app.post('/api/admin/game-passes/:id/approve', requireAdmin, h(async (req, res) => {
  const p = await skyPayments.approvePass(req.params.id, req.adminSession.username);
  res.json(ok('Approved. The pass is now active.', gamePassSummary(p)));
}));
app.post('/api/admin/game-passes/:id/reject', requireAdmin, h(async (req, res) => {
  const reason = req.body ? req.body.reason : null;
  const p = await skyPayments.rejectPass(req.params.id, req.adminSession.username, reason);
  res.json(ok('Rejected', gamePassSummary(p)));
}));
app.delete('/api/admin/game-passes/:id', requireSuperAdmin, h(async (req, res) => {
  res.json(ok('Game pass deleted', await skyPayments.removePass(req.params.id)));
}));

// ── /api/admin/manual-deposits — combined manual-deposit review queue ────
// One list across the three manual rails (manual-payment subscriptions,
// scan Buy submissions, pricing game passes), split by country for the
// staff tabs. Approval/rejection delegate to each rail's own service, so
// activation semantics (including PENDING-only, double-approve → 409) are
// unchanged. Sim deposits live in separate sim_* tables and are never read.
const manualDeposits = require('../lib/services/manualDeposits');
app.get('/api/admin/manual-deposits', requireAdmin, h(async (req, res) => {
  const list = await manualDeposits.listAll(req.query.country);
  res.json(ok(`Manual deposits (${list.length})`, list));
}));
app.get('/api/admin/manual-deposits/:source/:id', requireAdmin, h(async (req, res) => {
  res.json(ok('Manual deposit details', await manualDeposits.getById(req.params.source, req.params.id)));
}));
app.post('/api/admin/manual-deposits/:source/:id/approve', requireAdmin, h(async (req, res) => {
  res.json(ok('Approved', await manualDeposits.approve(req.params.source, req.params.id, req.adminSession.username)));
}));
app.post('/api/admin/manual-deposits/:source/:id/reject', requireAdmin, h(async (req, res) => {
  const reason = req.body ? req.body.reason : null;
  res.json(ok('Rejected', await manualDeposits.reject(req.params.source, req.params.id, req.adminSession.username, reason)));
}));

// ── Manual timed scan-session review ─────────────────────────────────────
function manualScanSessionSummary(p) {
  const plan = require('../lib/util').SCAN_SESSION_PLAN[p.plan];
  return { id: p.id, sessionId: p.sessionId, email: p.email, plan: p.plan, amountCedis: plan.amountCedis, durationMinutes: plan.durationMinutes, accountName: p.accountName, accountNumber: p.accountNumber, networkOrBank: p.networkOrBank, reference: p.reference, screenshotUrl: p.screenshotUrl, status: p.status, rejectionReason: p.rejectionReason, submittedAt: p.submittedAt, reviewedAt: p.reviewedAt, reviewedByAdmin: p.reviewedByAdmin };
}
app.get('/api/admin/scan-sessions', requireAdmin, h(async (req, res) => { res.json(ok('All manual timed scan-session payments', (await manualScanSession.listAll()).map(manualScanSessionSummary))); }));
app.get('/api/admin/scan-sessions/pending', requireAdmin, h(async (req, res) => { res.json(ok('Pending manual timed scan-session payments', (await manualScanSession.listPending()).map(manualScanSessionSummary))); }));
app.post('/api/admin/scan-sessions/:id/approve', requireAdmin, h(async (req, res) => { res.json(ok('Approved. The timed scan session is now active.', manualScanSessionSummary(await manualScanSession.approve(req.params.id, req.adminSession.username)))); }));
app.post('/api/admin/scan-sessions/:id/reject', requireAdmin, h(async (req, res) => { res.json(ok('Rejected', manualScanSessionSummary(await manualScanSession.reject(req.params.id, req.adminSession.username, req.body && req.body.reason)))); }));
app.delete('/api/admin/scan-sessions/:id', requireSuperAdmin, h(async (req, res) => { res.json(ok('Timed scan session deleted', await manualScanSession.remove(req.params.id))); }));

// ── /api/admin/scan-purchases — AdminScanPurchaseController.java ──────────
function scanPurchaseSummary(p) {
  const plan = SCAN_PLAN[p.scanPlan];
  const gs = scanPurchase.grantState(p);
  return {
    id: p.id, email: p.email, scanPlan: p.scanPlan, amountCedis: storedOrLegacyGhs(p.amountCedis, p.scanPlan),
    maxPicks: plan.maxPicks < 0 ? 'FULL' : plan.maxPicks,
    accountName: p.accountName, accountNumber: p.accountNumber, networkOrBank: p.networkOrBank,
    reference: p.reference, screenshotUrl: p.screenshotUrl, status: p.status,
    rejectionReason: p.rejectionReason, submittedAt: p.submittedAt, reviewedAt: p.reviewedAt,
    reviewedByAdmin: p.reviewedByAdmin, usedAt: p.usedAt,
    scansUsed: gs.scansUsed, scansMax: gs.scansMax, scansLeft: gs.scansLeft,
    windowStartedAt: gs.windowStartedAt, windowExpiresAt: gs.windowExpiresAt, grantState: gs.state,
  };
}
app.get('/api/admin/scan-purchases', requireAdmin, h(async (req, res) => {
  const list = (await scanPurchase.listAll()).map(scanPurchaseSummary);
  res.json(ok(`All scan purchase submissions (${list.length})`, list));
}));
app.get('/api/admin/scan-purchases/pending', requireAdmin, h(async (req, res) => {
  const list = (await scanPurchase.listPending()).map(scanPurchaseSummary);
  res.json(ok(`Pending scan purchase submissions (${list.length})`, list));
}));
app.get('/api/admin/scan-purchases/:id', requireAdmin, h(async (req, res) => {
  res.json(ok('Scan purchase details', scanPurchaseSummary(await scanPurchase.getById(req.params.id))));
}));
app.post('/api/admin/scan-purchases/:id/approve', requireAdmin, h(async (req, res) => {
  const p = await scanPurchase.approve(req.params.id, req.adminSession.username);
  res.json(ok('Approved. The user can now submit their slip image to POST /api/scan/analyze.', scanPurchaseSummary(p)));
}));
app.post('/api/admin/scan-purchases/:id/reject', requireAdmin, h(async (req, res) => {
  const reason = req.body ? req.body.reason : null;
  const p = await scanPurchase.reject(req.params.id, req.adminSession.username, reason);
  res.json(ok('Rejected', scanPurchaseSummary(p)));
}));
app.delete('/api/admin/scan-purchases/:id', requireSuperAdmin, h(async (req, res) => {
  res.json(ok('Scan purchase deleted', await scanPurchase.remove(req.params.id)));
}));

// ── /api/admin/mines-purchases — AI Mines manual bank-transfer payments ────
// Response shape matches exactly what superadmin-dashboard.html's MINES_EP
// block + renderMinesContent()/openModal() already expect (id, email,
// minesPlan, amountCedis, accountName, accountNumber, networkOrBank,
// reference, screenshotUrl, status, submittedAt, reviewedAt, reviewedByAdmin,
// rejectionReason, usedAt).
function minesPurchaseSummary(p) {
  return {
    id: p.id, email: p.email, minesPlan: p.minesPlan, amountCedis: p.amountCedis,
    accountName: p.accountName, accountNumber: p.accountNumber, networkOrBank: p.networkOrBank,
    reference: p.reference, screenshotUrl: p.screenshotUrl, status: p.status,
    rejectionReason: p.rejectionReason, submittedAt: p.submittedAt, reviewedAt: p.reviewedAt,
    reviewedByAdmin: p.reviewedByAdmin, usedAt: p.usedAt,
  };
}
app.get('/api/admin/mines-purchases', requireAdmin, h(async (req, res) => {
  const list = (await minesPurchase.listAll()).map(minesPurchaseSummary);
  res.json(ok(`All Mines payment submissions (${list.length})`, list));
}));
app.get('/api/admin/mines-purchases/pending', requireAdmin, h(async (req, res) => {
  const list = (await minesPurchase.listPending()).map(minesPurchaseSummary);
  res.json(ok(`Pending Mines payment submissions (${list.length})`, list));
}));
app.get('/api/admin/mines-purchases/:id', requireAdmin, h(async (req, res) => {
  res.json(ok('Mines payment details', minesPurchaseSummary(await minesPurchase.getById(req.params.id))));
}));
app.post('/api/admin/mines-purchases/:id/approve', requireAdmin, h(async (req, res) => {
  const p = await minesPurchase.approve(req.params.id, req.adminSession.username);
  res.json(ok('Approved', minesPurchaseSummary(p)));
}));
app.post('/api/admin/mines-purchases/:id/reject', requireAdmin, h(async (req, res) => {
  const reason = req.body ? req.body.reason : null;
  const p = await minesPurchase.reject(req.params.id, req.adminSession.username, reason);
  res.json(ok('Rejected', minesPurchaseSummary(p)));
}));

// ── Round Customization — admin sets the next 10 crash multipliers per game ──
// The predictor consumes these in order (both simulator + live users); when
// the queue empties the game reverts to random provably-fair generation.
app.get('/api/admin/rounds/custom/:gameId', requireAdmin, h(async (req, res) => {
  res.json(ok('Custom rounds', await customRounds.listRounds(req.params.gameId)));
}));
app.post('/api/admin/rounds/custom', requireAdmin, h(async (req, res) => {
  const { gameId, points } = req.body || {};
  if (!gameId) throw new ApiError('gameId is required', 400);
  const by = req.adminSession ? req.adminSession.username : 'admin';
  res.json(ok('Custom rounds saved', await customRounds.setRounds(gameId, points, by)));
}));
app.delete('/api/admin/rounds/custom/:gameId', requireAdmin, h(async (req, res) => {
  res.json(ok('Custom rounds cleared', await customRounds.clearRounds(req.params.gameId)));
}));
// Public draw: predictor calls this before each round. One call = one
// play = 5 credits, spent here (real wallet, or the sim wallet for sim
// tokens; staff never spend). Returns the custom round, or
// { custom: false, creditsLeft } when none is queued (caller falls back
// to local generation). Simulator sessions NEVER draw from the real SA
// queue: a sim token gets the no-custom shape (local draw) even when SA
// rounds are queued, so sim play can neither drain SA rounds nor play
// them. Real and staff tokens draw FIFO.
app.get('/api/rounds/next/:gameId', h(async (req, res) => {
  const ctx = await assertGameAccess(req, req.params.gameId);
  const ref = 'ROUND_' + req.params.gameId + '_' + Date.now() + '_' + Math.random().toString(36).slice(2, 8);
  const creditsLeft = await spendForPlay(ctx, req.params.gameId, ref);
  try {
    const header = req.headers.authorization;
    const token = header && header.startsWith('Bearer ') ? header.slice(7) : null;
    if (token && token.startsWith(simulator.SIM_TOKEN_PREFIX)) {
      return res.json(ok('No custom rounds queued', { custom: false, creditsLeft }));
    }
    const d = await customRounds.drawNext(req.params.gameId);
    if (!d) return res.json(ok('No custom rounds queued', { custom: false, creditsLeft }));
    res.json(ok('Custom round', { ...d, creditsLeft }));
  } catch (err) {
    await refundPlay(ctx, req.params.gameId, ref);
    throw err;
  }
}));

// ── /api/credits — credit wallet ────────────────────────────────────────────
// Current balance for the signed-in account (sim sessions read the sim
// wallet). The lobby + game pages poll this to show credits and to stop
// the engine the moment the balance hits 0.
app.get('/api/credits/balance', requireSession, h(async (req, res) => {
  if (req.userSession.sim) {
    const balance = await credits.simBalanceFor(req.userSession.username);
    return res.json(ok('Sim credit balance', { ...credits.summary(balance), simulated: true }));
  }
  const skyUser = await skyAccount.findByUsername(req.userSession.username).catch(() => null);
  const identities = [req.userSession.username, skyUser && skyUser.email].filter(Boolean);
  const balance = await credits.balanceForIdentities(identities);
  res.json(ok('Credit balance', credits.summary(balance)));
}));

// ── /api/mines/play — one mines game = 5 credits ───────────────────────────
// Mines runs fully client-side, so the board calls this when a game
// starts (Run prediction). Same spend rules as a crash round: staff
// never spend, sim sessions spend sim credits, a failed spend answers
// 403 CREDITS_EXHAUSTED and the board must not start.
app.post('/api/mines/play', requireSession, h(async (req, res) => {
  if (req.userSession.sim) {
    const left = await credits.spendSimCredits(req.userSession.username, { reason: 'PLAY_MINES', ref: 'MINES_SIM_' + Date.now() + '_' + Math.random().toString(36).slice(2, 8) });
    return res.json(ok('Mines game started (SIMULATED)', { ...credits.summary(left), simulated: true }));
  }
  const skyUser = await skyAccount.findByUsername(req.userSession.username).catch(() => null);
  const identities = [req.userSession.username, skyUser && skyUser.email].filter(Boolean);
  await gameWindows.requireActive(identities, 'mines');
  const left = await credits.spendCreditsForIdentities(identities, { reason: 'PLAY_MINES', ref: 'MINES_' + Date.now() + '_' + Math.random().toString(36).slice(2, 8) });
  res.json(ok('Mines game started', credits.summary(left)));
}));
app.delete('/api/admin/mines-purchases/:id', requireSuperAdmin, h(async (req, res) => {
  res.json(ok('Mines payment deleted', await minesPurchase.remove(req.params.id)));
}));

// ── /api/mines/payment — user-facing manual submission (no submission
//    form exists in the frontend yet, but the admin review side above
//    needs something to populate it — built to the same contract as
//    /api/scan/payment/submit so a future purchase form has a working
//    target). Ghana and Nigeria alike: transfer + proof + admin review.
app.post('/api/mines/payment/submit', h(async (req, res) => {
  const { email, minesPlan, amountCedis, accountName, accountNumber, networkOrBank, reference, screenshotUrl } = req.body || {};
  const ip = req.headers['x-forwarded-for'] || req.socket.remoteAddress || '';
  const purchase = await minesPurchase.submit(email, minesPlan, amountCedis, accountName, accountNumber, networkOrBank, reference, screenshotUrl, String(ip).split(',')[0].trim());
  res.json(ok('Mines payment proof submitted, awaiting admin review', {
    id: purchase.id, status: purchase.status, minesPlan: purchase.minesPlan, amountCedis: purchase.amountCedis,
    submittedAt: purchase.submittedAt,
    message: 'Submitted. Save this id - check its status with GET /api/mines/payment/status/{id}.',
  }));
}));
app.get('/api/mines/payment/status/:id', h(async (req, res) => {
  const purchase = await minesPurchase.getById(req.params.id);
  const data = {
    id: purchase.id, status: purchase.status, minesPlan: purchase.minesPlan, amountCedis: purchase.amountCedis,
    submittedAt: purchase.submittedAt, reviewedAt: purchase.reviewedAt,
  };
  if (purchase.status === 'REJECTED') data.rejectionReason = purchase.rejectionReason;
  else if (purchase.status === 'APPROVED') data.message = 'Approved! You can now play.';
  else if (purchase.status === 'USED') { data.usedAt = purchase.usedAt; data.message = 'This purchase has already been used.'; }
  res.json(ok('Mines payment status', data));
}));

// ============================================================================
// /api/superadmin/** (everything below requires SUPER_ADMIN) — SuperAdminController.java
// ============================================================================
function adminSummary(a) {
  return {
    username: a.username, role: a.role, referralCode: a.referralCode,
    adminSharePercent: a.adminSharePercent, platformSharePercent: a.platformSharePercent,
    active: a.active, createdAt: a.createdAt,
  };
}
// P1: this used to run six commission queries PER ADMIN plus a full users
// scan (6N+1 queries for the list). Aggregate once per request instead:
// one grouped commission query + one grouped referral-count query.
async function commissionAgg() {
  await commission.ensureSchema();
  const db = rawSql();
  const rows = await db`
    SELECT admin_username, currency,
           COALESCE(SUM(admin_share_cedis), 0)                                        AS earned,
           COALESCE(SUM(admin_share_cedis) FILTER (WHERE paid_out = false), 0)       AS pending,
           COALESCE(SUM(admin_share_cedis) FILTER (WHERE paid_out = true), 0)        AS paid
      FROM commission_records
     GROUP BY admin_username, currency`;
  const byAdmin = new Map();
  for (const r of rows) {
    byAdmin.set(r.admin_username + '|' + r.currency, {
      earned: Number(r.earned), pending: Number(r.pending), paid: Number(r.paid),
    });
  }
  // Referred-user headcounts read scan-side users only. The column is
  // healed by commission.ensureSchema above, but a database with no users
  // table at all must degrade to empty counts, never 500 the admins list.
  let counts = [];
  try {
    counts = await db`
      SELECT referred_by_admin_code AS code, COUNT(*)::int AS n
        FROM users
       WHERE referred_by_admin_code IS NOT NULL
       GROUP BY referred_by_admin_code`;
  } catch {
    counts = [];
  }
  const byCode = new Map(counts.map((r) => [r.code, r.n]));
  return { byAdmin, byCode };
}

async function adminSummaryWithStats(a, agg) {
  const m = adminSummary(a);
  const stats = agg || (await commissionAgg());
  const ghs = stats.byAdmin.get(a.username + '|GHS') || { earned: 0, pending: 0, paid: 0 };
  const ngn = stats.byAdmin.get(a.username + '|NGN') || { earned: 0, pending: 0, paid: 0 };
  m.totalCommissionEarned = ghs.earned;
  m.totalCommissionPending = ghs.pending;
  m.totalCommissionPaidOut = ghs.paid;
  m.currency = 'GHS';
  // See commission.js's currency-scoping fix — Nigerian manual-payment
  // referrals are tracked separately in Naira, never mixed into the GHS
  // figures above.
  m.totalCommissionEarnedNGN = ngn.earned;
  m.totalCommissionPendingNGN = ngn.pending;
  m.totalCommissionPaidOutNGN = ngn.paid;
  m.referredUserCount = stats.byCode.get(a.referralCode) || 0;
  return m;
}

app.post('/api/superadmin/admins', requireSuperAdmin, h(async (req, res) => {
  const { email, password, role, adminSharePercent } = req.body || {};
  if (!email || !password) throw new ApiError('email and password are required', 400);
  let roleUpper = 'ADMIN';
  if (role && role.trim()) {
    roleUpper = role.trim().toUpperCase();
    if (!['ADMIN', 'SUPER_ADMIN'].includes(roleUpper)) throw new ApiError('role must be ADMIN or SUPER_ADMIN', 400);
  }
  const a = await admin.createAdmin(email, password, roleUpper, adminSharePercent);
  res.json(ok('Admin created', adminSummary(a)));
}));

app.get('/api/superadmin/admins', requireSuperAdmin, h(async (req, res) => {
  const agg = await commissionAgg();
  const list = await Promise.all((await admin.listAll()).map((a) => adminSummaryWithStats(a, agg)));
  res.json(ok(`All admins (${list.length})`, list));
}));

app.get('/api/superadmin/admins/:username', requireSuperAdmin, h(async (req, res) => {
  const a = await admin.getByUsername(req.params.username);
  res.json(ok('Admin details', await adminSummaryWithStats(a)));
}));

app.put('/api/superadmin/admins/:username/deactivate', requireSuperAdmin, h(async (req, res) => {
  const a = await admin.setActive(req.params.username, false);
  res.json(ok('Admin deactivated', adminSummary(a)));
}));

app.put('/api/superadmin/admins/:username/activate', requireSuperAdmin, h(async (req, res) => {
  const a = await admin.setActive(req.params.username, true);
  res.json(ok('Admin activated', adminSummary(a)));
}));

// ── Superadmin customer-user directory ─────────────────────────────────────
// All customer users (casino signups + scan-side-only identities), with
// per-user detail (active plan, ever bought, purchase history) and
// deactivate / activate. SA-only, same guard as the other superadmin
// routes. Sim identities live in sim_* tables and never appear here.
app.get('/api/superadmin/users', requireSuperAdmin, h(async (req, res) => {
  const list = await customerUsers.listUsers();
  res.json(ok(`All users (${list.length})`, list));
}));

app.get('/api/superadmin/users/:email', requireSuperAdmin, h(async (req, res) => {
  const detail = await customerUsers.getDetail(decodeURIComponent(req.params.email));
  res.json(ok('User details', detail));
}));

app.put('/api/superadmin/users/:email/deactivate', requireSuperAdmin, h(async (req, res) => {
  const detail = await customerUsers.setActive(decodeURIComponent(req.params.email), false);
  res.json(ok('User deactivated', detail));
}));

app.put('/api/superadmin/users/:email/activate', requireSuperAdmin, h(async (req, res) => {
  const detail = await customerUsers.setActive(decodeURIComponent(req.params.email), true);
  res.json(ok('User activated', detail));
}));

/** Casino monitoring for the superadmin dashboard: every approved sale
 *  across all rails (not just the two legacy tables), live sessions, and
 *  the latest activity — split Ghana vs Nigeria, GHS vs NGN.
 *
 *  SALES TAXONOMY (exhaustive, no double count — stated, not guessed):
 *  - GATE PASSES = every approved purchase that opens game access:
 *    legacy gate fees (gate_payments) + pricing single-game passes
 *    (game_passes) + manual all-games subscriptions (manual_payments).
 *  - PLAN PURCHASES = every other approved plan buy: Buy scan plans
 *    (scan_purchases) + mines plans (mines_purchases) + legacy timed
 *    scan subscriptions (scan_sessions, MANUAL + activated) + legacy
 *    gateway subscriptions (akwapay_payments, payment_transactions).
 *  Together they exhaust the rails stats.successfulPaymentCount counts,
 *  plus gate_payments (which stats never counted): gate + plan minus
 *  gate_payments rows === stats successfulPaymentCount.
 *  PRICING reuses stats.js rules exactly (never re-priced here): passes
 *  and gate rows use their stored amount + currency; manual/scan rows
 *  use their stored amount_cedis when present, else the legacy GHS 550
 *  price (rows predating the 2026-10-24 price change to 800) — never the
 *  current constant for an old sale; NGN rows use PLAN_NAIRA /
 *  SCAN_PLAN_NAIRA via funds.js;
 *  mines use amount_cedis (Ghana-only, no NG price table exists);
 *  sessions are count-only (no amount column). A row whose amount has
 *  no price source in code (e.g. NG manual PREMIUM — PLAN_NAIRA has no
 *  PREMIUM key) is COUNTED and listed in unpricedPayments, and
 *  contributes nothing to the sums — never 0-presented-as-real.
 *  COUNTRY uses the codebase's existing classification only:
 *  gate/passes by stored currency; manual/scan by
 *  countryForManualSubmission (closed GH network list, else Nigeria by
 *  design); AKWAPAY/Paystack/mines are Ghana-only by code; sessions by
 *  stored country, else network. Anything else is unclassified
 *  (counted, never guessed into a country). Sim tables are never read.
 *  PREVIOUS BUG (why the tab read 0 with sales live): the old handler
 *  counted ONLY gate_payments + game_passes, so manual subscriptions,
 *  scan purchases, mines, sessions and gateway subs were invisible, and
 *  it summed NGN amounts straight into "Revenue (GHS)". */
app.get('/api/superadmin/monitoring', requireSuperAdmin, h(async (req, res) => {
  await skyPayments.ensureSchema();
  await skyAccount.ensureSchema();
  await manualPayment.ensureSchema();
  await scanPurchase.ensureSchema();
  // Tables no other service heals (legacy gateway tables, mines, timed
  // scan sessions) — see lib/services/monitoringSchema.js. Without this,
  // a prod database whose tables predate a column (or never had a
  // gateway-era table created) 500s this endpoint with 42703/42P01.
  await monitoringSchema.ensureSchema();
  const db = rawSql();
  // Second line of defence: a leg that still fails (genuinely absent
  // table, future column drift) degrades to empty/zero instead of 500ing
  // the whole dashboard — the commissionAgg try/catch precedent. Healing
  // above is the primary fix; these guards only ever fire if healing
  // missed something.
  const leg = (p) => p.catch(() => []);
  const cnt = (p) => p.catch(() => [{ n: 0 }]);
  const [gateRows, passRows, manualRows, scanRows, minesRows, sessionRows, akwRows, ptRows, liveSessions, adminCount] = await Promise.all([
    leg(db`SELECT email, amount, currency, created_at, reviewed_at FROM gate_payments WHERE status = 'APPROVED'`),
    leg(db`SELECT email, amount, currency, plan, created_at, reviewed_at FROM game_passes WHERE status = 'APPROVED' AND reviewed_at IS NOT NULL`),
    leg(db`SELECT email, plan, network_or_bank, amount_cedis, submitted_at, reviewed_at FROM manual_payments WHERE status = 'APPROVED' AND reviewed_at IS NOT NULL`),
    leg(db`SELECT email, scan_plan, payment_method, network_or_bank, paid_amount_cedis, amount_cedis, submitted_at, reviewed_at FROM scan_purchases WHERE status = 'APPROVED' AND reviewed_at IS NOT NULL`),
    leg(db`SELECT email, mines_plan, amount_cedis, network_or_bank, submitted_at, reviewed_at FROM mines_purchases WHERE status = 'APPROVED' AND reviewed_at IS NOT NULL`),
    leg(db`SELECT email, plan, country, network_or_bank, activated_at FROM scan_sessions WHERE payment_method = 'MANUAL' AND activated_at IS NOT NULL AND status IN ('ACTIVE', 'EXPIRED')`),
    leg(db`SELECT email, plan, paid_amount_cedis, submitted_at, reviewed_at FROM akwapay_payments WHERE status = 'APPROVED' AND reviewed_at IS NOT NULL`),
    leg(db`SELECT email, plan, created_at, verified_at FROM payment_transactions WHERE status = 'SUCCESS' AND verified_at IS NOT NULL`),
    cnt(db`SELECT COUNT(*)::int AS n FROM sessions WHERE active = true AND expires_at > now()`),
    cnt(db`SELECT COUNT(*)::int AS n FROM admins`),
  ]);
  const byCountry = {
    ghana: { payments: 0, depositsGHS: 0, unpricedPayments: 0 },
    nigeria: { payments: 0, depositsNGN: 0, unpricedPayments: 0 },
    unclassified: { payments: 0 },
  };
  const gh = (amt) => { byCountry.ghana.payments++; if (amt == null) byCountry.ghana.unpricedPayments++; else byCountry.ghana.depositsGHS += amt; };
  const ng = (amt) => { byCountry.nigeria.payments++; if (amt == null) byCountry.nigeria.unpricedPayments++; else byCountry.nigeria.depositsNGN += amt; };
  const un = () => { byCountry.unclassified.payments++; };
  const ghPrice = (r) => storedOrLegacyGhs(r.amount_cedis, r.plan);
  const scanGHPrice = (r) => {
    const real = r.paid_amount_cedis != null ? Number(r.paid_amount_cedis) : null;
    if (r.payment_method === 'AKWAPAY') return (real != null && real > 0) ? real : legacyGhsForPlan(r.scan_plan);
    return storedOrLegacyGhs(r.amount_cedis, r.scan_plan);
  };
  const recent = [];
  const push = (row) => { if (row.at) recent.push(row); };
  let gatePassesSold = 0;
  let planPurchases = 0;
  for (const r of gateRows) {
    gatePassesSold++;
    const amt = Number(r.amount) || 0;
    if (r.currency === 'GHS') gh(amt); else if (r.currency === 'NGN') ng(amt); else un();
    push({ type: 'gate', email: r.email, at: r.reviewed_at || r.created_at, amount: amt, currency: r.currency || 'GHS' });
  }
  for (const r of passRows) {
    gatePassesSold++;
    const amt = Number(r.amount) || 0;
    if (r.currency === 'GHS') gh(amt); else if (r.currency === 'NGN') ng(amt); else un();
    push({ type: 'pass', email: r.email, at: r.reviewed_at || r.created_at, amount: amt, currency: r.currency || 'GHS', plan: r.plan });
  }
  for (const r of manualRows) {
    gatePassesSold++;
    const country = countryForManualSubmission(r.network_or_bank);
    const amt = country === 'NG' ? funds.nairaPriceForPlan(r.plan) : ghPrice(r);
    if (country === 'NG') ng(amt); else gh(amt);
    push({ type: 'manual', email: r.email, at: r.reviewed_at || r.submitted_at, amount: amt, currency: country === 'NG' ? 'NGN' : 'GHS', plan: r.plan });
  }
  for (const r of scanRows) {
    planPurchases++;
    if (r.payment_method === 'AKWAPAY') {
      const amt = scanGHPrice(r);
      gh(amt);
      push({ type: 'scan', email: r.email, at: r.reviewed_at || r.submitted_at, amount: amt, currency: 'GHS', plan: r.scan_plan });
    } else if (r.payment_method === 'MANUAL') {
      const country = countryForManualSubmission(r.network_or_bank);
      const amt = country === 'NG' ? funds.nairaPriceForScanPlan(r.scan_plan) : scanGHPrice(r);
      if (country === 'NG') ng(amt); else gh(amt);
      push({ type: 'scan', email: r.email, at: r.reviewed_at || r.submitted_at, amount: amt, currency: country === 'NG' ? 'NGN' : 'GHS', plan: r.scan_plan });
    } else {
      un();
      push({ type: 'scan', email: r.email, at: r.reviewed_at || r.submitted_at, amount: null, currency: null, plan: r.scan_plan });
    }
  }
  for (const r of minesRows) {
    planPurchases++;
    const amt = Number(r.amount_cedis) || 0;
    gh(amt);
    push({ type: 'mines', email: r.email, at: r.reviewed_at || r.submitted_at, amount: amt, currency: 'GHS', plan: r.mines_plan });
  }
  for (const r of sessionRows) {
    planPurchases++;
    if (r.country === 'NG') byCountry.nigeria.payments++;
    else if (r.country === 'GH') byCountry.ghana.payments++;
    else if (r.network_or_bank) {
      if (countryForManualSubmission(r.network_or_bank) === 'NG') byCountry.nigeria.payments++;
      else byCountry.ghana.payments++;
    } else un();
    push({ type: 'session', email: r.email, at: r.activated_at, amount: null, currency: null, plan: r.plan });
  }
  for (const r of akwRows) {
    planPurchases++;
    const real = r.paid_amount_cedis != null ? Number(r.paid_amount_cedis) : null;
    const amt = (real != null && real > 0) ? real : ghPrice(r.plan);
    gh(amt);
    push({ type: 'akwapay', email: r.email, at: r.reviewed_at || r.submitted_at, amount: amt, currency: 'GHS', plan: r.plan });
  }
  for (const r of ptRows) {
    planPurchases++;
    const amt = ghPrice(r.plan);
    gh(amt);
    push({ type: 'paystack', email: r.email, at: r.verified_at || r.created_at, amount: amt, currency: 'GHS', plan: r.plan });
  }
  recent.sort((a, b) => new Date(b.at).getTime() - new Date(a.at).getTime());
  const recentTop = recent.slice(0, 8);
  res.json(ok('Monitoring', {
    gatePassesSold,
    planPurchases,
    activeSessions: liveSessions[0].n,
    revenueGhs: byCountry.ghana.depositsGHS,
    revenueNgn: byCountry.nigeria.depositsNGN,
    totalAdmins: adminCount[0].n,
    byCountry,
    recent: recentTop,
  }));
}));

app.get('/api/superadmin/stats', requireSuperAdmin, h(async (req, res) => {
  const today = new Date().toISOString().slice(0, 10);
  const weekStart = new Date(Date.now() - 7 * 24 * 3600 * 1000).toISOString();
  // Same self-healing preamble as the monitoring endpoint: stats reads
  // reviewed_at across the payment rails, and a database where no user
  // registration has ever run skyPayments.ensureSchema yet (or whose
  // tables predate a column) 500s with 'column "reviewed_at" does not
  // exist' before any figure is computed.
  await skyPayments.ensureSchema();
  await skyAccount.ensureSchema();
  await manualPayment.ensureSchema();
  await scanPurchase.ensureSchema();
  const allCommissions = await commission.listAll();
  // Scoped to GHS only — commission_records.currency splits GHS/NGN (see
  // commission.js), and mixing them into one "owed"/"paid" figure would be
  // the same currency-mixing bug fixed everywhere else in this file.
  const ghsCommissions = allCommissions.filter((c) => (c.currency || 'GHS') === 'GHS');
  const ngnCommissions = allCommissions.filter((c) => c.currency === 'NGN');
  const totalCommissionsOwed = ghsCommissions.filter((c) => !c.paidOut).reduce((s, c) => s + c.adminShareCedis, 0);
  const totalCommissionsPaid = ghsCommissions.filter((c) => c.paidOut).reduce((s, c) => s + c.adminShareCedis, 0);
  const totalCommissionsOwedNGN = ngnCommissions.filter((c) => !c.paidOut).reduce((s, c) => s + c.adminShareCedis, 0);
  const totalCommissionsPaidNGN = ngnCommissions.filter((c) => c.paidOut).reduce((s, c) => s + c.adminShareCedis, 0);

  res.json(ok('Platform-wide stats', {
    currency: 'GHS',
    depositsToday: await stats.depositsOn(today),
    paymentsToday: await stats.successfulPaymentCountOn(today),
    depositsThisWeek: await stats.depositsSince(weekStart),
    depositsAllTime: await stats.totalDepositsAllTime(),
    successfulPaymentsAllTime: await stats.successfulPaymentCount(),
    totalCommissionsOwed,
    totalCommissionsPaid,
    totalAdmins: (await admin.listAll()).length,
    // Nigerian (Naira) figures — tracked separately, never added into the
    // GHS numbers above. See stats.js / commission.js for why.
    depositsTodayNGN: await stats.depositsOnNGN(today),
    depositsThisWeekNGN: await stats.depositsSinceNGN(weekStart),
    depositsAllTimeNGN: await stats.totalDepositsAllTimeNGN(),
    // Per-country breakdown (Ghana GHS + Nigeria NGN + unclassified) for
    // today / 7 days / all-time. Amounts reconcile exactly to the legacy
    // GHS/NGN totals above; counts reconcile to the payment counts.
    // See lib/services/stats.js for the classification rules.
    breakdown: {
      today: await stats.breakdownOn(today),
      week: await stats.breakdownSince(weekStart),
      allTime: await stats.breakdownAllTime(),
    },
    totalCommissionsOwedNGN,
    totalCommissionsPaidNGN,
  }));
}));

app.get('/api/superadmin/commissions', requireSuperAdmin, h(async (req, res) => {
  const records = await commission.listAll();
  res.json(ok(`All commission records (${records.length})`, records));
}));

// Super-admin: list all PENDING payout requests (admin-initiated, awaiting review).
app.get('/api/superadmin/payouts/pending', requireSuperAdmin, h(async (req, res) => {
  const records = await commission.pendingPayoutRequests();
  res.json(ok(`Pending payout requests (${records.length})`, records));
}));

// Super-admin: approve a PENDING payout request — marks commissions paid_out.
app.post('/api/superadmin/payouts/:id/approve', requireSuperAdmin, h(async (req, res) => {
  const record = await commission.approvePayoutRequest(req.params.id, req.adminSession.username);
  res.json(ok('Payout request approved. Commissions marked paid.', record));
}));

// Super-admin: reject a PENDING payout request — commissions stay pending.
app.post('/api/superadmin/payouts/:id/reject', requireSuperAdmin, h(async (req, res) => {
  const record = await commission.rejectPayoutRequest(
    req.params.id, req.adminSession.username, req.body && req.body.reason);
  res.json(ok('Payout request rejected.', record));
}));

// Super-admin: direct payout (legacy — bypasses request flow, immediate).
// Keep :adminUsername AFTER the fixed :id routes above so Express matches
// /pending, /uuid/approve, /uuid/reject first before falling to this dynamic segment.
app.post('/api/superadmin/payouts/:adminUsername', requireSuperAdmin, h(async (req, res) => {
  const currency = (req.body && req.body.currency) ? String(req.body.currency).toUpperCase() : 'GHS';
  const record = await commission.payoutAdmin(req.params.adminUsername, req.adminSession.username, currency);
  res.json(ok(`Payout recorded (${currency})`, record));
}));

// ── /api/superadmin/ghana — Web Rabbit Ghana collections (B1) ────────────
// superadmin-ghana.html shipped calling these routes but they never
// existed. The webrabbit_payments / webrabbit_withdrawals tables have been
// in schema.sql (and are already read by funds.js) — these routes serve
// them. NOTE: there is still no Web Rabbit provider client anywhere in
// this codebase, so a withdrawal POST records a PENDING request only; it
// does NOT disburse money. Wire the provider call here before treating a
// submitted withdrawal as sent.
app.get('/api/superadmin/ghana/transactions', requireSuperAdmin, h(async (req, res) => {
  const db = rawSql();
  const rows = await db`SELECT * FROM webrabbit_payments ORDER BY submitted_at DESC LIMIT 500`;
  const mapped = rows.map((t) => ({
    id: t.id, email: t.email, plan: t.plan, amount: Number(t.amount), currency: t.currency || 'GHS',
    subscriberNumber: t.subscriber_number, network: t.network, status: t.status,
    rabbitTransactionId: t.rabbit_transaction_id, submittedAt: t.submitted_at,
  }));
  res.json(ok(`Ghana transactions (${mapped.length})`, { total: mapped.length, rows: mapped }));
}));

app.get('/api/superadmin/ghana/withdrawals', requireSuperAdmin, h(async (req, res) => {
  const db = rawSql();
  const rows = await db`SELECT * FROM webrabbit_withdrawals ORDER BY created_at DESC LIMIT 500`;
  res.json(ok(`Ghana withdrawals (${rows.length})`, rows.map((t) => ({
    id: t.id, amount: Number(t.amount), currency: t.currency || 'GHS',
    subscriberNumber: t.subscriber_number, network: t.network, status: t.status,
    rabbitTransactionId: t.rabbit_transaction_id, createdAt: t.created_at,
  }))));
}));

app.post('/api/superadmin/ghana/withdrawals', requireSuperAdmin, h(async (req, res) => {
  const { recipientName, amount, subscriberNumber, network, description } = req.body || {};
  const amt = Number(amount);
  if (!subscriberNumber || !network || !amt || amt <= 0) {
    throw new ApiError('amount, subscriberNumber and network are required', 400);
  }
  const db = rawSql();
  const { generateId } = require('../lib/util');
  const id = generateId();
  const rows = await db`
    INSERT INTO webrabbit_withdrawals
      (id, amount, currency, subscriber_number, network, description, status, idempotency_key)
    VALUES (${id}, ${amt}, 'GHS', ${String(subscriberNumber)}, ${String(network)},
            ${description ? String(description) : (recipientName ? 'Withdrawal for ' + String(recipientName) : null)},
            'PENDING', ${generateId()})
    RETURNING *`;
  const t = rows[0];
  res.json(ok('Withdrawal recorded as PENDING (provider disbursement is not wired yet)', {
    id: t.id, amount: Number(t.amount), status: t.status,
    rabbitTransactionId: t.rabbit_transaction_id, createdAt: t.created_at,
  }));
}));

app.get('/api/superadmin/payouts', requireSuperAdmin, h(async (req, res) => {
  const records = await commission.allPayouts(req.query.admin);
  res.json(ok(`All payout records (${records.length})`, records));
}));

// ── Platform-wide funds: total, by admin, by payment method, by country (NEW) ─
app.get('/api/superadmin/funds', requireSuperAdmin, h(async (req, res) => {
  const data = await funds.platformFunds();
  res.json(ok('Platform-wide funds breakdown', data));
}));

// ── Day-by-day revenue for the last N days (NEW) ────────────────────────────
// ?days=30 (default 30, max 365). GHS and NGN are kept separate per day —
// see funds.js's dailyFunds() for why they're never summed together.
app.get('/api/superadmin/funds/daily', requireSuperAdmin, h(async (req, res) => {
  const days = req.query.days ? Number(req.query.days) : 30;
  const data = await funds.dailyFunds(days);
  res.json(ok(`Daily funds for the last ${data.days} day(s)`, data));
}));

// ── Every transaction across all 4 payment rails (NEW) ──────────────────────
// Optional query params: ?method=PAYSTACK|MANUAL|MANUAL_SCAN|MANUAL_SCAN_SESSION
app.get('/api/superadmin/transactions', requireSuperAdmin, h(async (req, res) => {
  const { method, status, limit, offset } = req.query;
  const data = await funds.allTransactions({
    method,
    status,
    limit: limit ? Math.min(Number(limit), 1000) : 200,
    offset: offset ? Number(offset) : 0,
  });
  res.json(ok(`All transactions (${data.total} total, showing ${data.count})`, data));
}));

// ── /api/superadmin/simulator — SuperAdminScanSimulatorController.java ────
function simSessionMap(s) {
  const plan = require('../lib/util').SCAN_SESSION_PLAN[s.plan];
  return {
    sessionId: s.id, status: s.status, plan: s.plan, planCode: plan.code,
    amountCedis: plan.amountCedis, durationMinutes: plan.durationMinutes,
    scanCount: s.scanCount, secondsRemaining: superAdminSimulator.secondsRemaining(s),
    paymentStatus: s.paymentStatus,
    paymentMethod: s.paymentMethod, paymentReference: s.paymentReference,
    phone: s.phone, network: s.network, paidAmountCedis: s.paidAmountCedis,
    accountName: s.accountName, accountNumber: s.accountNumber, networkOrBank: s.networkOrBank, reference: s.reference, screenshotUrl: s.screenshotUrl,
    activatedAt: s.activatedAt, expiresAt: s.expiresAt, createdAt: s.createdAt,
    simulatorSession: true,
  };
}
function simResultMap(r) {
  return {
    id: r.id, sessionId: r.purchaseId, scanPlan: r.scanPlan,
    totalPicksDetected: r.totalPicksDetected, picksAnalyzed: r.picksAnalyzed,
    coverageNote: r.coverageNote, predictions: r.predictions || [],
    ...(r.rawModelOutput ? { rawModelOutput: r.rawModelOutput, rawOutputNote: 'AI could not parse structured picks — raw output included' } : {}),
    createdAt: r.createdAt, simulatorResult: true,
  };
}

app.post('/api/superadmin/simulator/create-session', requireSuperAdmin, h(async (req, res) => {
  const planCode = (req.body && req.body.planCode) || 'SESSION_500';
  const s = await superAdminSimulator.createSimulatorSession(planCode, req.body || {});
  res.json(ok('Simulator session created', simSessionMap(s)));
}));

app.post('/api/superadmin/simulator/approve-payment/:sessionId', requireSuperAdmin, h(async (req, res) => {
  const s = await superAdminSimulator.approveSimulatorPayment(req.params.sessionId);
  res.json(ok('Simulated payment approved — payment settled, session is now ACTIVE', simSessionMap(s)));
}));

app.post('/api/superadmin/simulator/fail-payment/:sessionId', requireSuperAdmin, h(async (req, res) => {
  const s = await superAdminSimulator.failSimulatorPayment(req.params.sessionId);
  res.json(ok('Simulated payment rejected — payment FAILED', simSessionMap(s)));
}));

app.post('/api/superadmin/simulator/scan/:sessionId', requireSuperAdmin, h(async (req, res) => {
  const { imageBase64, imageContentType } = req.body || {};
  const r = await superAdminSimulator.analyzeSlip(req.params.sessionId, imageBase64, imageContentType || 'image/jpeg');
  res.json(ok('Scan complete', simResultMap(r)));
}));

// ── /api/superadmin/userflow-simulator — SUPERADMIN USER-FLOW SIMULATOR ──
// Staff-only QA tool on the VirtuWinUi simulation pattern, for the WHOLE
// user journey (not the scan): a simulated identity browses the real
// games lobby, pays with a SIMULATED manual payment (no real money, no
// ImgBB, no real approval queue), gets a 45-minute simulated window,
// and plays the real game engines. All state lives in the sim_* tables;
// nothing here ever touches real users, wallets, queues or windows.
// (Kept apart from /api/superadmin/simulator/*, which is the SCAN
// simulator and must keep working untouched.)
app.post('/api/superadmin/userflow-simulator/start', requireSuperAdmin, h(async (req, res) => {
  const run = await simulator.startRun(req.adminSession.username);
  res.json(ok('Simulator run started (SIMULATED)', run));
}));

app.post('/api/superadmin/userflow-simulator/pay', requireSuperAdmin, h(async (req, res) => {
  const { runId, game, details } = req.body || {};
  const payment = await simulator.simPay(runId, game, details || {});
  res.json(ok('Simulated payment submitted (SIMULATED — no real money)', payment));
}));

app.post('/api/superadmin/userflow-simulator/approve', requireSuperAdmin, h(async (req, res) => {
  const { paymentId } = req.body || {};
  const result = await simulator.simApprove(paymentId);
  res.json(ok('Simulated payment approved — simulated window active (SIMULATED)', result));
}));

app.post('/api/superadmin/userflow-simulator/decline', requireSuperAdmin, h(async (req, res) => {
  const { paymentId } = req.body || {};
  const result = await simulator.simDecline(paymentId);
  res.json(ok('Simulated payment declined — nothing granted (SIMULATED)', result));
}));

app.get('/api/superadmin/userflow-simulator/entitlement', requireSuperAdmin, h(async (req, res) => {
  const run = await simulator.getRun(String(req.query.runId || ''));
  res.json(ok('Simulator entitlement (SIMULATED)', await simulator.simEntitlement(run.sim_identity)));
}));

app.post('/api/superadmin/userflow-simulator/expire', requireSuperAdmin, h(async (req, res) => {
  const { runId } = req.body || {};
  res.json(ok('Simulator run expired', await simulator.expireRun(runId)));
}));

// Simulated scan on the REAL AI pipeline — sim tables only, SA-gated.
// The /simulator/scan-slip page runs the same staged pipeline as the
// real /scan-slip (transcribe -> gapfill -> verify -> finalize), but
// every gate, consume and store lands on sim_scan_access / sim_scans.
// No stage consumes; only finalize consumes one sim scan, after a
// completed analysis — failed or cancelled sim scans consume nothing.
// Nothing here reads or writes real purchases, grants or results.
function simStagePicks(req) {
  const raw = req.body?.picks;
  if (typeof raw === 'string') {
    try {
      const v = JSON.parse(raw);
      if (Array.isArray(v)) return v;
    } catch { /* fall through to the 400 below */ }
    throw new ApiError('picks must be a JSON array', 400);
  }
  if (Array.isArray(raw)) return raw;
  throw new ApiError('picks must be a JSON array', 400);
}

function simStageTotal(req) {
  const t = Number(req.body?.totalPicksDetected);
  return Number.isFinite(t) && t >= 0 ? t : 0;
}

app.post('/api/superadmin/userflow-simulator/scan/stage/transcribe', requireSuperAdmin, upload.single('image'), h(async (req, res) => {
  const { runId } = req.body || {};
  if (!runId) throw new ApiError('runId is required', 400);
  if (!req.file) throw new ApiError('An image file is required', 400);
  res.json(ok('Teams read', await simScanService.transcribeStage(runId, req.file.buffer, req.file.mimetype)));
}));

app.post('/api/superadmin/userflow-simulator/scan/stage/gapfill', requireSuperAdmin, upload.single('image'), h(async (req, res) => {
  const { runId } = req.body || {};
  if (!runId) throw new ApiError('runId is required', 400);
  if (!req.file) throw new ApiError('An image file is required', 400);
  const picks = simStagePicks(req);
  res.json(ok('Gaps filled', await simScanService.gapFillStage(runId, req.file.buffer, req.file.mimetype, picks, simStageTotal(req))));
}));

app.post('/api/superadmin/userflow-simulator/scan/stage/verify', requireSuperAdmin, upload.single('image'), h(async (req, res) => {
  const { runId } = req.body || {};
  if (!runId) throw new ApiError('runId is required', 400);
  if (!req.file) throw new ApiError('An image file is required', 400);
  const picks = simStagePicks(req);
  const servingModel = typeof req.body?.servingModel === 'string' ? req.body.servingModel : null;
  res.json(ok('Teams double-checked', await simScanService.verifyStage(runId, req.file.buffer, req.file.mimetype, picks, simStageTotal(req), servingModel)));
}));

app.post('/api/superadmin/userflow-simulator/scan/stage/finalize', requireSuperAdmin, h(async (req, res) => {
  const { runId, predictions, slipName } = req.body || {};
  if (!runId) throw new ApiError('runId is required', 400);
  res.json(ok('Scan complete', await simScanService.finalizeStage(runId, predictions, simStageTotal(req), slipName)));
}));

app.get('/api/superadmin/userflow-simulator/scans', requireSuperAdmin, h(async (req, res) => {
  const run = await simulator.getRun(String(req.query.runId || ''));
  res.json(ok('Scan history (SIMULATED)', await simulator.listSimScans(run.sim_identity)));
}));

app.get('/api/superadmin/userflow-simulator/runs', requireSuperAdmin, h(async (req, res) => {
  res.json(ok('Simulator runs (SIMULATED)', await simulator.listRuns()));
}));

app.get('/api/superadmin/simulator/sessions', requireSuperAdmin, h(async (req, res) => {
  const list = (await superAdminSimulator.listSimulatorSessions()).map(simSessionMap);
  res.json(ok(`Simulator sessions (${list.length})`, list));
}));

app.get('/api/superadmin/simulator/results', requireSuperAdmin, h(async (req, res) => {
  const list = (await superAdminSimulator.listSimulatorResults()).map(simResultMap);
  res.json(ok(`Simulator scan results (${list.length})`, list));
}));

app.get('/api/superadmin/simulator/plans', requireSuperAdmin, h(async (req, res) => {
  res.json(ok('Available scan session plans', superAdminSimulator.listPlans()));
}));

app.get('/api/superadmin/simulator/session/:sessionId', requireSuperAdmin, h(async (req, res) => {
  res.json(ok('Simulator session', simSessionMap(await superAdminSimulator.getSimulatorSession(req.params.sessionId))));
}));

app.post('/api/superadmin/simulator/expire/:sessionId', requireSuperAdmin, h(async (req, res) => {
  const s = await superAdminSimulator.expireSession(req.params.sessionId);
  res.json(ok('Session expired', simSessionMap(s)));
}));

// ── /api/admin/simulator — Admin scan simulator ───────────────────────────
// Admins use the same simulator service and session lifecycle as super admins,
// but authenticate through the regular admin guard and their own route prefix.
app.post('/api/admin/simulator/create-session', requireAdmin, h(async (req, res) => {
  const planCode = (req.body && req.body.planCode) || 'SESSION_500';
  const s = await superAdminSimulator.createSimulatorSession(planCode, req.body || {});
  res.json(ok('Simulator session created', simSessionMap(s)));
}));

app.post('/api/admin/simulator/approve-payment/:sessionId', requireAdmin, h(async (req, res) => {
  const s = await superAdminSimulator.approveSimulatorPayment(req.params.sessionId);
  res.json(ok('Simulated payment approved — payment settled, session is now ACTIVE', simSessionMap(s)));
}));

app.post('/api/admin/simulator/fail-payment/:sessionId', requireAdmin, h(async (req, res) => {
  const s = await superAdminSimulator.failSimulatorPayment(req.params.sessionId);
  res.json(ok('Simulated payment rejected — payment FAILED', simSessionMap(s)));
}));

app.post('/api/admin/simulator/scan/:sessionId', requireAdmin, h(async (req, res) => {
  const { imageBase64, imageContentType } = req.body || {};
  const r = await superAdminSimulator.analyzeSlip(req.params.sessionId, imageBase64, imageContentType || 'image/jpeg');
  res.json(ok('Scan complete', simResultMap(r)));
}));

// ============================================================================
// /api/scan/payment — ScanPurchaseController.java (manual AI-scan purchase)
// ============================================================================
app.get('/api/scan/payment/plans', h(async (req, res) => {
  const list = Object.values(SCAN_PLAN).map((p) => ({
    code: p.code, name: p.name, amountCedis: p.amountCedis, maxPicks: p.maxPicks < 0 ? 'FULL' : p.maxPicks,
  }));
  res.json(ok('Available AI scan plans', list));
}));

app.post('/api/scan/payment/submit', h(async (req, res) => {
  const { email, plan, accountName, accountNumber, networkOrBank, reference, screenshotUrl } = req.body || {};
  const ip = req.headers['x-forwarded-for'] || req.socket.remoteAddress || '';
  const purchase = await scanPurchase.submit(email, plan, accountName, accountNumber, networkOrBank, reference, screenshotUrl, String(ip).split(',')[0].trim());
  const pl = SCAN_PLAN[purchase.scanPlan];
  res.json(ok('Scan payment proof submitted', {
    id: purchase.id, status: purchase.status, scanPlan: purchase.scanPlan,
    maxPicks: pl.maxPicks < 0 ? 'FULL' : pl.maxPicks, submittedAt: purchase.submittedAt,
    message: 'Submitted, awaiting admin review. Check status with GET /api/scan/payment/status/{id}.',
  }));
}));

app.get('/api/scan/payment/status/:id', h(async (req, res) => {
  const purchase = await scanPurchase.getById(req.params.id);
  const pl = SCAN_PLAN[purchase.scanPlan];
  const gs = scanPurchase.grantState(purchase);
  const data = {
    id: purchase.id, status: purchase.status, scanPlan: purchase.scanPlan,
    maxPicks: pl.maxPicks < 0 ? 'FULL' : pl.maxPicks, submittedAt: purchase.submittedAt, reviewedAt: purchase.reviewedAt,
    scansUsed: gs.scansUsed, scansMax: gs.scansMax, scansLeft: gs.scansLeft,
    windowStartedAt: gs.windowStartedAt, windowExpiresAt: gs.windowExpiresAt, grantState: gs.state, secondsLeft: gs.secondsLeft,
  };
  if (purchase.status === 'REJECTED') data.rejectionReason = purchase.rejectionReason;
  else if (purchase.status === 'APPROVED') data.message = 'Approved! Submit your slip image to POST /api/scan/analyze with this purchase id.';
  else if (purchase.status === 'USED') { data.usedAt = purchase.usedAt; data.message = 'All 10 scans on this purchase have been used.'; }
  res.json(ok('Scan payment status', data));
}));

// Grant state for /scan-slip: the next-to-consume grant + the named
// purchase's own state + email-wide totals. Public like the status
// endpoint (keyed by email + purchase id, no account gate — Analyze
// lookups were never account-gated).
app.get('/api/scan/grant', h(async (req, res) => {
  const email = req.query.email;
  if (!email) throw new ApiError('email is required', 400);
  res.json(ok('Scan grant state', await scanPurchase.grantSummaryForEmail(email, req.query.purchaseId || null)));
}));

// ============================================================================
// /api/scan — ScanController.java (run the AI analysis)
// ============================================================================
function pickResponseMap(p) {
  return {
    sectionIndex: p.sectionIndex, matchLabel: p.matchLabel, originalPick: p.originalPick,
    prediction: p.prediction, confidence: p.confidence, analysis: p.analysis,
    verification: p.verification, verificationNote: p.verificationNote,
    recovered: p.recovered === true,
  };
}
function scanResultResponse(r) {
  const m = {
    id: r.id, purchaseId: r.purchaseId, email: r.email, scanPlan: r.scanPlan,
    totalPicksDetected: r.totalPicksDetected, picksAnalyzed: r.picksAnalyzed, coverageNote: r.coverageNote,
    predictions: (r.predictions || []).map(pickResponseMap),
  };
  if (r.credits) m.credits = r.credits;
  if (r.grant) m.grant = r.grant;
  if (r.rawModelOutput) {
    m.rawModelOutput = r.rawModelOutput;
    m.note = 'AI response could not be parsed into structured picks - raw output included instead.';
  }
  m.createdAt = r.createdAt;
  return m;
}

app.post('/api/scan/analyze', upload.single('image'), h(async (req, res) => {
  const { purchaseId, email } = req.body || {};
  if (!purchaseId || !email) throw new ApiError('purchaseId and email are required', 400);
  if (!req.file) throw new ApiError('An image file is required', 400);
  const result = await scanService.analyze(purchaseId, email, req.file.buffer, req.file.mimetype);
  res.json(ok('Scan complete', scanResultResponse(result)));
}));

// --- Staged scan pipeline (async, past the 60s function wall) --------
// The single-call /api/scan/analyze above can run ~110s on dense slips,
// which Vercel kills at 60s with no result. These stages split it so
// each invocation stays comfortably under 60s; the client orchestrates
// and shows real stage progress. Same gates as analyze (purchase
// ownership + grant validity per stage, no token auth — exactly like
// analyze); no stage consumes, only finalize consumes, after a
// completed analysis.
function parseStagePicks(req) {
  const raw = req.body?.picks;
  if (typeof raw === 'string') {
    try {
      const v = JSON.parse(raw);
      if (Array.isArray(v)) return v;
    } catch { /* fall through to the 400 below */ }
    throw new ApiError('picks must be a JSON array', 400);
  }
  if (Array.isArray(raw)) return raw;
  throw new ApiError('picks must be a JSON array', 400);
}

function parseStageTotal(req) {
  const t = Number(req.body?.totalPicksDetected);
  return Number.isFinite(t) && t >= 0 ? t : 0;
}

app.post('/api/scan/stage/transcribe', upload.single('image'), h(async (req, res) => {
  const { purchaseId, email } = req.body || {};
  if (!purchaseId || !email) throw new ApiError('purchaseId and email are required', 400);
  if (!req.file) throw new ApiError('An image file is required', 400);
  res.json(ok('Teams read', await scanService.transcribeStage(purchaseId, email, req.file.buffer, req.file.mimetype)));
}));

app.post('/api/scan/stage/gapfill', upload.single('image'), h(async (req, res) => {
  const { purchaseId, email } = req.body || {};
  if (!purchaseId || !email) throw new ApiError('purchaseId and email are required', 400);
  if (!req.file) throw new ApiError('An image file is required', 400);
  const picks = parseStagePicks(req);
  res.json(ok('Gaps filled', await scanService.gapFillStage(purchaseId, email, req.file.buffer, req.file.mimetype, picks, parseStageTotal(req))));
}));

app.post('/api/scan/stage/verify', upload.single('image'), h(async (req, res) => {
  const { purchaseId, email } = req.body || {};
  if (!purchaseId || !email) throw new ApiError('purchaseId and email are required', 400);
  if (!req.file) throw new ApiError('An image file is required', 400);
  const picks = parseStagePicks(req);
  const servingModel = typeof req.body?.servingModel === 'string' ? req.body.servingModel : null;
  res.json(ok('Teams double-checked', await scanService.verifyStage(purchaseId, email, req.file.buffer, req.file.mimetype, picks, parseStageTotal(req), servingModel)));
}));

app.post('/api/scan/stage/finalize', h(async (req, res) => {
  const { purchaseId, email, predictions } = req.body || {};
  if (!purchaseId || !email) throw new ApiError('purchaseId and email are required', 400);
  const result = await scanService.finalizeStage(purchaseId, email, predictions, parseStageTotal(req));
  res.json(ok('Scan complete', scanResultResponse(result)));
}));

app.get('/api/scan/result/:id', h(async (req, res) => {
  res.json(ok('Scan result', scanResultResponse(await scanService.getById(req.params.id))));
}));

app.get('/api/scan/history', h(async (req, res) => {
  const email = req.query.email;
  if (!email) throw new ApiError('email is required', 400);
  const list = (await scanService.listForEmail(email)).map(scanResultResponse);
  res.json(ok(`Scan history for ${email}`, list));
}));

// ============================================================================
// /api/scan/session — ScanSessionController.java (timed unlimited-scan sessions)
// ============================================================================
app.get('/api/scan/session/plans', h(async (req, res) => {
  res.json(ok('Available scan session plans', scanSession.listPlans()));
}));

// Manual timed-session submissions — Ghana and Nigeria alike: transfer
// the session amount to the published receiving details, submit proof
// here, and an admin activates the session from the review queue.
app.post('/api/scan/session/submit', h(async (req, res) => {
  const { email, plan, accountName, accountNumber, networkOrBank, reference, screenshotUrl } = req.body || {};
  const ip = req.headers['x-forwarded-for'] || req.socket.remoteAddress || '';
  const payment = await manualScanSession.submit({ email, planCode: plan, accountName, accountNumber, networkOrBank, reference, screenshotUrl, ipAddress: String(ip).split(',')[0].trim() });
  res.status(202).json(ok('Timed scan payment proof submitted, awaiting admin review', { sessionId: payment.sessionId, id: payment.id, status: payment.status, plan: payment.plan, submittedAt: payment.submittedAt, message: 'Submitted. Save this session id and check its status while approval is pending.' }));
}));

app.get('/api/scan/session/status/:sessionId', h(async (req, res) => {
  res.json(ok('Manual scan session status', await manualScanSession.status(req.params.sessionId)));
}));

app.post('/api/scan/session/analyze', upload.single('image'), h(async (req, res) => {
  const { sessionId, email } = req.body || {};
  if (!sessionId || !email) throw new ApiError('sessionId and email are required', 400);
  if (!req.file) throw new ApiError('An image file is required', 400);
  const result = await scanSession.analyze(sessionId, email, req.file.buffer, req.file.mimetype || 'image/jpeg');
  res.json(ok('Scan complete', result));
}));

// Public build marker for the deploy-version watcher. A tab opened
// before a redeploy runs the old client bundle until it reloads; the
// watcher compares the boot chunk, but a deploy that only touches
// route chunks (e.g. a scan-page fix) leaves the boot chunk unchanged
// and the tab would run stale route code against the new API forever
// (that is how a live countdown read 49:54 on a 45-minute window after
// the reset had already landed: new server behavior, old client chunk).
// This endpoint lets the watcher detect ANY redeploy: the client build
// SHA is injected at build time (vite define from VERCEL_GIT_COMMIT_SHA)
// and the server reports the deployment's SHA. A SHA is not sensitive
// (it names a commit, nothing more). When either side is 'dev' (local
// builds, or a host that does not expose the SHA at runtime) the
// watcher skips the check — never a reload loop, never a false reload.
// ── /api/virtuals/** — Instant Virtuals (real virtual football) ──────────
app.use('/api/virtuals', virtualsRouter);

app.get('/api/version', (req, res) => {
  res.json(ok('SignalVault build', { build: process.env.VERCEL_GIT_COMMIT_SHA || 'dev' }));
});

// ============================================================================
// Fallback 404 + error handlers (GlobalExceptionHandler.java equivalent)
// ============================================================================
app.use('/api', (req, res) => {
  res.status(404).json(fail('Not found: ' + req.method + ' ' + req.originalUrl));
});

// Multer / body-parser errors land here
app.use((err, req, res, next) => {
  if (err && err.code === 'LIMIT_FILE_SIZE') {
    return res.status(413).json(fail('Image is too large. Please choose an image smaller than 10 MB.'));
  }
  if (err && (err.type === 'entity.too.large' || err.status === 413)) {
    return res.status(413).json(fail('Request is too large. Please upload an image smaller than 10 MB.'));
  }
  const status = err instanceof ApiError ? err.status : err.status || 400;
  if (status >= 500) console.error(err);
  res.status(status).json(fail(err.message || 'Something went wrong'));
});

module.exports = app;
 
