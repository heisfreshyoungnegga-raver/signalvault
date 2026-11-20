// lib/services/account.js — port of service/AccountService.java
const { sql } = require('../db');
const { ApiError, generatePassword } = require('../util');
const ban = require('./ban');

const EMAIL_RE = /^[A-Za-z0-9+_.-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$/;
const PHONE_RE = /^\+?[0-9]{7,15}$/;

function validateIdentifier(identifier) {
  if (!identifier || !identifier.trim()) {
    throw new ApiError('Email or phone number is required', 400);
  }
  if (!EMAIL_RE.test(identifier) && !PHONE_RE.test(identifier)) {
    throw new ApiError('Please provide a valid email address or phone number', 400);
  }
}

function rowToAccount(row) {
  if (!row) return null;
  return {
    username: row.username,
    password: row.password,
    plan: row.plan,
    createdAt: row.created_at,
    usageExpiresAt: row.usage_expires_at,
    activeSessionToken: row.active_session_token,
    subscriptionConsumed: row.subscription_consumed,
    referredByAdminCode: row.referred_by_admin_code,
    active: row.active !== false,
    deactivatedAt: row.deactivated_at || null,
  };
}

function isPaid(account) {
  return !!account.password && !!account.plan;
}

function isWindowExpired(account) {
  return !!account.usageExpiresAt && new Date() > new Date(account.usageExpiresAt);
}

function hasActiveSubscription(account) {
  return isPaid(account) && !account.subscriptionConsumed && !isWindowExpired(account);
}

async function findByUsername(identifier) {
  const db = sql();
  const rows = await db`SELECT * FROM users WHERE username = ${identifier}`;
  return rowToAccount(rows[0]);
}

async function register(identifier, referralCode, ipAddress) {
  validateIdentifier(identifier);
  await ban.checkNotBanned(identifier, ipAddress);
  const db = sql();

  // Record the email<->IP link on every registration attempt (not just
  // deposits), so the identity graph is complete from the moment an email
  // first appears — this is what lets a brand-new email be caught
  // immediately if it's coming from an already-banned IP, and lets an
  // already-banned email be tracked across every IP it's ever used.
  if (ipAddress) await ban.recordIdentityContact(identifier, ipAddress, 'REGISTER');

  let account = await findByUsername(identifier);

  if (!account) {
    let referredByAdminCode = null;
    if (referralCode && referralCode.trim()) {
      const admins = await db`SELECT * FROM admins WHERE referral_code = ${referralCode}`;
      const admin = admins[0];
      if (!admin) throw new ApiError('Invalid referral code', 400);
      if (!admin.active) throw new ApiError('This referral link is no longer active', 400);
      referredByAdminCode = referralCode;
    }
    await db`
      INSERT INTO users (username, referred_by_admin_code)
      VALUES (${identifier}, ${referredByAdminCode})
    `;
    return findByUsername(identifier);
  }

  return account;
}

async function assignSubscription(identifier, plan) {
  const db = sql();
  const account = await findByUsername(identifier);
  if (!account) {
    throw new ApiError(`No registered account found for ${identifier}. Please register first.`, 404);
  }

  const password = generatePassword(Number(process.env.ACCOUNT_PASSWORD_LENGTH || 10));

  await db`
    UPDATE users
    SET password = ${password},
        plan = ${plan.name},
        usage_expires_at = NULL,
        subscription_consumed = false,
        active_session_token = NULL
    WHERE username = ${identifier}
  `;

  return findByUsername(identifier);
}

async function canPurchase(identifier) {
  const account = await findByUsername(identifier);
  return !!account;
}

async function getAccountOrNull(identifier) {
  return findByUsername(identifier);
}

async function findAll() {
  const db = sql();
  const rows = await db`SELECT * FROM users ORDER BY created_at DESC`;
  return rows.map(rowToAccount);
}

module.exports = {
  register,
  assignSubscription,
  canPurchase,
  getAccountOrNull,
  findByUsername,
  findAll,
  isPaid,
  isWindowExpired,
  hasActiveSubscription,
};
