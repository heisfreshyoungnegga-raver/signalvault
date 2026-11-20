// lib/services/monitoringSchema.js
//
// Self-healing schema for the tables GET /api/superadmin/monitoring reads
// that NO other service ensureSchema covers — the exact class of bug that
// 500'd the endpoint live (42703 missing column / 42P01 missing table on a
// prod database whose tables predate later columns, or whose gateway-era
// tables were never created because the full lib/schema.sql was never run).
//
// Covered here (CREATE + ALTER, memoized, same pattern as
// skyPayments.ensureSchema):
//   - gate_payments, akwapay_payments, payment_transactions: legacy
//     gateway-era tables, created only by lib/schema.sql — nothing at
//     runtime ever heals them.
//   - mines_purchases: created only by lib/schema.sql; minesPurchase.js
//     has no ensureSchema at all.
//   - scan_sessions: created only by lib/schema.sql; its country /
//     network_or_bank / payment_method columns arrived via later ALTERs
//     in that file, and no service heals them at runtime.
// Deliberately NOT duplicated here: game_passes (skyPayments.ensureSchema),
// manual_payments (manualPayment.ensureSchema), scan_purchases
// (scanPurchase.ensureSchema — which also gains paid_amount_cedis),
// sky_users (skyAccount.ensureSchema). The monitoring handler calls all of
// those plus this one, so every table it reads is healed before it reads.
const { sql } = require('../db');

let schemaReady = null;
async function ensureSchema() {
  if (schemaReady) return schemaReady;
  schemaReady = (async () => {
    const db = sql();
    // Legacy gateway gate fees (handler reads email, amount, currency,
    // created_at, reviewed_at WHERE status).
    await db`
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
      )`;
    await db`ALTER TABLE gate_payments ADD COLUMN IF NOT EXISTS reviewed_at TIMESTAMPTZ`;
    await db`ALTER TABLE gate_payments ADD COLUMN IF NOT EXISTS email TEXT`;
    await db`ALTER TABLE gate_payments ADD COLUMN IF NOT EXISTS amount INTEGER`;
    await db`ALTER TABLE gate_payments ADD COLUMN IF NOT EXISTS currency TEXT DEFAULT 'GHS'`;
    await db`ALTER TABLE gate_payments ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ DEFAULT now()`;
    // Legacy AkwaPay subscriptions (handler reads email, plan,
    // paid_amount_cedis, submitted_at, reviewed_at WHERE status).
    // paid_amount_cedis arrived only via a schema.sql ALTER — a table
    // created by an older schema run lacks it, which 500s the handler.
    await db`
      CREATE TABLE IF NOT EXISTS akwapay_payments (
        id                 TEXT PRIMARY KEY,
        email              TEXT NOT NULL,
        plan               TEXT NOT NULL,
        reference          TEXT NOT NULL UNIQUE,
        intent_id          TEXT,
        status             TEXT NOT NULL DEFAULT 'AWAITING_PAYMENT',
        failure_reason     TEXT,
        password_revealed  BOOLEAN NOT NULL DEFAULT false,
        submitted_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
        reviewed_at        TIMESTAMPTZ
      )`;
    await db`ALTER TABLE akwapay_payments ADD COLUMN IF NOT EXISTS reviewed_at TIMESTAMPTZ`;
    await db`ALTER TABLE akwapay_payments ADD COLUMN IF NOT EXISTS paid_amount_cedis NUMERIC`;
    await db`ALTER TABLE akwapay_payments ADD COLUMN IF NOT EXISTS email TEXT`;
    await db`ALTER TABLE akwapay_payments ADD COLUMN IF NOT EXISTS plan TEXT`;
    await db`ALTER TABLE akwapay_payments ADD COLUMN IF NOT EXISTS submitted_at TIMESTAMPTZ DEFAULT now()`;
    // Legacy Paystack transactions (handler reads email, plan, created_at,
    // verified_at WHERE status + verified_at).
    await db`
      CREATE TABLE IF NOT EXISTS payment_transactions (
        reference    TEXT PRIMARY KEY,
        email        TEXT NOT NULL,
        plan         TEXT NOT NULL,
        status       TEXT NOT NULL DEFAULT 'PENDING',
        created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
        verified_at  TIMESTAMPTZ
      )`;
    await db`ALTER TABLE payment_transactions ADD COLUMN IF NOT EXISTS verified_at TIMESTAMPTZ`;
    await db`ALTER TABLE payment_transactions ADD COLUMN IF NOT EXISTS email TEXT`;
    await db`ALTER TABLE payment_transactions ADD COLUMN IF NOT EXISTS plan TEXT`;
    await db`ALTER TABLE payment_transactions ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ DEFAULT now()`;
    // Mines purchases (handler reads email, mines_plan, amount_cedis,
    // network_or_bank, submitted_at, reviewed_at WHERE status).
    await db`
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
        status              TEXT NOT NULL DEFAULT 'PENDING',
        rejection_reason    TEXT,
        submitted_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
        reviewed_at         TIMESTAMPTZ,
        reviewed_by_admin   TEXT,
        used_at             TIMESTAMPTZ
      )`;
    await db`ALTER TABLE mines_purchases ADD COLUMN IF NOT EXISTS reviewed_at TIMESTAMPTZ`;
    await db`ALTER TABLE mines_purchases ADD COLUMN IF NOT EXISTS email TEXT`;
    await db`ALTER TABLE mines_purchases ADD COLUMN IF NOT EXISTS network_or_bank TEXT`;
    await db`ALTER TABLE mines_purchases ADD COLUMN IF NOT EXISTS amount_cedis NUMERIC`;
    await db`ALTER TABLE mines_purchases ADD COLUMN IF NOT EXISTS mines_plan TEXT`;
    await db`ALTER TABLE mines_purchases ADD COLUMN IF NOT EXISTS submitted_at TIMESTAMPTZ`;
    // Legacy timed scan sessions (handler reads email, plan, country,
    // network_or_bank, activated_at WHERE payment_method, activated_at,
    // status). country / network_or_bank / payment_method arrived only
    // via schema.sql ALTERs — an older table lacks all three, which 500s
    // the handler. The payment_method DEFAULT ('MANUAL') matters: it is
    // what makes pre-existing rows match the handler's WHERE clause
    // after healing, instead of healing the column but counting nothing.
    await db`
      CREATE TABLE IF NOT EXISTS scan_sessions (
        id                 TEXT PRIMARY KEY,
        email              TEXT NOT NULL,
        plan               TEXT NOT NULL,
        akwapay_reference  TEXT,
        akwapay_intent_id  TEXT,
        status             TEXT NOT NULL DEFAULT 'AWAITING_PAYMENT',
        created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
        activated_at       TIMESTAMPTZ,
        expires_at         TIMESTAMPTZ,
        scan_count         INT NOT NULL DEFAULT 0
      )`;
    await db`ALTER TABLE scan_sessions ADD COLUMN IF NOT EXISTS payment_method TEXT NOT NULL DEFAULT 'MANUAL'`;
    await db`ALTER TABLE scan_sessions ADD COLUMN IF NOT EXISTS email TEXT`;
    await db`ALTER TABLE scan_sessions ADD COLUMN IF NOT EXISTS plan TEXT`;
    await db`ALTER TABLE scan_sessions ADD COLUMN IF NOT EXISTS activated_at TIMESTAMPTZ`;
    await db`ALTER TABLE scan_sessions ADD COLUMN IF NOT EXISTS account_name TEXT`;
    await db`ALTER TABLE scan_sessions ADD COLUMN IF NOT EXISTS account_number TEXT`;
    await db`ALTER TABLE scan_sessions ADD COLUMN IF NOT EXISTS network_or_bank TEXT`;
    await db`ALTER TABLE scan_sessions ADD COLUMN IF NOT EXISTS manual_reference TEXT`;
    await db`ALTER TABLE scan_sessions ADD COLUMN IF NOT EXISTS manual_screenshot_url TEXT`;
    await db`ALTER TABLE scan_sessions ADD COLUMN IF NOT EXISTS manual_reviewed_by TEXT`;
    await db`ALTER TABLE scan_sessions ADD COLUMN IF NOT EXISTS manual_rejection_reason TEXT`;
    await db`ALTER TABLE scan_sessions ADD COLUMN IF NOT EXISTS phone TEXT`;
    await db`ALTER TABLE scan_sessions ADD COLUMN IF NOT EXISTS network TEXT`;
    await db`ALTER TABLE scan_sessions ADD COLUMN IF NOT EXISTS country TEXT DEFAULT 'GH'`;
    await db`ALTER TABLE scan_sessions ADD COLUMN IF NOT EXISTS paid_amount_cedis NUMERIC`;
  })().catch((err) => { schemaReady = null; throw err; });
  return schemaReady;
}

module.exports = { ensureSchema };
