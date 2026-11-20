// lib/services/customerUsers.js — superadmin customer-user directory.
//
// SOURCE OF TRUTH: the CASINO account (sky_users) is the signed-up user
// (username, name, email, created_at). The scan-side users table holds
// purchase identities keyed by email (username = email or phone); a scan
// row without a matching casino account is still a real customer
// identity (email-only registration / pre-gate purchases), so the
// directory is the UNION by email: casino data wins where both exist,
// scan-only identities appear with no name/username. Sim identities
// live in sim_* tables and never appear here.
//
// DEACTIVATION: an `active` flag (default true) + deactivated_at on
// BOTH tables, added via ALTER (the same self-healing pattern the
// other services use). Deactivating an identifier flips every row that
// identifier owns. Enforcement lives at: casino login
// (skyAccount.login), session validation (session.validate), in-engine
// access (assertGameAccess), and the email-based purchase submits via
// assertNotDeactivated() below.
//
// This module imports only db + util (never another service), so the
// submit paths can require it without import cycles. Every query that
// touches a table another service owns is guarded: a missing table
// reads as "no rows", never a 500 — mirroring skyAccount.hasScanAccess.
const { sql } = require('../db');
const { ApiError } = require('../util');

const DEACTIVATED_MESSAGE = 'This account has been deactivated.';

let schemaReady;
async function ensureSchema() {
  if (!schemaReady) {
    schemaReady = (async () => {
      const db = sql();
      await db`
        CREATE TABLE IF NOT EXISTS sky_users (
          username               TEXT PRIMARY KEY,
          name                   TEXT NOT NULL,
          email                  TEXT NOT NULL,
          password               TEXT NOT NULL,
          referred_by_admin_code TEXT,
          created_at             TIMESTAMPTZ NOT NULL DEFAULT now()
        )`;
      await db`
        CREATE TABLE IF NOT EXISTS users (
          username                 TEXT PRIMARY KEY,
          password                 TEXT,
          plan                     TEXT,
          created_at               TIMESTAMPTZ NOT NULL DEFAULT now(),
          usage_expires_at         TIMESTAMPTZ,
          active_session_token     TEXT,
          subscription_consumed    BOOLEAN NOT NULL DEFAULT false,
          referred_by_admin_code   TEXT
        )`;
      await db`ALTER TABLE sky_users ADD COLUMN IF NOT EXISTS active BOOLEAN NOT NULL DEFAULT true`;
      await db`ALTER TABLE sky_users ADD COLUMN IF NOT EXISTS deactivated_at TIMESTAMPTZ`;
      await db`ALTER TABLE users ADD COLUMN IF NOT EXISTS active BOOLEAN NOT NULL DEFAULT true`;
      await db`ALTER TABLE users ADD COLUMN IF NOT EXISTS deactivated_at TIMESTAMPTZ`;
    })().catch((err) => { schemaReady = null; throw err; });
  }
  return schemaReady;
}

/** Runs a query that may target a table another service owns: missing table = no rows. */
async function guarded(fn) {
  try {
    return await fn();
  } catch {
    return [];
  }
}

function lower(s) {
  return String(s || '').trim().toLowerCase();
}

function skyRowToUser(row) {
  if (!row) return null;
  return {
    username: row.username,
    name: row.name,
    email: row.email,
    referredByAdminCode: row.referred_by_admin_code,
    createdAt: row.created_at,
    active: row.active !== false,
    deactivatedAt: row.deactivated_at || null,
  };
}

function scanRowToUser(row) {
  if (!row) return null;
  return {
    username: row.username,
    plan: row.plan,
    createdAt: row.created_at,
    usageExpiresAt: row.usage_expires_at,
    subscriptionConsumed: !!row.subscription_consumed,
    referredByAdminCode: row.referred_by_admin_code,
    active: row.active !== false,
    deactivatedAt: row.deactivated_at || null,
  };
}

/**
 * The directory: one row per customer identifier, newest signup first.
 * Casino data wins where both rows exist; scan-only identities appear
 * with no name/username. Active-plan + ever-bought indicators are
 * computed in bulk (a handful of queries, not per-user N+1).
 */
async function listUsers() {
  await ensureSchema();
  const db = sql();
  const skyRows = await db`SELECT * FROM sky_users ORDER BY created_at DESC`;
  const scanRows = await guarded(() => db`SELECT * FROM users ORDER BY created_at DESC`);

  const byEmail = new Map();
  for (const row of skyRows) {
    const u = skyRowToUser(row);
    byEmail.set(lower(u.email), {
      email: u.email,
      username: u.username,
      name: u.name,
      createdAt: u.createdAt,
      referredByAdminCode: u.referredByAdminCode,
      active: u.active,
      deactivatedAt: u.deactivatedAt,
      source: 'account',
      hasScanRow: false,
    });
  }
  for (const row of scanRows) {
    const s = scanRowToUser(row);
    const key = lower(s.username);
    const existing = byEmail.get(key);
    if (existing) {
      existing.hasScanRow = true;
      existing.active = existing.active && s.active;
      if (s.deactivatedAt && !existing.deactivatedAt) existing.deactivatedAt = s.deactivatedAt;
      if (!existing.referredByAdminCode) existing.referredByAdminCode = s.referredByAdminCode;
    } else {
      byEmail.set(key, {
        email: s.username,
        username: null,
        name: null,
        createdAt: s.createdAt,
        referredByAdminCode: s.referredByAdminCode,
        active: s.active,
        deactivatedAt: s.deactivatedAt,
        source: 'scan',
        hasScanRow: true,
      });
    }
  }

  // Bulk indicators: live windows + ever-bought identity sets.
  const liveWindows = await guarded(() => db`
    SELECT identity, game, plan, expires_at FROM game_windows WHERE expires_at > now()`);
  const activeByIdentity = new Map();
  for (const w of liveWindows) {
    const list = activeByIdentity.get(String(w.identity)) || [];
    list.push({ game: w.game, plan: w.plan, expiresAt: w.expires_at });
    activeByIdentity.set(String(w.identity), list);
  }
  const bought = new Set();
  const addEmails = (rows, col) => {
    for (const r of rows || []) if (r[col]) bought.add(lower(r[col]));
  };
  addEmails(await guarded(() => db`SELECT email FROM manual_payments`), 'email');
  addEmails(await guarded(() => db`SELECT email FROM scan_purchases`), 'email');
  addEmails(await guarded(() => db`SELECT email FROM scan_sessions`), 'email');
  addEmails(await guarded(() => db`SELECT email FROM gate_payments`), 'email');
  const passes = await guarded(() => db`SELECT username, email FROM game_passes`);
  addEmails(passes, 'email');
  addEmails(passes, 'username');

  const rows = [...byEmail.values()].map((u) => {
    const identities = [u.username, u.email].filter(Boolean);
    const activeGames = [];
    for (const id of identities) {
      for (const w of activeByIdentity.get(String(id)) || []) {
        if (!activeGames.some((g) => g.game === w.game)) activeGames.push(w);
      }
    }
    return {
      ...u,
      activeGames,
      activePlan: activeGames.length ? activeGames[0].plan : null,
      everBought: identities.some((id) => bought.has(lower(id))),
    };
  });
  rows.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
  return rows;
}

function windowState(row, now) {
  const expiresMs = new Date(row.expires_at).getTime();
  const secondsLeft = Math.max(0, Math.floor((expiresMs - now) / 1000));
  return {
    game: row.game,
    plan: row.plan,
    source: row.source,
    startedAt: row.started_at,
    expiresAt: row.expires_at,
    state: secondsLeft > 0 ? 'active' : 'expired',
    secondsLeft,
  };
}

/** Full detail for one customer identifier (email, or sky username). */
async function getDetail(identifier) {
  await ensureSchema();
  const db = sql();
  const key = lower(identifier);
  if (!key) throw new ApiError('User not found', 404);

  const skyRows = await db`
    SELECT * FROM sky_users WHERE lower(email) = ${key} OR lower(username) = ${key} LIMIT 1`;
  const sky = skyRowToUser(skyRows[0]);
  const scanRows = await guarded(() => db`
    SELECT * FROM users WHERE lower(username) = ${key} LIMIT 1`);
  let scan = scanRowToUser(scanRows[0]);
  if (sky && !scan) {
    const byEmail = await guarded(() => db`
      SELECT * FROM users WHERE lower(username) = ${lower(sky.email)} LIMIT 1`);
    scan = scanRowToUser(byEmail[0]);
  }
  if (!sky && !scan) throw new ApiError('User not found', 404);

  const email = sky ? sky.email : scan.username;
  const username = sky ? sky.username : null;
  const identities = [username, email].filter(Boolean);
  const now = Date.now();

  // Windows (best row per game, latest expiry wins) — pure read, never
  // mints anything (unlike the entitlement bridge, which grants).
  const windowRows = [];
  for (const id of identities) {
    windowRows.push(...(await guarded(() => db`SELECT * FROM game_windows WHERE identity = ${id}`)));
  }
  const best = new Map();
  for (const r of windowRows) {
    const cur = best.get(r.game);
    if (!cur || new Date(r.expires_at).getTime() > new Date(cur.expires_at).getTime()) best.set(r.game, r);
  }
  const windows = [...best.values()].map((r) => windowState(r, now)).sort((a, b) => a.game.localeCompare(b.game));
  const activeGames = windows.filter((w) => w.state === 'active');

  // Scan access: a grant with scans + window time left (APPROVED,
  // scans_used below cap, window unstarted or unexpired), or an ACTIVE
  // unexpired legacy session. Grant-aware query first; on any error
  // (e.g. a pre-grant table without the new columns) fall back to the
  // legacy APPROVED check so old DBs never read as "no access".
  let approvedScans = [];
  try {
    approvedScans = await db`
      SELECT 1 FROM scan_purchases WHERE lower(email) = ${key} AND status = 'APPROVED' AND scans_used < scans_max AND (window_expires_at IS NULL OR window_expires_at > now()) LIMIT 1`;
  } catch {
    approvedScans = await guarded(() => db`
      SELECT 1 FROM scan_purchases WHERE lower(email) = ${key} AND status = 'APPROVED' LIMIT 1`);
  }
  const activeSessions = await guarded(() => db`
    SELECT 1 FROM scan_sessions WHERE lower(email) = ${key} AND status = 'ACTIVE' AND expires_at > now() LIMIT 1`);
  const scanAccess = approvedScans.length > 0 || activeSessions.length > 0;

  // Legacy scan-side subscription (read-only; the users.plan row).
  const legacySubscription = scan && scan.plan
    ? {
        plan: scan.plan,
        usageExpiresAt: scan.usageExpiresAt,
        subscriptionConsumed: scan.subscriptionConsumed,
        active: !!scan.plan && !scan.subscriptionConsumed &&
          (!scan.usageExpiresAt || new Date(scan.usageExpiresAt).getTime() > now),
      }
    : null;

  // Purchase history across every rail (manual_payments + scan_purchases
  // carry no amount column — plan code is the record; game_passes do).
  const history = [];
  const pushHistory = (rows, map) => {
    for (const r of rows || []) history.push(map(r));
  };
  pushHistory(await guarded(() => db`SELECT * FROM manual_payments WHERE lower(email) = ${key}`), (r) => ({
    source: 'manual', id: r.id, plan: r.plan, game: null, amount: null, currency: null,
    status: r.status, date: r.submitted_at,
  }));
  pushHistory(await guarded(() => db`SELECT * FROM scan_purchases WHERE lower(email) = ${key}`), (r) => ({
    source: 'scan', id: r.id, plan: r.scan_plan, game: null, amount: null, currency: null,
    status: r.status, date: r.submitted_at,
  }));
  pushHistory(await guarded(() => db`SELECT * FROM scan_sessions WHERE lower(email) = ${key}`), (r) => ({
    source: 'scan-session', id: r.id, plan: r.plan, game: null, amount: null, currency: null,
    status: r.status, date: r.created_at,
  }));
  const passRows = [];
  for (const id of identities) {
    passRows.push(...(await guarded(() => db`SELECT * FROM game_passes WHERE username = ${id} OR lower(email) = ${key}`)));
  }
  const seenPasses = new Set();
  pushHistory(passRows.filter((r) => (seenPasses.has(r.id) ? false : (seenPasses.add(r.id), true))), (r) => ({
    source: 'pricing', id: r.id, plan: r.plan, game: r.game, amount: r.amount, currency: r.currency,
    status: r.status, date: r.created_at,
  }));
  pushHistory(await guarded(() => db`SELECT * FROM gate_payments WHERE lower(email) = ${key}`), (r) => ({
    source: 'gate', id: r.id ?? null, plan: 'GATE', game: null, amount: r.amount ?? null,
    currency: r.currency ?? null, status: r.status, date: r.created_at,
  }));
  history.sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());

  const plansEver = [...new Set([
    ...history.map((h) => h.plan).filter(Boolean),
    ...windows.map((w) => w.plan).filter(Boolean),
    ...(legacySubscription ? [legacySubscription.plan] : []),
  ])];
  const everBought = history.length > 0 || windows.length > 0 || !!legacySubscription;

  return {
    email,
    username,
    name: sky ? sky.name : null,
    createdAt: sky ? sky.createdAt : scan.createdAt,
    referredByAdminCode: (sky && sky.referredByAdminCode) || (scan && scan.referredByAdminCode) || null,
    active: (sky ? sky.active : true) && (scan ? scan.active : true),
    deactivatedAt: (sky && sky.deactivatedAt) || (scan && scan.deactivatedAt) || null,
    source: sky && scan ? 'both' : sky ? 'account' : 'scan',
    hasScanRow: !!scan,
    activeGames,
    activePlan: activeGames.length ? activeGames[0].plan : null,
    scanAccess,
    legacySubscription,
    windows,
    everBought,
    plansEver,
    lastPurchaseAt: history.length ? history[0].date : null,
    purchaseHistory: history.slice(0, 50),
  };
}

/** Flip the active flag on every row an identifier owns. 404 if none exist. */
async function setActive(identifier, active) {
  await ensureSchema();
  const db = sql();
  const key = lower(identifier);
  if (!key) throw new ApiError('User not found', 404);
  const stamp = active ? null : new Date().toISOString();
  const skyRes = await db`
    UPDATE sky_users SET active = ${active}, deactivated_at = ${stamp}
    WHERE lower(email) = ${key} OR lower(username) = ${key}`;
  const scanRes = await guarded(() => db`
    UPDATE users SET active = ${active}, deactivated_at = ${stamp}
    WHERE lower(username) = ${key}`);
  const skyCount = Number(skyRes.count ?? 0);
  // postgres.js UPDATE results carry .count; guarded() returns a bare []
  // (count undefined → 0) when the table is missing.
  const scanCount = Number(scanRes.count ?? 0);
  if (skyCount === 0 && scanCount === 0) {
    await getDetail(identifier); // throws 404 when truly absent
  }
  return getDetail(identifier);
}

/**
 * Purchase-submit guard: a deactivated identifier may not buy anything
 * new. Fail-open on missing columns/tables (old DBs): only an explicit
 * active=false blocks. Throws 403 with a clear message otherwise.
 */
async function assertNotDeactivated(email) {
  const key = lower(email);
  if (!key) return;
  const db = sql();
  const skyOff = await guarded(() => db`
    SELECT 1 FROM sky_users WHERE lower(email) = ${key} AND active = false LIMIT 1`);
  if (skyOff.length) throw new ApiError(DEACTIVATED_MESSAGE, 403);
  const scanOff = await guarded(() => db`
    SELECT 1 FROM users WHERE lower(username) = ${key} AND active = false LIMIT 1`);
  if (scanOff.length) throw new ApiError(DEACTIVATED_MESSAGE, 403);
}

module.exports = {
  ensureSchema,
  listUsers,
  getDetail,
  setActive,
  assertNotDeactivated,
  DEACTIVATED_MESSAGE,
};
