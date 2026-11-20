# SignalVault — Pre-Launch Double-Check (Full Live, No Demo)

**Date:** Thu 22 Oct 2026, ~23:00 GMT · **Scope:** repo tree at `~/workspace/darkweb` (remote main `241d5924` + the 3 audit fixes below, which are local until the next snapshot push) · **Method:** source sweep, production build as Vercel runs it, and a live smoke test of the real API + production frontend against a **fresh, empty** database with zero seeds.

## VERDICT: READY-WITH-FIXES — code is clean; do NOT deploy until the 5 launch gates below clear

The product code contains **no demo accounts, no seeded data, no mock data paths**, and the full money flow (register → manual submit → admin approve → login) proves out on an empty database. Three demo leftovers found in this audit were fixed on the spot. What stands between here and launch is inputs, not code: the binary assets, a one-time database step, the production env vars, one security scrub, and pushing this audit's fixes.

### Launch gates (hard blockers in practice)

1. **Binaries must land in the GitHub repo before Vercel builds.** Locally every binary exists; remote `main` has none of them (text-only push route). A deploy today succeeds but ships naked — see §3 for exactly what breaks.
2. **Run `lib/schema.sql` once against the production Neon database before first deploy.** The app does **not** create its core tables on boot (only `platform_settings`, `sky_users`, `game_passes`, `custom_rounds`, `login_attempts` self-create). Proven in smoke phase 0: empty DB without the schema → register returns 500 `relation "sessions" does not exist`. The file's own header documents the step; it is idempotent and safe to re-run.
3. **Set the required production env vars** (full table in §2). The two that silently kill the business if missed: `IMGBB_API_KEY` (without it, **no manual payment can be submitted** — a proof screenshot is mandatory and the upload endpoint 503s) and `SUPERADMIN_USERNAME`/`SUPERADMIN_PASSWORD` (without them, no super admin can ever exist).
4. **Scrub `.env.example` and rotate the database password.** `.env.example` is tracked in git and contains a **real Neon connection string** and non-placeholder super-admin username/password values (pattern-checked during this audit without printing values; no `example`/`placeholder` markers present). Replace with placeholders and rotate the Neon password before relying on that database in production.
5. **Push this audit's 3 fixes** (they are in the local tree, not yet on remote main): login-page demo-credential banners removed ×2, OpenRouter referer fallback corrected ×1. Details in §1.

---

## 1. Zero demo data in what ships

**Demo rig separation — confirmed.** Everything demo lives in `~/workspace/darkweb-demo/` (harness, seeds, demo credentials) — a sibling directory, not the repo. Nothing from it is inside `~/workspace/darkweb` or the build output.

**Sweeps (source + fresh build):**

| Check | Result |
|---|---|
| `demouser`, `demo@darkweb.test`, `DemoUser123`, `DemoAdmin`, `DemoSuper`, "walk user" in `src/ api/ lib/` | **0 hits** |
| Same strings in the production build output (`.output`) | **0 hits** |
| Seed INSERTs in `lib/schema.sql` / migrations | **None** — schema is DDL only (30 tables) |
| Mock/stub data paths | **None.** `MOCK_API_URL` exists only as an SSR loader override in `src/lib/api.ts` (`loaderApiBase()`); unset in production it falls through to `APP_FRONTEND_BASE_URL`. No fixture/sample data feeds any page; AI scan has **no fallback picks** — with no provider key it throws an explicit "AI scanning not configured" error |
| Default/fallback credentials in auth code | **None.** Admin/super-admin login is DB-only (`adminAuth.login`); bootstrap creates the first SA **only** from `SUPERADMIN_USERNAME`/`SUPERADMIN_PASSWORD` env — if unset it creates nothing (no hardcoded fallback) |
| Demo payment placeholders | **None.** Defaults are Chuks's real receiving details (verified live in §4) |

**Found and FIXED in this audit (local tree; gate 5 above):**

- `src/routes/admin.login.tsx` — a banner printed *"Demo admin — user `admin@demo` · pass `demo1234`"* on the public admin login page. Display-only (smoke test proves those credentials return 401 — they exist nowhere in the backend), but pure demo data on a user surface. Banner replaced with a clean "New admins are created by the super admin." note.
- `src/routes/superadmin.login.tsx` — same pattern: *"Demo defaults — user `superadmin@skypredictor.com` · pass `DarkWeb2026!`"*. Also display-only and non-functional (401 in smoke), also removed entirely.
- `lib/services/ai.js` — OpenRouter `HTTP-Referer` fallback was the leftover `https://virtuwin.vercel.app`; now falls back to `APP_FRONTEND_BASE_URL`, then `https://www.predatorgh.xyz`.

**Known items for Chuks's call (not demo-rig data, inherited product behaviour):**

- **"Players online" counts are synthetic.** `src/routes/predictor/index.tsx` generates a stable per-game number (800–9,800) from a hash of the game id — the code comment literally reads *"stable demo players online"*. These are not real user counts; the source products did the same. Left as-is; his call whether they stay.
- **Demo-labelled copy remains in the predictor tools** (inherited SkyPredictor framing, cosmetic): a "Demo data" badge in the predictor terminal, "demo money" badge on the AutoFollow paper-trading feature, analytics disclaimers ("demo dataset", "demo keeper model"), predictor settings ("Demo round generator", "Not built in demo"), and an error string ("The demo API may be unreachable"). None expose data, credentials, or access. The history page's "stored in this demo session" copy reflects a real limitation: **predictor analysis history is an in-memory array in the API process (cap 200), not persisted** — on serverless it resets per instance. Scan results, by contrast, ARE persisted in the database.
- **Admin simulators stay in the product** (`UserFlowSimulator`, `superAdminSimulator`): staff-only QA tools whose records are explicitly written as `payment_method='SIMULATED'`. Not user-facing, no demo accounts involved. Flagged so he can decide whether they remain enabled in production.
- **Repo hygiene (not in the build):** root-level `walkthrough.mjs`, `probe-*.mjs`, `shots*.mjs`, `previews/`, `hero-options/`, `gateway.mjs` exist in the local tree (only `local-server.js` is git-tracked among them). Vite never bundles them; they do not reach users.

## 2. Full-live integration checklist

### Environment variables (every var the code reads)

**Required — production breaks or degrades without them:**

| Var | Purpose | If missing |
|---|---|---|
| `DATABASE_URL` (or `POSTGRES_URL`) | Neon Postgres via HTTP driver (`lib/db.js`) | Throws on first query — nothing works |
| `SUPERADMIN_USERNAME` + `SUPERADMIN_PASSWORD` | First super admin, created lazily on first request (`lib/bootstrap.js`) | No super admin can ever be created; admin side is dead |
| `APP_FRONTEND_BASE_URL` | SSR loader base (`loaderApiBase`) + admin referral links (`frontendBaseUrl`) | SSR loaders fall back to `http://127.0.0.1:8080` / referral links to `http://localhost:3000` — hard page loads and referral links break |
| `IMGBB_API_KEY` | Proof-screenshot uploads (`POST /api/upload` → ImgBB; the returned URL is stored on the submission) | Uploads 503 with a clear message — and since a screenshot is **mandatory** on manual submit, **all manual payments stop** |
| At least one AI key: `AI_OPENROUTER_API_KEYS` (or `AI_OPENROUTER_API_KEY`), `AI_GEMINI_API_KEYS`, `AI_CLOUDFLARE_ACCOUNTS` | Slip-scan providers (`lib/services/ai.js`, CSV lists) | Scan analysis fails with an explicit "not configured" error (no fake results, no silent demo mode) |

**Optional — sane defaults exist:**

| Var | Default |
|---|---|
| `CRON_SECRET` | Unset = `/api/cron/reconcile` is **unauthenticated**. Impact is low (the sweep only expires stale login sessions) but set it — Vercel Cron sends it automatically |
| `ADMIN_SESSION_DURATION_HOURS` | 12 |
| `ACCOUNT_PASSWORD_LENGTH` | 10 (length of the login password issued on payment approval) |
| `REFERRAL_DEFAULT_ADMIN_SHARE_PERCENT` | 30 |
| `APP_PLATFORM_FRONTEND_URL` | Only the OpenRouter referer label |
| `MOCK_API_URL` | **Do not set in production** — SSR override for local rigs only |

**Dead vars (in the 21 Oct list / `.env.example`, no longer read by the code):** `BOOTSTRAP_KEY` (zero references in the tree — first SA is purely the env pair above), `AI_GEMINI_FALLBACK_MODELS`, `AI_ATTEMPT_TIMEOUT_SECONDS` (timeout is a hardcoded 6s constant), `APP_SHINOBIPAY_*` (gateway removed), `VITE_API_BASE_URL` (the frontend reads no build-time env at all). `.env.example` still lists the ShinobiPay pair — stale doc, worth a tidy.

### Wiring

- **Database:** Neon over the HTTP driver (serverless-safe). Schema = gate 2 (one manual run of `lib/schema.sql`); afterwards, per-service `ensureSchema()` calls cover the 5 self-creating tables.
- **Superadmin bootstrap:** middleware on every API request calls `ensureSuperAdminBootstrapped()` — cheap no-op once the SA exists. ✔
- **Cron:** `vercel.json` declares `/api/cron/reconcile` every 5 minutes; the handler now only expires stale sessions (payments settle by admin review, never automatically). ✔ wired
- **Uploads:** browser → `POST /api/upload` (multer, 10 MB cap) → ImgBB → URL stored on the payment row. No local file storage. ✔ (depends on `IMGBB_API_KEY`)
- **Auth/sessions:** user + admin sessions are DB-backed tokens; login rate limiting is DB-backed (5 fails / 15 min → 429), so it works across serverless instances. ✔
- **Payments:** fully manual — Ghana MoMo + Nigeria bank transfer for all 5 purchase types; country derived server-side from the network/bank label; approve activates exactly once (double-approve → 409). Gateway code is gone (routes 404). ✔
- **Degraded/demo-mode traps in production:** none found beyond the env fallbacks tabled above. No feature silently substitutes sample data.

## 3. Production build

- `bun run build` (exactly Vercel's path, default **cloudflare-module** preset) — **passes** (~17s). `.output` greps clean for all demo strings (§1).
- **Missing-binaries impact — what breaks on day one if deployed from GitHub main before the binaries land:**
  - `/fonts/f1–f18.woff2` 404 → all self-hosted fonts fall back; **`f13.woff2` is the Material Symbols icon font — every icon sitewide breaks and renders as raw words.** This is the single most visible breakage.
  - `/videos/aviator-bg.mp4`, `sportyjet-bg.mp4`, `sportyhero-bg.mp4` 404 → the three crash-game pages lose their animated backgrounds.
  - `/games/*` art 404 → **every lobby tile poster broken**: Aviator, Sporty Jet, SportyHero, SportyKick, Super Hero, Mines, Spin da Bottle, and the Instant Virtuals tile.
  - `/hero-a.webp` 404 → homepage hero photo missing. `favicon.ico` 404 (the SVG favicon is text and ships fine). `src/assets/hero.jpg` is unreferenced by the code, so its absence cannot fail the build.
  - The build itself **succeeds** without them (public assets are copied as-is, nothing imports them at build time) — Vercel would happily deploy the naked site, which is why this is gate 1.

## 4. Live smoke — production code, fresh empty database, zero seeds

Harness: the real `api/index.js` over a fresh in-memory PGlite (the Neon driver is swapped the same way the demo rig does it, but with **no seed block at all**); SA supplied only via env with throwaway test values; no AI keys, no ImgBB key, no cron secret — production-with-missing-optional-env conditions.

**Phase 0 — schema step skipped (blocker proof):** register → **500** `relation "sessions" does not exist`. Confirms gate 2 is real.

**Phase 1 — schema applied (the documented step), 20 checks:**

- ✅ Demo/default credentials all rejected with 401: `demouser`, `admin@demo`/`demo1234`, `superadmin@skypredictor.com`/`DarkWeb2026!` — no demo users exist on a fresh DB
- ✅ Super admin bootstraps from env alone and logs in
- ✅ Casino-side register + login (username/password) works
- ✅ `GET /api/payment/details` returns the **real** details — Ghana: KINSMAN SUSU VENTURES-SEKONDI, MoMo 0541568542 · Nigeria: Access Bank, 1945116494, Amadi Victor Chinaemeze
- ✅ Full subscription money path: email register → manual submit → **PENDING** → visible in admin pending queue → approve → **APPROVED** with the account login password issued → the paid user logs in with that password → **double-approve blocked (409)**
- ✅ Upload without `IMGBB_API_KEY` → clean **503** naming the missing var (proves the gate-3 requirement, fails safe not silent)
- One test-design note: submitting a subscription payment under a *casino* username account is correctly rejected 409 "not registered yet" — the subscription flow keys on the email account, exactly as the product's two account systems are designed.

**Frontend:** the production build was also booted locally (node-server preset used for the local boot only; the cloudflare build above is what Vercel runs) — `/`, `/login`, `/pricing`, `/scan` all **200**, correct page title, and pricing shows the single-plan copy ("The Premium pass", no plan-chooser language).

---

### Bottom line for the launch decision

Code: **ready** — no demo data, no demo mode, full flow proven on an empty database. Launch inputs outstanding: **(1)** binaries into the repo, **(2)** `schema.sql` run once on the production database, **(3)** required env vars set (database, super-admin pair, frontend base URL, ImgBB key, one AI key set, cron secret), **(4)** `.env.example` scrubbed + database password rotated, **(5)** this audit's 3 small fixes pushed. Clear those five and SignalVault goes fully live with nothing demo about it.
