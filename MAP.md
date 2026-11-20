# MAP — "Dark Web" work copy → second rebrand (rebrand2)

> **Scope.** Read-only inventory of `~/workspace/darkweb-rebrand/rebrand2/`
> (the "Dark Web" app, a SkyPredictor clone). The implementer rebrands **this
> copy only**. Do **not** touch SignalVault (`~/workspace/darkweb-rebrand/signalvault/`,
> live at https://signalvault-theta.vercel.app) or its database.
> All counts below were verified by `find`/`grep`/reading the files on
> 2026-11-19. Where the task brief's §5 premise differs from what is actually
> in this copy, the map says so explicitly — see **§0, the three divergences**.
> Those are the riskiest facts in this job.

## §0 — READ THIS FIRST: three divergences from the brief (verified)

The brief's §5 describes SignalVault's **later** state (tiers/virtuals/uploads
work of 2026-11-17/19, in `signalvault/` only). **None of it is in this copy.**
This copy is the pre-tiers, pre-virtuals, pre-self-hosted-uploads state:

| Brief §5 claim | What is actually in `rebrand2/` | Where the brief's version lives |
|---|---|---|
| Pricing tiers GH₵250→20, 300→25, 500→40, 1000→80 credits | **Single pack: 30 credits for GH₵400 (NGN 75,000), 5 credits/use.** `CREDIT_PACK = { credits: 30, priceGhs: 400, priceNgn: 75000, costPerUse: 5 }` in `src/lib/api.ts:165-171` and `PACK_CREDITS = 30 / PACK_PRICE_GHS = 400 / PACK_PRICE_NGN = 75000` in `lib/services/credits.js:33-37`. Approval grants are **pro-rata**: `creditsForPayment` = `round(paid / 400) * 30` (GHS) — so GH₵800 earns 60, GH₵550 earns 41 (`lib/services/credits.js:150-160`). | `signalvault/lib/services/credits.js` `PACKS` table (STARTER/STANDARD/PREMIUM/VAULT) + `signalvault/src/lib/api.ts` `CREDIT_PACKS`. Porting the tiers is a **feature port, not a preserve**. |
| Manual-deposit recipient Telecel Cash **0509620668 / THERESAH MENSAH** | **Ghana: KINSMAN SUSU VENTURES-SEKONDI, MoMo 0541568542. Nigeria: Access Bank, 1945116494, Amadi Victor Chinaemeze.** Code defaults in `lib/services/settings.js:106-113` (`PAYMENT_DETAILS_DEFAULTS`) and offline fallback `src/lib/api.ts:250-257` (`PAYMENT_DETAILS_FALLBACK`) — the two must match. Overridable at runtime by super-admin via `PUT /api/settings/payment-details` (stored in `platform_settings`, key `payment_details`). | `signalvault/lib/services/settings.js:109-110` and `signalvault/src/lib/api.ts:261`. The Theresah recipient was set on SignalVault 2026-11-11; it was **never** applied to this copy. If the new brand is meant to use it, that is a deliberate money change, not a rebrand. |
| Self-hosted uploads: Neon `uploads` table, `POST /api/upload`, `GET /api/uploads/:id`, "do NOT reintroduce ImgBB" | **ImgBB is the current state here.** `POST /api/upload` (`api/index.js:463-476`) forwards the file to `https://api.imgbb.com/1/upload?key=…` using `IMGBB_API_KEY`; on missing key it 503s ("Add IMGBB_API_KEY to the Vercel Production environment"). **No `uploads` table** in `lib/schema.sql` (42 tables, none named `uploads`); **no `GET /api/uploads/:id` route** (163 API routes, none matching). `grep uploads lib/ api/ src/` finds only the multer setup + the ImgBB call. | `signalvault/api/index.js:469-515` creates `uploads (id, mime, data_b64, created_at)` inline and serves `GET /api/uploads/:id`. Removing ImgBB here = **porting SignalVault's upload implementation**, not keeping the status quo. |
| "Virtuals engine" (`/virtuals`, leagues, betting) | **No `/virtuals` route, no virtuals engine, no `virtuals-api.ts` in this copy.** "Instant Virtuals" here is only a **label on the AI slip-scan tile**: `src/routes/predictor/route.tsx:45` (`TOOL_NAV: { to: "/scan", name: "Instant Virtuals" }`) and `src/components/predictor/casino-lobby.tsx:68-70` (tile uses `public/games/instant-virtuals.png`). The only virtuals-related backend is a kill switch: `GET/PUT /api/settings/virtual-predictions` (`api/index.js:746-758`, key `virtual_predictions` in `platform_settings`, default OFF) gating the scan tile via `src/lib/use-game-access.ts`. | `signalvault/src/routes/virtuals.tsx` + `signalvault/src/lib/virtuals-api.ts` (3 fictional leagues, 3-minute rounds, seeded generator `signalvault-virtuals-v1:<roundId>`, 5-credit min stake). Porting it is a feature port. |

**Consequence for the implementer:** do not "preserve" the §5 tiers/recipient/uploads/virtuals by copying them from the brief — first decide with Prince whether this rebrand is (a) a pure visual rebrand of this copy as-is (keep 30cr/GH₵400, Kinsman/0541568542, ImgBB, no virtuals), or (b) a rebrand **plus** a port of SignalVault's later money/virtuals/upload work. The map below documents the as-is state; §5 of the map lists the as-is money rules.

---

## Verified counts (all counted 2026-11-19)

| Area | Count | How verified |
|---|---|---|
| Total files (excl. `node_modules`, `.git`) | **244** | `find . -type f \| wc -l` |
| Frontend route files | **32** (`src/routes/`, incl. `__root.tsx` + `README.md`) → **29 public URLs** | file list §2 |
| Frontend components | **82 files**: `ui/` 49, `predictor/` 25, `site/` 4, `fx/` 1, `auth-splash.tsx`, `engine-intro.tsx`, `window-ui.tsx` | `find src/components -type f` |
| CSS files | **2**: `src/styles.css` (496 lines), `src/fonts.css` (564 lines) | `find src -name '*.css'` |
| API routes in `api/index.js` (2,058 lines) | **163** — GET 82, POST 68, PUT 7, DELETE 6; all under `/api/` | Python regex over `app.(get\|post\|put\|delete)('…')` |
| Backend JS files | **43** (`api/` + `lib/`, incl. `api/cron/reconcile.js`) | `find lib api -name '*.js'` |
| Backend services | **31 files** in `lib/services/` (+ `lib/services/engines/` 8 files) | `ls lib/services` |
| SQL tables in `lib/schema.sql` (720 lines) | **42** `CREATE TABLE IF NOT EXISTS` | `grep -c` + name list §6 |
| Public assets | **~14 MB total**: `public/` 14 MB (fonts 4.3 MB, videos 4.7 MB, games 4.9 MB), `src/assets/hero.jpg` 144 KB | `du` + per-file `ls -lh` §8 |
| `src/` files total | **133** (113 `.tsx`) | `find src -type f` |
| No Prisma, no `manifest.json`, no `sitemap.xml` | — | `find` for `manifest*`/`*.prisma` returns nothing |

Stack (from `package.json`, `vercel.json`, `vite.config.ts`): TanStack Start
1.168 + TanStack Router 1.170 + React 19.2, Tailwind CSS v4 (`@tailwindcss/vite`
4.2.1), Vite 8, Nitro/Cloudflare output via `@lovable.dev/vite-tanstack-config`
2.13.0. Backend: Express 4.19 + `@neondatabase/serverless`, plain SQL in
`lib/schema.sql` + self-healing `ensureSchema` blocks in services (no ORM).
`package.json` name is `"darkweb"`, `private: true`. Scripts: `dev` (`vite dev`),
`build` (`vite build`), `build:dev`, `preview`, `lint`, `format`,
`dev:api` (`node local-server.js`).

---

## 1. Shell / layout / theme

### Root layout — `src/routes/__root.tsx` (283 lines)
- The only layout. `RootShell` renders `<html lang="en"><head><HeadContent/></head><body>{children}<Scripts/></body></html>`.
- `RootComponent`: wraps everything in `QueryClientProvider`; non-immersive
  pages get `<div class="flex min-h-screen flex-col"><Header/><main><Outlet/></main><Footer/></div>`; **immersive pages get no Header/Footer**: `/predictor/aviator`, `/predictor/sporty-jet`, `/predictor/sportyhero` (checked in both `__root.tsx` and `src/routes/predictor/route.tsx`, `VIDEO_GAMES`).
- Global extras mounted here: `<Toaster position="top-center" richColors />`
  (Sonner), `<SupportFloat />` (on every page incl. immersive), and
  `<DeployVersionWatcher />` — polls the live document + `GET /api/version`
  every 5 min and reloads once per deployed build SHA (keys §6).
- Head/meta (lines 84-112): title **`Dark Web — Credits & AI Slip Scan`**,
  description *"Dark Web is the underground predictor vault. 30 credits for
  GH₵400 — full access to every game engine and AI slip scan, 5 credits per
  play. Pay by Mobile Money or bank transfer."*, author `Dark Web`,
  `og:type website`, `twitter:card summary_large_image`; preloads
  `/fonts/f13.woff2` (Material Symbols) and `/fonts/f17.woff2` (Unbounded
  latin); favicon `/favicon.svg`; stylesheet `../styles.css?url`.
- 404 + error components are inline in this file (404 page, "This page didn't
  load" + Try again / Go home).
- `src/router.tsx` (16 lines): `createRouter({ routeTree, scrollRestoration: true, defaultPreloadStaleTime: 0 })`. `src/routeTree.gen.ts` is auto-generated — do not hand-edit. `src/routes/README.md` documents file-routing conventions.

### Header / nav — `src/components/site/Header.tsx`
- **Deliberately minimal: logo only, no nav links, no login button.**
  Sticky top-0, `bg-background/80 backdrop-blur-xl`, inner `max-w-6xl h-16`,
  renders `<Brand />` (a `Link to="/"` wrapping `Logo`). There is **no**
  centre nav, no "Get access" button, no mobile menu — unlike SignalVault,
  whose rebrand added those. Any new nav belongs here.
- The predictor area has its **own** chrome instead: `src/routes/predictor/route.tsx`
  (`PredictorLayout`) — desktop collapsible sidebar (248px / 68px collapsed,
  `bg-[#04120a]/90`, brand block "DARK WEB / Analytics Terminal" with a Radio
  icon) + mobile bottom chip nav (~59px tall). See §2.

### Footer — `src/components/site/Footer.tsx`
- 4 columns: brand + *"Timed access passes and AI betting-slip analysis, built
  for Ghana. Pay with Mobile Money, get in, get value."*; Product (Access
  plans `/pricing`, AI slip scan `/scan`, Manual payment `/manual-payment`);
  Account (Register `/register`, Log in `/login`, My session `/dashboard`);
  Staff (Admin login `/admin/login`, Super admin login `/superadmin/login`).
- Bottom bar: `© {year} Dark Web. All rights reserved.` + *"Passwords are shown
  once. Save them safely."*

### Logo — `src/components/site/Logo.tsx`
- `LogoMark`: inline SVG 48×48, hexagonal vault, deep-green gradient
  (`#02120a → #063d21 → #0a5c2e`, gradient ids `dw-badge`, `dw-pulse`,
  `dw-halo`), signal-green pulse polyline `#00cc66 → #4dff9d`, glowing node.
- `Logo`: wordmark `DARK` + gradient `WEB` (`text-gradient dw-glow-text`,
  `font-logo`, uppercase, tracking 0.01em) + `GH` pill chip (hidden when
  `compact`). Used by Header (`Brand`) and Footer.
- Favicon mirrors it: `public/favicon.svg` (879 B, same green hexes, ids
  `dw-b`/`dw-h`) + `public/favicon.ico` (20 KB).

### Support float — `src/components/site/SupportFloat.tsx`
- Fixed Telegram pill ("Support" / "Chat with support"), Telegram blue
  `#229ED9`, links to **`https://t.me/pycuepay`** (hardcoded `SUPPORT_URL`).
  `aria-label="Chat with Dark Web support on Telegram"`. Mounted in `__root.tsx`.

### Theme tokens — `src/styles.css` (496 lines) — **the single place colours live**
- Tailwind v4: `@import "tailwindcss"`, `@theme inline` maps `--font-*` /
  `--color-*` to `:root` / `.dark` oklch tokens. Header comment: *"Dark Web
  design system — deep green on black. Underground terminal luxury. Palette
  lock: near-black green base, ONE accent (signal green), amber only for
  warnings. All colors are oklch tokens. Never hardcode colors in components."*
  (Components do still hardcode some greens — e.g. predictor layout
  `bg-[#020a05]`, `bg-[#04120a]/90`, `shadow-[0_0_24px_rgba(0,230,122,0.45)]` —
  a rebrand sweep must grep `#0…` / `rgba(0,230,122` / `emerald-` too.)
- Fonts: `--font-sans: "Space Grotesk"`, `--font-display: "Unbounded"`,
  `--font-mono: "JetBrains Mono"`, `--font-logo: "Unbounded"`.
- Core tokens (`:root`, dark-only app; `.dark` block repeats them slightly darker):
  `--background oklch(0.085 0.024 164)`, `--foreground oklch(0.93 0.035 152)`,
  `--card oklch(0.125 0.032 162)`, **`--primary oklch(0.79 0.195 152)` (signal
  green — the one accent)**, `--primary-foreground oklch(0.09 0.03 160)`,
  `--secondary oklch(0.42 0.115 158)` (deep vault green), `--muted`,
  `--accent oklch(0.19 0.055 158)`, `--destructive oklch(0.62 0.21 25)`,
  `--success` = primary green, `--warning oklch(0.8 0.15 80)` (amber),
  `--border/--input/--ring` = primary at 15%/20%/100%, `--radius: 1rem`
  (radius scale `sm` … `4xl` derived from it), gradients `--gradient-hero`
  / `--gradient-brand` (green) / `--gradient-soft`, shadows `--shadow-soft`
  / `--shadow-lift` / `--shadow-glow` (green glow).
- Animations: `float`, `rise`, `shimmer`, `pulse-ring`, `success-pop`;
  `dw-*` utility classes defined here — see §6 (do not rename).
- `src/fonts.css` (564 lines): self-hosted `@font-face` for **Syne 600/700/800**,
  **Space Grotesk**, **JetBrains Mono**, **Unbounded** (check: the file's
  families are Syne, Space Grotesk, JetBrains Mono, Unbounded — plus Material
  Symbols Outlined in `styles.css:451`), all served from `/fonts/f1…f18.woff2`
  with unicode-range subsets. Note: **Syne is bundled but `styles.css` does
  not use it** (display font is Unbounded) — SignalVault's rebrand switched
  display/logo to Syne without adding files.
- No light theme: `:root` is already dark; `.dark` only deepens it. There is
  no theme toggle in the UI (grep found none).

### Other shell pieces
- `src/components/auth-splash.tsx` — post-login/register full-screen video
  splash (`/videos/auth-access.mp4`, `/videos/auth-register.mp4`).
- `src/components/engine-intro.tsx` — per-engine intro overlay
  (`/videos/engine-access.mp4`).
- `src/components/fx/Fx.tsx` — matrix-rain / FX layer (SignalVault rebrand
  re-tinted its rain; check its colour constants on the sweep).
- `src/components/window-ui.tsx` — window chrome helpers.
- `src/lib/use-window.ts`, `src/lib/device.ts` — window/device helpers.
- No dock/bottom bar except the predictor mobile chip nav (§2) and the
  SupportFloat offset for it (`max-md:bottom-[calc(4.75rem+env(safe-area-inset-bottom))]`).

---

## 2. Every user-facing page / route (29 URLs, 31 route files)

File routing: `src/routes/<name>.tsx` → `/<name>`; `index.tsx` → `/`;
`$gameId.tsx` → `/:gameId`; `predictor/route.tsx` is the predictor layout
(no URL of its own). All pages carry per-route `head()` titles — nearly all
end in "— Dark Web" (full list in §4).

| URL | File | Purpose / main components |
|---|---|---|
| `/` | `src/routes/index.tsx` | Landing. Hero (photo `src/assets/hero.jpg` + `public/hero-a.webp`, `dw-hero-shade`, terminal card `credits_topup — GH₵400 · 30 CREDITS · ALL ENGINES`), marquee (`dw-marquee-track`), "Games we cover" cards (6 engines, from a local `GAMES` list), "Why people stick with Dark Web", testimonials, FAQ accordion, pricing CTA. Copy: *"Dark Web reads crash, penalty and hero games live — and scans your slip with AI."* |
| `/login` | `src/routes/login.tsx` | **Main site-user login page** (see §3). `?redirect=` supported. Preloads `/videos/auth-access.mp4`; post-login splash via `auth-splash.tsx`. |
| `/register` | `src/routes/register.tsx` | Site-user sign-up: name + email + username + own password (+ optional referral code). Preloads `/videos/auth-register.mp4`. Creates `sky_users` row + token immediately (no email verification). |
| `/dashboard` | `src/routes/dashboard.tsx` | "My session" — legacy timed-session countdown (`GET /api/protected/status`, `StatusData`), links to features. `robots: noindex`. Largely legacy now that credits gate access; still live. |
| `/pricing` | `src/routes/pricing.tsx` | **Top-up / buy page.** Single Premium pack (GH₵400, 45-min legacy label in fallback) — plan picker reads `GET /api/payment/plans` with `PLAN_FALLBACK = [{ plan: "PREMIUM", hours: 0.75, minutes: 45, amountCedis: 400 }]`. Payment form: Ghana MoMo (networks `GH_NETWORKS`) / Nigeria bank (`NG_BANKS`), screenshot upload via `POST /api/upload` (ImgBB), submits to `POST /api/payment/manual/submit`. `?plan=&game=` search params. **Note:** unlike SignalVault post-2026-11-17, no guest-browse fix is recorded here — verify whether logged-out visitors are redirected to `/login` on mount before promising guest browsing. |
| `/manual-payment` | `src/routes/manual-payment.tsx` | Manual-payment checkout form (same plan picker + proof upload as pricing, standalone page). Persists `darkweb_manual_id` + `darkweb_email` in localStorage; polls `GET /api/payment/manual/status/:id`. |
| `/payment/waiting` | `src/routes/payment.waiting.tsx` | Waiting room after submitting proof — polls manual-payment status until approved/rejected. |
| `/scan` | `src/routes/scan.tsx` | **AI betting-slip scan ("Instant Virtuals" tile target).** Upload slip photo → staged AI analysis (`POST /api/scan/stage/transcribe|gapfill|verify|finalize`, `POST /api/scan/analyze`), buy tab (`SCAN_PLAN_FALLBACK = [{ code: "SCAN_550", name: "PREMIUM", amountCedis: 400, maxPicks: "FULL" }]`), history tab (`?tab=history\|buy`). Costs 5 credits on a completed scan (failed scans free). Image shown with `/games/instant-virtuals.png`. |
| `/scan-slip` | `src/routes/scan-slip.tsx` | Slip-scan workspace (upload + downscale via `src/lib/downscale-image.ts` + staged scan UI). Shares `SCAN_RESULT_KEY = "darkweb_scan_result"`. |
| `/scan-result` | `src/routes/scan-result.tsx` | Scan result view — per-fixture predictions, confidence, verification (`verified/mismatch/unverified/unreadable`), raw model output. |
| `/engines` | `src/routes/engines/index.tsx` | **Public engines lobby** (no login required): 5–6 engine cards with live stats + confidence rings, provably-fair note. Static fallback tiles exist in code; live data from `GET /api/engines`. |
| `/engines/:gameId` | `src/routes/engines/$gameId.tsx` | Public engine detail (history, stats, fairness verifier `FairnessVerifier.tsx`). |
| `/predictor` | `src/routes/predictor/index.tsx` + `route.tsx` | **Games lobby (login required).** Loader fetches `GET /api/engines` via `loaderFetch` (see §7 — SSR loader quirk); renders shared `src/components/predictor/casino-lobby.tsx` (engine tiles with lock overlays from `GET /api/games/entitlement`, Mines + Bottle tiles, Instant Virtuals tile → `/scan`). `PredictorLayout` (`route.tsx`) is immersive here (no sidebar/topbar — lobby owns the screen). |
| `/predictor/:gameId` | `src/routes/predictor/$gameId.tsx` | Per-engine analytics/terminal page (`terminal.tsx`, `PredictorReveal.tsx`, `SignalMeter.tsx`, `charts.tsx`, crash `CrashPredictor.tsx` / `MinimalStage.tsx` / `panels.tsx` / `useCrashRun.ts`, `CrashAnalytics.tsx`, `PenaltyAnalytics.tsx`, `ActionAnalytics.tsx`). Aviator / Sporty Jet / SportyHero are **immersive video pages** (full-screen, no site chrome; videos `aviator-bg.mp4`, `sportyjet-bg.mp4`, `sportyhero-bg.mp4`). 5 credits per round/tick; `POST /api/engines/:id/tick` etc. |
| `/predictor/mines` | `src/routes/predictor/mines.tsx` | Mines — "AI diamond locator" (`MinesBoard.tsx`, mine-count cap 10 = Premium tier). `POST /api/mines/play`, `POST /api/mines/payment/submit` for passes. |
| `/predictor/bottle` | `src/routes/predictor/bottle.tsx` | Spin da Bottle (`BottleArena.tsx`, `BottleRounds.tsx`) — UP/DOWN calls; super-admin can pin the next 10 calls (`GET/PUT /api/settings/bottle-rounds`). |
| `/predictor/history` | `src/routes/predictor/history.tsx` | Prediction history (`GET /api/analyses`, `POST /api/analyses`). |
| `/predictor/settings` | `src/routes/predictor/settings.tsx` | Predictor settings page (incl. provably-fair note; copy mentions seeded engines). |
| `/predictor/simulate` | `src/routes/predictor/simulate.tsx` | Simulation Lab (`SimulationLab.tsx`) — synthetic runs from a seed, `POST /api/engines/:id/simulate` + `.../analyze`. Never mixed into real history. |
| `/admin/login` | `src/routes/admin.login.tsx` | Admin login page → `POST /api/admin/auth/login`. |
| `/admin` | `src/routes/admin.index.tsx` | **Admin dashboard**: manual payments, scan purchases, mines purchases, scan sessions, game passes, referrals + commissions, payouts, funds, users/referred. `robots: noindex`. |
| `/superadmin/login` | `src/routes/superadmin.login.tsx` | Super-admin login page → `POST /api/superadmin/auth/login`. |
| `/superadmin` | `src/routes/superadmin.index.tsx` | **Super-admin control room**: platform stats, admin management (create/deactivate), users, commissions + payouts (approve/reject), funds/daily, transactions (Ghana/Nigeria), monitoring, payment-details editor, virtual-predictions + bottle-rounds switches, **user-flow simulator** controls. `robots: noindex`. |
| `/simulator` | `src/routes/simulator.tsx` | Staff-only QA simulator lobby — super-admin (or admin) starts a simulated user run (`POST /api/superadmin/simulator/create-session`), renders the casino lobby as that fake identity (`simtok_…` token, separate sim wallet). |
| `/simulator/payment` | `src/routes/simulator.payment.tsx` | Sim payment page (sim-only products incl. "Instant Virtuals" scan front door). |
| `/simulator/scan` | `src/routes/simulator.scan.tsx` | Sim scan page (same slip flow against sim tables). |
| `/simulator/scan-slip` | `src/routes/simulator.scan-slip.tsx` | Sim scan-slip workspace. |
| `/simulator/scan-result` | `src/routes/simulator.scan-result.tsx` | Sim scan result. |
| `/simulator/waiting` | `src/routes/simulator.waiting.tsx` | Sim payment-waiting room. |

Predictor sidebar nav (`src/routes/predictor/route.tsx`): Games — Sporty Jet,
Aviator, SportyKick, SportyHero, Super Hero, Test Flight; Virtual Predictor —
Mines, Spin da Bottle; Tools — Instant Virtuals (`/scan`), Simulation Lab,
Prediction History, Settings. Mobile: bottom chip nav with the same items.

Components worth knowing for the rebrand (beyond `ui/`): `src/components/predictor/`
has 25 files — `casino-lobby.tsx` (the lobby), `terminal.tsx`, `MinesBoard.tsx`,
`BottleArena.tsx`/`BottleRounds.tsx`, `ScanMedia.tsx`, `ScanPickCard.tsx`,
`SignalMeter.tsx`, `PredictorReveal.tsx`, `PredictionsOffline.tsx`,
`RoundCustomization.tsx`, `SimulationLab.tsx`, `SuperadminLiveGames.tsx`,
`SuperadminNextRuns.tsx`, `FairnessVerifier.tsx`, `AutoFollow.tsx`, `charts.tsx`,
`crash/` (5 files), `fx/Fx.tsx`. `src/components/ui/` (49 files) is stock
shadcn/Radix — rebrand via tokens, not per-file edits. `payment-details-card.tsx`
and `payment-success.tsx` render the manual-payment recipient + success state.

---

## 3. Auth — the MAIN LOGIN and the staff logins

### 3.1 Site-user login (the main login) — `sky_users`
- **Table:** `sky_users` (`lib/schema.sql:509-517` + self-healing `ALTER TABLE`
  in `lib/services/skyAccount.js:20-44`): `username PK, name, email, password,
  referred_by_admin_code, created_at`, plus `active BOOLEAN DEFAULT true`,
  `deactivated_at`, `last_game`. **Passwords are stored in PLAINTEXT**
  (`skyAccount.js:163-164` inserts `String(password)`; login at `:176`
  compares `skyUser.password !== String(password)`). Contrast: admin passwords
  are scrypt hashes (`lib/util.js:31-43` `hashPassword`/`verifyPassword`,
  `scrypt$<salt>$<hash>`). The plaintext `sky_users.password` is pre-existing
  and out of rebrand scope, but the implementer must not "fix" it silently as
  part of a rebrand — flag it to Prince separately.
- **Register:** `POST /api/auth/register` (`api/index.js:137-156`). Two paths in
  one endpoint: (a) body has `username` + `password` → casino account via
  `skyAccount.register` (name/email/username/password, optional `referralCode`;
  min password length 6; returns `{ token, user }` immediately, no email
  verification); (b) email-only → legacy scan-side `account.register` (password
  issued only when a subscription settles — see `lib/services/account.js`).
- **Login:** `POST /api/auth/login` (`api/index.js:158-179`). Accepts
  `username` **or** `email` + `password`. If the identifier matches a `sky_users`
  row → `skyAccount.login` (30-day session, see below); otherwise falls through
  to legacy scan-side `session.login` (timed plan window; refuses unpaid
  accounts, expired windows, and a second concurrent device with 409 —
  `lib/services/session.js`).
- **Me / entitlement:** `GET /api/auth/me` and `GET /api/games/entitlement`
  (both `requireSession`; sim tokens branch to sim entitlement).
  `GET /api/games/last-played`, `POST /api/games/intro-seen` (login-resume +
  once-per-window intro).
- **Logout:** `POST /api/auth/logout` (Bearer token → `session.logout`).
- **Session behaviour (site user):** DB-backed `sessions` table, opaque token
  (`generateToken()`), sent as `Authorization: Bearer <token>`. Casino
  (`sky_users`) sessions live **30 days** (`SESSION_TTL_MS = 30d`,
  `skyAccount.js:16`); one live session per casino account (fresh sign-in
  retires the old token). Legacy scan sessions expire at the plan window end.
  **No cookies are used for auth** — see §6. Ban check: `GET /api/auth/ban-status`
  (email + IP against `banned_identities` / `deposit_submission_ips`).
- **Login UI:** `src/routes/login.tsx` (page; `?redirect=`; remembers
  `darkweb_email` from localStorage to prefill; auth splash video after
  success) and `src/routes/register.tsx`. Token handling lives in
  `src/lib/api.ts:85-108` (`userToken`, `adminToken` — §6). There is **no**
  login modal — login is a full page. `src/components/auth-splash.tsx` is the
  post-auth video interstitial.
- **Protected pages** redirect to `/login` when `userToken.get()` is null
  (predictor lobby, scan buy flows, pricing submit). Dashboard uses
  `GET /api/protected/status|dashboard`.

### 3.2 Admin login — `admins` table, role `ADMIN`
- `POST /api/admin/auth/login` (`api/index.js:695-709`), UI
  `src/routes/admin.login.tsx`, dashboard `src/routes/admin.index.tsx`.
  Body `username`/`email` + `password` → `adminAuth.login` (scrypt verify,
  `active` check). Returns `{ token, role, expiresAt }`.
- Admin sessions: `admin_sessions` table, **12 h** default
  (`ADMIN_SESSION_DURATION_HOURS`, default 12 — `lib/services/adminAuth.js:32`).
  `POST /api/admin/auth/logout`. Guard middleware `requireAdmin`
  (`lib/middleware/adminAuth.js`); super-admins also pass `requireAdmin`.
- Rate limit (admin + super-admin logins only): 5 failed attempts per
  IP+username in 15 min → 429 (`api/index.js:61-100`, `login_attempts` table).
  **Site-user login has no such throttle in `api/index.js`** — verify before
  claiming otherwise.

### 3.3 Super-admin login — same `admins` table, role `SUPER_ADMIN`
- `POST /api/superadmin/auth/login` (`api/index.js:722-736`), UI
  `src/routes/superadmin.login.tsx`, dashboard `src/routes/superadmin.index.tsx`.
  Same token/session mechanics as admin, but `adminAuth.login(user, password,
  'SUPER_ADMIN')` refuses non-super-admins with 403 ("This login is for
  SUPER_ADMIN accounts only"). Guard: `requireSuperAdmin`.
- **Seed / bootstrap:** `lib/bootstrap.js` — on first request per warm container,
  if `SUPERADMIN_USERNAME` + `SUPERADMIN_PASSWORD` env vars are set and no such
  admin exists, creates a `SUPER_ADMIN` via `adminService.createAdmin`. Never
  overwrites an existing account. Old hardcoded password is gone from source
  (comment: "has shipped in source — rotate it"). **No other seed accounts
  exist in code** — there is no seed file, no demo user, no `OP-DEMO` code in
  this copy (grep for `OP-DEMO|promo` finds nothing; `OP-DEMO1` in MEMORY.md
  belongs to OnyxPlay, not this app). `.env.example` defaults:
  `SUPERADMIN_USERNAME=superadmin@platform.com`, `SUPERADMIN_PASSWORD=<redacted>`
  (placeholder, not a real password — do not treat as a credential).
- **Referral codes:** per-admin `referral_code` (unique, generated by
  `generateReferralCode()` in `lib/util.js` — check its alphabet/prefix in
  `lib/util.js` before renaming anything that looks like a prefix; `admin.js:70-82`
  retries up to 20 times for uniqueness). Default split
  `REFERRAL_DEFAULT_ADMIN_SHARE_PERCENT=30` (admin 30 / platform 70) — see §5.
  No brand-derived prefix was found (codes are random, not `DW-…` etc.).

### 3.4 Simulator / staff QA identities (not real accounts)
- `SIMULATOR_EMAIL = 'superadmin-simulator@darkweb.local'`
  (`lib/services/superAdminSimulator.js:5`). Sim runs use token prefix
  **`simtok_`** (`lib/services/simulator.js:34`), stored in `sim_runs`, with a
  **separate sim wallet** (`sim_credit_balances` / `sim_credit_ledger`) that
  can never touch real money. Sim approval grants 30 sim credits
  (`simulator.js:223-230`). Sim identities resolve in `requireSession`
  (`lib/middleware/sessionAuth.js`) and are branched on `req.userSession.sim`
  in handlers. Do not rename the email or the prefix — sim runs in flight
  depend on them.

---

## 4. Brand strings — every place the brand lives

The brand is **"Dark Web"** (wordmark `DARK WEB` + `GH` chip). Verified
occurrences: `grep -ri "dark web" src` = **51 matches**; `grep -ri "darkweb"
src api lib` = **36 matches** (mostly the §6 non-renames below). Full sweep
list (rebrand checklist — every line below needs a decision):

**User-visible (must change in a rebrand):**
- `src/routes/__root.tsx:87,91,93` — title, meta description ("underground
  predictor vault… 30 credits for GH₵400…"), author.
- Per-route `head()` titles/descriptions in **every** route file:
  `index.tsx` ("Dark Web — Credits & AI Slip Scan"), `login.tsx`,
  `register.tsx` ("Create your Dark Web account"), `dashboard.tsx`,
  `pricing.tsx` ("Top up credits — Dark Web"), `manual-payment.tsx`,
  `payment.waiting.tsx`, `scan.tsx`, `scan-slip.tsx`, `scan-result.tsx`,
  `engines/index.tsx` ("Prediction Engines — Dark Web"), `admin.index.tsx`,
  `admin.login.tsx`, `superadmin.index.tsx`, `superadmin.login.tsx`.
- `src/components/site/Logo.tsx:4,60` — comment + wordmark `DARK<span>WEB</span>`.
- `src/components/site/Footer.tsx:78` — `© {year} Dark Web. All rights reserved.`
- `src/components/site/SupportFloat.tsx:21` — aria-label "Chat with Dark Web
  support on Telegram".
- `src/routes/index.tsx:195,278,349` — hero + "Why people stick with Dark Web"
  + testimonials copy.
- `src/routes/predictor/route.tsx` sidebar brand block ("DARK WEB / Analytics
  Terminal").
- `src/components/predictor/crash/gameThemes.ts:45` — kicker "Dark Web Lab ·
  Sandbox" (Test Flight).
- `src/components/predictor/MinesBoard.tsx:18,27` — comment + "Initializing Dark
  Web engine…".
- `src/components/predictor/ScanMedia.tsx:28` — "Looping Dark Web scanning video".
- `lib/services/ai.js:125` — **AI system prompt**: *"You are Dark Web AI, an
  elite football betting analyst…"*; `:322` — OpenRouter header
  `X-Title: 'Dark Web AI Slip Scanner'`. (Model-facing: rename or the model
  keeps introducing itself as Dark Web AI.)
- `api/index.js:2034` — `GET /api/version` returns `ok('Dark Web build', …)`.
- `local-server.js` console log "Dark Web API running locally".
- `package.json` `"name": "darkweb"`; `README.md`, `AGENTS.md`, `GAMES_AUDIT.md`,
  `GO-LIVE-CHECK.md`, `docs/` — docs mention Dark Web throughout (rebrand
  docs too, or leave docs stale deliberately — decide, don't half-do it).
- `src/styles.css` header comment (design-system description) + all green
  oklch tokens + `--gradient-*` (§1).
- `public/favicon.svg` + `public/favicon.ico` (§1), `public/hero-a.webp` +
  `src/assets/hero.jpg` (hero photo — SignalVault re-graded/re-shot it; the
  phone screen in the photo may show old-brand UI — check the image before
  reusing).
- **No `manifest.json` / PWA manifest exists** (nothing to rename there; if the
  new brand wants installability, that is new work). **No TOTP / 2FA issuer**:
  `input-otp.tsx` is a stock shadcn OTP input component, not wired to any
  authenticator flow — no `otpauth://`, no issuer string found anywhere.
  **No emails are sent by this app** — no nodemailer/SMTP/sendmail; the only
  `@…` strings are placeholder emails in form fields (`you@example.com`,
  `agent1@example.com`) and the simulator address (§3.4). "Passwords are shown
  once" (Footer) refers to legacy scan-side passwords issued on approval, not
  to email delivery.

**Stale upstream brand strings (NOT "Dark Web" — older names still in the tree):**
- `.env.example` header: *"SkyPredictr — copy to .env"*; `APP_FRONTEND_BASE_URL`
  / `APP_PLATFORM_FRONTEND_URL` default to **`https://www.grokaiprediction.com`**;
  `VITE_API_BASE_URL=http://localhost:8080`. `lib/util.js` / comments reference
  **VirtuWin** (the Java original) in ~15 files (`api/index.js`, `lib/services/*`,
  `src/components/predictor/*` comments — "ported from VirtuWin('s) …").
  **AkwaPay / Paystack / ShinobiPay / WebRabbit** appear in table names, code
  comments and legacy payment paths (`akwapay_payments`, `shinobipay_payments`,
  `webrabit_*`, `payment_transactions` = Paystack) — these are dead/legacy rails
  (see §5); rename only if the new brand touches those strings, and never
  rename the table names.
- `src/lib/api.ts` comment + `local-server.js` still say "Dark Web" in places
  a brand grep for user-visible strings will miss — use the grep lists above,
  not a title-only sweep.
- **Tagline(s):** no single canonical tagline file. Candidates in copy: root
  meta *"the underground predictor vault"*; hero *"Dark Web reads crash,
  penalty and hero games live — and scans your slip with AI."*; Footer
  *"Timed access passes and AI betting-slip analysis, built for Ghana."*;
  predictor sidebar *"Analytics Terminal"*. Pick the new tagline once and
  replace all four, or they will disagree.
- **Referral code prefix:** none — codes are random (`lib/util.js`
  `generateReferralCode`); no `DW-` or brand prefix to change.

---

## 5. Money / logic that must NOT change (as-is in this copy)

**Credit model (single source of truth: `lib/services/credits.js`):**
- 1 pack = **30 credits for GH₵400 / NGN 75,000**; **5 credits per use**
  (one completed slip scan, one crash round, one bottle spin, one mines game).
  `COST_PER_USE = 5`, `OUT_OF_CREDITS_CODE = 'CREDITS_EXHAUSTED'` (403).
  Credits **never expire**, top-ups **stack**. Balance < 5 = locked out of
  every game/scan; client kicks the user to the pay-again page.
- Grants are **pro-rata on amount actually paid** (`creditsForPayment`):
  GHS `round(paid/400)*30`, NGN `round(paid/75000)*30`, min 1; exact-pack
  payment earns exactly 30. Applied on approval in `manualPayment.js:152-166`
  (`MANUAL` ref), `scanPurchase.js:369-385` (`SCAN`), `skyPayments.js:216-229`
  (`PASS`, game passes), `simulator.js:223-230` (sim wallet, flat 30).
  Ledger dedupes on `ref` — a double-approval can never double-credit.
- In-play spend happens **before** the draw for rounds/spins (refunded if the
  draw errors — `api/index.js:290-307` `spendForPlay`/`refundPlay`); **after**
  a completed scan only (failed scans cost nothing). **Staff never spend and
  never gate** (`assertGameAccess` returns `{ kind: 'staff' }` for admin/super-admin tokens).
- Wallet key = **lower-cased email** (`credits.keyForIdentities`); sim keys are
  `sim-…` identities in separate tables. `GET /api/credits/balance`
  (`requireSession`) returns the summary.
- Legacy 45-min windows / 10-scan grants grant **nothing** any more
  (credits.js header) — but the tables and grant code still exist
  (`game_windows`, `scan_sessions`, `scan grant` state in `api.ts`) for
  backwards-compat reads; do not delete them in a rebrand.

**Manual-deposit flow (the ONLY payment rail — owner decision 2026-10-22, every
gateway removed):**
- User transfers to the §0 recipient (Ghana MoMo **0541568542 / KINSMAN SUSU
  VENTURES-SEKONDI**; Nigeria Access Bank **1945116494 / Amadi Victor
  Chinaemeze**), submits plan + sender name/number + reference + screenshot
  (`POST /api/payment/manual/submit`, `POST /api/scan/payment/submit`,
  `POST /api/mines/payment/submit`, `POST /api/scan/session/submit`),
  admin approves/rejects in `/admin` (`/api/admin/manual-payments/:id/approve|reject`,
  same pattern for `game-passes`, `scan-purchases`, `mines-purchases`,
  `scan-sessions`, `manual-deposits`), credits land on approval.
  `GET /api/payment/details` serves the live recipient (super-admin editable).
- **Retired gateways — dead code, do not revive:** `POST /api/payment/initialize`
  and `GET /api/payment/verify/:reference` return errors; `GET /api/games-access/*`
  (4 routes) return a retired response; ShinobiPay/AkwaPay/Paystack/WebRabbit
  tables + `funds.js` reporting remain for history only. `IMGBB_API_KEY` is
  still required for proof uploads in this copy (§0).
- Scan grants (legacy): one approved scan purchase = up to **10 completed scans
  in a 45-min window** from first use (`api.ts` `ScanGrantState`); the credit
  wallet is now the primary gate, grants are the fallback.

**Prediction engines (`lib/services/engines/`):**
- 6 engines, singletons, pre-seeded with **120 rounds** each
  (`lib/services/engines/index.js`): `sporty-jet` (Crash, SportyBet, seed 7),
  `aviator` (Crash, Spribe, seed 42), `sportykick` (Penalty, SportyBet, seed 13),
  `sportyhero` (Crash, SportyBet, seed 99, `hero32` 32-bit variant),
  `super-hero` (Action, SportyBet, seed 5), `test-flight` (Crash · Lab, seed 123,
  RTP 0.97). Engines: `crash-engine.js` (SHA-512 multi-seed for Aviator/Jet,
  SHA-256 32-bit for SportyHero — `provably-fair.js`), `penalty-engine.js`,
  `action-engine.js`, `base-engine.js`, `rng.js` (mulberry32 seeded / Math.random),
  `stats.js`. Public: `GET /api/engines`, `GET /api/engines/:id`,
  `GET /api/engines/:id/history|fairness/:round|random-crash`,
  `POST /api/engines/:id/tick|verify|analyze|simulate`,
  `GET /api/engines/sportykick|super-hero/zones`.
- **Mines** (`lib/services/minesPurchase.js`, `POST /api/mines/play`) and
  **Bottle** (`lib/services/bottleRounds.js`, `POST /api/bottle/next`,
  super-admin-pinned next-10 pattern) are pass/credit-gated predictors, not
  separate engines. **AI slip scan** (`lib/services/ai.js`, `scanService.js`,
  `simScanService.js`): OpenRouter vision models, staged
  transcribe→gapfill→verify→finalize, `SYSTEM_PROMPT` §4; keys via
  `AI_OPENROUTER_API_KEYS` (comma-separated, up to 4).
- **Referral/commission:** admin `referral_code` on `admins`; referred user's
  payment records a commission (`lib/services/commission.js`,
  `commission_records`): admin share = amount × `admin_share_percent`
  (default **30%**, `REFERRAL_DEFAULT_ADMIN_SHARE_PERCENT`), platform gets the
  rest; currency kept separate (GHS vs NGN never summed together). Payouts:
  admin requests (`POST /api/admin/payouts/request`), super-admin approves/rejects
  (`/api/superadmin/payouts/:id/approve|reject`); reservation pattern prevents
  double-pay. **Do not change the split or the currency separation in a rebrand.**

**"Virtuals" in this copy:** only the scan tile label + the
`virtual_predictions` kill switch (§0/§2). There is no virtual-football
betting engine to preserve.

---

## 6. Deliberate non-renames from the first rebrand — DO NOT RENAME

SignalVault's rebrand report (`signalvault/REBRAND-REPORT.md`, "What deliberately
did not change") kept these because renaming breaks saved sessions, changes
provably-fair round sequences, or orphans accounts. **The same rule applies
here — this copy still carries all of them.** Complete list found by grep:

**localStorage keys (all `darkweb_*`, `src/lib/api.ts` + routes):**
- `darkweb_api_base` — API base override (`api.ts:8`, `getApiBase`/`setApiBase`).
- `darkweb_email` — remembered email (login prefill, manual/scan flows).
- `darkweb_manual_id` — last manual-payment submission id.
- `darkweb_scan_id` — last scan purchase id.
- `darkweb_scan_result` — cached scan result (`scan-slip.tsx:41`).
- `darkweb_sim_run_id`, `darkweb_sim_notice`, `darkweb_sim_scan_email`,
  `darkweb_sim_scan_id`, `darkweb_sim_scan_result` — simulator run state.
- `darkweb_deploy_reloaded_for`, `darkweb_deploy_reloaded_for_build` —
  deploy-watcher once-per-build guards (`__root.tsx:154-155`).

**sessionStorage keys (all `darkweb_*`, `src/lib/api.ts:85-87`):**
- `darkweb_user_token` (site-user Bearer token), `darkweb_admin_token`
  (admin/super-admin Bearer token), `darkweb_admin_role` (`ADMIN` /
  `SUPER_ADMIN`). Tokens live in **sessionStorage, not localStorage** — a
  rebrand that "moves tokens to localStorage for convenience" changes session
  behaviour; do not. `userToken` / `adminToken` helpers in `api.ts:89-108`
  are the only accessors.

**Provably-fair server seeds (renaming changes every round's crash point):**
- `darkweb-demo-jet-v1` (sporty-jet), `darkweb-demo-aviator-v1` (aviator),
  `darkweb-demo-hero-v1` (sportyhero), `darkweb-demo-lab-v1` (test-flight) —
  all in `lib/services/engines/index.js:18,27,45,63`. SportyKick/Super Hero use
  numeric seeds only (13 / 5).

**`dw-` CSS classes / SVG gradient ids (defined in `src/styles.css`, used in
components — renaming needs a coordinated sweep or styles silently break):**
- Classes: `dw-glow-text`, `dw-card-3d`, `dw-win-flash`, `dw-float3d`,
  `dw-blink`, `dw-scanbeam`, `dw-marquee-track`, `dw-marquee`, `dw-hero-shade`,
  `dw-scanlines`, `dw-scanline`, `dw-pulse-dot`, `dw-pulse`, `dw-pop`,
  `dw-halo`, `dw-spin-slow`, `dw-perspective`, `dw-live-dot`, `dw-grid-bg`,
  `dw-3d` (counts: `dw-card-3d` ×6, `dw-win-flash`/`dw-float3d`/`dw-blink` ×5,
  rest ×1–3 — grep `dw-[a-z0-9-]+` in `src/` to verify).
- SVG ids: `dw-badge`, `dw-pulse`, `dw-halo` (`Logo.tsx`); `dw-b`, `dw-h`
  (`public/favicon.svg`).

**Other identifiers to leave alone:**
- Simulator email `superadmin-simulator@darkweb.local` + token prefix `simtok_`
  (§3.4). `.env.example` localStorage key `skypredictr_api_base` (comment only;
  the live key is `darkweb_api_base`).
- **API paths:** every `/api/…` path (163 routes) — the frontend calls them by
  string; renaming a path without updating every caller breaks the app.
- **Cookie names:** there are **no auth cookies**. The only cookie in the app
  is the stock shadcn sidebar cookie `sidebar_state` (7-day, `src/components/ui/sidebar.tsx:21-22,85-86`) — not brand-related, leave it.
- **DB table/column names** (§6 list below), **plan codes** (`PREMIUM`,
  `SCAN_550`, `SESSION_550`, `SCAN_*`, `SESSION_*`, `MIN15`, `HOUR1`, `HOUR3`),
  **engine ids** (`sporty-jet`, `aviator`, `sportykick`, `sportyhero`,
  `super-hero`, `test-flight`, `mines`, `bottle`, `scan`), **setting keys**
  (`virtual_predictions`, `bottle_round_calls`, `payment_details`),
  **credit-ledger reason codes** (`PASS`, `MANUAL`, `SCAN`, `PLAY_<GAME>`,
  `REFUND_<GAME>`, `SIM_*`, `VIRTUAL_*` — none of the last exist here),
  **error code** `CREDITS_EXHAUSTED`, **sim token prefix** `simtok_`.
- **Package name** `"darkweb"` in `package.json` is invisible to users; the
  first rebrand left it — same call here (rename only if the deploy pipeline
  needs it).

### SQL tables — `lib/schema.sql` (42 tables)
`users`, `sessions`, `platform_settings`, `admins`, `admin_sessions`,
`payment_transactions` (Paystack legacy), `manual_payments`, `akwapay_payments`,
`akwapay_pending_subscription_intents`, `commission_records`, `payout_records`,
`scan_purchases`, `akwapay_pending_scan_intents`, `scan_results`, `scan_sessions`,
`akwapay_pending_scan_session_intents`, `mines_purchases`,
`deposit_submission_ips`, `banned_identities`, `games_access_payments`,
`webrabbit_payments`, `webrabbit_withdrawals`, `webrabbit_webhook_events`,
`login_attempts`, `shinobipay_payments`, `shinobipay_pending_intents`,
`sky_users`, `gate_payments`, `game_passes`, `game_windows`, `credit_balances`,
`credit_ledger`, `sim_credit_balances`, `sim_credit_ledger`, `game_intro_seen`,
`sim_intro_seen`, `sim_runs`, `sim_payments`, `sim_game_windows`,
`sim_scan_access`, `sim_scans`, `custom_rounds`.
Plus self-healing `CREATE TABLE IF NOT EXISTS` blocks inside services
(`credits.js` re-creates the 4 credit tables; `commission.js`, `admin.js`,
`skyAccount.js`, `settings.js` similar) — **no `uploads` table anywhere** (§0).
No Prisma schema exists. `lib/db.js` is the Neon client; `lib/bootstrap.js`
creates only the super-admin (§3.3). `lib/monitoringSchema.js` is a further
schema helper — check before touching monitoring tables.

---

## 7. Build / deploy config

- **`package.json`** — scripts §0; deps include `express`, `cors`, `multer`
  (10 MB upload limit, `api/index.js:47`), `dotenv`, `gsap`, `recharts`,
  `@neondatabase/serverless`. Root `api/package.json` + `lib/package.json`
  exist (check they are not stale duplicates before editing deps).
- **`vercel.json`** — `framework: tanstack-start`, `buildCommand: npm run build`,
  `installCommand: npm install`, `outputDirectory: .output/public`,
  `functions: { api/index.js: { maxDuration: 300 } }`,
  `rewrites: [{ source: "/api/:path*", destination: "/api/index.js" }]`,
  **cron**: `*/5 * * * *` → `/api/cron/reconcile` (session-expiry sweep only;
  payments are manual-review, `api/cron/reconcile.js`; protected by
  `CRON_SECRET` Bearer when set).
- **`vite.config.ts`** — `@lovable.dev/vite-tanstack-config` (includes TanStack
  Start, Nitro/Cloudflare target, tailwind, `@` alias, React dedupe); defines
  `__APP_BUILD_SHA__` from `VERCEL_GIT_COMMIT_SHA` (`'dev'` locally) for the
  deploy watcher. `src/server.ts` / `src/start.ts` are the TanStack Start
  server entry (SSR error wrapper) — do not remove.
- **API entry:** `api/index.js` is the whole API (single Express app, 2,058
  lines, mounted at root; `local-server.js` mounts it with `app.use(apiApp)`
  — mounting under `/api` would double the prefix to `/api/api/…`).
  Local dev: `bun run dev` (frontend, Vite) + `bun run dev:api`
  (`node local-server.js`, port `PORT` default **8080**).
- **How the frontend knows the API base URL** (`src/lib/api.ts:8-22`):
  `getApiBase()` = `localStorage["darkweb_api_base"]` → else
  `import.meta.env.VITE_API_BASE_URL` → else `""` (same-origin relative fetch,
  which on Vercel hits the `/api/:path*` rewrite to the same project's
  `api/index.js`). **SSR loaders are different:** `loaderApiBase()` (`api.ts:658-673`)
  runs server-side, where relative fetches are impossible — it uses
  `MOCK_API_URL`, else `process.env.APP_FRONTEND_BASE_URL` (must be the app's
  own public origin), else falls back to `http://127.0.0.1:8080`. SignalVault
  hit this exact trap in 2026-11-18 (lobby loader 404'd on same-origin
  `/api/engines` because the API was a separate project) — if the new deploy
  splits frontend/API into two Vercel projects, the loader path must be
  re-checked; if it stays one project, the rewrite covers it.
- **Env vars actually read** (grep `process.env.*` / `import.meta.env.*`):
  `DATABASE_URL` (required, Neon — `lib/db.js`; `POSTGRES_URL` also accepted
  per `.env.example`), `VITE_API_BASE_URL`, `SUPERADMIN_USERNAME`,
  `SUPERADMIN_PASSWORD`, `ADMIN_SESSION_DURATION_HOURS` (default 12),
  `REFERRAL_DEFAULT_ADMIN_SHARE_PERCENT` (default 30), `IMGBB_API_KEY`
  (required for proof uploads in this copy — §0), `AI_OPENROUTER_API_KEYS`
  (comma-separated, up to 4; singular `AI_OPENROUTER_API_KEY` also referenced
  in comments), `APP_FRONTEND_BASE_URL`, `APP_PLATFORM_FRONTEND_URL`,
  `APP_SHINOBIPAY_SECRET_KEY`, `APP_SHINOBIPAY_WEBHOOK_SECRET`,
  `APP_SHINOBIPAY_BASE_URL` (legacy gateway env, gateway retired),
  `ACCOUNT_PASSWORD_LENGTH` (default 10 — legacy scan-side password length),
  `GAME_WINDOW_MINUTES`, `SCAN_GRANT_MINUTES`, `CRON_SECRET`, `PORT` (8080),
  `VERCEL_GIT_COMMIT_SHA` (build-time), `MOCK_API_URL` (loader override).
  `.env.example` still says "SkyPredictr" and points at grokaiprediction.com —
  update it in the rebrand or the next deploy copies stale URLs.
- **Docs in-repo:** `README.md`, `AGENTS.md` (Lovable git-history warning —
  do not rewrite pushed history), `GAMES_AUDIT.md`, `GO-LIVE-CHECK.md`,
  `docs/FRONTEND_FLOW_MAP.md`, `docs/INTEGRATION_MAP.md`, `src/routes/README.md`.
  Read `docs/FRONTEND_FLOW_MAP.md` before changing any flow; it documents the
  loader/fetch split.

---

## 8. Public assets

`public/` total **~14 MB** (per-file sizes verified with `ls -lh`):

| Group | Files | Notes |
|---|---|---|
| Favicons | `favicon.ico` 20 KB, `favicon.svg` 879 B | Green hex vault (§1) — redraw both. |
| Fonts | `fonts/f1–f18.woff2`, **4.3 MB total** | Largest: `f13.woff2` **3.9 MB** (Material Symbols icon font — preloaded in `__root.tsx`); `f17.woff2` 50 KB (Unbounded latin — preloaded); `f15.woff2` 116 KB; rest 1.7–34 KB. Families: Syne, Space Grotesk, JetBrains Mono, Unbounded (+ Material Symbols). |
| Game art | `games/` **4.9 MB**, 13 files | `mines-engine-card.png` **3.4 MB** (check whether still referenced — SignalVault deleted it as dead in 2026-11-18; verify here before deleting); `instant-virtuals.png` 323 KB, `mines.png` 372 KB, `spin-bottle.png` 200 KB, `sportyhero-art.png` 206 KB, `aviator-logo.png` 116 KB (also deleted as dead in SignalVault — verify), `aviator.png` 44 KB, `sporty-jet.png` 29 KB, `sportyhero.png` 54 KB, `sportykick.png` 56 KB, `super-hero.png` 66 KB, `aviator-art.webp` 27 KB, `test-flight.png` 849 B (tiny placeholder — SignalVault once deleted it by mistake; it IS referenced by the engines API). |
| Hero | `hero-a.webp` 170 KB; `src/assets/hero.jpg` 144 KB | Same photo in two places — **both** must be re-shot/re-graded or they disagree (SignalVault replaced both). |
| Videos | `videos/` **4.7 MB**, 7 mp4s | `engine-access.mp4` 1.3 MB, `scan-access.mp4` 881 KB, `sportyhero-bg.mp4` 833 KB, `sportyjet-bg.mp4` 706 KB, `aviator-bg.mp4` 501 KB, `auth-access.mp4` 273 KB, `auth-register.mp4` 284 KB. Full-screen backgrounds/overlays — any on-screen brand text inside the video files themselves cannot be changed by a code sweep; check frames. |
| Misc | `robots.txt` 160 B (allows all bots incl. Googlebot/Bingbot/Twitterbot/facebookexternalhit) | No `manifest.json`, no `sitemap.xml`, no `og-image` file in `public/` (OG tags in `__root.tsx` have no `og:image` — check before adding one). |

---

## 9. Surprises / risks for the implementer (read before starting)

1. **The brief's §5 is not this copy's state (§0).** The three divergences
   (tiers, Theresah recipient, self-hosted uploads) plus the missing `/virtuals`
   engine are the whole job's biggest decision point. Get Prince's call on
   (a) pure rebrand vs (b) rebrand + port *before* writing code.
2. **`sky_users` passwords are plaintext** (§3.1) while admin passwords are
   scrypt. Do not touch as part of the rebrand; report it separately.
3. **The header has no nav** (§1) — the new brand's nav/links/buttons are new
   UI work, not a find-replace.
4. **Hardcoded greens outside tokens:** predictor layout (`bg-[#020a05]`,
   `bg-[#04120a]/90`), `Logo.tsx` hexes, `engines/index.tsx` confidence-ring
   hexes (`#22c55e/#eab308/#f97316`), `SupportFloat` Telegram blue `#229ED9`
   (intentional — leave), `Fx.tsx` rain colours. A token-only sweep will leave
   green behind; grep `#0`, `rgba(0,230,122`, `emerald-`, `green-` after the
   token change.
5. **Two hero images, two favicons, videos with baked-in pixels** (§8) — all
   need paired replacement; the videos cannot be edited by text sweep.
6. **Dead-weight assets:** `mines-engine-card.png` (3.4 MB) and
   `aviator-logo.png` (116 KB) were dead files in SignalVault — verify
   references here with grep before deciding to keep/delete; do **not**
   delete `test-flight.png`.
7. **Loader/API-base trap** (§7): if frontend and API deploy as separate
   Vercel projects, the SSR `loaderFetch` path breaks exactly as it did for
   SignalVault (2026-11-18). Keep one project, or fix `loaderApiBase`.
8. **No seeded/demo user accounts exist** (§3.3) — the only bootstrap is the
   env-var super-admin. Any demo/test login the implementer expects must be
   created explicitly; do not invent one.
9. **Legacy payment tables + retired gateway routes are load-bearing history:**
   `funds.js` reporting and the super-admin transactions view read
   `akwapay_/shinobipay_/paystack` rows. Renaming tables/columns breaks
   reporting — rebrand strings only.
10. **Lovable linkage:** `AGENTS.md` warns against rewriting pushed git
    history (Lovable sync). Keep the branch in a working state; the rebrand
    should land as normal commits.
11. **Brand strings live in the AI prompt and API messages too** (§4) — a
    frontend-only sweep leaves "Dark Web AI" answering users and "Dark Web
    build" in `/api/version`.
12. **`.env.example` points at grokaiprediction.com** — stale upstream domain;
    the new deploy's `APP_FRONTEND_BASE_URL` must be set or SSR loaders fall
    back to `127.0.0.1:8080` and hard loads break.
