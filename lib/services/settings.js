// lib/services/settings.js
// Persistent platform settings shared by the public site and super-admin dashboard.
const { sql } = require('../db');

const VIRTUAL_PREDICTIONS_KEY = 'virtual_predictions';
let tableReady;

async function ensureTable() {
  if (!tableReady) {
    const db = sql();
    tableReady = db.query(`
      CREATE TABLE IF NOT EXISTS platform_settings (
        setting_key TEXT PRIMARY KEY,
        setting_value JSONB NOT NULL,
        updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        updated_by TEXT
      )
    `).catch((err) => {
      tableReady = null;
      throw err;
    });
  }
  await tableReady;
}

async function getVirtualPredictions() {
  await ensureTable();
  const db = sql();
  const rows = await db`
    SELECT setting_value
    FROM platform_settings
    WHERE setting_key = ${VIRTUAL_PREDICTIONS_KEY}
  `;
  const value = rows[0] && rows[0].setting_value;
  return { enabled: value && typeof value === 'object' ? value.enabled === true : false };
}

async function setVirtualPredictions(enabled, updatedBy) {
  await ensureTable();
  const db = sql();
  const normalized = !!enabled;
  const rows = await db`
    INSERT INTO platform_settings (setting_key, setting_value, updated_at, updated_by)
    VALUES (${VIRTUAL_PREDICTIONS_KEY}, ${JSON.stringify({ enabled: normalized })}::jsonb, now(), ${updatedBy || null})
    ON CONFLICT (setting_key) DO UPDATE SET
      setting_value = EXCLUDED.setting_value,
      updated_at = EXCLUDED.updated_at,
      updated_by = EXCLUDED.updated_by
    RETURNING setting_value, updated_at, updated_by
  `;
  return {
    enabled: rows[0].setting_value.enabled === true,
    updatedAt: rows[0].updated_at,
    updatedBy: rows[0].updated_by,
  };
}

const BOTTLE_ROUNDS_KEY = 'bottle_round_calls';

async function getBottleRounds() {
  await ensureTable();
  const db = sql();
  const rows = await db`
    SELECT setting_value, updated_at, updated_by
    FROM platform_settings
    WHERE setting_key = ${BOTTLE_ROUNDS_KEY}
  `;
  const value = rows[0] && rows[0].setting_value;
  const calls = value && Array.isArray(value.calls) && value.calls.length === 10 && value.calls.every((c) => c === 'UP' || c === 'DOWN')
    ? value.calls : null;
  return {
    calls,
    updatedAt: rows[0] ? rows[0].updated_at : null,
    updatedBy: rows[0] ? rows[0].updated_by : null,
  };
}

async function setBottleRounds(calls, updatedBy) {
  await ensureTable();
  const db = sql();
  const normalized = calls == null ? null : calls.slice();
  const rows = await db`
    INSERT INTO platform_settings (setting_key, setting_value, updated_at, updated_by)
    VALUES (${BOTTLE_ROUNDS_KEY}, ${JSON.stringify({ calls: normalized })}::jsonb, now(), ${updatedBy || null})
    ON CONFLICT (setting_key) DO UPDATE SET
      setting_value = EXCLUDED.setting_value,
      updated_at = EXCLUDED.updated_at,
      updated_by = EXCLUDED.updated_by
    RETURNING setting_value, updated_at, updated_by
  `;
  return {
    calls: normalized,
    updatedAt: rows[0].updated_at,
    updatedBy: rows[0].updated_by,
  };
}

const PAYMENT_DETAILS_KEY = 'payment_details';

// Receiving details for MANUAL payments (owner-provided, 2026-10-22).
// Manual is the only payment rail now — Ghana pays by MoMo transfer to
// this number, Nigeria by bank transfer to this account — and every buy
// surface renders these. They are the code defaults; a super admin can
// override them via PUT /api/settings/payment-details (stored in
// platform_settings like every other setting).
const PAYMENT_DETAILS_DEFAULTS = {
  ghana: {
    accountName: 'KINSMAN SUSU VENTURES-SEKONDI',
    momoNumber: '0541568542',
  },
  nigeria: {
    bankName: 'Access Bank',
    accountNumber: '1945116494',
    receiverName: 'Amadi Victor Chinaemeze',
  },
};

async function getPaymentDetails() {
  await ensureTable();
  const db = sql();
  const rows = await db`
    SELECT setting_value
    FROM platform_settings
    WHERE setting_key = ${PAYMENT_DETAILS_KEY}
  `;
  const stored = rows[0] && rows[0].setting_value && typeof rows[0].setting_value === 'object'
    ? rows[0].setting_value : {};
  return {
    ghana: { ...PAYMENT_DETAILS_DEFAULTS.ghana, ...(stored.ghana || {}) },
    nigeria: { ...PAYMENT_DETAILS_DEFAULTS.nigeria, ...(stored.nigeria || {}) },
  };
}

async function setPaymentDetails(details, updatedBy) {
  await ensureTable();
  const pick = (obj, keys) => {
    const out = {};
    if (obj && typeof obj === 'object') {
      for (const k of keys) {
        if (typeof obj[k] === 'string' && obj[k].trim()) out[k] = obj[k].trim();
      }
    }
    return out;
  };
  const value = {
    ghana: pick(details && details.ghana, ['accountName', 'momoNumber']),
    nigeria: pick(details && details.nigeria, ['bankName', 'accountNumber', 'receiverName']),
  };
  const db = sql();
  await db`
    INSERT INTO platform_settings (setting_key, setting_value, updated_at, updated_by)
    VALUES (${PAYMENT_DETAILS_KEY}, ${JSON.stringify(value)}::jsonb, now(), ${updatedBy || null})
    ON CONFLICT (setting_key) DO UPDATE SET
      setting_value = EXCLUDED.setting_value,
      updated_at = EXCLUDED.updated_at,
      updated_by = EXCLUDED.updated_by
  `;
  return getPaymentDetails();
}

module.exports = { getVirtualPredictions, setVirtualPredictions, getBottleRounds, setBottleRounds, getPaymentDetails, setPaymentDetails, PAYMENT_DETAILS_DEFAULTS };
