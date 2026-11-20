# SignalVault — Implementation Notes (Path A rebrand of Dark Web)

Work copy: `~/workspace/darkweb-rebrand/rebrand2/` — the only copy edited.
Source: pristine Dark Web code (244 files). Nothing was touched in
`~/workspace/darkweb-rebrand/signalvault/` or the live SignalVault site/DB.
No deploy was done (separate step). No GitHub, no new paid services/keys.

## Brand as built

- **Name:** SignalVault. Tagline: "Bold calls, made in Ghana."
- **Theme:** LIGHT everywhere. Page `#FBF6EC` warm paper cream, banded
  sections `#F5EDDA`, cards `#FFFFFF` / `#FFFDF6`, ink `#1C1917`, headlines
  `#111110`, muted `#6B6257`, sand borders `#E8DFCE` / `#D8CBB2`.
- **Colours:** primary kente terracotta `#E14D2A` (hover `#B93A1D`, soft wash
  `#FBE9E2`); secondary kente indigo `#2E3A8C` (soft `#E7E9F7`, sparing);
  teal `#0F766E` success/live only; danger `#C62828`; warning `#B45309`
  (warning-foreground `#92400e`, dark amber — see Deviations).
  Charts: `#E14D2A`, `#2E3A8C`, `#0F766E`, `#B45309`, `#8C6D2F`.
- **Fonts (Google Fonts):** Fraunces 600/700/900 (display/wordmark),
  DM Sans 400/500/700 (body/UI), IBM Plex Mono 500/600/700 (amounts,
  balances, codes, odds). Material Symbols (`f13.woff2`, the only font file
  left) kept for icons.
- **Logo:** woven "K" mark — rounded cream square, three vertical warp bars
  (terracotta/indigo/teal) crossed by three horizontal weft bars, 1px sand
  gaps. Wordmark "KENTE" Fraunces 900 ink + "picks" DM Sans 700 terracotta.
  Favicon redrawn as the weave mark (`public/favicon.svg` + `.ico`).
  The `GH` pill is replaced by a 3-bar kente mini strip (desktop only).
- **Motifs:** kente strip (header divider, footer divider, ticket edge,
  progress bar), perforated ticket edge (`ticket-edge`), weave progress bar
  (`weave-progress`). No marquee, matrix rain, scanlines/scanbeam, 3D tilt,
  glow text, blinking cursor, card-in-card, eyebrow/tracked-caps labels,
  emoji-as-icons, purple-to-blue gradients, `transition: all`, or animated
  width/height/top/left. Radius base `0.75rem`, card `1rem`, pill `999px`.

## Product (frozen, Path A — NOT ported from SignalVault)

Single 30-credit / GH₵400 pack (NGN 75,000), 5 credits per use, credits
never expire, top-ups stack, pro-rata grants. Manual recipient **KINSMAN
SUSU VENTURES-SEKONDI, MoMo 0541568542** (Ghana) / **Access Bank
1945116494, Amadi Victor Chinaemeze** (Nigeria). ImgBB uploads
(`POST /api/upload` → api.imgbb.com). **No `/virtuals` route.** No tiers,
no Theresah recipient, no self-hosted uploads, no virtuals engine.
No features added; presentation + brand strings only.

## Layout-change map (what moved where, per surface)

- **Tokens/shell** — `src/styles.css` fully rewritten to the light tokens
  above; `.dark` mirrors `:root` (light-only). `dw-glow-text` is flat
  terracotta (no glow), `dw-win-flash` a warm terracotta wash, `dw-grid-bg`
  a faint sand weave, `dw-hero-shade` a cream veil, `dw-card-3d` a flat lift
  with terracotta ring. `dw-scanlines` / `dw-scanbeam` / `dw-marquee-track` /
  `tier-shimmer` / `dw-blink` definitions deleted. New utilities
  `kente-strip`, `ticket-edge`, `weave-progress`. `overflow-x: clip` on
  html/body, terracotta `:focus-visible` outline and `::selection`.
  `src/fonts.css` now holds only the Material Symbols `@font-face`.
  `src/routes/__root.tsx`: title/meta "SignalVault — Credits & AI Slip
  Scan", new description, Google Fonts links + preconnects, f17 preload
  dropped, `<Toaster>` `richColors` dropped (light toasts).
- **Header** (`site/Header.tsx`) — slim white bar: logo left, centre nav
  (Engines `/engines`, Slip scan `/scan`, Pricing `/pricing`), right Log in
  (ghost) + "Get 30 credits" solid terracotta pill, wallet pill (mono
  balance + Top up) when logged in, mobile hamburger with full-width
  dropdown, 3px kente strip at the bottom. Was logo-only.
- **Footer** (`site/Footer.tsx`) — white footer, 6px kente strip divider,
  new copy ("One pack, 30 credits, AI calls and slip scans — built for
  Ghana…"), copyright "SignalVault", same 4 columns/links.
- **Support float** — white pill, sand border, ink text, Telegram-blue icon
  only (`#229ED9`, intentional), same `https://t.me/pycuepay` link.
- **Home** (`routes/index.tsx`) — split hero on cream (no photo):
  kente-strip chip "Made in Ghana · Pay with MoMo", Fraunces headline
  "30 credits. Every engine. Yours to keep.", CTAs "Get 30 credits" /
  "Try the AI slip scan", trust row "4.9 average rating · 2,400+ top-ups
  sold". Right column: perforated wallet ticket card (vertical kente stub,
  "Your wallet", mono "30 credits", mono "GH₵400", 6-segment thread bar,
  "5 credits per scan or play · Never expires", sample "Today's call —
  Aviator 2.41×, 78% confidence thread" labelled as sample). Marquee
  deleted; "How it works" is a perforated ticket strip directly under the
  hero. Features on a sand band (terracotta icon tiles, no 3D tilt). Games
  cards with white tag chips. Reviews on a sand band (Fraunces quote,
  terracotta stars, copy unchanged). FAQ unchanged. Final CTA is a
  terracotta panel with a kente strip above, white "Create my account"
  button + outlined "Manual payment". `public/hero-a.webp` and
  `src/assets/hero.jpg` deleted (hero has no photo now).
- **Predictor lobby** (`routes/predictor/route.tsx`) — sidebar DELETED;
  top game rail (sticky `top-16`, white, scrollable terracotta active
  chips for all games + tools, teal "Live · Provably fair" chip, date,
  wallet pill at right). Main column full-width `max-w-[1500px]` on cream.
  Mobile bottom nav white with terracotta active state + raised centre
  Scan button (terracotta circle). Immersive branch now `bg-background`.
- **Games lobby** (`components/predictor/casino-lobby.tsx`) — scan tile
  renamed "Slip Scan" (alt text too); art box `bg-muted`; lock overlay a
  cream veil with terracotta lock chip; LIVE badge a teal-on-white chip;
  1X2 row white/cream with teal percentages; HOT/NEW ribbons replaced by
  round dot badges (terracotta dot HOT, indigo dot NEW); tile shell
  `rounded-2xl shadow-soft` with terracotta hover shadow; wallet bar
  terracotta-on-cream (mono balance); heading "Games · Crash calls";
  "Virtual Predictor" → "Extra Predictors" (indigo heading); scan-tile
  search string `"slip scan ai"`; engine-access video preload removed.
- **Engines lobby** (`routes/engines/index.tsx`) — `ConfidenceRing` (SVG
  ring `#22c55e/#eab308/#f97316`) replaced by horizontal confidence threads
  (sand track, terracotta/indigo/teal fill, mono percentage); LIVE pill is
  a white chip with teal text; "Engines online" line is teal; game
  name/provider moved out of the dark image scrim into the card body;
  tag chip is a white chip with ink text.
- **Engine detail** (`routes/engines/$gameId.tsx`) — RiskBadge uses light
  success/warning/destructive tokens; BigConfidence ring uses chart
  tokens (`#0F766E/#B45309/#E14D2A`); tier/corner/zone bars are solid
  terracotta (no emerald gradients); bonus-overdue and disclaimer boxes
  use warning tokens; hero scrim lightened (`from-black/65`); the "Live
  engine" line uses light teal (`text-teal-200`, dot `bg-teal-300`) because
  it sits on the dark image scrim; live feed dot is success teal; HIT/MISS
  chips are light success/destructive. White h1/blurb and the `bg-black/60`
  tag chip stay — they sit on the game key art, not on page chrome.
- **Game pages** — `predictor/$gameId.tsx`: headings ink, links muted,
  empty state a white dashed card. `predictor/mines.tsx` /
  `bottle.tsx`: ink headings, success/teal + primary accents, live pill
  in success tokens. `predictor/history.tsx`: ink headings, white/dashed
  empty state, `bg-card` rows. `predictor/settings.tsx`: "terminal" copy
  → "desk" wording (Panel title "About this desk", "what this desk can
  and cannot do", "the desk shows EV honestly", "The prediction desk is
  the research desk"); classes lightened. `predictor/simulate.tsx`: no
  dark classes (unchanged).
- **Crash games** (`components/predictor/crash/`) — immersive video pages
  keep the full-screen video, but the veil is now warm paper cream
  (`bg-[#FBF6EC]/60` + cream gradient) and the floating panel is cream
  glass (`bg-[#FBF6EC]/90`, ink text, terracotta CTAs). Top nav chips are
  cream glass with ink text; the active game chip is solid terracotta.
  `MinimalStage`: white stage card, ink numbers, per-game bars remapped
  (sporty-jet cyan → indigo, sportyhero emerald → terracotta, test-flight
  emerald → teal). `panels.tsx` (NextRunPanel/RunHistory): white panel,
  phase dots/text in success/warning/indigo/destructive, history chips in
  light destructive/muted/success. Run button is solid terracotta for
  every game (per-game colour lives only in the stage glow wash); Stop is
  light destructive; credits pill is a terracotta wash; error is light
  destructive; "Top up" is solid terracotta. `gameThemes.ts` glow/wash
  values are unchanged (subtle per-game washes).
- **Mines / Bottle / analytics** — `MinesBoard.tsx`: white board card,
  ink controls, Cash out is solid terracotta, selected tile is a
  terracotta wash, diamond glow is terracotta (`rgba(225,77,42,0.8)`),
  scan highlight is success teal. `BottleArena.tsx`: white arena card,
  ink title, UP zones success teal, spin button solid terracotta, spinner
  is a cream veil. `BottleRounds.tsx` / `RoundCustomization.tsx` /
  `SuperadminNextRuns.tsx`: white cards, ink text, win/save buttons solid
  terracotta, loss buttons solid destructive, kill-switch box light
  success. `ActionAnalytics.tsx` / `PenaltyAnalytics.tsx` /
  `charts.tsx`: `bg-card` panels, ink figures, selected zone indigo.
  `SignalMeter.tsx`: "Confidence meter", "Strong/Moderate/Weak call",
  bars solid terracotta. `PredictorReveal.tsx`: "Call locked",
  "Weighing the factors…", bar solid terracotta. `FairnessVerifier.tsx`:
  success/destructive verdicts. `AutoFollow.tsx`: warning "paper money"
  chip, success/destructive P&L. `SimulationLab.tsx`: ink headings,
  `btnPrimaryCls` used directly (old gradient no-op removed).
- **Predictor chrome** (`components/predictor/terminal.tsx`) — full light
  rewrite: white panels, sand borders, `shadow-soft`, `StatCard` values
  mono, tones remapped (up→success teal, down→destructive,
  warn→warning, info→secondary), teal LiveBadge, white inputs with
  terracotta focus, solid terracotta primary buttons.
- **Scan** (`routes/scan.tsx`, `scan-slip.tsx`) — hero cream band, scan art
  alt "Slip Scan", plan-card amount Fraunces `text-5xl`, plan name plain,
  step labels plain ("Step 1 — Plan & country"), BuyScan amount card is a
  ticket with kente strip + Fraunces amount, country tabs plain text.
  Result-card notes: mismatch `bg-warning/15 text-warning-foreground`
  (warning emoji removed), unverified/recovered `bg-muted`, slip-pick chip
  `bg-muted`. `ScanPickCard.tsx`: draw badge is a solid terracotta circle
  (was unreadable white-on-white/10); team monograms keep white text on
  real club colours (data, not brand).
- **Pricing / manual payment** (`routes/pricing.tsx`,
  `manual-payment.tsx`) — hero band cream; amount card is a perforated
  ticket (kente strip, Fraunces `text-5xl` amount, mono `usdApprox`, mono
  "30 credits" in terracotta); numbered 1-2-3 vertical timeline above the
  recipient card (Send → Submit proof → Approved); country tabs plain
  "Ghana"/"Nigeria" (flag emoji removed). `payment-details-card.tsx`: pay
  slip with kente strip top edge, sentence-case headings ("Pay with Mobile
  Money" / "Pay with bank transfer"), "Send payment to" in terracotta,
  plain labels, mono values `text-lg font-semibold tabular-nums`, copy
  buttons as sand chips.
- **Payment waiting / success** — approved check circle `bg-success
  shadow-soft`, "Taking you there…" dot teal, pending state is a queue
  ticket (kente strip, teal pulsing dot, "An admin reviews every payment
  — usually within minutes."). Success card: teal check, ink title, muted
  redirect line with teal dot.
- **Auth pages** — `login.tsx` / `register.tsx`: split screen, terracotta
  left panel (kente strip, weave mark, Fraunces headline "Welcome back." /
  "Your wallet is waiting.", three steps in cream, "One account, every
  game. 30 credits for GH₵400 — they never expire."), white form card on
  cream right; mobile collapses to a short top band. Logic unchanged
  (resume destination, `?redirect=`, AuthSplash handoff); video preload
  links removed. `admin.login.tsx` / `superadmin.login.tsx`: same split
  screen with an **indigo** left panel ("Staff sign in."), indigo icon
  tile, "New admins are created by the super admin." note in
  `bg-secondary-soft text-secondary`.
- **Dashboard** (`routes/dashboard.tsx`) — re-skinned to the wallet view:
  credit balance is the hero figure (mono, Fraunces label "Your credit
  wallet") via `GET /api/credits/balance`, with "5 credits per scan or
  play · Never expires · Top-ups stack" and a Top up button; the legacy
  session countdown stays below as a secondary card; three white link
  cards (Engines / AI betting-slip scan / Need more credits?); "Need more
  hours?" copy fixed to credits.
- **Admin / super-admin** (`admin.index.tsx`, `superadmin.index.tsx`) —
  titles already swept; fixed: admin Mines playtest box is now a
  terracotta wash (was emerald); super-admin "Simulator" tab is indigo;
  `depositStatusBadge` / `userStatusBadge` use light success/destructive/
  warning-foreground; `text-slate-*` → muted/foreground; `divide-white/5`
  → `divide-border`; stat-card values are `font-mono`; "Recent activity"
  Live pill is teal. Flag emoji kept in super-admin data rows (inline
  country labels in staff tables, not icons).
- **Simulator pages** (`routes/simulator*.tsx`) — page background was
  near-black `bg-[#020a05]` → `bg-background` on all six pages; every
  page now carries an unmissable indigo banner at the top:
  "SIMULATION — practice play only. No real money, no real credits."
  (the dynamic one-time notice on `simulator.tsx` is indigo too).
  Error boxes are light destructive; check icons / success states are
  success teal; `bg-red-600` buttons are `bg-destructive`.
- **Splash / scan media / fx** — `auth-splash.tsx` + `engine-intro.tsx`:
  woven splash (kente mark, cream, weave progress, tap-to-skip, 2.6s hard
  cap); video retired. `ScanMedia.tsx`: still slip-preview card + kente
  weave progress + Cancel button, no video element. `Fx.tsx`: `MatrixRain`
  deleted; `Tilt`/`Reveal` kept (unused). `window-ui.tsx`: countdown pill
  white with teal/red text; TimeUp/OutOfCredits overlays are white cards
  with a kente strip top edge and terracotta CTAs; scrim `bg-black/40`.
  Modal scrims in `ui/alert-dialog.tsx`, `ui/dialog.tsx`,
  `ui/drawer.tsx`, `ui/sheet.tsx` lowered from `bg-black/80` to
  `bg-black/40`.
- **Brand-string sweep** — `Dark Web AI Slip Scanner`→`Kente AI Slip
  Scanner`, `Dark Web AI`→`Kente AI`, `Dark Web Lab`→`Kente Lab`,
  `Initializing Dark Web engine…`→`Warming up the Kente engine…`,
  `Dark Web`→`SignalVault`, `DARK WEB`→`KENTE PICKS` (33 files: src, api,
  lib, docs, README, GAMES_AUDIT, GO-LIVE-CHECK). `lib/services/ai.js`
  system prompt "Kente AI", `X-Title` "Kente AI Slip Scanner";
  `api/index.js:2034` version "SignalVault build"; `local-server.js` log
  updated; `lib/services/engines/index.js` provider "Kente Lab";
  `gameThemes.ts` kicker "Kente Lab · Sandbox". "Signal" user-visible
  labels renamed to call wording (see above); "terminal" copy → "desk".
- **Assets deleted (unreferenced, grep-verified):**
  `public/games/mines-engine-card.png` (3.4 MB), `public/games/aviator-logo.png`
  (116 KB), `public/fonts/f1–f12, f14–f18.woff2` (~4 MB; only f13 Material
  Symbols is referenced). `public/games/instant-virtuals.png` KEPT (the
  Slip Scan tile art). `public/games/test-flight.png` KEPT (referenced by
  the engines API). `public/hero-a.webp` and `src/assets/hero.jpg` deleted
  (hero has no photo now).
- **`.env.example`** — header "SignalVault", `APP_FRONTEND_BASE_URL` /
  `APP_PLATFORM_FRONTEND_URL` set to `https://kentepicks.example.com` as an
  explicit placeholder (real deploy URL to be set at deploy time; noted in
  file). The `skypredictr_api_base` localStorage-key comment left as-is
  (deliberate non-rename).

## What still references the old brand, and why (deliberate non-renames)

- localStorage keys `darkweb_api_base`, `darkweb_email`,
  `darkweb_manual_id`, `darkweb_scan_id`, `darkweb_scan_result`,
  `darkweb_sim_*`, `darkweb_deploy_reloaded_for*`; sessionStorage
  `darkweb_user_token`, `darkweb_admin_token`, `darkweb_admin_role`.
- Provably-fair seeds `darkweb-demo-jet-v1`, `darkweb-demo-aviator-v1`,
  `darkweb-demo-hero-v1`, `darkweb-demo-lab-v1` in
  `lib/services/engines/index.js`.
- `dw-` CSS class names (definitions changed, names stay); SVG gradient
  ids where the SVG survives.
- Simulator identity `superadmin-simulator@darkweb.local` + `simtok_`
  prefix; all 163 `/api/…` paths; 42 DB table/column names; plan codes
  (`PREMIUM`, `SCAN_550`, etc.); engine ids; setting keys
  (`virtual_predictions`, `bottle_round_calls`, `payment_details`);
  credit-ledger reason codes; error code `CREDITS_EXHAUSTED`;
  `sidebar_state` cookie; referral codes (random, no brand prefix);
  `package.json` name `"darkweb"`.
- `src/components/predictor/terminal.tsx` file/import name (component
  name is code, not user-visible copy); `src/lib/team-crests.ts` crest
  colours are real club colours (data, not brand).
- Stale upstream names in dead code/comments (`VirtuWin`, `AkwaPay` /
  `Paystack` / `ShinobiPay` / `WebRabbit`) left alone except the
  `.env.example` header/URLs.
- Built-output chunk filename `terminal-*.js` (the component's file name,
  not rendered text). `AbortSignal` / fetch `signal:` in minified JS
  (code, not copy).

## Verification results

- **Build:** `npm run build` exits 0, clean (only pre-existing Radix
  `"use client"` warnings from node_modules). Rebuilt after the asset
  deletion — still 0.
- **Built-output banned-string grep** (`.output/public`): zero matches for
  `Dark Web`, `SignalVault`, `Onyx`, `Royale`, `underground`,
  `#00cc66`, `#4dff9d`, `#00e67a`, `#F2C230`, `#D4FF3F`, `Unbounded`,
  `Syne`, `Space Grotesk`, `JetBrains Mono`, `vault`. Remaining
  `darkweb` occurrences in built JS are only the kept keys/seeds listed
  above (`darkweb_api_base`, `darkweb_user_token`, `darkweb_scan_result`,
  `darkweb_sim_*`, `darkweb_deploy_reloaded_for`, …). One real catch
  during the pass: `MinesBoard.tsx` had a `drop-shadow-[0_0_6px_rgba
  (0,230,122,0.8)]` (old signal green) — fixed to terracotta
  `rgba(225,77,42,0.8)` and rebuilt.
- **Auth battery (local dev API, 7/7 PASS):** register 200 + token →
  `GET /api/auth/me` 200 → logout 200 → `/me` after logout 401 → login
  right password 200 → wrong password 401 → duplicate register 409.
  Disposable user `kptestverify` / `kptest-verify@example.com`, deleted
  afterwards (0 rows remain in the dev DB).
- **Money facts (live local API):** `GET /api/payment/plans` →
  PREMIUM, GH₵400. `GET /api/credits/balance` → balance 0, costPerUse 5,
  packCredits 30, packPriceGhs 400, packPriceNgn 75000.
  `GET /api/payment/details` → KINSMAN SUSU VENTURES-SEKONDI 0541568542 /
  Access Bank 1945116494 Amadi Victor Chinaemeze. Engines list: 6 live.
- **Screenshots: NOT YET DONE — handed off (see below).** The implementer
  subagent cannot operate a live browser. The servers are left running
  and a ready-to-run script is provided:
  `verification/kp-shots.js` (Puppeteer, same rig pattern as
  `~/workspace/flashsports-temp/rig/probe3.js`: relay on 127.0.0.1:18080,
  `--ignore-certificate-errors`, 1280x900 + 390x844, console/pageerror/
  failed-request capture, horizontal-overflow check at 390px, PNGs +
  `report.json` into `verification/shots/`).

### How to run the screenshot pass (browser-capable agent)

1. Relay: `cd ~/workspace/flashsports-temp/rig && node relay.js`
   (127.0.0.1:18080).
2. API: `cd /tmp/kp-api && node local-server.js` (port 8080) — already
   running; it is a CJS shim (local-server.js + symlinks to the repo's
   `api/`, `lib/`, `node_modules`) with a 0600 `.env` pointing at the
   disposable Neon project `kentepicks-dev` (`purple-river-53963149`).
3. Frontend: `cd ~/workspace/darkweb-rebrand/rebrand2 &&
   VITE_API_BASE_URL=http://localhost:8080 npx vite dev --port 5173
   --host 127.0.0.1` — already running; home serves 200 with title
   "SignalVault — Credits & AI Slip Scan".
4. `cd ~/workspace/darkweb-rebrand/rebrand2/verification && node kp-shots.js`
   (optionally with `KP_TEST_TOKEN=<token>` for the logged-in pages;
   create a disposable user via the API first, delete it after).
5. Check per page: zero console/page errors, no horizontal overflow at
   390px, zero "Dark Web"/"SignalVault" visible, zero banned gold/
   obsidian styling, no screen that could pass for SignalVault with the
   logo swapped. Also watch the three immersive video pages
   (`/predictor/aviator`, `/predictor/sporty-jet`, `/predictor/sportyhero`)
   for old-brand UI inside the video pixels — if a frame shows it, raise
   the cream veil opacity (CrashPredictor `bg-[#FBF6EC]/60`) or drop that
   video to a still.

### Dev-database setup (what was done, and what is still owed)

- Disposable Neon project `kentepicks-dev` (`purple-river-53963149`,
  aws-us-west-2, PG18) created via the Neon MCP connector. Schema applied
  from `lib/schema.sql` (42 tables) via `run_sql_transaction` in chunks.
  App role `kentepicks_app` (read_write) created; `GRANT CREATE ON SCHEMA
  public` applied. **Ownership transfer FAILED** — the MCP SQL user cannot
  `SET ROLE kentepicks_app`, and `GRANT kentepicks_app TO neondb_owner`
  is also denied. Consequence: the app role cannot run the codebase's
  runtime DDL (`CREATE TABLE IF NOT EXISTS` / `ALTER TABLE` in
  `lib/services/admin.js`, `commission.js`, `skyAccount.js`), so the local
  API runs on the **owner connection** (`get_connection_string`, stored
  only in 0600 `.env` files in the repo root and `/tmp/kp-api/.env`).
  This is a local-verification-only arrangement for a disposable project.
- **Owed after the screenshot pass:** delete the Neon project
  `purple-river-53963149` (there is no `delete_project` in the Neon MCP
  `ALLOWED_TOOLS` yet — it needs a reviewed add, or delete it from the
  Neon console), delete `~/workspace/darkweb-rebrand/rebrand2/.env` and
  `/tmp/kp-api/.env`, shred `/tmp/kp-role-pw.txt` and
  `/tmp/kp-owner-url.txt`, and stop the dev servers.
- **Pre-existing upstream quirk (not introduced by this rebrand):**
  `node local-server.js` fails as-is because `package.json` has
  `"type": "module"` while `local-server.js` / `api/` / `lib/` are
  CommonJS. The local run uses the `/tmp/kp-api` CJS shim (see above).
  `dev:api` should be fixed upstream or documented; the rebrand did not
  change it.

## Deviations from DESIGN.md (with reasons)

- `warning-foreground` set to `#92400e` (dark amber) instead of white —
  DESIGN's front matter does not define it, and white text on the light
  warning chips (`bg-warning/15`) used in pricing/manual-payment/scan/
  simulator would be unreadable. `destructive-foreground` stays white
  (used on solid red shadcn buttons).
- `.env.example` frontend URLs set to `https://kentepicks.example.com` as
  an explicit placeholder — no real deploy URL exists yet; the deploy
  step must replace it or SSR loaders fall back to `127.0.0.1:8080`.
- `AuthSplash`'s `src` prop kept (ignored) for call-site compatibility;
  the register call site no longer passes a video `src`.
- `Tilt`/`Reveal` exports kept in `Fx.tsx` (unused) for compatibility;
  only `MatrixRain` was deleted per contract.
- Engine-detail hero: white h1/blurb and the `bg-black/60` tag chip stay
  because they sit on the game key art (the scrim was lightened instead,
  per DESIGN's "or lighten scrim" alternative); the live line uses light
  teal `text-teal-200`/`bg-teal-300` for contrast on that dark scrim.
- Copy corrections to match the frozen credit model (not feature
  changes): register subcopy "After signup, one Premium pass unlocks each
  game for 24 hours" → "After signup, top up 30 credits for GH₵400 —
  they never expire."; home FEATURES card "Timer starts at payment" →
  "Credits never expire"; manual-payment step 3 "releases your one-time
  password here" → "the credits land in your wallet."
- No `og:image` added (none generatable in this pass). No PWA manifest
  (per contract).

## Deliberately left as-is

- All logic untouched: routes, API paths, request/response shapes, form
  fields, validation, cookies/localStorage keys, game slugs, engine ids,
  plan codes, provably-fair seeds, table names. Only `api/` / `lib/`
  changes are brand strings listed above.
- Plaintext `sky_users.password` is pre-existing and out of scope — do
  not "fix" silently; flag to Prince separately (per DESIGN.md).
- `src/assets/hero.jpg` deleted; `hero-a.webp` deleted (hero has no
  photo). The three immersive videos (`aviator-bg.mp4`,
  `sportyjet-bg.mp4`, `sportyhero-bg.mp4`) are kept; their pixels were
  not re-cut — see the screenshot-pass note above.
