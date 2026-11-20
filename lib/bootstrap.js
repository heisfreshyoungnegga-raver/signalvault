// lib/bootstrap.js — port of config/SuperAdminBootstrap.java
//
// The original ran this once at Spring Boot startup (CommandLineRunner).
// Serverless functions have no "startup" — instead this runs lazily, at
// most once per warm container, the first time any request comes in.
//
// C1 FIX: the superadmin credentials used to be hardcoded in this file and
// the password was force-reset on every cold start. They now come from the
// SUPERADMIN_USERNAME / SUPERADMIN_PASSWORD environment variables, are used
// ONLY to create the account when it does not exist yet, and are never
// written over an existing account. Set both variables in the Vercel
// project settings before deploying against a fresh database. The old
// hardcoded password has shipped in source — rotate it.
const adminService = require('./services/admin');

let checked = false;

const SUPERADMIN_USERNAME = process.env.SUPERADMIN_USERNAME;
const SUPERADMIN_PASSWORD = process.env.SUPERADMIN_PASSWORD;

async function ensureSuperAdminBootstrapped() {
  if (checked) return;
  checked = true;
  if (!SUPERADMIN_USERNAME || !SUPERADMIN_PASSWORD) return; // nothing to create

  try {
    const existing = await adminService.getByUsername(SUPERADMIN_USERNAME).catch(() => null);
    if (!existing) {
      await adminService.createAdmin(SUPERADMIN_USERNAME, SUPERADMIN_PASSWORD, 'SUPER_ADMIN', null);
      console.log('=======================================================');
      console.log(' Bootstrap SUPER_ADMIN created:', SUPERADMIN_USERNAME);
      console.log('=======================================================');
    }
    // DO NOT overwrite the password of an existing account on boot.
  } catch (err) {
    // Don't let a bootstrap race (two cold starts at once) break real requests.
    console.warn('[bootstrap] super admin bootstrap check failed:', err.message);
  }
}

module.exports = { ensureSuperAdminBootstrapped };
