# SignalVault — VirtuWin Games Audit (port blueprint)

**Date:** 21 Oct 2026 · **Phase:** AUDIT ONLY — no code changed in either project.
**Order from Chuks:** scan the games in the VirtuWin UI repo (everything, full flow), then port them into SignalVault with the admin + superadmin sides fully updated too. This document is the blueprint for that port.

## 0. Sources & method

- **Source of truth: `Cyril-dot/virtuwinUi` (`master`)** — the standalone VirtuWin product repo (private, last updated 20 Oct 2026). Audited via the local snapshot `~/workspace/virtuwin-pycue/repo` (the Oct-20 Pycue-migration working copy), **verified against live `master`**: `lib/services/` on GitHub matches the snapshot file-for-file.
- `~/workspace/virtuwinUi-scan/` (FRONTEND_MAP.md / BACKEND_MAP.md) was used as a cross-check only — it is a **ShinobiPay-era** scan and is stale wherever the Pycue migration touched the code. Where the maps and the live source disagree, the live source wins and the delta is noted.
- **Correction to a standing memory:** the "Round Customization" feature (next-10 crash multipliers, `lib/services/customRounds.js`) does **not** exist in live virtuwinUi — it exists in **SignalVault already** (arrived via the SkyPredictor lineage, which forked an evolved copy of this backend). VirtuWin's only round-pinning is for Spin da Bottle (§2.2). Treat SignalVault's custom-rounds as canonical; do not "port" it back.
- SignalVault state audited at `~/workspace/darkweb` (frontend `src/`, backend repo-root `api/` + `lib/`).

## 1. VirtuWin's access model (the frame every game hangs on)

VirtuWin is **not** a casino — it sells timed access to predictor tools, Ghana + Nigeria only.

1. **Games-access gate (one-time, lifetime):** GHS 50 (Ghana) / ₦10,000 (Nigeria). Ghana pays by MoMo prompt; Nigeria by manual bank-proof with superadmin review. Approval issues a 64-hex `access_token` (localStorage `grok_games_token`, sent as `X-Games-Access-Token` header). Gates the scan APIs and the game pages.
2. **Timed subscription plans** (buy on `games.html`, the hub): `TWO_HOUR` GHS 250 / `THREE_HOUR` GHS 350 / `FIVE_HOUR` GHS 750 (Nigeria ₦20,000/40,000/60,000). On approval the user gets a **one-time-revealed login password**; the usage timer starts at **first login**, not at payment. Single-session enforcement: a second login returns 409. Session countdown via `GET /api/protected/status` (user Bearer token), polled every 30 s on game pages.
3. **Current payment rails (live, post-Pycue):** Ghana = **Pycue** MoMo prompts (no webhooks — lazy status polling + cron reconcile) for subscriptions, mines, scan purchases, scan sessions (`pycue*.js` services; `/api/payment/pycue/init|status/:id`, `/api/mines/payment/pycue/init|status/:id`, `/api/scan/payment/pycue/init|status/:id`, `/api/scan/session/pycue/init|status/:id`). Games-access Ghana still uses the ShinobiPay init in this snapshot. Nigeria = manual proof everywhere. ShinobiPay services remain as legacy. All Ghana *manual* endpoints return 410.
4. **Virtual-predictions kill switch:** `platform_settings` flag, `GET /api/settings/virtual-predictions` (public) + `PUT` (superadmin). When OFF, `gp-init.js` blocks `games.html`, `mines.html`, `scan.html` with a "Predictions offline" overlay. **Note: `spin-bottle.html` is NOT in the gated page list in the source** — the bottle game stays live when predictions are off (port decision needed, §7).
5. **Ban gate:** 3 rejected manual deposits (across subscription + scan + mines) permanently bans the email and every IP it ever used, with cross-propagation.

## 2. Game inventory — VirtuWin

### 2.1 Mines — "AI diamond locator" (`public/mines.html`, ~917 lines)

- **What it is:** a predictor for the external Mines game, presented as a playable board. The user sets a mine count and clicks **Run Predictor**; an animated scan sweeps the grid and "locates" every diamond. Explicitly framed as "no real money, for educational purposes only". There is **no betting, no cashout, no server-side game state**.
- **Board:** 25 tiles (5×5). Mine count selectable 1–22 (`MIN_MINES=1`, `MAX_MINES=22` default), **capped by plan**: `PLAN_MAX_MINES = { TWO_HOUR: 5, THREE_HOUR: 7, FIVE_HOUR: 10 }`, read from `sessionStorage predatorgh_user_plan`. Safe-tile counter = 25 − mines.
- **Generation: 100% client-side.** Mine positions are placed in the browser on grid generation; Run Predictor just animates the reveal of the already-placed diamonds (`state.tileVisuals[i] = 'diamond'`). No endpoint carries game data.
- **Flow:** `games.html` Mines card → `startFlow('mines.html')` → page load checks games-access (`GET /api/games-access/authorize`, no token → bounce to `games.html`) → login form (the subscription password) → session runs against the plan countdown.
- **Backend calls (complete list):** `POST /api/auth/login {username, password}`, `POST /api/auth/logout`, `GET /api/protected/status` (on load + every 30 s; drives `secondsRemaining`/`expiresAt`; 401 → session-lost). That is all.
- **Money side (parallel path):** mines also has its own purchase flow — free-form GHS amount via `POST /api/mines/payment/pycue/init` → `GET …/status/:id` (legacy: ShinobiPay equivalents; manual = 410) landing in `mines_purchases`, reviewed in the admin/superadmin mines queue (`GET /api/admin/mines-purchases[/pending|/:id]`, `POST …/:id/approve|reject`, `DELETE` superadmin). How the direct purchase and the timed-plan session interlock is muddled in the source (two overlapping access paths to the same page) — see §7.
- **Staff mirror:** `public/admin-mines.html` — staff log in (superadmin auth first, admin fallback) and playtest the same board with free plans; auth endpoints only.

### 2.2 Spin da Bottle (`public/spin-bottle.html`, ~799 lines)

- **What it is:** a timed prediction arena. Each round the app issues a **call — UP or DOWN — with a confidence %**, a 15 s countdown runs (`ROUND_MS = 15000`), then the bottle spins (4.3 s, `SPIN_MS = 4300`) and lands; "the bottle lands randomly — the call is the prediction". Round history is kept on-page (streak/momentum display). No staking or cashout in the page — it is a signals tool consumed like the other predictors.
- **The call generator (client-side "AI"):** a heuristic over recent history — momentum (last-call bias, weight 2), alternation detector over the last 4 results (weight 1.5), and zone bias = lifetime UP ratio (weight 3 × deviation from 0.5). `score ≥ 0 → UP`. Confidence = clamp(64 + |score|×7 + rand×6, …, 94).
- **Superadmin-pinned pattern (the game's custom-rounds equivalent):** the superadmin can pin **exactly 10 calls** (each `UP`|`DOWN`) stored as JSONB in `platform_settings` (`bottle_rounds` key). The client fetches `GET /api/settings/bottle-rounds` (public; re-polled every 15 s), and while a pattern is set **every client consumes it in order, cycling 1→10→1**, with a displayed "pattern round N of 10" and a synthetic confidence (72–93). The consumption index is **per-client in-memory** (`adminCallIdx`), so clients drift out of sync with each other — a known weakness to fix in the port (§7). Clearing the pattern (PUT with null) reverts to the heuristic.
- **Flow:** `games.html` Spin da Bottle card → `startFlow('spin-bottle.html')` → the page runs its own register/login (`POST /api/auth/register`, `POST /api/auth/login`, `POST /api/auth/logout`) + `GET /api/protected/status` countdown, i.e. the same timed-plan session as Mines.
- **Backend calls (complete list):** the auth trio + protected/status + `GET /api/settings/bottle-rounds`. Everything else is local.
- **Staff mirrors:** `public/admin-spin-bottle.html` / `public/superadmin-spin-bottle.html` — the game plus staff controls; they also drive the scan-simulator session endpoints (`/api/{admin,superadmin}/simulator/create-session`, `…/approve-payment/:id`) to walk the customer flow. `public/superadmin-bottle-rounds.html` is the dedicated pattern editor (GET + `PUT /api/settings/bottle-rounds`, superadmin).

### 2.3 AI Slip Scan (`public/scan.html`, ~1,279 lines) — already in SignalVault

- **What it is:** upload a betting-slip screenshot → AI returns one pick (1/X/2) per fixture with an accuracy % and a one-line reason (OpenRouter free vision models in the source's `lib/services/ai.js`; SignalVault's copy already extends the provider chain).
- **Two products:** single-slip purchases (BASIC 3 picks / STANDARD 5 / PREMIUM full coverage) and timed scan sessions (10/20/30 min, unlimited scans). Purchase is consumed **before** the AI call (no free retries).
- **Flow:** games-access gate → register → buy (Ghana Pycue prompt / Nigeria manual proof + review) → `POST /api/scan/session/analyze` (multipart `{sessionId, email, image}`) or the single-scan equivalents (`/api/scan/analyze`, `/api/scan/result/:id`, `/api/scan/history`).
- **SignalVault status:** fully present and already collapsed to Premium (SCAN_550 full coverage, SESSION_550 60 min). **Not a port item** beyond regression-checking.

### 2.4 The hub itself (`public/games.html`, ~1,631 lines)

The storefront: register → country-branched plan purchase → one-time password → game cards (**Mines**, **Spin da Bottle**; scan has its own page). SignalVault's equivalents already exist (`gate.tsx` GHS 50 gate, `pricing.tsx` single Premium, `predictor/index.tsx` lobby). Not a port item — but the two game cards are the lobby entries the port must add (§6).

### 2.5 Platform/staff simulators (not user games, but part of "everything")

- **Games-page simulator** (`admin-simulator.html` / `superadmin-simulator.html`, "Games Page — Admin/Super Admin"): staff mirrors of the hub purchase flow, re-mirrored to the Pycue prompt flow; no game API calls beyond auth/logout — the point is previewing exactly what a customer sees.
- **Scan simulator** (`admin-scan-simulator.html` / `superadmin-scan-simulator.html`): create a fake scan session (`POST /api/{admin,superadmin}/simulator/create-session {planCode, phone}`), fake-approve/fail the MoMo prompt (`…/approve-payment/:sessionId`, `…/fail-payment/:sessionId`), then run the **real** AI scan (`…/scan/:sessionId {imageBase64, imageContentType}`). Superadmin adds session/result listing + force-expire.
- SignalVault already has staff flow simulators for its crash suite (`admin.simulator.tsx`, `superadmin.simulator.tsx`, `UserFlowSimulator`) — the port extends these rather than creating new ones (§6).

## 3. Endpoint map (game-relevant)

Full backend route table (≈120 routes) is documented in `~/workspace/virtuwinUi-scan/BACKEND_MAP.md` §3 and remains accurate except payments (Pycue supersedes ShinobiPay for Ghana — routes in §1.3 above). The game-surface endpoints:

| Area | Endpoints |
|---|---|
| Session | `POST /api/auth/register`, `POST /api/auth/login`, `POST /api/auth/logout`, `GET /api/protected/status`, `GET /api/auth/ban-status` |
| Gate | `POST /api/games-access/shinobipay/init`, `POST /api/games-access/submit`, `GET /api/games-access/status/:id`, `GET /api/games-access/verify/:token`, `GET /api/games-access/authorize` |
| Mines money | `POST /api/mines/payment/pycue/init`, `GET /api/mines/payment/pycue/status/:id` (+ legacy shinobipay pair; manual submit = 410), `GET /api/mines/payment/status/:id` |
| Bottle | `GET /api/settings/bottle-rounds` (public), `PUT /api/settings/bottle-rounds` (superadmin) |
| Kill switch | `GET /api/settings/virtual-predictions` (public), `PUT /api/settings/virtual-predictions` (superadmin) |
| Scan | `GET /api/scan/payment/plans`, `POST /api/scan/payment/pycue/init`, `GET …/status/:id`, `POST /api/scan/analyze`, `GET /api/scan/result/:id`, `GET /api/scan/history`; sessions: `GET /api/scan/session/plans`, `POST /api/scan/session/pycue/init`, `GET /api/scan/session/status/:sessionId`, `POST /api/scan/session/analyze` |
| Simulators | `POST /api/{admin,superadmin}/simulator/create-session`, `…/approve-payment/:sessionId`, `…/fail-payment/:sessionId`, `…/scan/:sessionId`; superadmin: `GET …/simulator/sessions|results|plans|session/:sessionId`, `POST …/simulator/expire/:sessionId` |

**Transport pattern throughout:** plain HTTP polling (30 s session status, 15 s bottle-pattern refresh, ~5 s payment status). **No websockets anywhere in either project.**

## 4. Admin + superadmin control map (source)

| Control | Where | Endpoint(s) | Notes |
|---|---|---|---|
| Bottle pattern (next 10 calls) | superadmin-bottle-rounds.html (+ spin-bottle staff pages) | `PUT /api/settings/bottle-rounds` | Superadmin only. Exactly 10 × UP/DOWN or null to clear. No admin-level equivalent. |
| Virtual-predictions kill switch | superadmin-dashboard.html | `PUT /api/settings/virtual-predictions` | Superadmin only; gates games/mines/scan pages (not bottle). |
| Mines purchase review | superadmin-dashboard queues; admin endpoints | `GET /api/admin/mines-purchases[/pending]`, `POST …/:id/approve|reject`, `DELETE` (superadmin) | Rejections feed the 3-strike ban gate. |
| Scan/session purchase review | superadmin-dashboard queues | `/api/admin/scan-purchases/*`, `/api/admin/scan-sessions/*` (same verb pattern) | Same ban-gate coupling. |
| Games-access review | superadmin-games-access.html | `GET /api/superadmin/games-access`, `POST …/:id/approve|reject` | Superadmin only. |
| Staff playtest mirrors | admin-mines.html, admin/superadmin-spin-bottle.html, admin/superadmin-simulator.html | auth + bottle-rounds GET (+ simulator session endpoints on bottle pages) | Free plans; no separate "enable game" toggle exists. |
| Scan simulator | admin/superadmin-scan-simulator.html | §2.5 endpoints | Runs the real AI pipeline. |
| Per-game enable/disable | — | — | **Does not exist in VirtuWin.** The only on/off is the global virtual-predictions switch. No per-game odds/multiplier controls exist for mines/bottle (their "odds" are the plan caps and the pattern). |

## 5. SignalVault — current state

**Games (live, server-anchored — SignalVault is AHEAD of VirtuWin here):**
- **Crash/prediction engines** in `lib/services/engines/` (registry `GAMES`): `aviator`, `sporty-jet`, `sportyhero` (CrashEngine, provably-fair hash chain, per-game seed/serverSeed), `sportykick` (PenaltyEngine — zone predictions), `super-hero` (ActionEngine — zone predictions), `test-flight` (lab CrashEngine).
- **Live play is client-side:** `useCrashRun` first draws `GET /api/rounds/next/:gameId` (admin custom rounds, FIFO) and falls back to a **local provably-fair draw** (`src/lib/provably-fair.ts`). Server engines API serves detail/history/tick/fairness/verify/analyze + Monte-Carlo `simulate` (`/api/engines/*`, incl. `/zones` for sportykick/super-hero).
- **Custom rounds (admin + superadmin "rounds" tab, `RoundCustomization.tsx`):** next-10 multipliers per game, 1.00–1000x, random-fill, clear-to-revert; `lib/services/customRounds.js` + `custom_rounds` table; `GET/POST/DELETE /api/admin/rounds/custom[/:gameId]`, public `GET /api/rounds/next/:gameId`.
- **Scan:** complete (single + timed session), collapsed to Premium.
- **Access model (already collapsed):** one-time gate GHS 50 (`gate.tsx`) + **single Premium pass GHS 550 / 24 h per game** (`skyPayments.js` GAME_PLANS); no Nigeria/WW rails; payments on SignalVault's ShinobiPay-based stack.
- **Admin tabs today:** users, manual payments, scans, commissions, payouts, rounds. **Superadmin adds:** admins, live games (`SuperadminLiveGames`), next runs (`SuperadminNextRuns`), monitoring.
- **Staff simulators today:** `admin.simulator.tsx` / `superadmin.simulator.tsx` render `UserFlowSimulator` — a step mirror (pick game → pay → play) of the 3 crash games on the Premium plan.
- **Dormant backend (present via shared lineage, no UI):** `lib/services/minesPurchase.js` + admin mines-purchases queue routes in `api/index.js`; `gamesAccess` service + 10 routes; `settings.js` virtual-predictions get/set + `GET /api/settings/virtual-predictions` route. **Absent entirely:** any mines or bottle frontend, `bottle_rounds` in settings, user-facing mines payment routes, per-game anything for mines/bottle.

## 6. The gap — what the port actually is

| # | Item | In VirtuWin | In SignalVault | Port size |
|---|---|---|---|---|
| G1 | **Mines predictor game** | Full page, client-side | **Absent** (backend purchase queue dormant) | New route + lobby card; session rides existing pass |
| G2 | **Spin da Bottle game** | Full page, client-side | **Absent entirely** | New route + lobby card + settings backend + rounds editor |
| G3 | **Bottle pattern control (superadmin)** | Dedicated editor page | Absent (crash custom-rounds exists as the UX pattern to mirror) | New superadmin tab + PUT endpoint |
| G4 | **Staff playtest mirrors for mines/bottle** | admin-mines, admin/superadmin spin-bottle, games-page simulators | Crash-only simulators | Extend existing simulator routes |
| G5 | Kill-switch coverage for new games | Setting exists; bottle excluded in source | Setting + GET route exist; no game pages consume it | Wire new pages to the setting; decide bottle inclusion |
| — | Scan, gate, crash suite, custom rounds, access/pass model | Present | **Present / ahead** | No port — regression check only |

**Plan-gating collapse (VirtuWin → SignalVault's one Premium plan):**
- Timed plans TWO_HOUR/THREE_HOUR/FIVE_HOUR (250/350/750) → **Premium GHS 550 / 24 h** already covers entry; mines/bottle should check the same per-game pass as the crash games.
- `PLAN_MAX_MINES` 5/7/10 → one plan = top tier: recommend **cap 22 (full grid range)** for Premium (decision point, §7).
- Scan BASIC/STANDARD/PREMIUM → already collapsed (SCAN_550 / SESSION_550). Gate GHS 50 → already identical. Nigeria ₦ plans and WW crypto → **not ported** (SignalVault is Ghana-only by design).

**Design-rule application (Chuks's standing rule):** the ONE shared AI crash-point logic already governs SignalVault's crash games (shared CrashEngine + provably-fair chain + `useCrashRun`); per-game difference is theming only (Aviator red / Sporty Jet cyan / SportyHero violet: glow + video bg) — **the port must not fork this**. Mines and Bottle are **not crash games** and must not be forced into CrashEngine: Mines' generation is a client-side grid placement with a reveal animation; Bottle's is a binary-call predictor whose admin override (pinned pattern) maps naturally onto the existing **customRounds pattern** (per-game FIFO queue) rather than VirtuWin's settings-JSON approach.

## 7. Risks & open decisions

1. **Bottle pattern sync:** VirtuWin's per-client in-memory index means two users see different "pattern round N". Port recommendation: consume server-side via a FIFO queue (customRounds-style, e.g. `GET /api/bottle/next`) so all users share one sequence. Needs Chuks's OK — it changes observable behaviour vs the source.
2. **Mines double-gating in the source is muddled** (timed-plan session AND a separate direct mines purchase both lead to the same page). Recommendation: in SignalVault, the Premium pass alone gates Mines; keep the dormant admin mines-purchases queue unused unless Chuks wants per-game mines sales on top of the pass.
3. **Bottle + kill switch:** source excludes bottle from the virtual-predictions gate. Decide deliberately (recommend: include it — one switch should stop all prediction surfaces).
4. **Payments:** port games onto SignalVault's existing rails (gate + Premium pass via `skyPayments`). Do **not** import VirtuWin's Pycue services — SignalVault's backend deliberately carries the ShinobiPay lineage; mixing rails re-opens settled decisions.
5. **Snapshot trust:** the Oct scan maps in `virtuwinUi-scan/` describe retired flows (ShinobiPay Ghana, manual Ghana) — anyone building from them without this audit would resurrect dead code. Root-level `games.html`/`scan.html` in the source repo are likewise stale copies; `public/` is canonical.
6. **`test-flight`** (SignalVault lab engine) is unrelated to the port; leave it.
7. **Game art:** VirtuWin's mines/bottle art is mostly icon/emoji-driven in-page (no dedicated card art files beyond `public/assets/mines-engine-card.png` and crest PNGs). Chuks's standing rule — keep original game images as-is — applies to any art carried over; new SignalVault card art for mines/bottle needs his eye before wiring.

## 8. Port checklist (concrete)

**Backend (`~/workspace/darkweb`)**
- [ ] `lib/services/settings.js` — add `getBottleRounds`/`setBottleRounds` (port from virtuwinUi `settings.js`: `platform_settings` JSONB key `bottle_rounds`, validate exactly 10 × UP/DOWN or null).
- [ ] `api/index.js` — add `GET /api/settings/bottle-rounds` (public) + `PUT /api/settings/bottle-rounds` (requireSuperAdmin), mirroring the virtual-predictions routes beside them.
- [ ] (If §7.1 approved) bottle consumption queue: new `lib/services/bottleRounds.js` FIFO (clone of `customRounds.js` shape) + `GET /api/bottle/next`; settings JSONB then only stores the template.
- [ ] Mines: no new backend if pass-gated (decision §7.2); session/pass check reuses existing middleware. Leave `minesPurchase` dormant.
- [ ] Confirm `PUT /api/settings/virtual-predictions` route parity (service setter exists; wire the toggle UI if missing on the superadmin side).

**Frontend**
- [ ] NEW `src/routes/predictor/mines.tsx` — 5×5 Mines predictor: mine-count picker (1–22), Run Predictor scan-reveal animation, safe-count, pass-gated entry, deep green/black theme, Material Symbols icons (no emoji), mobile-first.
- [ ] NEW `src/routes/predictor/bottle.tsx` — Spin da Bottle arena: 15 s round countdown ring, call card (UP/DOWN + confidence), 4.3 s spin animation, round history strip, pattern-mode indicator ("pattern round N of 10") driven by `/api/settings/bottle-rounds` (or `/api/bottle/next` if §7.1).
- [ ] MODIFY `src/routes/predictor/index.tsx` (casino lobby) — add Mines + Spin da Bottle cards with art, same tile treatment as existing games.
- [ ] MODIFY `src/lib/api.ts` — bottle-rounds get/put clients + types; mines needs no client (local state).
- [ ] NEW card art in `public/games/` for mines + bottle (pending Chuks's approval of art, §7.7).
- [ ] Wire both new pages to the virtual-predictions setting (offline overlay behaviour matching existing pages).

**Admin**
- [ ] MODIFY `src/routes/admin.index.tsx` — add a "Bottle rounds" tab (read-only pattern view + status) and a "Mines" playtest tab (staff sandbox board with plan caps lifted), mirroring VirtuWin's admin-mines/admin-spin-bottle roles.
- [ ] MODIFY `src/routes/admin.simulator.tsx` — extend `UserFlowSimulator` game list with Mines + Bottle so staff can walk the full customer flow for them.

**Superadmin**
- [ ] MODIFY `src/routes/superadmin.index.tsx` — add the **Bottle Rounds editor** tab (10 UP/DOWN slots, random-fill, clear-to-AI — UX mirroring `RoundCustomization.tsx`) → `PUT /api/settings/bottle-rounds`.
- [ ] MODIFY `src/routes/superadmin.simulator.tsx` — same Mines + Bottle simulator extension as admin.
- [ ] Confirm the virtual-predictions toggle sits in the superadmin panel and covers the new pages (per §7.3 decision).

**Verification (per Chuks's standing rules)**
- [ ] `bun run build` + `npx tsc --noEmit` pass; phone-size (390×844) screenshots of: lobby with new cards, Mines, Bottle, admin tabs, superadmin Bottle Rounds editor — checked in the logged-in views he will actually use.
- [ ] End-to-end: set a bottle pattern as superadmin → user bottle page follows it in order → clear it → heuristic calls resume. Set mines cap → predictor respects it. Kill switch off → new pages block.
