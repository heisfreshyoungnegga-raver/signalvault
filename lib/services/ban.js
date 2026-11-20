// lib/services/ban.js — deposit-rejection ban gate.
//
// Rule: once a user's deposit (manual subscription payment, AI scan
// purchase, or Mines purchase) has been REJECTED by an admin a combined
// total of 3 times, that user's email AND the IP address they've used are
// permanently and SEPARATELY banned — two independent ban records, either
// of which is enough to block. This is deliberate and strict:
//
//   • Same email, new IP  -> still blocked (the email itself is banned).
//   • Same IP, new email  -> the new email is blocked the moment it's seen
//     from a banned IP (checkNotBanned matches on IP alone), and is also
//     recorded so it's caught everywhere else even if it later moves off
//     that IP too.
//
// To make the second case watertight, EVERY identity-touching action
// (register, login, and every deposit submission) records the
// email<->IP link via recordIdentityContact(), not just deposit
// submissions. That means the full email/IP graph for a person is known
// as soon as they've ever registered or logged in from a device, not only
// once they've made a payment attempt — so a freshly-created email used
// from an already-banned IP is caught and banned immediately, and an
// already-banned email is caught no matter what new IP it appears from.
//
// This is intentionally a hard, permanent lock — there is no auto-expiry.
// Un-banning is a manual admin action (delete the row from
// banned_identities), not something this service exposes to end users.
//
// NOTE ON DEVICE/MAC ADDRESSES: a web server (this API) has no way to read
// a visitor's hardware MAC address — browsers never send it, and it isn't
// part of HTTP/TCP/IP at the level a website operates at. Any product that
// claims to "block by MAC" over the web is either misrepresenting IP
// address as MAC, or requires a native app/router-level integration this
// codebase doesn't have. IP address is the strongest device-level signal
// actually available here, so that's what's enforced.
const { sql } = require('../db');
const { ApiError, generateId } = require('../util');

const REJECTION_LIMIT = 3;

/**
 * Record that this email was seen from this IP, at this moment, for this
 * reason. Call this on every register, login, AND deposit submission — not
 * just deposit submissions — so the email<->IP graph is complete before a
 * ban ever needs to be enforced or propagated.
 */
async function recordIdentityContact(email, ipAddress, source) {
  if (!email || !ipAddress) return;
  const db = sql();
  await db`
    INSERT INTO deposit_submission_ips (id, email, ip_address, source)
    VALUES (${generateId()}, ${email.trim()}, ${ipAddress}, ${source})
  `;
}

// Back-compat alias — existing call sites use this name for deposit submits.
const recordSubmissionIp = recordIdentityContact;

/**
 * Combined rejection count for this email, across manual_payments,
 * scan_purchases, and mines_purchases.
 */
async function rejectionCountForEmail(email) {
  const db = sql();
  const rows = await db`
    SELECT
      (SELECT COUNT(*)::int FROM manual_payments WHERE email = ${email} AND status = 'REJECTED') AS manual_count,
      (SELECT COUNT(*)::int FROM scan_purchases  WHERE email = ${email} AND status = 'REJECTED') AS scan_count,
      (SELECT COUNT(*)::int FROM mines_purchases WHERE email = ${email} AND status = 'REJECTED') AS mines_count
  `;
  const row = rows[0] || { manual_count: 0, scan_count: 0, mines_count: 0 };
  return row.manual_count + row.scan_count + row.mines_count;
}

/** Every distinct IP this email has ever submitted a deposit from. */
async function ipsForEmail(email) {
  const db = sql();
  const rows = await db`
    SELECT DISTINCT ip_address FROM deposit_submission_ips WHERE email = ${email}
  `;
  return rows.map((r) => r.ip_address).filter(Boolean);
}

async function isBanned(email, ipAddress) {
  const db = sql();
  const rows = await db`
    SELECT email, ip_address FROM banned_identities
    WHERE (${email || null}::text IS NOT NULL AND email = ${email || null})
       OR (${ipAddress || null}::text IS NOT NULL AND ip_address = ${ipAddress || null})
    LIMIT 1
  `;
  return rows[0] || null;
}

async function banIdentity(email, ipAddress, reason) {
  const db = sql();
  await db`
    INSERT INTO banned_identities (id, email, ip_address, reason)
    VALUES (${generateId()}, ${email || null}, ${ipAddress || null}, ${reason})
  `;
}

/**
 * Throws a 403 ApiError if this email or IP is banned. Call before
 * register/login/any submit — i.e. before any action that would let
 * someone in.
 *
 * Strict cross-propagation: if the IP is banned but this exact email
 * isn't banned yet (a brand-new email tried from a banned device), that
 * email is banned too, right here, before the error is thrown — so it's
 * caught everywhere else from now on, even if it's later used from an
 * unbanned IP. Same in reverse: if the email is banned but this exact IP
 * isn't banned yet, the IP is banned too.
 */
async function checkNotBanned(email, ipAddress) {
  const hit = await isBanned(email, ipAddress);
  if (!hit) return;

  const matchedByEmail = email && hit.email === email;
  const matchedByIp = ipAddress && hit.ip_address === ipAddress;

  if (matchedByIp && email) {
    const emailAlreadyBanned = await isBanned(email, null);
    if (!emailAlreadyBanned) {
      await banIdentity(email, null, `auto-banned: seen from already-banned IP ${ipAddress}`);
    }
  }
  if (matchedByEmail && ipAddress) {
    const ipAlreadyBanned = await isBanned(null, ipAddress);
    if (!ipAlreadyBanned) {
      await banIdentity(null, ipAddress, `auto-banned: already-banned email ${email} seen from this IP`);
    }
  }

  throw new ApiError(
    'This account/device has been permanently banned for repeated rejected deposits and can no longer access this site.',
    403
  );
}

/**
 * Call this right after any manual/scan/mines rejection goes through.
 * If the user has now hit REJECTION_LIMIT combined rejections, ban their
 * email and every IP they've ever submitted a deposit from.
 */
async function recordRejectionAndMaybeBan(email) {
  if (!email) return { banned: false, count: 0 };
  const count = await rejectionCountForEmail(email);
  if (count < REJECTION_LIMIT) return { banned: false, count };

  const ips = await ipsForEmail(email);
  const reason = `${count} rejected deposit submissions (limit ${REJECTION_LIMIT})`;

  // Ban the email itself (idempotent-ish: fine if this runs more than once,
  // it just records another row — isBanned only needs one match).
  const alreadyBannedEmail = await isBanned(email, null);
  if (!alreadyBannedEmail) {
    await banIdentity(email, null, reason);
  }
  for (const ip of ips) {
    const alreadyBannedIp = await isBanned(null, ip);
    if (!alreadyBannedIp) {
      await banIdentity(null, ip, reason);
    }
  }

  return { banned: true, count };
}

function extractIp(req) {
  const raw = req.headers['x-forwarded-for'] || req.socket.remoteAddress || '';
  return String(raw).split(',')[0].trim();
}

module.exports = {
  REJECTION_LIMIT,
  recordIdentityContact,
  recordSubmissionIp,
  rejectionCountForEmail,
  isBanned,
  checkNotBanned,
  banIdentity,
  recordRejectionAndMaybeBan,
  extractIp,
};
