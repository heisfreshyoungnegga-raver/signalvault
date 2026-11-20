# SignalVault — Credit-Pack Rebuild (2026-11-20)

Owner-locked change: **4 credits per play**, new packs replace the old
four tiers (GH₵250→20, 300→25, 500→40, 1,000→80 at 5/play) and the old
30-credit GH₵400 pack. Game flow mirrors darkweb: spend server-side
**before** a round/play, refund if the draw errors, gate
`403 CREDITS_EXHAUSTED` at 0 credits with an out-of-credits overlay that
sends the user to buy a pack (session survives — **no logout**), staff
never spend/gate, sim wallet separate.

## New packs

| Tier | Price (GHS) | Credits | Plays | Price (NGN) |
| --- | --- | --- | --- | --- |
| STARTER | GH₵250 | 4 | 1 | **not set** |
| STANDARD | GH₵300 | 8 | 2 | **not set** |
| PREMIUM (default) | GH₵500 | 12 | 3 | **not set** |
| VAULT (best value) | GH₵1,000 | 20 | 5 | **not set** |

- **Cost per use: 4 credits** — one completed slip scan, one crash round,
  one bottle spin, one Mines game. Virtuals minimum stake is 4 credits.
- Credits never expire; top-ups stack.
- **NGN TODO (owner):** NGN prices for the four new packs were not given.
  `priceNgn` is `null` on every tier (backend `credits.js` PACKS,
  `lib/util.js` PLAN/SCAN_PLAN, `src/lib/api.ts` CREDIT_PACKS, catalogue
  responses). Nigeria purchase is **disabled in the UI** — the Nigeria tab
  shows "Nigeria packs are not priced yet" and the submit buttons are
  disabled on `/pricing`, `/manual-payment`, and `/scan`. The old NGN
  figures (47,000 / 56,000 / 94,000 / 188,000) survive **only** in
  `lib/services/funds.js` PLAN_NAIRA / SCAN_PLAN_NAIRA, where they price
  pre-cutover NG rows in funds reports and referral commissions — they
  are not pack prices any more. To re-enable Nigeria: set `priceNgn` on
  the four tiers in `credits.js` + `util.js` + `api.ts`, and remove the
  Nigeria gating in the three pages above.

## Grants — exact-match only

`creditsForPayment()` in `lib/services/credits.js` is now **exact-match
only**: a payment earns credits only when its amount is exactly a tier
price (GH₵250/300/500/1,000). Anything else — including the old GH₵400
pack, in-flight GH₵800/GH₵550 amounts, and **every NGN payment** — earns
**0** and grants nothing. The old proportional fallback was deleted.
The three approval rails skip the grant when the earned amount is 0 and
log a warning instead (approval itself is never rolled back):

- `manualPayment.approve` → `MANUAL_<id>`
- `skyPayments.approvePass` → `MANUAL_PASS_<id>`
- `scanPurchase.approve` → `SCAN_<id>`

All grants stay idempotent on `ref` (`credit_ledger.ref` is unique).
Simulator approvals grant the **default pack: 12 sim credits**
(PREMIUM GH₵500), 3 sim plays — previously 30 sim credits.

## What changed per game

- **Aviator** (the only crash engine since the 2026-11-20 cut;
  `GET /api/rounds/next/aviator`): spend 4 before the draw, refund on
  draw error. Unchanged pattern, new cost.
- **Mines** (`POST /api/mines/play`): spend 4 before the board starts;
  **new** — if the spend lands but the reply fails, the 4 credits are
  refunded (`REFUND_MINES`). Same for sim (`REFUND_MINES` on sim wallet).
- **Spin da Bottle** (`POST /api/bottle/next`): spend 4 before the spin,
  refund on draw error. Unchanged pattern, new cost.
- **AI scan** (`scanService.js`, `simScanService.js`): gate first
  (`requireCredits`), spend 4 **after** a completed analysis only —
  failed analyses still cost nothing.
- **Virtuals — REMOVED 2026-11-20, see "Virtuals — dark web logic"
  below.** The virtual-football betting game is gone; "Instant
  Virtuals" is now only the AI slip scan's front door, exactly like
  dark web. No stake, no virtual-football bets, no `VIRTUAL_*` ledger
  refs any more.
- **0-credits behaviour** (unchanged, already matched darkweb):
  `403 CREDITS_EXHAUSTED` → bounce to `/pricing?game=<id>`, mid-play
  `OutOfCreditsOverlay` in `window-ui.tsx`; `userToken.clear()` only on
  401, so the session survives to top up and resume.

## Admin / super-admin — NEW credit ledger

- New endpoints: `GET /api/admin/credits` and
  `GET /api/superadmin/credits` (staff auth, read-only) returning
  wallet count, total credits in circulation, cost per use, live packs,
  top 50 balances, latest 100 ledger rows.
- New **Credit ledger** tab on `/admin` and `/superadmin`
  (`src/components/admin/CreditLedgerView.tsx`): summary cards, live
  packs, top balances, recent ledger (identity, delta, reason, ref,
  balance after). Use it to audit any balance — a grant's `ref`
  (`MANUAL_<id>`, `MANUAL_PASS_<id>`, `SCAN_<id>`, `SIM_<id>`)
  ties it to the payment that caused it. (`VIRTUAL_WIN_<betId>` is
  gone — virtual-football betting was removed 2026-11-20, see below.)
- Approvals work exactly as before (same queues, same buttons); the
  only change is what an approval grants.

## Migration / database notes

- **No schema change.** `lib/schema.sql` credit tables
  (`credit_balances`, `credit_ledger`, `sim_*`) are unchanged; only
  their header comment was updated. No migration to run.
- **Existing balances carry over as-is.** Old balances are still
  spendable at 4/play, but 1–3 credits can strand: e.g. a 25-credit
  balance buys 6 plays and leaves 1 credit that can never be spent
  alone (it tops up fine with a new pack). Nothing was converted or
  wiped — this matches the owner's standing rule (no grandfathering
  of old windows/grants, balances themselves untouched).
- **Mines purchases do NOT grant credits.** `minesPurchase.approve`
  only flips status (there is no frontend purchase form for it). Mines
  is played from the shared credit wallet; approving a mines payment
  alone adds no credits. If mines payments should buy credits, say so
  and the grant will be added to `minesPurchase.approve`.
- `lib/services/funds.js` NGN tables and `manualDeposits.js`
  `NG_SCAN_AMOUNT = 75000` are legacy reporting/display figures for
  pre-cutover rows only — see the NGN TODO above.

## Files changed

Backend: `lib/services/credits.js` (packs, cost 4, exact-match grants),
`lib/util.js` (PLAN / SCAN_PLAN), `lib/services/skyPayments.js`
(catalogue `priceNgn: null`, grant skip-if-0), `manualPayment.js`,
`scanPurchase.js` (grant skip-if-0), `simulator.js` (sim amount/grant =
default pack), `lib/services/gameWindows.js`,
`scanService.js`, `skyAccount.js`, `funds.js` (comments), `lib/schema.sql`
(comment), `api/index.js` (Mines refund, `/api/admin/credits` +
`/api/superadmin/credits`, virtuals router unmounted 2026-11-20),
`lib/services/credits.test.js` (new).

Frontend: `src/lib/api.ts` (pack tables,
nullable `priceNgn`), `src/routes/pricing.tsx`, `manual-payment.tsx`,
`scan.tsx` (new packs, plays per pack, NGN disabled + gating,
Instant Virtuals branding), `src/components/predictor/casino-lobby.tsx` (tier cards, Instant Virtuals scan tile, virtual-football tile removed 2026-11-20), `src/components/admin/CreditLedgerView.tsx` (new),
`src/routes/admin.index.tsx`, `superadmin.index.tsx` (Credit ledger
tab), `src/routes/index.tsx`, `dashboard.tsx`, `login.tsx`,
`register.tsx`, `scan-slip.tsx`, `scan-result.tsx`, `payment.waiting.tsx`,
`src/routes/predictor/{bottle,mines}.tsx`, `src/routes/predictor/route.tsx` (Instant Virtuals nav → `/scan`), `src/components/predictor/{BottleArena,MinesBoard,CrashPredictor,crash/*}.tsx`,
`src/lib/use-game-access.ts`, `src/components/window-ui.tsx`,
simulator pages
(`simulator.scan.tsx`, `simulator.scan-slip.tsx`,
`simulator.scan-result.tsx`, `simulator.payment.tsx`,
`simulator.waiting.tsx`), `package.json` (`test` script).
Deleted 2026-11-20: `api/virtuals.js`, `lib/services/virtuals.js`,
`src/routes/virtuals.tsx`, `src/lib/virtuals-api.ts`. Added:
`public/games/instant-virtuals.png` (copied from dark web).

## Aviator-only cut (2026-11-20, owner order)

SignalVault is now **one crash engine: Aviator**. The other five engines
were removed completely — no re-add under new names, no "coming soon"
tiles, no silent fallback to another engine.

### What was removed
- Registry entries in `lib/services/engines/index.js`: `sporty-jet`,
  `sportykick`, `sportyhero`, `super-hero`, `test-flight` (Aviator entry
  untouched: CrashEngine, seed 42, serverSeed `darkweb-demo-aviator-v1`).
- `lib/services/engines/penalty-engine.js` and `action-engine.js`
  **deleted** (referenced nowhere else).
- `src/components/predictor/PenaltyAnalytics.tsx` and
  `ActionAnalytics.tsx` **deleted** (only served the removed games).
- Server: `GET /api/engines/sportykick/zones` and
  `GET /api/engines/super-hero/zones` **deleted**; the `hero32`
  (SportyHero) provably-fair construction removed from
  `lib/services/engines/provably-fair.js` and `crash-engine.js`
  (Aviator SHA-512 construction only).
- Client: `getPenaltyZones` / `getActionZones` and the `ZoneStat` /
  `ActionZoneMetric` types removed from `src/lib/api.ts`; the `hero32`
  local-draw branch removed from `src/lib/provably-fair.ts`
  (always the Aviator construction now).
- Docs: engine-listing passages in `MAP.md`, `GAMES_AUDIT.md`,
  `DESIGN.md` updated to Aviator-only (TIERS-MAP.md needed no change —
  its "Hero" hits are historical port quotes, not engine listings;
  GO-LIVE-CHECK.md / IMPLEMENTATION_NOTES.md left as historical notes).

### Where Aviator lives now
- **Lobby:** `src/components/predictor/casino-lobby.tsx` — Aviator is the
  only engine tile; Mines, Spin da Bottle, Slip Scan and Instant Virtuals
  tiles unchanged. Top-up strip still shows the four credit tiers.
- **Engine page:** `/predictor/aviator` (immersive video page,
  `CrashPredictor.tsx` / `MinimalStage.tsx` / `gameThemes.ts` — Aviator
  theme only) and `/engines/aviator` (dashboard + FairnessVerifier).
- **Home:** `src/routes/index.tsx` — "The game we cover", one Aviator card.
- **Admin:** Round Customization (`RoundCustomization.tsx`) and the
  super-admin Live Games / Next Runs views are Aviator-only; the
  Simulation Lab (`SimulationLab.tsx`) simulates Aviator only.
- **Simulator:** crash side is Aviator-only (`simulator.payment.tsx`,
  `simulator.waiting.tsx` game lists); Mines / bottle / scan sim flows
  unchanged.

### Rejection / redirect rules
- **API:** any non-`aviator` gameId on `GET /api/rounds/next/:gameId`
  and on the admin custom-rounds endpoints
  (`GET/POST/DELETE /api/admin/rounds/custom[/:gameId]`) answers
  **404 `Unknown game engine`** — before any credit is spent, so a
  removed engine can never play. The generic engine endpoints
  (`/api/engines/:id`, `/history`, `/tick`, `/fairness`, `/random-crash`,
  `/verify`, `/analyze`, `/simulate`) 404 the same way via the trimmed
  registry (`getGame` returns null).
- **Frontend:** `/predictor/<removed>` redirects to `/predictor/aviator`
  (loader redirect); `/engines/<removed>` redirects to `/engines/aviator`.
- **Kept as-is:** Mines, Spin da Bottle, AI scan, virtuals, simulator —
  none of them referenced a removed engine after the cut (verified by grep).

### Flow checklist (4 credits/play, packs 250=4 / 300=8 / 500=12 / 1000=20)
1. Register → buy a pack (Ghana MoMo + manual) → credits land on approval
   (exact-match grants only; see above).
2. Aviator round: `GET /api/rounds/next/aviator` spends **4 credits
   server-side BEFORE the draw**; a draw error refunds the 4
   (`REFUND_AVIATOR`).
3. 0 credits → `403 CREDITS_EXHAUSTED` → out-of-credits overlay → pricing;
   session survives (**no logout**).
4. Balance chip updates everywhere (lobby, predictor rail, dashboard).
5. Admin / super-admin credit ledger shows Aviator spends as
   `PLAY_AVIATOR` rows.
6. Also fixed while here: stale "GH₵1,000 for 80 credits" copy in the
   home page, pricing, manual-payment, scan and root meta now reads
   **20 credits** (the VAULT pack) — the packs themselves are unchanged.

### Tests, build, smoke checks (run 2026-11-20)
- `bun test lib/services/credits.test.js` — **12 pass, 0 fail** (9 credit
  tests + 3 new Aviator-only registry tests: exactly one engine,
  removed ids rejected, `listGames()` is Aviator-only).
- `node --check` on every edited server file — clean.
- `bun run build` — **passes** (vite build, exit 0).
- API smoke (local server, no DB): `GET /api/rounds/next/aviator`
  responds (gated as expected without a session) and
  `GET /api/rounds/next/sporty-jet` answers 404 `Unknown game engine`;
  `GET /api/engines` lists Aviator only.

## Virtuals — dark web logic (2026-11-20, owner order)

SignalVault's own virtual-football betting game is **gone**. Dark web
never had one, and the owner ordered the same logic here: remove the
current logic, use dark web's.

### What was removed

- Deleted: `api/virtuals.js`, `lib/services/virtuals.js`,
  `src/routes/virtuals.tsx`, `src/lib/virtuals-api.ts`.
- Unmounted: `/api/virtuals` router removed from `api/index.js` —
  `GET /api/virtuals/round` and `/api/virtuals/bets` now answer
  404 `Not found` (verified by API smoke, no DB).
- Lobby: `VirtualFootballTile` (the `/virtuals` betting tile, min
  stake 4, "Virtual football — tap to play") deleted from
  `casino-lobby.tsx`, along with its `< 4 credits` lock and the
  "Mines, bottle & virtuals" heading — the Extra Predictors heading
  is now "Mines & bottle", like dark web's.
- Nav: predictor `TOOL_NAV` no longer lists `/virtuals` (Trophy).
- Route tree: `/virtuals` removed from `src/routeTree.gen.ts`
  (build regenerates it and it stays gone).
- Tests: the `virtuals MIN_STAKE is 4 credits` test was deleted with
  the game (11 tests pass now, was 12).
- No schema change: the removed game kept no game tables, and no
  `VIRTUAL_*` ledger rows exist in the schema — nothing to migrate.
  Old `VIRTUAL_STAKE_*` / `VIRTUAL_WIN_*` ledger refs from before
  this cut are history only.

### What replaced it — dark web's Instant Virtuals

Exactly like dark web, "Instant Virtuals" is **only the AI slip
scan's front door** — there is no virtual-football betting anywhere:

- **Lobby tile** (`casino-lobby.tsx`, `InstantVirtualsTile`):
  poster tile in the games grid with the 1X2 probability row
  (1 — 46%, X — 27%, 2 — 27%), art
  `public/games/instant-virtuals.png` (copied from dark web's
  `public/games/` — this repo shipped without a `public/` dir, so
  the file is new here), LIVE badge when unlocked. Locked when the
  account holds no scan access → links to `/scan`, where scan
  purchases are sold; unlocked → `/scan` scanner. In sim mode it
  links to `/simulator/scan`, never to the real scan flow.
- **Predictor nav** (`src/routes/predictor/route.tsx`, `TOOL_NAV`):
  one entry — `{ to: "/scan", name: "Instant Virtuals", icon:
  ScanSearch }` — same as dark web's. Mobile bottom nav keeps its
  raised Scan button to `/scan`.
- **Scan page** (`src/routes/scan.tsx`): carries the Instant
  Virtuals branding/art exactly like dark web's `scan.tsx` — hero
  "AI betting-slip scan", "Snap your slip…" copy, and the
  `instant-virtuals.png` poster (alt "Instant Virtuals").
- **The scan flow itself is unchanged** (it already mirrored dark
  web): upload slip image → OpenRouter vision reads every pick →
  per-pick predictions with confidence + reasoning; gate first
  (`requireCredits`, ≥ 4), spend 4 credits **only after** a
  completed analysis — failed analyses still cost nothing.
- **Virtual-predictions kill switch is unchanged:** `GET/PUT
  /api/settings/virtual-predictions`, PUT super-admin only, covering
  Mines / Bottle / scan via `use-game-access.ts`.

### Tests, build, smoke checks (run 2026-11-20)

- `bun test lib/services/credits.test.js`: **11 pass, 0 fail**
  (9 credit + 3 Aviator-only minus the deleted virtuals test).
- `node --check` clean on `api/index.js`.
- `bun run build`: **exit 0**; regenerated `routeTree.gen.ts`
  still has zero Virtuals references.
- API smoke over HTTP (bun local server, no DB):
  `GET /api/virtuals/round` → 404, `GET /api/virtuals/bets` →
  404; `GET /api/scan/payment/plans` → the four SCAN plans
  (SCAN_250/300/500/1000); `GET /api/payment/plans` → the four
  packs (4/8/12/20 credits, `priceNgn: null`).
- 390px checked statically only (no new layout code in this cut —
  tile rename is text-only, heading text shortened); eyeball lobby
  + scan page on a phone before shipping.

## AI models — openrouter/free only (2026-11-20, owner order)

Owner order: use the `/free` router, don't hardcode any model. This
explicitly overrides the old standing rule (25 Oct 2026, Proposal A)
that pinned proven free models and kept verification on a different
model.

### What was removed

- `lib/services/ai.js`: `FIRST_READ_MODELS` (openrouter/free +
  two pinned free models) and `VERIFY_MODELS` (the two pinned
  models) are deleted, along with every hardcoded model id in the
  repo. The dead `buildGeminiOpenAiVisionBody` helper (never called)
  was removed too.
- `GO-LIVE-CHECK.md`: two stale doc references to other providers'
  key vars fixed to OpenRouter only.
- The ONLY model string left anywhere in the codebase is
  `'openrouter/free'` — the OpenRouter free auto-router (constant
  `OPENROUTER_MODEL` in `lib/services/ai.js`). Verified by grep:
  zero `dots-studio` / `nemotron` / `:free` model ids / other
  vendor strings in `lib/`, `api/`, `src/`, docs.

### What the scan uses now

- Every AI attempt — first read, transcribe, gap-fill, verification,
  winner recovery, simulator scan — goes to `openrouter/free` only.
- Fallback is key rotation only: one attempt per configured API key
  (up to 4 accounts via `AI_OPENROUTER_API_KEYS`, unchanged),
  per-attempt timeouts, max tokens, prompts and response handling
  all unchanged. A failed attempt still falls through to the next key.
- Verification is now a second independent read through the same
  router (`verificationCandidates()` returns `['openrouter/free']`).

### The tradeoff (honest)

- The router picks whatever free model serves each call, so the
  verification read may be served by the SAME underlying model as
  the first read — it is a second call, not a guaranteed second
  opinion. A confident misread can now survive the double-check
  where the pinned pool used to catch it.
- The old misroute risk the pinning guarded against returns:
  the router can land on a moderation model (no JSON) or a
  "thinking" model; retries across keys hit the same router string
  and can repeat the same failure until the router picks
  differently. (`reasoning: { effort: 'none' }` is still sent on
  every call to blunt the thinking-model case.)
- No `/models` list is fetched, no new provider, no paid model.

### Tests, build, smoke checks (run 2026-11-20)

- NEW `lib/services/ai.test.js` (7 tests): chain builds exactly
  one `openrouter/free` attempt per key (1 key → 1, 2 keys → 2,
  6 keys → capped at 4, no keys → 0); verification candidates are
  `['openrouter/free']` for any serving model; source-level guard
  asserting no other model id / vendor string in `ai.js`.
  Exports changed: `VERIFY_MODELS` / `FIRST_READ_MODELS` removed;
  `OPENROUTER_MODEL`, `buildAttemptChain`, `verificationCandidates`
  exported (no consumers outside `ai.js` used the removed ones).
- `bun test lib/services/`: **18 pass, 0 fail** (11 credit +
  Aviator-only + 7 AI). `node --check` clean on `ai.js`,
  `ai.test.js`, `api/index.js`. `bun run build`: **exit 0**.
- API smoke over HTTP (bun local server, no DB):
  `GET /api/payment/plans` → four packs (4/8/12/20 credits,
  `priceNgn: null`); `GET /api/scan/payment/plans` → four SCAN
  plans (SCAN_250/300/500/1000).

## NOT live-verified

- No live Neon database was available in this sandbox, so
  spend/grant/refund were **not** exercised against a real DB (the
  logic paths are the same atomic `UPDATE … WHERE balance >= …`
  / idempotent-`ref` code as before, with the cost constant changed).
  Before going live: run the DB smoke checklist — buy GH₵250 → 4
  credits land; play one crash round → 3 left; approve a GH₵400
  payment → 0 credits granted; approve an NGN payment → 0 credits
  granted; check `/admin` → Credit ledger shows the rows.
- No live payment was made; Nigeria remains disabled until NGN
  prices are set.
- 390px width was checked statically only (pricing grid is 2-col on
  mobile with short "NGN to be set" lines, ledger tables use
  `overflow-x-auto`, the header balance chip is a small pill, lobby
  tiles truncate) — no live 390px render was done here; eyeball the
  pricing page and a game page on a phone before shipping.
- **Aviator-only cut, also not live-verified:** the Aviator round flow
  (spend-before-draw, refund, out-of-credits overlay, ledger
  `PLAY_AVIATOR` rows) was verified by unit tests + API smoke only —
  no real user, pack purchase, or DB-backed round was run end to end.
  The removed-engine 404s and the frontend redirects were verified
  statically (registry test + build); confirm on the deployed site
  that `/predictor/sporty-jet` lands on Aviator and the lobby shows
  one engine tile.
- **AI scan, also not live-verified:** no live OpenRouter call was
  made here — no API keys and no DB in this sandbox. The
  openrouter/free-only chain was verified by unit tests + the plan
  endpoints only. Before going live: set `AI_OPENROUTER_API_KEYS`
  on the deployed backend, run one real slip scan, and confirm the
  response `model` is a free model and the 4-credit spend lands
  only after a completed analysis.
- Not pushed to GitHub, not deployed (per instructions).
