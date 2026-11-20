---
# DESIGN.md — SignalVault (second rebrand of the Dark Web code, rebrand2)
# Contract for the implementation agent. Design only — no logic changes.
# Source of truth for structure: MAP.md in this same directory (read it first).
# This file is the contract; if a detail here and MAP.md disagree on structure,
# MAP.md (verified against the code) wins and this file must be amended, not the code.

brand:
  name: "SignalVault"
  short_name: "Kente"
  tagline: "Bold calls, made in Ghana."
  design_read: "Market-day brightness, not a midnight terminal — a warm cream paper
    site with terracotta and indigo kente weave, editorial serif headlines, and
    prices set in mono like figures on a market ticket."
  dials:
    variance: high
    motion: low-calm
    density: airy
  avoid_resemblance:
    - "SignalVault: molten gold on obsidian, near-black, Syne display, dark luxury"
    - "OnyxPlay: onyx near-black + volt lime #D4FF3F"
    - "Dark Web (original): deep green on black, Unbounded, terminal, matrix rain"
  rule: "If any screen could pass for SignalVault with the logo swapped, the
    redesign has failed. The single biggest guard is the LIGHT theme: this app
    is cream paper everywhere. No near-black page backgrounds anywhere."

tokens:
  colors:
    background: "#FBF6EC"      # warm paper cream — page background, light only
    background_alt: "#F5EDDA"  # deeper sand for banded sections
    surface: "#FFFFFF"         # card surface
    surface_warm: "#FFFDF6"    # card surface, warm variant
    primary: "#E14D2A"         # kente terracotta — THE one brand accent
    primary_deep: "#B93A1D"    # primary hover / pressed
    primary_soft: "#FBE9E2"    # primary tinted wash (chips, highlights)
    primary_foreground: "#FFFFFF"
    secondary: "#2E3A8C"       # kente indigo — second colour, used sparingly
    secondary_soft: "#E7E9F7"
    tertiary: "#0F766E"        # teal — functional success / live states only
    text: "#1C1917"            # warm ink — body text
    text_strong: "#111110"     # headlines
    muted: "#6B6257"           # secondary text (warm grey-brown)
    muted_text_on_dark: "#EDE6D6"
    border: "#E8DFCE"          # warm sand border
    border_strong: "#D8CBB2"
    success: "#0F766E"
    success_foreground: "#FFFFFF"
    danger: "#C62828"
    danger_soft: "#FCE8E8"
    warning: "#B45309"
    warning_soft: "#FDF0DC"
    live: "#0F766E"
    ring: "#E14D2A"
    chart_1: "#E14D2A"
    chart_2: "#2E3A8C"
    chart_3: "#0F766E"
    chart_4: "#B45309"
    chart_5: "#8C6D2F"
    # BANNED in this rebrand (any occurrence in built output fails verification):
    #   #00cc66 #4dff9d #00e67a #0a5c2e #063d21 #02120a (old signal greens)
    #   #F2C230 family (SignalVault gold), #D4FF3F (OnyxPlay volt lime)
    #   emerald-*/green-* Tailwind utilities as brand colour (success teal only)
  radius:
    base: "0.75rem"            # was 1rem — slightly tighter, ticket-like
    card: "1rem"
    pill: "999px"
  typography:
    display: "Fraunces"        # Google Fonts, 600/700/900 — editorial serif headlines + wordmark
    body: "DM Sans"            # Google Fonts, 400/500/700 — UI + body copy
    mono: "IBM Plex Mono"     # Google Fonts, 500/600/700 — amounts, balances, codes, odds
    replaces:
      display: "Unbounded (was --font-display and --font-logo)"
      body: "Space Grotesk (was --font-sans)"
      mono: "JetBrains Mono (was --font-mono)"
      note: "Syne is bundled in fonts.css but unused by styles.css — do NOT adopt it;
        it is SignalVault's display font. Keep Material Symbols (f13.woff2) for icons."
  spacing:
    page_max: "72rem"          # max-w-6xl, unchanged
    lobby_max: "87.5rem"       # max-w-[1400px], unchanged
    section_y: "4rem mobile / 5rem desktop"
  elevation:
    soft: "0 1px 2px rgba(28,25,23,0.06), 0 10px 28px -12px rgba(28,25,23,0.18)"
    lift: "0 2px 4px rgba(28,25,23,0.06), 0 22px 48px -16px rgba(225,77,42,0.28)"
    glow: "none — no coloured glow anywhere (the old green glow is a Dark Web tell)"
---

# SignalVault — DESIGN.md

## Overview

**Brand:** SignalVault. **Tagline:** "Bold calls, made in Ghana."
**One-line design read:** Market-day brightness, not a midnight terminal — a
warm cream paper site with terracotta and indigo kente weave, editorial serif
headlines, and prices set in mono like figures on a market ticket.

This is the **second** rebrand of the same Dark Web codebase (the first is
SignalVault, live at signalvault-theta.vercel.app). It must read nothing like
either of them — and nothing like OnyxPlay. The decisive break is the **light
theme**: Dark Web, SignalVault and OnyxPlay are all near-black apps. Kente
Picks is cream paper (`#FBF6EC`) on every surface, including the predictor
lobby, the game terminals and the staff portals. A screenshot of any Kente
Picks page next to a SignalVault screenshot must look like a different product
from a different company, not a re-skin.

**Architecture first (Prince's rule).** Files, components and flows are
unchanged — this contract re-skins and re-composes existing files only. The
files that carry the most visual weight, in order: `src/styles.css` (the
single token file — re-token here first), `src/fonts.css` (font loading),
`src/routes/__root.tsx` (head/meta + shell), `src/components/site/Header.tsx`
+ `Logo.tsx` + `Footer.tsx` + `SupportFloat.tsx`, `src/routes/index.tsx`
(hero), `src/routes/predictor/route.tsx` (predictor chrome),
`src/components/predictor/casino-lobby.tsx` (lobby),
`src/routes/pricing.tsx` + `src/routes/manual-payment.tsx` +
`src/components/ui/payment-details-card.tsx` (money surfaces),
`src/routes/scan.tsx` + `scan-slip.tsx` + `scan-result.tsx`,
`src/routes/login.tsx` + `register.tsx`, `src/routes/admin.index.tsx` +
`src/routes/superadmin.index.tsx`, `src/components/fx/Fx.tsx` (kill the rain),
`src/components/ui/*` (49 stock shadcn files — rebrand via tokens only, no
per-file edits unless a file hardcodes a colour). Reusable pieces stay
reusable: header, footer, support float, payment-details card, toast system,
game tile, stat card, approval row.

**User flows (unchanged, only re-skinned):**
`/` → `/register` → `/pricing` (or `/manual-payment`) → send MoMo/bank
transfer → submit proof → `/payment/waiting` → admin approves in `/admin` →
credits land → `/predictor` lobby → per-game terminal (`/predictor/:gameId`,
Mines, Bottle) or `/scan` → `/scan-slip` → `/scan-result`. Staff:
`/admin/login` → `/admin`, `/superadmin/login` → `/superadmin`.
**Business model (as-is, Path A):** one pack only — **30 credits for GH₵400
(NGN 75,000), 5 credits per use, credits never expire, top-ups stack**,
manual payment only, recipient **KINSMAN SUSU VENTURES-SEKONDI, MoMo
0541568542** (Ghana) / **Access Bank 1945116494, Amadi Victor Chinaemeze**
(Nigeria), proof upload via ImgBB, admin approval. There are no tiers, no
`/virtuals` route, no self-hosted uploads in this copy — do not design around
them. "Instant Virtuals" is only a label on the `/scan` tile.

**What the first page must say (Prince's rule 11):** the hero must say, in
one glance, "buy 30 credits for GH₵400, get AI calls on crash/penalty/hero
games and AI slip scans, pay by MoMo". The credit wallet is the product; the
hero shows it, it does not hide it behind a terminal joke.

## Colors

Light-only app. There is no dark mode, no theme toggle (there never was one),
and no near-black page background anywhere — including the predictor area,
whose current `#020a05` / `#04120a` surfaces are the single most
SignalVault-like thing in the code and must go.

| Token | Hex | Role |
|---|---|---|
| `--background` | `#FBF6EC` | Page background, every page |
| `--background-alt` | `#F5EDDA` | Banded sections (features, reviews) |
| `--card` / `--popover` | `#FFFFFF` / `#FFFDF6` | Card surfaces |
| `--primary` | `#E14D2A` | Kente terracotta — the one brand accent: CTAs, active states, prices, links |
| `--primary-deep` | `#B93A1D` | Primary hover/pressed |
| `--primary-soft` | `#FBE9E2` | Tinted wash for chips and highlights |
| `--primary-foreground` | `#FFFFFF` | Text on primary |
| `--secondary` | `#2E3A8C` | Kente indigo — second colour, used sparingly (sidebar active edge, section markers, the "Extra Predictors" group) |
| `--secondary-soft` | `#E7E9F7` | Indigo tint |
| `--success` / `--live` | `#0F766E` | Teal — success and LIVE states only, never brand |
| `--destructive` | `#C62828` | Errors, reject actions |
| `--warning` | `#B45309` | Warnings, low-balance urgency (replaces amber-on-black) |
| `--foreground` | `#1C1917` | Warm ink body text |
| `--muted-foreground` | `#6B6257` | Secondary text |
| `--border` / `--input` | `#E8DFCE` | Warm sand borders |
| `--ring` | `#E14D2A` | Focus ring |
| `--chart-1…5` | `#E14D2A`, `#2E3A8C`, `#0F766E`, `#B45309`, `#8C6D2F` | Charts / confidence |

**Token discipline (Hallmark floor):** every colour and font goes through a
token declared at `:root` — no literal colours or `font-family` past the token
block. No `transition: all`. Never animate `width`, `height`, `top`, `left`.
Every interactive element gets `:focus-visible`. Every animation has a
`prefers-reduced-motion` fallback and content is visible with scripting off.
`overflow-x: clip` on both `html` and `body`. No invented metrics,
testimonials, logo walls or case-study counts — the existing reviews/ratings
copy stays exactly as written (it is the product's own copy, not invented
here); do not add new numbers. No eyebrow text, no tracked-caps/small-caps
labels, no purple-to-blue gradient, no card inside a card, no emoji as icon,
no hand-drawn browser/OS window.

**Hardcoded-colour sweep (MAP.md §9.4 — a token-only change leaves green
behind):** after re-tokening, grep and replace `#0…`, `rgba(0,230,122`,
`emerald-`, `green-`, `cyan-300` (predictor sidebar active states), `slate-*`
on dark surfaces, and the confidence-ring hexes `#22c55e/#eab308/#f97316`
(`src/routes/engines/index.tsx`) — remap to terracotta/indigo/teal per the
chart tokens above. `SupportFloat` Telegram blue `#229ED9` is intentional
(Telegram's brand) — leave it. The `dw-*` utility class **names** stay
(see "What is deliberately NOT renamed") but their **definitions** change:
`dw-glow-text` becomes a flat terracotta text treatment with no glow,
`dw-win-flash` becomes a warm terracotta radial wash, `dw-grid-bg` becomes a
faint kente-weave grid in sand, `dw-hero-shade` becomes a cream veil,
`dw-scanbeam`/`dw-scanlines` are deleted (see Scan).

## Typography

- **Display — Fraunces (Google Fonts, 600/700/900).** Headlines, the
  wordmark, prices on the pricing ticket, section titles. Warm editorial
  serif: the opposite of Unbounded (Dark Web) and Syne (SignalVault).
  Headlines set tight (`-0.02em`), sentence case, never all-caps.
- **Body/UI — DM Sans (Google Fonts, 400/500/700).** All body copy, buttons,
  labels, table text. Friendly humanist sans, clearly not Space Grotesk.
- **Mono — IBM Plex Mono (Google Fonts, 500/600/700).** Amounts, balances,
  credit counts, codes, odds, timestamps, the payment recipient's number.
  Replaces JetBrains Mono.
- **Loading:** add the three Google Fonts families in `__root.tsx` head
  (or self-host the woff2 files the same way `fonts.css` does today — either
  is fine, but do not leave Unbounded/Space Grotesk referenced anywhere).
  Keep Material Symbols for icons (it is an icon font, not a brand font).
- **Scale:** hero `text-4xl sm:text-6xl` Fraunces 900; section titles
  `text-3xl sm:text-4xl` Fraunces 700; card titles `text-lg` DM Sans 700;
  body `text-sm/text-base` DM Sans 400; amounts/figures IBM Plex Mono 600
  with `tabular-nums`.

## Layout

### Global shell (`__root.tsx`, `Header`, `Footer`, `SupportFloat`)

- **Header — the biggest structural addition.** Today it is logo-only, no
  nav, no login button. New header: slim white bar (`bg-surface/90
  backdrop-blur`, sand bottom border), logo left; centre nav on desktop —
  **Engines** (`/engines`), **Slip scan** (`/scan`), **Pricing** (`/pricing`);
  right — **Log in** (ghost button) + **Get 30 credits** (solid terracotta
  pill, → `/pricing`); logged-in state shows a **credit wallet pill**
  (mono balance + "Top up" link) instead of the CTA. Mobile: hamburger
  opening a full-width dropdown panel with the same links. Height stays
  `h-16`. *SignalVault test: SignalVault's header is a dark bar with a gold
  wordmark and no wallet pill; this one is white, terracotta, and
  wallet-first — it cannot pass for it.*
- **Footer — light ledger footer.** Keep the 4 columns (brand / Product /
  Account / Staff) and links, but on white with sand borders; add a
  **kente strip divider** (a 6px woven bar: terracotta / indigo / cream /
  teal repeating blocks) above the footer and above the final CTA band.
  Bottom bar copy keeps "Passwords are shown once. Save them safely." and
  the copyright with the new brand name.
- **Support float — keep position, change skin.** Same fixed Telegram pill
  bottom-right, same `https://t.me/pycuepay` link, but restyle the pill as
  white with a sand border and ink text (Telegram blue icon only); the
  current dark pill on a light page would look like a leftover.
- **Toasts (Sonner, `__root.tsx`) — light toasts.** Drop `richColors`
  (dark toasts); use light toasts: white card, sand border, terracotta
  success icon, ink text. Toast copy unchanged.
- **Modals / dialogs (shadcn `ui/dialog`, `ui/alert-dialog`, etc.) —**
  centred white cards with a 4px kente-strip top edge (terracotta/indigo/
  cream/teal), sand border, `rounded-2xl`, terracotta primary buttons; on
  mobile they become bottom sheets (`rounded-t-3xl`, drag handle). No dark
  scrim heavier than `bg-black/40`.

### Home / hero (`src/routes/index.tsx`) — RECOMPOSED, not the current hero

The current hero is a photo with a dark green shade, a glass "Underground ·
Built in Ghana · Pay with MoMo" chip, a terminal card
(`credits_topup — GH₵400 · 30 CREDITS · ALL ENGINES` with blinking block
cursor) and a scrolling marquee. **All of that goes.** New hero:

- **Split hero on cream, no photo.** Left column: kente-strip chip
  ("Made in Ghana · Pay with MoMo"), Fraunces headline —
  *"30 credits. Every engine. Yours to keep."* — subcopy in DM Sans
  ("SignalVault reads crash, penalty and hero games live — and scans your
  slip with AI. GH₵400 for 30 credits, MoMo or bank transfer. Each scan or
  play costs 5 credits."), CTAs: solid terracotta pill **"Get 30 credits"**
  (→ `/register` or `/predictor` when logged in) + white outlined pill
  **"Try the AI slip scan"** (→ `/scan`). Under the CTAs, the trust row
  stays honest (existing copy only): "4.9 average rating · 2,400+ top-ups
  sold" — do not invent new figures.
- **Right column — the credit wallet card (the product, shown not told).**
  A white ticket card with a perforated left edge: "Your wallet" header,
  big mono **"30 credits"**, mono **"GH₵400"**, a 6-segment thread bar
  (each segment = 5 credits = one play), and the line "5 credits per scan
  or play · Never expires". Below it, a mini "today's call" sample row
  (Aviator — 2.41× — 78% confidence thread bar) labelled as a sample.
  No photo, no terminal, no blinking cursor, no 3D tilt.
- **Delete the marquee strip** (the scrolling `30 credits — GH₵400 ✦ …`
  ticker). Replace with a static **"How it works" ticket strip**: three
  numbered steps (Sign up → Top up → Play) as a horizontal perforated
  ticket, steps separated by dashed dividers — the same three steps that
  currently sit further down, moved up directly under the hero.
- **Sections below, re-skinned in place:** "Why people stick with Kente
  Picks" (6 feature cards — white cards, terracotta icon tiles, no 3D tilt
  hover; hover = lift + terracotta ring only), "Games we cover" (see Lobby
  card language below), reviews (white cards on the sand band, Fraunces
  quote mark, terracotta stars), FAQ accordion (unchanged structure, sand
  dividers), final CTA band — a **terracotta panel** (not the current
  `gradient-hero` green panel) with white Fraunces headline, cream text,
  white "Create my account" button + outlined "Manual payment" button.
- *SignalVault test: SignalVault's hero is a dark photo hero with gold
  display type and a terminal card. This hero has no photo, no dark panel,
  serif type and a paper ticket — it cannot pass for it.*

### Games / predictor lobby (`casino-lobby.tsx`, `predictor/index.tsx`, `engines/`)

- **Lobby chrome — wallet-first header.** The lobby keeps its search box
  and game grid, but the top row becomes a **sticky wallet summary bar**:
  left "Games" Fraunces title, right the credit wallet pill (mono balance,
  "5 per play", terracotta "Top up" link) — always visible while scrolling.
  The current green wallet pill (`border-emerald-400/25 bg-emerald-400/10
  text-emerald-300`) is re-tokened to terracotta-on-cream.
- **Cards — market-stall cards, not casino tiles.** Keep the 2/3/4/6-column
  grid and the same game art, but: white cards, sand border, `rounded-2xl`,
  art box keeps `aspect-[1/1.02]`; the clipped-corner **HOT/NEW ribbons go**
  — replaced by a small round dot badge top-left (terracotta dot + "HOT" in
  ink on white, or indigo dot + "NEW"); the centred lock overlay stays in
  structure but becomes a **cream veil** (`bg-[#FBF6EC]/70`) with a
  terracotta lock chip and the line "Locked — tap to top up" in ink; the
  balance line under an unlocked tile stays mono ("30 credits") in
  terracotta; the 1X2 probability row on the Instant Virtuals tile keeps
  its layout but in ink/teal on a cream strip (no emerald).
- **Filters — segmented control, not pills on dark.** The category filter
  (`All / Crash / Penalty / Action`) becomes a segmented control: cream
  track, white active segment with terracotta text and sand border. Search
  stays a rounded-full white input with a sand border.
- **"Virtual Predictor" group → "Extra Predictors".** The Mines + Bottle
  section heading is renamed (there is no virtuals engine here) and gets
  the indigo accent instead of terracotta, so the two groups read as
  distinct shelves.
- **"Instant Virtuals" tile → "Slip Scan" tile.** Same tile shell, same
  art (`/games/instant-virtuals.png`), same lock behaviour, new name and
  subcopy ("AI slip scan — tap to predict" / "Locked — tap to top up").
  It still links to `/scan` (sim mode still links to `/simulator/scan`).
- **Public engines lobby (`/engines`) — confidence threads, not rings.**
  The green/amber/orange confidence rings (`#22c55e/#eab308/#f97316`)
  become horizontal **confidence threads**: a sand track with a
  terracotta/indigo/teal fill and the mono percentage at the end. Engine
  cards go white-on-cream with the same art; the "LIVE" pill becomes teal
  text on a white chip. The provably-fair note stays, reworded only for
  brand name.
- *SignalVault test: SignalVault's lobby is a dark casino grid with gold
  accents and green lock overlays. This lobby is cream, white cards, serif
  title, terracotta wallet bar, thread-style confidence — it cannot pass
  for it.*

### Predictor shell (`predictor/route.tsx`) — sidebar becomes a top game rail

- **Desktop: replace the collapsible left sidebar (248px/68px, dark green)
  with a top game rail.** Slim white header row under the site header:
  horizontally scrollable game chips (Sporty Jet, Aviator, SportyKick,
  SportyHero, Super Hero, Test Flight, Mines, Spin da Bottle) + Tools
  (Slip scan, Simulation Lab, Prediction History, Settings); active chip
  is solid terracotta with white text; the wallet pill sits at the right
  end of the rail. The brand block ("DARK WEB / Analytics Terminal") is
  deleted — the site header already carries the brand. The "Live /
  Provably-fair engine" box becomes a small teal "Live · Provably fair"
  chip in the rail. The collapse button goes with the sidebar.
- **Game pages:** main column becomes full-width (`max-w-[1500px]`
  centred, cream background, white terminal cards with sand borders).
  The top bar's dark `#020a05` background, emerald "Live" pill and cyan
  active states are all re-tokened (teal live pill, terracotta active).
- **Mobile: keep the bottom tab bar, change its skin and centre action.**
  White bar, sand top border, ink icons, terracotta active state; the four
  tabs stay (Overview, Sim Lab, History, Settings) and a raised centre
  **Scan** button (terracotta circle, ScanLine icon) is added — the scan
  is the product's second front door and today it is buried. The mobile
  game scroller chips become the same segmented chips as desktop.
- **Immersive video pages (Aviator / Sporty Jet / SportyHero):** keep the
  full-screen video backgrounds (asset decision below), but every overlay
  panel becomes **cream glass** (`bg-[#FBF6EC]/85 backdrop-blur`, ink
  text, terracotta CTAs) instead of dark terminal glass. If a video frame
  itself shows old-brand UI, the veil opacity rises rather than the video
  being re-cut in this pass — flag it in verification.
- *SignalVault test: SignalVault keeps a dark sidebar terminal. This shell
  has no sidebar at all — a top rail on cream with a wallet pill — it
  cannot pass for it.*

### Pricing / packages (`pricing.tsx`)

- **One pack, presented as a ticket — not a plan picker.** The single
  PREMIUM pack (30 credits / GH₵400 / NGN 75,000) is rendered as a large
  **perforated ticket card**: left stub with the kente strip, big Fraunces
  "30 credits", mono "GH₵400 · NGN 75,000", "5 credits per scan or play ·
  Never expires · Top-ups stack". The plan picker UI stays in code (it
  reads `GET /api/payment/plans`) but renders as this single ticket —
  there is only ever one plan, so do not design a multi-tier grid.
- **Steps become a vertical timeline, not tabs-first.** The purchase flow
  reads top-to-bottom on one column (desktop: ticket left, form right):
  **1 — Send** (recipient card, see below) → **2 — Submit proof**
  (sender name/number, reference, screenshot upload) → **3 — Approved**
  (credits land, "usually within minutes"). Each step has a numbered
  terracotta circle and a dashed connector line.
- **Country toggle** (Ghana / Nigeria) becomes a segmented control at the
  top of the form, cream track, white active segment.
- **Recipient card (`payment-details-card.tsx`, "SEND PAYMENT TO")** —
  the dashed-border box becomes a **pay slip**: white card, dashed
  terracotta border, mono recipient name + number in large type, copy
  buttons as small sand chips. Ghana shows KINSMAN SUSU
  VENTURES-SEKONDI / 0541568542; Nigeria shows Access Bank / 1945116494 /
  Amadi Victor Chinaemeze. Amounts and recipient details are data, not
  design — they must render exactly as the API returns them.
- **Upload + submit:** the screenshot dropzone becomes a dashed sand
  upload box with a terracotta upload icon; the submit button is solid
  terracotta, full-width on mobile, with a loading spinner state (Prince's
  rule 8 — loaders on clicks and uploads). Success state
  (`payment-success.tsx`) keeps its check-draw animation, re-coloured
  terracotta/teal on white.
- *SignalVault test: SignalVault's pricing is a dark tier grid with gold
  "Best value" shimmer. This is a single cream ticket with a timeline —
  it cannot pass for it.*

### Manual payment (`manual-payment.tsx`, `payment/waiting.tsx`)

- Same ticket + timeline language as Pricing (shared components — do not
  build a second visual language). The hero band (`gradient-hero`) becomes
  a cream band with a Fraunces title and the "No card needed" chip in
  terracotta-soft. The gate panel for logged-out visitors keeps its
  structure, re-skinned white/cream with a terracotta "Log in" button.
- **Waiting room** becomes a **queue ticket**: white perforated ticket
  showing the submission reference in mono, a "Waiting for approval"
  status line with a calm pulsing teal dot, and the honest line "An admin
  reviews every payment — usually within minutes." No countdown timer
  (credits never expire; there is nothing counting down).

### Scan (`scan.tsx`, `scan-slip.tsx`, `scan-result.tsx`)

- **Kill the scanlines/scanbeam.** The `dw-scanlines` and `dw-scanbeam`
  utilities (green scanline overlays) are deleted; the scan workspace gets
  a **weave progress** instead: a thin kente-strip progress bar
  (terracotta/indigo/cream/teal segments) that fills as the staged
  analysis runs (transcribe → gapfill → verify → finalise). The
  "Looping Dark Web scanning video" (`ScanMedia.tsx`) is replaced by a
  still slip-preview card with the same weave progress overlay — or the
  video is re-graded (asset decision below); no green scan beam either way.
- **Scan page structure:** Buy / History tabs become a segmented control
  (cream track, white active). The plan card is the same single-ticket
  treatment as Pricing (SCAN_550 / PREMIUM / GH₵400 / full coverage).
  History rows become white ledger rows with status pills (teal =
  verified, amber = mismatch, grey = unreadable).
- **Result view:** per-fixture predictions become **verdict cards** —
  white cards, fixture in DM Sans bold, the call in Fraunces, confidence
  as a thread bar, verification as a pill (Verified / Mismatch /
  Unverified / Unreadable). Raw model output stays in a collapsed
  mono block. The "5 credits per completed scan — failed scans free"
  rule is stated once, plainly, above the upload.
- *SignalVault test: SignalVault's scan is a dark terminal with a green
  scan beam. This is cream paper with a weave progress bar and verdict
  cards — it cannot pass for it.*

### Login / register (`login.tsx`, `register.tsx`)

- **Split screen, not a centred card on a gradient.** Desktop: left
  panel (terracotta, full height) with the woven kente mark, Fraunces
  headline ("Welcome back." / "Your wallet is waiting."), the three steps
  in cream text, and the honest line "One account, every game. 30 credits
  for GH₵400 — they never expire." Right: white form card on cream
  (name/email/username/password + optional referral code on register;
  username-or-email + password on login), inputs `h-12 rounded-xl` with
  sand borders and terracotta focus rings, solid terracotta submit
  button, "Create an account / Log in" cross-links in terracotta.
  Mobile: the terracotta panel collapses to a short top band with the
  mark + one line; the form fills the rest.
- **Auth splash videos** (`auth-splash.tsx`, `/videos/auth-access.mp4`,
  `/videos/auth-register.mp4`): replace the post-login video interstitial
  with a **woven-pattern splash** — the kente mark drawing itself in
  (stroke animation) on cream, then the app. If Prince wants to keep
  video, the videos must be re-shot/re-graded to the new palette first;
  the default is no video. Same call for `engine-intro.tsx`
  (`/videos/engine-access.mp4`) — replace with the woven splash.
- **Resume behaviour unchanged:** `?redirect=`, last-played game,
  scan-only users → `/scan-slip`, else `/predictor`.

### Admin + super-admin portals (`admin.index.tsx`, `superadmin.index.tsx`, logins)

- **Staff logins** (`admin.login.tsx`, `superadmin.login.tsx`): same
  split-screen as site login, but the left panel is **indigo** (staff =
  indigo, players = terracotta — the colour tells you which door you are
  at) with "Staff sign in" and no registration link.
- **Dashboards — light ledger desks.** Keep every tab and table (manual
  payments, scan purchases, mines purchases, scan sessions, game passes,
  referrals + commissions, payouts, funds, users; super-admin adds
  platform stats, admin management, transactions, monitoring,
  payment-details editor, virtual-predictions + bottle-rounds switches,
  user-flow simulator). Re-skin only:
  - Page background cream; stat cards white with sand borders, label in
    muted small caps-free DM Sans, **value in IBM Plex Mono** (amounts are
    figures), terracotta left-edge accent on the primary stat.
  - Tabs become a **left vertical nav** on desktop (indigo active item
    with a terracotta left bar) and the existing horizontal tab list on
    mobile; keep the tab order and labels exactly.
  - Tables: white cards, sand row dividers, ink text, mono amounts,
    status pills (PENDING amber, APPROVED teal, REJECTED red), approve /
    reject as small solid buttons (teal approve, white-with-red-text
    reject). Copy buttons (referral codes/links) become sand chips.
  - The payment-details editor, bottle-rounds editor and
    virtual-predictions switch keep their exact labels and behaviour —
    only colours change. The "Live games / next runs" panels
    (`SuperadminLiveGames`, `SuperadminNextRuns`) get the same white-card
    treatment with thread-style confidence.
  - **Simulator lobby** (`/simulator/*`) renders the same lobby as the
    player lobby (it reuses `CasinoLobbyView`) — it inherits the lobby
    re-skin automatically; add a persistent **indigo "SIMULATION — no real
    money" banner** at the top of every simulator page (it exists as a
    notice today; make it unmissable).
- *SignalVault test: SignalVault's staff portals are dark tables with gold
  headers. These are cream ledger desks with mono figures and indigo staff
  accents — they cannot pass for it.*

### Dashboard (`dashboard.tsx`, "My session")

- Keep the legacy session countdown structure, but re-skin to the wallet
  view: the credit balance is the hero figure (mono, Fraunces label),
  links to Engines / Slip scan / Top up as three white cards. No dark
  panels.

### FX, motion and the death list

- **DELETE:** matrix rain (`MatrixRain` in `fx/Fx.tsx` — green falling
  characters; the char set even contains "DW"), `dw-scanlines`,
  `dw-scanbeam`, the marquee, the 3D tilt hover (`dw-card-3d` /
  `dw-float3d` — replace with a flat `translateY(-4px)` + terracotta ring
  on hover), `dw-glow-text` (no glow), `dw-win-flash` green radial (→
  warm terracotta wash), the terminal card in the hero, the blinking
  block cursor.
- **KEEP (re-coloured):** `Tilt`/`Reveal` helpers only where they do not
  fight the flat language — prefer `Reveal` (rise + fade) and drop `Tilt`
  on cards; `float`/`rise`/`shimmer`/`pulse-ring`/`success-pop`
  keyframes re-tokened to terracotta; `tier-shimmer` is dead code for a
  single-pack page — delete it.
- **ADD:** the kente strip (a reusable 6px woven bar + a 3-bar mini
  strip for the logo chip), the perforated ticket edge (radial-gradient
  notches, CSS only), the confidence thread bar, the weave progress bar.
- **Motion:** calm and short — 200–350ms ease-out, transform/opacity
  only, `prefers-reduced-motion` disables all of it. No perpetual motion
  except the small teal live dot and the weave progress during a scan.

## Logo / wordmark / favicon

- **Mark — the weave.** A rounded square (`rounded-2xl`) in cream with a
  woven "K": three vertical warp bars (terracotta, indigo, teal) crossed
  by three horizontal weft bars (cream, terracotta, indigo) with a
  1px sand gap at each crossing, so the mark reads as cloth, not as a
  badge. No hexagon, no vault, no pulse line, no glowing node — the Dark
  Web hex vault and its green gradient are gone entirely.
- **Wordmark — "KENTE" in Fraunces 900, ink, with "picks" in DM Sans 700
  terracotta lowercase tucked after it** ("KENTE picks"), tracking
  `-0.02em`. The `GH` pill chip is replaced by the **3-bar kente mini
  strip** (terracotta/indigo/teal, 18×6px) shown at desktop sizes only.
  `Logo.tsx` keeps its component names and props (`LogoMark`, `Logo`,
  `compact`, `markClassName`); only the SVG and the wordmark change.
  The SVG gradient ids `dw-badge`/`dw-pulse`/`dw-halo` are deleted with
  the old SVG.
- **Favicon —** redraw both `public/favicon.svg` and `public/favicon.ico`
  as the weave mark on cream (terracotta K bars). Same files, same paths.
- **App icon / OG image:** there is no `manifest.json` and no `og:image`
  today. Add an `og:image` (1200×630, cream, weave mark + "SignalVault —
  Bold calls, made in Ghana.") only if the implementer can generate the
  image in the same pass; otherwise leave OG imageless rather than
  shipping a stale one. Do not add a PWA manifest in this pass.

## Assets that must be re-shot, re-graded or dropped

The code sweep cannot change pixels. Decide each item before the build, or
the new brand will ship with old-brand pixels inside it:

| Asset | Decision |
|---|---|
| `public/hero-a.webp` + `src/assets/hero.jpg` (same photo, two places) | **Drop both.** The new hero has no photo. Delete the files and their references, or keep them unused — do not leave a reference to either. |
| `public/games/*.png` (game art: aviator, mines, spin-bottle, instant-virtuals) | **Keep.** They are the games' own art, not brand art. Re-tint only if a file carries old-brand UI inside the image itself — check each file's pixels. `mines-engine-card.png` (3.4 MB) and `aviator-logo.png` were dead weight in SignalVault — verify with grep before deleting here. The removed engines' art (sporty-jet, sportyhero, sportykick, super-hero, test-flight) is unreferenced since the 2026-11-20 Aviator-only cut. |
| `public/videos/*.mp4` (auth-access, auth-register, engine-access, scan-access, aviator-bg) | **Default: stop using the three interstitial videos** (auth ×2, engine-access) — replaced by the woven splash. **Keep the one immersive game background** (`aviator-bg.mp4`) behind the new cream-glass overlay, but check its frames for old-brand text/UI; if any frame shows it, raise the veil opacity or drop that video to a still. `scan-access.mp4` is replaced by the still slip-preview card. The removed engines' backgrounds (sportyjet-bg, sportyhero-bg) are unreferenced since the 2026-11-20 Aviator-only cut. |
| `public/fonts/f1–f18.woff2` (4.3 MB) | Keep Material Symbols (f13) and any files the new fonts need; the Unbounded/Space Grotesk/JetBrains Mono files become dead weight once the tokens change — remove them from `fonts.css` and the preloads in `__root.tsx` if nothing references them. |
| `public/favicon.svg` / `favicon.ico` | Redraw as the weave mark (above). |

## Brand-string rename list

User-visible strings only. Everything below is a find-and-replace target;
the verification checklist greps for leftovers.

| Old string (where it lives) | New string |
|---|---|
| `Dark Web` (titles, meta, footer, sidebar, AI prompt, `/api/version`, `local-server.js` log) | `SignalVault` |
| `DARK WEB` / `DARK<span>WEB</span>` wordmark (`Logo.tsx`) | `KENTE picks` (Fraunces + DM Sans, see Logo) |
| `Dark Web AI` (`lib/services/ai.js` system prompt) | `Kente AI` |
| `X-Title: 'Dark Web AI Slip Scanner'` (`lib/services/ai.js`) | `Kente AI Slip Scanner` |
| `Dark Web build` (`GET /api/version`) | `SignalVault build` |
| `the underground predictor vault` (root meta description) | `bold AI calls and slip scans, made in Ghana` |
| `Underground · Built in Ghana · Pay with MoMo` (hero chip) | `Made in Ghana · Pay with MoMo` |
| `Dark Web reads crash, penalty and hero games live — and scans your slip with AI.` | `SignalVault reads crash, penalty and hero games live — and scans your slip with AI.` |
| `Why people stick with Dark Web` | `Why people stick with SignalVault` |
| `Real feedback from people using Dark Web across Ghana.` | `Real feedback from people using SignalVault across Ghana.` |
| `Analytics Terminal` (predictor sidebar brand block) | Deleted with the sidebar — the rail has no brand block; the page subtitle becomes `Prediction desk` where a label is needed |
| `Dark Web Lab · Sandbox` (`gameThemes.ts` Test Flight kicker) | `Kente Lab · Sandbox` |
| `Initializing Dark Web engine…` (`MinesBoard.tsx`) | `Warming up the Kente engine…` |
| `Looping Dark Web scanning video` (`ScanMedia.tsx`) | Deleted with the video (still slip-preview card) |
| `Chat with Dark Web support on Telegram` (SupportFloat aria-label) | `Chat with SignalVault support on Telegram` |
| `© {year} Dark Web. All rights reserved.` | `© {year} SignalVault. All rights reserved.` |
| `Timed access passes and AI betting-slip analysis, built for Ghana. Pay with Mobile Money, get in, get value.` (Footer) | `One pack, 30 credits, AI calls and slip scans — built for Ghana. Pay with Mobile Money, get in, get value.` |
| `Instant Virtuals` (lobby tile, sidebar TOOL_NAV, mobile chips) | `Slip Scan` |
| `Virtual Predictor` (lobby group heading, sidebar group) | `Extra Predictors` |
| `Create your Dark Web account` (register title) | `Create your SignalVault account` |
| `Top up credits — Dark Web`, `AI betting-slip scan — Dark Web`, `Prediction Engines — Dark Web`, `Admin dashboard — Dark Web`, `Super admin — Dark Web`, `Log in — Dark Web`, `Manual payment — Dark Web`, all other `— Dark Web` per-route titles | Same titles with `— SignalVault` |
| `Dark Web — Credits & AI Slip Scan` (root title) | `SignalVault — Credits & AI Slip Scan` |
| `Enter casino` (hero CTA when logged in) | `Open the lobby` |
| `Games · Crash predictors` (lobby heading) | `Games · Crash calls` |
| `SkyPredictr` (`.env.example` header) + `https://www.grokaiprediction.com` defaults | `SignalVault` + the new deploy's real frontend URL (set `APP_FRONTEND_BASE_URL` on deploy, or SSR loaders fall back to `127.0.0.1:8080`) |
| `darkweb` in `package.json` `"name"` | Leave (invisible to users — see non-renames) or rename only if the deploy pipeline needs it |
| Docs (`README.md`, `AGENTS.md`, `GAMES_AUDIT.md`, `GO-LIVE-CHECK.md`, `docs/`) | Rebrand the user-facing brand mentions; leave the Lovable git-history warning in `AGENTS.md` untouched |

## What is deliberately NOT renamed and why

These identifiers are invisible to users but load-bearing. Renaming them
breaks saved sessions, changes provably-fair round sequences, or orphans
accounts — SignalVault's first rebrand kept the same list, and this one does
too.

- **localStorage keys** (`darkweb_api_base`, `darkweb_email`,
  `darkweb_manual_id`, `darkweb_scan_id`, `darkweb_scan_result`,
  `darkweb_sim_*`, `darkweb_deploy_reloaded_for*`): renaming orphans saved
  emails, payment lookups and deploy-watcher guards. Keep.
- **sessionStorage keys** (`darkweb_user_token`, `darkweb_admin_token`,
  `darkweb_admin_role`): renaming logs every user out mid-session. Keep.
  Tokens stay in sessionStorage — do not "move them to localStorage".
- **Provably-fair server seeds** (`darkweb-demo-jet-v1`,
  `darkweb-demo-aviator-v1`, `darkweb-demo-hero-v1`,
  `darkweb-demo-lab-v1` in `lib/services/engines/index.js`): renaming
  changes every round's crash point. Keep.
- **`dw-` CSS class names** (`dw-glow-text`, `dw-card-3d`, `dw-win-flash`,
  `dw-float3d`, `dw-blink`, `dw-marquee-track`, `dw-hero-shade`,
  `dw-scanlines`, `dw-scanline`, `dw-pulse-dot`, `dw-pop`, `dw-halo`,
  `dw-spin-slow`, `dw-perspective`, `dw-live-dot`, `dw-grid-bg`,
  `dw-3d`, plus SVG ids `dw-badge`/`dw-pulse`/`dw-halo` where the SVG
  survives): keep the **names** so components keep matching their styles;
  change their **definitions** to the new tokens, and delete the
  definitions for utilities that are removed (`dw-scanlines`,
  `dw-scanbeam`, `dw-marquee-track`). A coordinated rename of every
  `dw-` name is allowed only as a single sweep with a build + visual pass
  after it — never a partial rename.
- **Simulator identity** (`superadmin-simulator@darkweb.local`,
  `simtok_` prefix): sim runs in flight depend on them. Keep.
- **API paths** (all 163 `/api/…` routes), **DB table/column names**
  (42 tables in `lib/schema.sql`), **plan codes** (`PREMIUM`, `SCAN_550`,
  `SESSION_550`, `SCAN_*`, `SESSION_*`, `MIN15`, `HOUR1`, `HOUR3`),
  **engine ids** (`aviator`, `mines`, `bottle`, `scan` — Aviator-only since
  the 2026-11-20 cut),
  **setting keys** (`virtual_predictions`, `bottle_round_calls`,
  `payment_details`), **credit-ledger reason codes** (`PASS`, `MANUAL`,
  `SCAN`, `PLAY_<GAME>`, `REFUND_<GAME>`, `SIM_*`),
  **error code** `CREDITS_EXHAUSTED`, **sidebar cookie**
  (`sidebar_state`), **referral codes** (random, no brand prefix):
  keep all. They are logic, not brand.
- **Game catalogue content** (engine names, providers, game art, Mines /
  Bottle rules, scan staged-analysis flow, referral split 30% admin /
  70% platform, credit model 30 for GH₵400 / 5 per use / pro-rata grants,
  manual-payment recipient and approval flow): frozen logic. Re-skin the
  containers, never the content or the numbers.
- **Stale upstream names** (`VirtuWin` in comments, `AkwaPay`/`Paystack`/
  `ShinobiPay`/`WebRabbit` in dead tables and legacy paths, `SkyPredictr`
  in `.env.example` comments): leave the dead-code mentions alone except
  the `.env.example` header/URLs above — renaming tables or legacy rails
  breaks reporting history. Only user-visible strings change.
- **Plaintext `sky_users.password`** (MAP.md §3.1): pre-existing, out of
  rebrand scope. Do not "fix" it silently inside this rebrand — flag it to
  Prince separately.

## Do's and Don'ts

**Do:** light cream everywhere; Fraunces headlines + DM Sans UI + IBM Plex
Mono figures; terracotta as the single brand accent with indigo as a quiet
second; the kente strip as the one recurring motif (header divider, footer
divider, ticket edge, progress bar); wallet-first (balance visible in the
header, the lobby bar and the hero ticket); loaders on every click and upload;
`prefers-reduced-motion` fallbacks; `:focus-visible` on everything
interactive; `overflow-x: clip` on `html` and `body`.

**Don't:** no near-black backgrounds; no green as a brand colour; no gold
(`#F2C230` family) and no volt lime (`#D4FF3F`); no Unbounded, Syne or Space
Grotesk anywhere in the built CSS; no "underground", "vault", "terminal",
"dark", "web", "signal", "gold", "onyx" or "royale" in any user-visible
string; no marquee, matrix rain, scanlines, scan beam, 3D tilt, glow text or
blinking cursor; no card inside a card; no eyebrow text or tracked-caps
labels; no invented metrics, testimonials or counts; no emoji as icons; no
purple-to-blue gradients; no `transition: all`; no animating `width` /
`height` / `top` / `left`; no new paid services; no feature ports (no tiers,
no `/virtuals`, no self-hosted uploads — Path A is a pure rebrand).

## Verification checklist (implementation agent must satisfy all of these)

1. **Build clean:** `npm run build` (and `npm run lint` if it runs) passes
   with zero errors. No new dependencies unless Prince approves them.
2. **Zero banned strings in built output:** grep the built output
   (`.output/` + `dist` as applicable) for `Dark Web`, `darkweb` (except
   the kept `darkweb_*` storage keys and provably-fair seeds — list every
   remaining occurrence and justify it), `underground`, `vault` (user
   -visible), `terminal`, `Signal`, `Vault`, `Onyx`, `Royale`, `Unbounded`,
   `Syne`, `Space Grotesk`, `JetBrains Mono`, and the hexes `#00cc66`,
   `#4dff9d`, `#00e67a`, `#F2C230`, `#D4FF3F`. Any hit is a fail until
   justified in the build report.
3. **Token audit:** every colour in `src/styles.css` resolves through a
   `:root` token; grep `src/` for `#0`, `rgba(0,230,122`, `emerald-`,
   `green-`, `cyan-300` — each hit must be justified (Telegram blue and
   functional teal only) or removed.
4. **Screenshots, real browser, 390px + desktop (1440px):** home (hero +
   ticket), lobby (grid + wallet bar), pricing (ticket + timeline),
   manual-payment, scan (buy tab + result), login, register, admin
   dashboard, super-admin dashboard, one game terminal, one immersive
   video page. Each screenshot must be eyeballed against the SignalVault
   test — if it could pass for SignalVault with the logo swapped, it fails.
5. **Flows still work (no logic touched):** register → top up (manual
   submit) → approval path → lobby unlock → one engine round → one scan
   (or the equivalent API-level checks); admin approve/reject; super-admin
   login. Any flow that breaks is a rebrand regression, not a design issue
   — fix the rebrand, not the logic.
6. **Money facts render exactly:** 30 credits / GH₵400 / NGN 75,000 /
   5 per use / never expires; recipient KINSMAN SUSU VENTURES-SEKONDI
   0541568542 and Access Bank 1945116494 Amadi Victor Chinaemeze, as
   returned by `GET /api/payment/details`. No tier copy anywhere.
7. **Contrast + a11y:** ink `#1C1917` on cream `#FBF6EC` and white
   `#FFFFFF` on terracotta `#E14D2A` both ≥ 4.5:1; focus ring visible on
   every interactive element; reduced-motion mode shows static content
   with no animation; page usable with scripting off for content.
8. **Assets:** hero photo references removed; favicons redrawn; auth /
   engine / scan videos either replaced by the woven splash or re-graded
   and frame-checked; no game-art file deleted without a grep proving it
   unreferenced (the removed engines' art is unreferenced since the
   2026-11-20 Aviator-only cut).
9. **No scope creep:** no tiers, no `/virtuals`, no upload-implementation
   port, no password-storage change, no token-storage move, no API-path /
   table / seed renames. Anything in the "deliberately NOT renamed" list
   that changed must be listed in the build report with a reason.
10. **Deploy hygiene:** one Vercel project for frontend + API (the SSR
    `loaderApiBase` trap — MAP.md §7); `APP_FRONTEND_BASE_URL` set to the
    new deploy's real origin; `.env.example` updated to SignalVault with
    the real URL; Lovable history rule respected (normal commits, no
    force-push / rebase of pushed history).

---

*Contract version: 1.0 — 2026-11-19. Grounded in MAP.md (verified counts:
29 URLs, 82 components, 2 CSS files, 163 API routes, 42 SQL tables) and the
local-ui-design skill (architecture first, DESIGN.md contract, map before
redesign). Brand, palette and fonts chosen to be maximally distant from
Dark Web (green terminal), SignalVault (gold on obsidian, Syne) and OnyxPlay
(onyx + volt lime).*
