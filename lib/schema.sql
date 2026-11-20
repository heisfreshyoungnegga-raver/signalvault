-- ============================================================================
-- VirtuWin serverless schema (Neon / Vercel Postgres)
-- Replaces every InMemory*Repository from the original Spring Boot backend.
-- Run this once against your Neon database before first deploy.
-- Safe to re-run: every statement is IF NOT EXISTS / idempotent.
-- ============================================================================

-- ── Users & sessions ────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS users (
    username                 TEXT PRIMARY KEY,          -- email or phone
    password                 TEXT,                      -- null until paid
    plan                     TEXT,                      -- TWO_HOUR | THREE_HOUR | FIVE_HOUR
    created_at               TIMESTAMPTZ NOT NULL DEFAULT now(),
    usage_expires_at         TIMESTAMPTZ,
    active_session_token     TEXT,
    subscription_consumed    BOOLEAN NOT NULL DEFAULT false,
    referred_by_admin_code   TEXT
);

CREATE TABLE IF NOT EXISTS sessions (
    token       TEXT PRIMARY KEY,
    username    TEXT NOT NULL,
    login_at    TIMESTAMPTZ NOT NULL,
    expires_at  TIMESTAMPTZ NOT NULL,
    ip_address  TEXT,
    active      BOOLEAN NOT NULL DEFAULT true
);
CREATE INDEX IF NOT EXISTS idx_sessions_username ON sessions(username);

-- ── Platform settings ───────────────────────────────────────────────────────
-- JSON values keep this extensible while the setting key remains stable.
CREATE TABLE IF NOT EXISTS platform_settings (
    setting_key   TEXT PRIMARY KEY,
    setting_value JSONB NOT NULL,
    updated_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_by    TEXT
);

-- ── Admins & admin sessions ─────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS admins (
    username               TEXT PRIMARY KEY,   -- email
    password                TEXT NOT NULL,
    role                    TEXT NOT NULL,      -- ADMIN | SUPER_ADMIN
    referral_code           TEXT UNIQUE NOT NULL,
    admin_share_percent     INT NOT NULL,
    platform_share_percent  INT NOT NULL,
    active                  BOOLEAN NOT NULL DEFAULT true,
    created_at              TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS admin_sessions (
    token       TEXT PRIMARY KEY,
    username    TEXT NOT NULL,
    role        TEXT NOT NULL,
    login_at    TIMESTAMPTZ NOT NULL,
    expires_at  TIMESTAMPTZ NOT NULL,
    active      BOOLEAN NOT NULL DEFAULT true
);

-- ── Paystack subscription payments ──────────────────────────────────────────
CREATE TABLE IF NOT EXISTS payment_transactions (
    reference    TEXT PRIMARY KEY,
    email        TEXT NOT NULL,
    plan         TEXT NOT NULL,
    status       TEXT NOT NULL DEFAULT 'PENDING',  -- PENDING | SUCCESS | FAILED
    created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
    verified_at  TIMESTAMPTZ
);

-- ── Manual (screenshot) subscription payments ───────────────────────────────
CREATE TABLE IF NOT EXISTS manual_payments (
    id                  TEXT PRIMARY KEY,
    email               TEXT NOT NULL,
    plan                TEXT NOT NULL,
    account_name        TEXT NOT NULL,
    account_number      TEXT NOT NULL,
    network_or_bank     TEXT NOT NULL,
    reference           TEXT NOT NULL,
    screenshot_url      TEXT NOT NULL,
    status              TEXT NOT NULL DEFAULT 'PENDING', -- PENDING | APPROVED | REJECTED
    rejection_reason    TEXT,
    password_revealed   BOOLEAN NOT NULL DEFAULT false,
    submitted_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
    reviewed_at         TIMESTAMPTZ,
    reviewed_by_admin   TEXT,
    amount_cedis        INTEGER  -- amount actually charged (GHS; NULL = legacy row, priced at 550, or Nigeria priced in NGN)
);
CREATE INDEX IF NOT EXISTS idx_manual_payments_email ON manual_payments(email);
CREATE INDEX IF NOT EXISTS idx_manual_payments_status ON manual_payments(status);

-- ── AkwaPay subscription payments ───────────────────────────────────────────
CREATE TABLE IF NOT EXISTS akwapay_payments (
    id                 TEXT PRIMARY KEY,
    email              TEXT NOT NULL,
    plan               TEXT NOT NULL,
    reference          TEXT NOT NULL UNIQUE,
    intent_id          TEXT,
    status             TEXT NOT NULL DEFAULT 'AWAITING_PAYMENT', -- AWAITING_PAYMENT | APPROVED | FAILED
    failure_reason     TEXT,
    password_revealed  BOOLEAN NOT NULL DEFAULT false,
    submitted_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
    reviewed_at        TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS idx_akwapay_payments_email ON akwapay_payments(email);

CREATE TABLE IF NOT EXISTS akwapay_pending_subscription_intents (
    reference        TEXT PRIMARY KEY,
    intent_id        TEXT NOT NULL,
    payment_id       TEXT NOT NULL,
    email            TEXT NOT NULL,
    created_at       TIMESTAMPTZ NOT NULL,
    last_checked_at  TIMESTAMPTZ
);

-- ── Commissions & payouts ───────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS commission_records (
    id                     TEXT PRIMARY KEY,
    payment_reference      TEXT NOT NULL,
    admin_username         TEXT NOT NULL,
    referred_user_email    TEXT NOT NULL,
    plan                   TEXT,
    amount_cedis           INT NOT NULL,
    admin_share_cedis      DOUBLE PRECISION NOT NULL,
    platform_share_cedis   DOUBLE PRECISION NOT NULL,
    created_at             TIMESTAMPTZ NOT NULL DEFAULT now(),
    paid_out               BOOLEAN NOT NULL DEFAULT false,
    paid_out_at            TIMESTAMPTZ,
    payout_id              TEXT
);
CREATE INDEX IF NOT EXISTS idx_commission_admin ON commission_records(admin_username);

-- CRITICAL FIX: commission_records only ever had one amount column
-- (amount_cedis), which meant a Nigerian manual payment's real Naira value
-- had nowhere honest to go — it was either dropped to the Cedi plan price
-- or (if ever "fixed" naively) written into amount_cedis and silently
-- summed into GHS totals elsewhere. This column records which currency
-- amount_cedis/admin_share_cedis/platform_share_cedis actually represent
-- for that row, so NGN commissions can be reported and paid out separately
-- and never added into a GHS total. Existing rows default to GHS since
-- every commission recorded before this fix really was in Cedis.
ALTER TABLE commission_records ADD COLUMN IF NOT EXISTS currency TEXT NOT NULL DEFAULT 'GHS';

CREATE TABLE IF NOT EXISTS payout_records (
    id                   TEXT PRIMARY KEY,
    admin_username       TEXT NOT NULL,
    total_amount_cedis   DOUBLE PRECISION NOT NULL,
    commission_count     INT NOT NULL,
    paid_at              TIMESTAMPTZ NOT NULL DEFAULT now(),
    paid_by_username     TEXT
);
CREATE INDEX IF NOT EXISTS idx_payout_admin ON payout_records(admin_username);
-- Matches commission_records.currency (see its comment above) — a payout is
-- always scoped to one currency, so this tags which one total_amount_cedis
-- represents for that payout row.
ALTER TABLE payout_records ADD COLUMN IF NOT EXISTS currency TEXT NOT NULL DEFAULT 'GHS';

-- Admin-initiated payout requests: an admin can ask to be paid their
-- pending commission balance; a superadmin then approves (which actually
-- marks the underlying commissions as paid_out, same as the old direct
-- payoutAdmin() flow) or rejects it (commissions stay pending, free to be
-- requested again). Existing rows predate this feature and were all
-- created directly by a superadmin with money already moved, so they
-- default to PAID with requested_at = paid_at.
ALTER TABLE payout_records ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'PAID';
ALTER TABLE payout_records ADD COLUMN IF NOT EXISTS requested_at TIMESTAMPTZ NOT NULL DEFAULT now();
ALTER TABLE payout_records ADD COLUMN IF NOT EXISTS rejected_at TIMESTAMPTZ;
ALTER TABLE payout_records ADD COLUMN IF NOT EXISTS rejected_by_username TEXT;
ALTER TABLE payout_records ALTER COLUMN paid_at DROP NOT NULL;

-- ── AI scan purchases (single-slip, manual or AkwaPay) ──────────────────────
CREATE TABLE IF NOT EXISTS scan_purchases (
    id                  TEXT PRIMARY KEY,
    email               TEXT NOT NULL,
    scan_plan           TEXT NOT NULL,
    payment_method      TEXT NOT NULL,  -- MANUAL | AKWAPAY
    account_name        TEXT,
    account_number      TEXT,
    network_or_bank     TEXT,
    reference           TEXT,
    screenshot_url      TEXT,
    akwapay_reference   TEXT UNIQUE,
    akwapay_intent_id   TEXT,
    status              TEXT NOT NULL DEFAULT 'PENDING',
    submitted_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
    reviewed_at         TIMESTAMPTZ,
    reviewed_by_admin   TEXT,
    rejection_reason    TEXT,
    used_at             TIMESTAMPTZ,
    -- Scan grant model (owner spec 2026-10-24): one APPROVED purchase =
    -- up to 10 completed analyses inside a 45-minute window starting on
    -- first use. Pre-grant rows convert automatically (0 used, no window).
    scans_used          INTEGER NOT NULL DEFAULT 0,
    scans_max           INTEGER NOT NULL DEFAULT 10,
    window_started_at   TIMESTAMPTZ,
    window_expires_at   TIMESTAMPTZ,
    amount_cedis        INTEGER  -- amount actually charged (GHS; NULL = legacy row, priced at 550, or Nigeria priced in NGN)
);
ALTER TABLE scan_purchases ADD COLUMN IF NOT EXISTS scans_used INTEGER NOT NULL DEFAULT 0;
ALTER TABLE scan_purchases ADD COLUMN IF NOT EXISTS scans_max INTEGER NOT NULL DEFAULT 10;
ALTER TABLE scan_purchases ADD COLUMN IF NOT EXISTS window_started_at TIMESTAMPTZ;
ALTER TABLE scan_purchases ADD COLUMN IF NOT EXISTS window_expires_at TIMESTAMPTZ;
CREATE INDEX IF NOT EXISTS idx_scan_purchases_email ON scan_purchases(email);
CREATE INDEX IF NOT EXISTS idx_scan_purchases_status ON scan_purchases(status);

CREATE TABLE IF NOT EXISTS akwapay_pending_scan_intents (
    reference        TEXT PRIMARY KEY,
    intent_id        TEXT NOT NULL,
    purchase_id      TEXT NOT NULL,
    email            TEXT NOT NULL,
    created_at       TIMESTAMPTZ NOT NULL,
    last_checked_at  TIMESTAMPTZ
);

-- ── AI scan results ──────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS scan_results (
    id                     TEXT PRIMARY KEY,
    purchase_id            TEXT NOT NULL,   -- also used for scan_session.id / simulator session id
    email                  TEXT NOT NULL,
    scan_plan              TEXT NOT NULL,
    total_picks_detected   INT NOT NULL DEFAULT 0,
    picks_analyzed         INT NOT NULL DEFAULT 0,
    predictions            JSONB,
    coverage_note          TEXT,
    raw_model_output       TEXT,
    created_at             TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_scan_results_email ON scan_results(email);
CREATE INDEX IF NOT EXISTS idx_scan_results_purchase ON scan_results(purchase_id);

-- ── Timed scan sessions (unlimited scans within a paid time window) ─────────
CREATE TABLE IF NOT EXISTS scan_sessions (
    id                 TEXT PRIMARY KEY,
    email              TEXT NOT NULL,
    plan               TEXT NOT NULL,   -- BASIC | STANDARD | PREMIUM (ScanSessionPlan)
    akwapay_reference  TEXT,
    akwapay_intent_id  TEXT,
    status             TEXT NOT NULL DEFAULT 'AWAITING_PAYMENT', -- AWAITING_PAYMENT|ACTIVE|EXPIRED|FAILED
    created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
    activated_at       TIMESTAMPTZ,
    expires_at         TIMESTAMPTZ,
    scan_count         INT NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_scan_sessions_email ON scan_sessions(email);
CREATE INDEX IF NOT EXISTS idx_scan_sessions_akwapay_ref ON scan_sessions(akwapay_reference);
ALTER TABLE scan_sessions ADD COLUMN IF NOT EXISTS simulator_payment_status TEXT;
ALTER TABLE scan_sessions ADD COLUMN IF NOT EXISTS simulator_rabbit_transaction_id TEXT;
ALTER TABLE scan_sessions ADD COLUMN IF NOT EXISTS simulator_subscriber_number TEXT;
ALTER TABLE scan_sessions ADD COLUMN IF NOT EXISTS simulator_network TEXT;

-- Manual Ghana timed-session payment review fields.
ALTER TABLE scan_sessions ADD COLUMN IF NOT EXISTS payment_method TEXT NOT NULL DEFAULT 'MANUAL';
ALTER TABLE scan_sessions ADD COLUMN IF NOT EXISTS account_name TEXT;
ALTER TABLE scan_sessions ADD COLUMN IF NOT EXISTS account_number TEXT;
ALTER TABLE scan_sessions ADD COLUMN IF NOT EXISTS network_or_bank TEXT;
ALTER TABLE scan_sessions ADD COLUMN IF NOT EXISTS manual_reference TEXT;
ALTER TABLE scan_sessions ADD COLUMN IF NOT EXISTS manual_screenshot_url TEXT;
ALTER TABLE scan_sessions ADD COLUMN IF NOT EXISTS manual_reviewed_by TEXT;
ALTER TABLE scan_sessions ADD COLUMN IF NOT EXISTS manual_rejection_reason TEXT;

-- ── Funds/country tracking (added for admin & super-admin fund reporting) ──
-- AkwaPay currently only routes Ghana mobile-money networks (see
-- resolveNetwork in akwapayCore.js), so every AkwaPay-sourced row is 'GH'
-- today. Kept as a real column (not hardcoded in queries) so this is a
-- one-line change if/when more countries are added.
ALTER TABLE akwapay_payments ADD COLUMN IF NOT EXISTS phone TEXT;
ALTER TABLE akwapay_payments ADD COLUMN IF NOT EXISTS network TEXT;
ALTER TABLE akwapay_payments ADD COLUMN IF NOT EXISTS country TEXT DEFAULT 'GH';

ALTER TABLE scan_purchases ADD COLUMN IF NOT EXISTS phone TEXT;
ALTER TABLE scan_purchases ADD COLUMN IF NOT EXISTS network TEXT;
ALTER TABLE scan_purchases ADD COLUMN IF NOT EXISTS country TEXT DEFAULT 'GH';

ALTER TABLE scan_sessions ADD COLUMN IF NOT EXISTS phone TEXT;
ALTER TABLE scan_sessions ADD COLUMN IF NOT EXISTS network TEXT;
ALTER TABLE scan_sessions ADD COLUMN IF NOT EXISTS country TEXT DEFAULT 'GH';

-- CRITICAL: real paid amount, captured directly from AkwaPay at the moment
-- a payment_intent actually succeeds (webhook or lazy-poll reconciliation).
-- Previously every total/report re-derived the amount afterward from a
-- static plan lookup table (PLAN/SCAN_PLAN/SCAN_SESSION_PLAN), which is
-- only ever as correct as that table is kept in sync with what was really
-- charged. This column is the ground truth: whatever AkwaPay's own
-- payment_intent.amount says was paid, in pesewas, converted to Cedis at
-- write time. NULL until settlement; once set, it is never recalculated.
ALTER TABLE akwapay_payments ADD COLUMN IF NOT EXISTS paid_amount_cedis NUMERIC;
ALTER TABLE scan_purchases ADD COLUMN IF NOT EXISTS paid_amount_cedis NUMERIC;
ALTER TABLE scan_sessions ADD COLUMN IF NOT EXISTS paid_amount_cedis NUMERIC;

CREATE TABLE IF NOT EXISTS akwapay_pending_scan_session_intents (
    reference        TEXT PRIMARY KEY,
    intent_id        TEXT NOT NULL,
    session_id       TEXT NOT NULL,
    email            TEXT NOT NULL,
    created_at       TIMESTAMPTZ NOT NULL,
    last_checked_at  TIMESTAMPTZ
);

-- ── AI Mines game payments (manual bank-transfer, same lifecycle as scan
--    purchases: PENDING -> APPROVED -> USED, or REJECTED) ───────────────────
-- No canonical price list exists for this feature yet anywhere in the
-- codebase, so amount_cedis/mines_plan are freeform (whatever the submitting
-- form sends), not validated against a hardcoded plan table like PLAN/SCAN_PLAN.
CREATE TABLE IF NOT EXISTS mines_purchases (
    id                  TEXT PRIMARY KEY,
    email               TEXT NOT NULL,
    mines_plan          TEXT NOT NULL,
    amount_cedis        NUMERIC NOT NULL,
    account_name        TEXT NOT NULL,
    account_number      TEXT NOT NULL,
    network_or_bank     TEXT NOT NULL,
    reference           TEXT NOT NULL,
    screenshot_url      TEXT NOT NULL,
    status              TEXT NOT NULL DEFAULT 'PENDING', -- PENDING | APPROVED | REJECTED | USED
    rejection_reason    TEXT,
    submitted_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
    reviewed_at         TIMESTAMPTZ,
    reviewed_by_admin   TEXT,
    used_at             TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS idx_mines_purchases_email ON mines_purchases(email);
CREATE INDEX IF NOT EXISTS idx_mines_purchases_status ON mines_purchases(status);
-- ShinobiPay rail for Mines (manual proof route closed; Ghana pays by MoMo prompt)
ALTER TABLE mines_purchases ALTER COLUMN screenshot_url DROP NOT NULL;
ALTER TABLE mines_purchases ADD COLUMN IF NOT EXISTS payment_method TEXT NOT NULL DEFAULT 'MANUAL';
ALTER TABLE mines_purchases ADD COLUMN IF NOT EXISTS shinobipay_reference TEXT;
ALTER TABLE mines_purchases ADD COLUMN IF NOT EXISTS shinobipay_intent_id TEXT;

-- ── Deposit-rejection ban gate ───────────────────────────────────────────────
-- Every manual/scan/mines deposit submission now records the submitter's IP
-- here so a rejection can be tied back to an IP as well as an email — a user
-- can't dodge the ban by re-registering under a new email from the same
-- device/network. banned_identities is the actual gate: once an email OR an
-- ip_address shows up in this table, checkNotBanned() (lib/services/ban.js)
-- blocks that identity from registering, logging in, or submitting any new
-- deposit anywhere on the site. Rows are never auto-deleted — unbanning is a
-- manual admin action (delete the row) by design, since this is meant to be
-- a hard, permanent lock, not a cooldown.
CREATE TABLE IF NOT EXISTS deposit_submission_ips (
    id             TEXT PRIMARY KEY,
    email          TEXT NOT NULL,
    ip_address     TEXT NOT NULL,
    source         TEXT NOT NULL,  -- MANUAL_SUBSCRIPTION | SCAN | MINES
    submitted_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_deposit_submission_ips_email ON deposit_submission_ips(email);
CREATE INDEX IF NOT EXISTS idx_deposit_submission_ips_ip ON deposit_submission_ips(ip_address);

CREATE TABLE IF NOT EXISTS banned_identities (
    id            TEXT PRIMARY KEY,
    email         TEXT,
    ip_address    TEXT,
    reason        TEXT NOT NULL,
    banned_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_banned_identities_email ON banned_identities(email);
CREATE INDEX IF NOT EXISTS idx_banned_identities_ip ON banned_identities(ip_address);

-- ── Games Access — one-time lifetime access gate ────────────────────────────
-- A user pays once (GHS 50 in Ghana, ₦10,000 in Nigeria) to permanently
-- unlock the games page on their device. The access token is stored here
-- and also persisted in the browser's localStorage under `grok_games_token`
-- so the client can check access offline. On each page load the client
-- checks the token against /api/games-access/verify to confirm it is still
-- valid server-side (super admin can revoke).
--
-- device_fingerprint: a best-effort client-side fingerprint composed of
--   navigator.userAgent + screen dimensions + timezone — stored so a revoke
--   can also clear by device rather than only by email.
-- ip_address: submitter's IP at time of submission (same pattern as
--   deposit_submission_ips above — for ban-gate auditing).
-- approved_by: superadmin username who approved the payment; NULL until approved.
--
-- Status lifecycle: PENDING → APPROVED (or REJECTED).
-- Once APPROVED the token is non-expiring; super admin can delete the row to
-- revoke access (client will then get 404 on /api/games-access/verify and
-- redirect to the payment page).
CREATE TABLE IF NOT EXISTS games_access_payments (
    id                  TEXT PRIMARY KEY,
    email               TEXT NOT NULL,
    country             TEXT NOT NULL,                  -- 'GH' | 'NG'
    amount              NUMERIC NOT NULL,               -- 50 (GHS) or 10000 (NGN)
    currency            TEXT NOT NULL,                  -- 'GHS' | 'NGN'
    account_name        TEXT NOT NULL,
    account_number      TEXT NOT NULL,
    network_or_bank     TEXT NOT NULL,
    reference           TEXT NOT NULL,
    screenshot_url      TEXT NOT NULL,
    status              TEXT NOT NULL DEFAULT 'PENDING', -- PENDING | APPROVED | REJECTED
    rejection_reason    TEXT,
    access_token        TEXT UNIQUE,                    -- set on approval, used for offline verify
    device_fingerprint  TEXT,                           -- client fingerprint at submission time
    ip_address          TEXT,
    submitted_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
    reviewed_at         TIMESTAMPTZ,
    approved_by         TEXT
);
CREATE INDEX IF NOT EXISTS idx_gap_email   ON games_access_payments(email);
CREATE INDEX IF NOT EXISTS idx_gap_status  ON games_access_payments(status);
CREATE INDEX IF NOT EXISTS idx_gap_token   ON games_access_payments(access_token);
ALTER TABLE games_access_payments ALTER COLUMN account_name DROP NOT NULL;
ALTER TABLE games_access_payments ALTER COLUMN screenshot_url DROP NOT NULL;
-- ShinobiPay rail for games access (Ghana one-time payment by MoMo prompt)
ALTER TABLE games_access_payments ADD COLUMN IF NOT EXISTS payment_method TEXT NOT NULL DEFAULT 'MANUAL';
ALTER TABLE games_access_payments ADD COLUMN IF NOT EXISTS shinobipay_reference TEXT;
ALTER TABLE games_access_payments ADD COLUMN IF NOT EXISTS shinobipay_intent_id TEXT;
ALTER TABLE games_access_payments ALTER COLUMN screenshot_url DROP NOT NULL;
ALTER TABLE games_access_payments ADD COLUMN IF NOT EXISTS payment_method TEXT NOT NULL DEFAULT 'MANUAL';
ALTER TABLE games_access_payments ADD COLUMN IF NOT EXISTS rabbit_transaction_id TEXT;
ALTER TABLE games_access_payments ADD COLUMN IF NOT EXISTS webrabbit_payment_id TEXT UNIQUE;
ALTER TABLE games_access_payments ADD COLUMN IF NOT EXISTS webrabbit_transaction_id TEXT;
CREATE INDEX IF NOT EXISTS idx_gap_webrabbit_transaction ON games_access_payments(webrabbit_transaction_id);

-- ── Web Rabbit Media — Ghana Mobile Money collections/disbursements ────────
CREATE TABLE IF NOT EXISTS webrabbit_payments (
    id TEXT PRIMARY KEY, email TEXT NOT NULL, plan TEXT NOT NULL, amount NUMERIC NOT NULL,
    currency TEXT NOT NULL DEFAULT 'GHS', subscriber_number TEXT NOT NULL, network TEXT NOT NULL,
    description TEXT, rabbit_transaction_id TEXT, provider_transaction_id TEXT,
    status TEXT NOT NULL DEFAULT 'PENDING', status_code TEXT, reason_code TEXT, reason TEXT,
    account_name TEXT, fee_amount NUMERIC, net_amount NUMERIC, idempotency_key TEXT UNIQUE NOT NULL,
    submitted_at TIMESTAMPTZ NOT NULL DEFAULT now(), settled_at TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS idx_webrabbit_payments_status ON webrabbit_payments(status);
CREATE INDEX IF NOT EXISTS idx_webrabbit_payments_submitted ON webrabbit_payments(submitted_at DESC);
ALTER TABLE webrabbit_payments ADD COLUMN IF NOT EXISTS country TEXT NOT NULL DEFAULT 'GH';
CREATE TABLE IF NOT EXISTS webrabbit_withdrawals (
    id TEXT PRIMARY KEY, amount NUMERIC NOT NULL, currency TEXT NOT NULL DEFAULT 'GHS',
    subscriber_number TEXT NOT NULL, network TEXT NOT NULL, description TEXT,
    rabbit_transaction_id TEXT, provider_transaction_id TEXT, status TEXT NOT NULL DEFAULT 'PENDING',
    reason TEXT, idempotency_key TEXT UNIQUE NOT NULL, created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_webrabbit_withdrawals_created ON webrabbit_withdrawals(created_at DESC);

CREATE TABLE IF NOT EXISTS webrabbit_webhook_events (event_id TEXT PRIMARY KEY, event_type TEXT, received_at TIMESTAMPTZ NOT NULL DEFAULT now());

-- ── Audit fixes (2026-10-05): payouts + login rate limiting ────────────────
-- C7/C8/L3: store the payout rejection reason, reserve the commissions of
-- existing PENDING requests (they were created before reservation existed),
-- and guarantee at most one open request per admin + currency. If the
-- unique index fails because duplicate PENDING rows exist, reject or merge
-- the extras first, then re-run.
ALTER TABLE payout_records ADD COLUMN IF NOT EXISTS rejection_reason TEXT;

UPDATE commission_records c
   SET payout_id = p.id
  FROM payout_records p
 WHERE p.status = 'PENDING'
   AND c.admin_username = p.admin_username
   AND c.currency = p.currency
   AND c.paid_out = false
   AND c.payout_id IS NULL;

CREATE UNIQUE INDEX IF NOT EXISTS uniq_pending_payout
  ON payout_records (admin_username, currency)
  WHERE status = 'PENDING';

-- C11: DB-backed login attempt counters (in-memory counters do not work on
-- serverless). One row per IP + username, 15-minute window.
CREATE TABLE IF NOT EXISTS login_attempts (
    key          TEXT PRIMARY KEY,
    count        INT NOT NULL DEFAULT 0,
    window_start TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ── ShinobiPay subscription payments ────────────────────────────────────────
-- Ghana subscriptions paid by direct MoMo push: creating the ShinobiPay
-- intent sends the approval prompt to the customer's phone; the row settles
-- AWAITING_PAYMENT -> APPROVED via webhook / lazy poll / cron sweep (see
-- lib/services/shinobiPaySubscription.js). Config is env-only:
-- APP_SHINOBIPAY_SECRET_KEY + APP_SHINOBIPAY_WEBHOOK_SECRET.
CREATE TABLE IF NOT EXISTS shinobipay_payments (
    id                 TEXT PRIMARY KEY,
    email              TEXT NOT NULL,
    plan               TEXT NOT NULL,
    reference          TEXT NOT NULL UNIQUE,
    intent_id          TEXT,
    status             TEXT NOT NULL DEFAULT 'AWAITING_PAYMENT', -- AWAITING_PAYMENT | APPROVED | FAILED
    failure_reason     TEXT,
    phone              TEXT,
    network            TEXT,
    country            TEXT DEFAULT 'GH',
    paid_amount_cedis  NUMERIC,
    password_revealed  BOOLEAN NOT NULL DEFAULT false,
    submitted_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
    reviewed_at        TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS idx_shinobipay_payments_email ON shinobipay_payments(email);
CREATE INDEX IF NOT EXISTS idx_shinobipay_payments_status ON shinobipay_payments(status);

-- One pending-intent tracking table shared by all three ShinobiPay flows
-- (subscription | scan_purchase | scan_session). The webhook doorbell and
-- the cron sweep look intents up here by reference.
CREATE TABLE IF NOT EXISTS shinobipay_pending_intents (
    reference        TEXT PRIMARY KEY,
    intent_id        TEXT NOT NULL,
    flow             TEXT NOT NULL,
    record_id        TEXT NOT NULL,
    email            TEXT NOT NULL,
    created_at       TIMESTAMPTZ NOT NULL,
    last_checked_at  TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS idx_shinobipay_pending_flow ON shinobipay_pending_intents(flow);

-- ── Casino accounts + ShinobiPay gate fee / per-game passes ─────────────
-- The frontend's account model (lib/services/skyAccount.js): sign up with
-- name/username/password, token sessions in the shared sessions table.
-- Gate fee and per-game passes settle via ShinobiPay
-- (lib/services/skyPayments.js, flows sky_gate / sky_pass in
-- shinobipay_pending_intents).
CREATE TABLE IF NOT EXISTS sky_users (
    username               TEXT PRIMARY KEY,
    name                   TEXT NOT NULL,
    email                  TEXT NOT NULL,
    password               TEXT NOT NULL,
    referred_by_admin_code TEXT,
    created_at             TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS gate_payments (
    id                   TEXT PRIMARY KEY,
    username             TEXT NOT NULL,
    email                TEXT NOT NULL,
    phone                TEXT,
    amount               INTEGER NOT NULL,
    currency             TEXT NOT NULL DEFAULT 'GHS',
    status               TEXT NOT NULL DEFAULT 'PENDING',
    shinobipay_reference TEXT,
    shinobipay_intent_id TEXT,
    device_id            TEXT,
    ip_address           TEXT,
    created_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
    reviewed_at          TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS idx_gate_payments_username ON gate_payments(username);

CREATE TABLE IF NOT EXISTS game_passes (
    id                   TEXT PRIMARY KEY,
    username             TEXT NOT NULL,
    email                TEXT NOT NULL,
    game                 TEXT NOT NULL,
    plan                 TEXT NOT NULL,
    amount               INTEGER NOT NULL,
    currency             TEXT NOT NULL DEFAULT 'GHS',
    status               TEXT NOT NULL DEFAULT 'PENDING',
    shinobipay_reference TEXT,
    shinobipay_intent_id TEXT,
    ip_address           TEXT,
    created_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
    settled_at           TIMESTAMPTZ,
    expires_at           TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS idx_game_passes_username ON game_passes(username);

-- ── 45-minute per-game access windows ──────────────────────────────────────
-- One row per (identity, game): minted at manual-payment approval (a
-- per-game pass mints its game; a Premium subscription mints every
-- game), [started_at, expires_at] is a pure wall-clock interval that
-- never pauses and survives logout/login. Renewal replaces the row.
-- intro_seen records that the engine-entry intro played for THIS
-- window. Identity is the casino username (or the subscription email
-- when no casino account exists yet); reads merge both keys.
CREATE TABLE IF NOT EXISTS game_windows (
    identity    TEXT NOT NULL,
    game        TEXT NOT NULL,
    plan        TEXT NOT NULL DEFAULT 'PREMIUM',
    source      TEXT NOT NULL,
    source_ref  TEXT,
    started_at  TIMESTAMPTZ NOT NULL,
    expires_at  TIMESTAMPTZ NOT NULL,
    intro_seen  BOOLEAN NOT NULL DEFAULT false,
    PRIMARY KEY (identity, game)
);
CREATE INDEX IF NOT EXISTS idx_game_windows_identity ON game_windows(identity);

-- ── Credit wallet (2026-11-20, replaces 45-minute windows + scan grants) ──
-- NEW PACKS: GH₵250 → 4 credits, GH₵300 → 8, GH₵500 → 12, GH₵1,000 → 20;
-- every use (scan, crash round, bottle spin, mines game) costs 4. NGN
-- pack prices are NOT SET. Credits never expire and top-ups stack.
-- Identity is the lower-cased account email (real) or the sim identity
-- (sim). The ledger audits every grant/spend; `ref` is unique so an
-- approval can never double-credit. Legacy game_windows / scan grant
-- rows are kept for history but grant NOTHING after this.
CREATE TABLE IF NOT EXISTS credit_balances (
    identity    TEXT PRIMARY KEY,
    balance     INTEGER NOT NULL DEFAULT 0,
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS credit_ledger (
    id            TEXT PRIMARY KEY,
    identity      TEXT NOT NULL,
    delta         INTEGER NOT NULL,
    reason        TEXT NOT NULL,
    ref           TEXT,
    balance_after INTEGER NOT NULL,
    created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS credit_ledger_identity_idx ON credit_ledger (identity, created_at DESC);
CREATE UNIQUE INDEX IF NOT EXISTS credit_ledger_ref_idx ON credit_ledger (ref) WHERE ref IS NOT NULL;
CREATE TABLE IF NOT EXISTS sim_credit_balances (
    identity    TEXT PRIMARY KEY,
    balance     INTEGER NOT NULL DEFAULT 0,
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS sim_credit_ledger (
    id            TEXT PRIMARY KEY,
    identity      TEXT NOT NULL,
    delta         INTEGER NOT NULL,
    reason        TEXT NOT NULL,
    ref           TEXT,
    balance_after INTEGER NOT NULL,
    created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS sim_credit_ledger_ref_idx ON sim_credit_ledger (ref) WHERE ref IS NOT NULL;

-- Engine-entry intro, once per game per account (no longer tied to a
-- window row, since windows are not minted any more). Same for sim.
CREATE TABLE IF NOT EXISTS game_intro_seen (
    identity    TEXT NOT NULL,
    game        TEXT NOT NULL,
    seen_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (identity, game)
);
CREATE TABLE IF NOT EXISTS sim_intro_seen (
    identity    TEXT NOT NULL,
    game        TEXT NOT NULL,
    seen_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (identity, game)
);

-- ── Superadmin user-flow simulator (staff-only QA) ─────────────────────────
-- Simulated state lives ONLY here — never in users/sky_users/
-- manual_payments/game_passes/game_windows. A sim identity (sim-*) can
-- browse the real lobby and play the real engines through its sim
-- token, but no real queue, wallet or window row is ever created.
CREATE TABLE IF NOT EXISTS sim_runs (
    id            TEXT PRIMARY KEY,
    sa_username   TEXT NOT NULL,
    sim_identity  TEXT NOT NULL UNIQUE,
    sim_token     TEXT NOT NULL UNIQUE,
    status        TEXT NOT NULL DEFAULT 'ACTIVE',
    created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
    expires_at    TIMESTAMPTZ NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_sim_runs_token ON sim_runs(sim_token);
CREATE TABLE IF NOT EXISTS sim_payments (
    id          TEXT PRIMARY KEY,
    run_id      TEXT NOT NULL,
    game        TEXT NOT NULL,
    status      TEXT NOT NULL DEFAULT 'PENDING',
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    reviewed_at TIMESTAMPTZ,
    -- Manual-payment form fields, mirrored from the real game-pass purchase.
    country        TEXT,
    account_name   TEXT,
    account_number TEXT,
    network_or_bank TEXT,
    reference      TEXT,
    amount         INTEGER,
    currency       TEXT
);
CREATE INDEX IF NOT EXISTS idx_sim_payments_run ON sim_payments(run_id);
ALTER TABLE sim_payments ADD COLUMN IF NOT EXISTS country TEXT;
ALTER TABLE sim_payments ADD COLUMN IF NOT EXISTS account_name TEXT;
ALTER TABLE sim_payments ADD COLUMN IF NOT EXISTS account_number TEXT;
ALTER TABLE sim_payments ADD COLUMN IF NOT EXISTS network_or_bank TEXT;
ALTER TABLE sim_payments ADD COLUMN IF NOT EXISTS reference TEXT;
ALTER TABLE sim_payments ADD COLUMN IF NOT EXISTS amount INTEGER;
ALTER TABLE sim_payments ADD COLUMN IF NOT EXISTS currency TEXT;
CREATE TABLE IF NOT EXISTS sim_game_windows (
    identity    TEXT NOT NULL,
    game        TEXT NOT NULL,
    started_at  TIMESTAMPTZ NOT NULL,
    expires_at  TIMESTAMPTZ NOT NULL,
    intro_seen  BOOLEAN NOT NULL DEFAULT false,
    PRIMARY KEY (identity, game)
);

-- Simulated scan access (granted by a 'scan' payment approval — one sim
-- grant mirroring the real model: 10 scans inside a 45-minute window
-- from first use) and simulated scan history (locally generated
-- results, no AI call).
CREATE TABLE IF NOT EXISTS sim_scan_access (
    identity    TEXT PRIMARY KEY,
    granted_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    scans_used  INTEGER NOT NULL DEFAULT 0,
    scans_max   INTEGER NOT NULL DEFAULT 10,
    window_started_at TIMESTAMPTZ,
    window_expires_at TIMESTAMPTZ
);
ALTER TABLE sim_scan_access ADD COLUMN IF NOT EXISTS scans_used INTEGER NOT NULL DEFAULT 0;
ALTER TABLE sim_scan_access ADD COLUMN IF NOT EXISTS scans_max INTEGER NOT NULL DEFAULT 10;
ALTER TABLE sim_scan_access ADD COLUMN IF NOT EXISTS window_started_at TIMESTAMPTZ;
ALTER TABLE sim_scan_access ADD COLUMN IF NOT EXISTS window_expires_at TIMESTAMPTZ;
CREATE TABLE IF NOT EXISTS sim_scans (
    id          TEXT PRIMARY KEY,
    identity    TEXT NOT NULL,
    slip_name   TEXT,
    result      JSONB NOT NULL,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_sim_scans_identity ON sim_scans(identity, created_at DESC);

-- ShinobiPay references on the shared purchase/session tables (rows are
-- payment_method = 'SHINOBIPAY'; the manual and retired-gateway columns are
-- left untouched).
ALTER TABLE scan_purchases ADD COLUMN IF NOT EXISTS shinobipay_reference TEXT;
ALTER TABLE scan_purchases ADD COLUMN IF NOT EXISTS shinobipay_intent_id TEXT;
ALTER TABLE scan_sessions ADD COLUMN IF NOT EXISTS shinobipay_reference TEXT;
ALTER TABLE scan_sessions ADD COLUMN IF NOT EXISTS shinobipay_intent_id TEXT;
CREATE INDEX IF NOT EXISTS idx_scan_sessions_shinobipay_ref ON scan_sessions(shinobipay_reference);

-- ── Round Customization — admin-set next-10-rounds overrides ────────────────
-- The predictor consumes these FIFO per game; empty queue = random generation.
CREATE TABLE IF NOT EXISTS custom_rounds (
    game_id      TEXT NOT NULL,
    round_index  INT  NOT NULL,
    crash_point  DOUBLE PRECISION NOT NULL,
    set_by       TEXT,
    created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (game_id, round_index)
);
CREATE INDEX IF NOT EXISTS idx_custom_rounds_game ON custom_rounds(game_id, round_index);
