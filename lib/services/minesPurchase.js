// lib/services/minesPurchase.js — AI Mines game manual bank-transfer payments.
// Same lifecycle/shape as lib/services/scanPurchase.js (PENDING -> APPROVED ->
// USED, or REJECTED), since that's the pattern the already-built admin review
// UI (superadmin-dashboard.html's MINES_EP block) expects.
const { sql } = require('../db');
const { ApiError, generateId, assertCleanField } = require('../util');
const ban = require('./ban');

function rowToPurchase(row) {
  if (!row) return null;
  return {
    id: row.id,
    email: row.email,
    minesPlan: row.mines_plan,
    amountCedis: Number(row.amount_cedis),
    accountName: row.account_name,
    accountNumber: row.account_number,
    networkOrBank: row.network_or_bank,
    reference: row.reference,
    screenshotUrl: row.screenshot_url,
    status: row.status,
    rejectionReason: row.rejection_reason,
    submittedAt: row.submitted_at,
    reviewedAt: row.reviewed_at,
    reviewedByAdmin: row.reviewed_by_admin,
    usedAt: row.used_at,
  };
}

function isValidHttpUrl(value) {
  return /^https?:\/\//i.test(value);
}

async function canSubmit(email) {
  return true;
}

async function submit(email, minesPlan, amountCedis, accountName, accountNumber, networkOrBank, reference, screenshotUrl, ipAddress) {
  assertCleanField(accountName, 'Account name');
  assertCleanField(reference, 'Reference');
  const db = sql();
  if (!email || !email.trim()) throw new ApiError('email is required', 400);
  await ban.checkNotBanned(email, ipAddress);
  if (!minesPlan || !minesPlan.trim()) throw new ApiError('minesPlan is required', 400);
  const amount = Number(amountCedis);
  if (!amount || amount <= 0) throw new ApiError('amountCedis must be a positive number', 400);

  if (!screenshotUrl || !screenshotUrl.trim()) throw new ApiError('A payment screenshot link is required', 400);
  if (!accountName || !accountName.trim()) throw new ApiError('accountName is required', 400);
  if (!accountNumber || !accountNumber.trim()) throw new ApiError('accountNumber is required', 400);
  if (!networkOrBank || !networkOrBank.trim()) throw new ApiError('networkOrBank is required', 400);
  if (!reference || !reference.trim()) throw new ApiError('reference is required', 400);

  const trimmedUrl = screenshotUrl.trim();
  if (!isValidHttpUrl(trimmedUrl)) throw new ApiError('screenshotUrl must be a valid http(s) URL', 400);

  const id = generateId();
  await db`
    INSERT INTO mines_purchases (id, email, mines_plan, amount_cedis, account_name, account_number, network_or_bank, reference, screenshot_url, status)
    VALUES (${id}, ${email.trim()}, ${minesPlan.trim()}, ${amount}, ${accountName.trim()}, ${accountNumber.trim()}, ${networkOrBank.trim()}, ${reference.trim()}, ${trimmedUrl}, 'PENDING')
  `;
  if (ipAddress) await ban.recordSubmissionIp(email.trim(), ipAddress, 'MINES');
  return getById(id);
}

async function getById(id) {
  const db = sql();
  const rows = await db`SELECT * FROM mines_purchases WHERE id = ${id}`;
  const purchase = rowToPurchase(rows[0]);
  if (!purchase) throw new ApiError('Mines purchase not found', 404);
  return purchase;
}

async function listAll() {
  const db = sql();
  const rows = await db`SELECT * FROM mines_purchases ORDER BY submitted_at DESC`;
  return rows.map(rowToPurchase);
}

async function listPending() {
  const db = sql();
  const rows = await db`SELECT * FROM mines_purchases WHERE status = 'PENDING' ORDER BY submitted_at DESC`;
  return rows.map(rowToPurchase);
}

async function listForEmail(email) {
  const db = sql();
  const rows = await db`SELECT * FROM mines_purchases WHERE email = ${email} ORDER BY submitted_at DESC`;
  return rows.map(rowToPurchase);
}

async function approve(id, adminUsername) {
  const db = sql();
  const purchase = await getById(id);
  if (purchase.status !== 'PENDING') {
    throw new ApiError(`This submission has already been ${purchase.status}`, 409);
  }
  const now = new Date().toISOString();
  await db`
    UPDATE mines_purchases SET status = 'APPROVED', reviewed_at = ${now}, reviewed_by_admin = ${adminUsername}
    WHERE id = ${id}
  `;
  return getById(id);
}

async function reject(id, adminUsername, reason) {
  const db = sql();
  const purchase = await getById(id);
  if (purchase.status !== 'PENDING') {
    throw new ApiError(`This submission has already been ${purchase.status}`, 409);
  }
  const now = new Date().toISOString();
  await db`
    UPDATE mines_purchases
    SET status = 'REJECTED', rejection_reason = ${reason && reason.trim() ? reason : 'Not specified'}, reviewed_at = ${now}, reviewed_by_admin = ${adminUsername}
    WHERE id = ${id}
  `;
  await ban.recordRejectionAndMaybeBan(purchase.email);
  return getById(id);
}

async function markUsed(id) {
  const db = sql();
  const purchase = await getById(id);
  if (purchase.status !== 'APPROVED') {
    throw new ApiError(`This Mines purchase is not ready to use (status: ${purchase.status})`, 409);
  }
  const now = new Date().toISOString();
  await db`UPDATE mines_purchases SET status = 'USED', used_at = ${now} WHERE id = ${id}`;
  return getById(id);
}

async function remove(id) {
  const db = sql();
  const purchase = await getById(id);
  if (['APPROVED', 'USED'].includes(purchase.status)) throw new ApiError('Approved or used Mines purchases cannot be deleted', 409);
  await db`DELETE FROM mines_purchases WHERE id = ${id}`;
  return { id, deleted: true };
}

module.exports = { canSubmit, submit, getById, listAll, listPending, listForEmail, approve, reject, markUsed, remove };
