// lib/services/admin.js — port of service/AdminService.java
const { sql } = require('../db');
const { ApiError, generateReferralCode, hashPassword, verifyPassword } = require('../util');

function rowToAdmin(row) {
  if (!row) return null;
  return {
    username: row.username,
    password: row.password,
    role: row.role,
    referralCode: row.referral_code,
    adminSharePercent: row.admin_share_percent,
    platformSharePercent: row.platform_share_percent,
    active: row.active,
    createdAt: row.created_at,
  };
}

// Self-healing schema: admins / admin_sessions are created ONLY by
// lib/schema.sql (no service created them), so a database that grew
// table-by-table via service ensureSchemas — e.g. a prod Neon — can hold
// an admins table predating created_at (or miss the tables entirely).
// listAll's ORDER BY created_at then 500s the whole superadmin admins
// list (and the stats endpoint's totalAdmins) with
// 'column "created_at" does not exist'. Creating + ALTERing here makes
// the staff endpoints work on any database instead of depending on a
// manual schema run. Same pattern as commission.ensureSchema.
let schemaReady = null;
async function ensureSchema() {
  if (schemaReady) return schemaReady;
  schemaReady = (async () => {
    const db = sql();
    await db`
      CREATE TABLE IF NOT EXISTS admins (
        username               TEXT PRIMARY KEY,
        password               TEXT NOT NULL,
        role                   TEXT NOT NULL,
        referral_code          TEXT UNIQUE NOT NULL,
        admin_share_percent    INT NOT NULL,
        platform_share_percent INT NOT NULL,
        active                 BOOLEAN NOT NULL DEFAULT true,
        created_at             TIMESTAMPTZ NOT NULL DEFAULT now()
      )`;
    await db`
      CREATE TABLE IF NOT EXISTS admin_sessions (
        token      TEXT PRIMARY KEY,
        username   TEXT NOT NULL,
        role       TEXT NOT NULL,
        login_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
        expires_at TIMESTAMPTZ NOT NULL,
        active     BOOLEAN NOT NULL DEFAULT true
      )`;
    await db`ALTER TABLE admins ADD COLUMN IF NOT EXISTS password TEXT`;
    await db`ALTER TABLE admins ADD COLUMN IF NOT EXISTS role TEXT`;
    await db`ALTER TABLE admins ADD COLUMN IF NOT EXISTS referral_code TEXT`;
    await db`ALTER TABLE admins ADD COLUMN IF NOT EXISTS admin_share_percent INT`;
    await db`ALTER TABLE admins ADD COLUMN IF NOT EXISTS platform_share_percent INT`;
    await db`ALTER TABLE admins ADD COLUMN IF NOT EXISTS active BOOLEAN NOT NULL DEFAULT true`;
    await db`ALTER TABLE admins ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ NOT NULL DEFAULT now()`;
  })().catch((err) => { schemaReady = null; throw err; });
  return schemaReady;
}

async function exists(username) {
  const db = sql();
  const rows = await db`SELECT 1 FROM admins WHERE username = ${username}`;
  return rows.length > 0;
}

async function referralCodeExists(code) {
  const db = sql();
  const rows = await db`SELECT 1 FROM admins WHERE referral_code = ${code}`;
  return rows.length > 0;
}

async function generateUniqueReferralCode() {
  for (let attempts = 0; attempts < 20; attempts++) {
    const code = generateReferralCode();
    if (!(await referralCodeExists(code))) return code;
  }
  throw new ApiError('Could not generate a unique referral code, try again', 500);
}

async function createAdmin(email, password, role, adminSharePercentOverride) {
  await ensureSchema();
  const db = sql();
  if (await exists(email)) {
    throw new ApiError('An admin with this email already exists', 409);
  }

  const defaultAdminShare = Number(process.env.REFERRAL_DEFAULT_ADMIN_SHARE_PERCENT || 30);
  const adminShare = adminSharePercentOverride != null ? adminSharePercentOverride : defaultAdminShare;
  if (adminShare < 0 || adminShare > 100) {
    throw new ApiError('adminSharePercent must be between 0 and 100', 400);
  }
  const platformShare = 100 - adminShare;
  const referralCode = await generateUniqueReferralCode();

  await db`
    INSERT INTO admins (username, password, role, referral_code, admin_share_percent, platform_share_percent, active)
    VALUES (${email}, ${hashPassword(password)}, ${role}, ${referralCode}, ${adminShare}, ${platformShare}, true)
  `;

  return getByUsername(email);
}

async function authenticate(username, password) {
  const admin = await getByUsername(username).catch(() => null);
  if (!admin) throw new ApiError('Invalid admin credentials', 401);
  if (!admin.active) throw new ApiError('This admin account has been deactivated', 403);

  // C2: passwords are stored as scrypt hashes. Rows written before this
  // change hold plain text — accept one last plain-text match and upgrade
  // the row to a hash immediately, so plain text disappears on first login.
  let valid = verifyPassword(password, admin.password);
  if (!valid && admin.password && !admin.password.startsWith('scrypt$') && admin.password === password) {
    valid = true;
    const db = sql();
    await db`UPDATE admins SET password = ${hashPassword(password)} WHERE username = ${username}`;
  }
  if (!valid) throw new ApiError('Invalid admin credentials', 401);
  return admin;
}

async function getByUsername(username) {
  const db = sql();
  const rows = await db`SELECT * FROM admins WHERE username = ${username}`;
  const admin = rowToAdmin(rows[0]);
  if (!admin) throw new ApiError('Admin not found', 404);
  return admin;
}

async function getByReferralCode(code) {
  const db = sql();
  const rows = await db`SELECT * FROM admins WHERE referral_code = ${code}`;
  const admin = rowToAdmin(rows[0]);
  if (!admin) throw new ApiError('Invalid referral code', 400);
  return admin;
}

async function listAll() {
  await ensureSchema();
  const db = sql();
  const rows = await db`SELECT * FROM admins ORDER BY created_at DESC`;
  return rows.map(rowToAdmin);
}

async function setActive(username, active) {
  const db = sql();
  await getByUsername(username); // throws if not found
  await db`UPDATE admins SET active = ${active} WHERE username = ${username}`;
  return getByUsername(username);
}

module.exports = { ensureSchema, createAdmin, authenticate, getByUsername, getByReferralCode, listAll, setActive, exists };
