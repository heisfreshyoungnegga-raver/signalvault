# SignalVault — clone of SkyPredictor

Underground predictor vault. Deep green on black. **One plan only: Premium — GHS 550 for 24 hours** per game (full engine access + full-coverage AI slip scan). One-time GHS 50 gate fee to enter.

Stack: TanStack Start frontend (`src/`), Express serverless backend (`api/` + `lib/`, Neon Postgres), GSAP + custom 3D FX (`src/components/fx/Fx.tsx`).

Dev: `bun run dev` (frontend) · `bun run dev:api` (API)

# SignalVault

Timed access passes + AI betting-slip analysis, built for Ghana. Pay with Mobile
Money, get in, get value.

Full-stack monorepo:

| Part | Tech | Dir |
|------|------|-----|
| Frontend | TanStack Start (React 19), Tailwind, shadcn/ui | `src/` (repo root) |
| Backend | Node.js Express API, Neon Postgres | `backend/` |

The frontend talks to the backend over REST (`VITE_API_BASE_URL`,
default `http://localhost:8080`). Every response uses the envelope
`{ success, message, data }`.

**Integration map:** [`docs/INTEGRATION_MAP.md`](docs/INTEGRATION_MAP.md) — every
external service (Neon, ShinobiPay, ImgBB, OpenRouter, Cron), the full
frontend↔backend contract, business rules, and env vars.

## Quickstart

```bash
cp .env.example .env        # DATABASE_URL + APP_SHINOBIPAY_SECRET_KEY + an AI key
docker compose up --build   # backend :8080, web :3000
docker compose exec backend npm run db:migrate   # one-time schema setup
```

Or run each side directly:

```bash
# backend (needs Node 18+)
cd backend && npm install && npm run db:migrate && node local-server.js

# frontend (needs bun or node)
bun install
VITE_API_BASE_URL=http://localhost:8080 bun run dev
```

Open http://localhost:3000. The app also reads the API base URL from
`localStorage` (`darkweb_api_base`), so it can be pointed at any backend
without rebuilding.

## What the backend does

- **Subscriptions** — register with email → pay via **ShinobiPay instant MoMo**
  (prompt lands on the phone, approve with PIN) → one-time login password
  revealed → login starts the 2/3/5-hour timer. One active session per account.
- **Manual payments (Nigeria)** — bank-transfer proof via `/api/upload`
  (ImgBB, key stays server-side) → admin review → password.
- **AI slip scan** — one-time GHS 50 games-access gate, then buy a scan plan
  (MoMo or manual proof), upload the slip, OpenRouter vision models return
  per-pick predictions with confidence + reasoning.
- **Admin / super-admin** — separate logins, review queues (manual payments,
  scan purchases/sessions, mines), referral commissions + payouts, platform
  stats, scan simulator, virtual-predictions kill switch.
- **Safety nets** — ShinobiPay webhook + lazy status-poll reconciliation + a
  5-minute cron sweep settle payments race-free; expired sessions are
  force-logged-out.

## Configuration

All settings are env vars — see [`.env.example`](.env.example). The ones you
must set:

- `DATABASE_URL` — Neon Postgres (required)
- `APP_SHINOBIPAY_SECRET_KEY` / `APP_SHINOBIPAY_WEBHOOK_SECRET` — paid flows
- `IMGBB_API_KEY` — proof uploads
- `AI_OPENROUTER_API_KEYS` — AI scans
- `SUPERADMIN_USERNAME` / `SUPERADMIN_PASSWORD` — first superadmin (created on boot)
- `CRON_SECRET` — cron auth

## Deploy notes

- **Frontend** deploys from GitHub via Vercel/Lovable as before — set
  `VITE_API_BASE_URL` to the backend's public URL in the hosting dashboard.
- **Backend** deploys as Vercel serverless (`backend/vercel.json`: `/api/*`
  rewrites, cron every 5 min) or anywhere with Docker (`backend/Dockerfile`,
  honours `$PORT`).
- Register `POST https://<backend>/api/webhooks/shinobipay` in the ShinobiPay
  dashboard with the `whsec_…` secret.

## Project layout

```
darkweb/
├── src/                    # frontend (TanStack Start app)
│   ├── routes/             # /, /pricing, /scan, /dashboard, /manual-payment,
│   │                       #   /admin/*, /superadmin/* …
│   ├── components/         # site chrome + shadcn/ui primitives
│   └── lib/api.ts          # typed API client (points at VITE_API_BASE_URL)
├── backend/                # Node.js API (Express + Neon Postgres)
│   ├── api/index.js        # the entire API as one Express app
│   ├── api/cron/           # pending-payment + session-expiry sweep
│   ├── lib/services/       # ShinobiPay flows, AI, sessions, commissions…
│   ├── lib/middleware/     # session / admin / games-access auth
│   ├── lib/schema.sql      # Postgres schema
│   └── vercel.json         # rewrites + cron schedule
├── docs/
│   ├── INTEGRATION_MAP.md  # every integration, contract table, runbook
│   └── FRONTEND_FLOW_MAP.md# per-route frontend flow reference
├── docker-compose.yml      # backend + web dev stack
└── .env.example
```
