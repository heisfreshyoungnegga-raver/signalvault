// api/cron/reconcile.js
//
// Backup sweep for background jobs the original Java backend's @Scheduled
// jobs used to do continuously (session-expiry cleanup, etc). Since
// serverless functions can't run background loops, this same logic runs on
// a schedule via Vercel Cron (see vercel.json "crons").
//
// Payments are MANUAL (owner decision, 2026-10-22 — every gateway was
// removed): submissions are settled by admin review, never automatically,
// so this sweep no longer touches payments at all. It only expires stale
// login sessions.
// Protect this endpoint: Vercel Cron requests include an
// `Authorization: Bearer $CRON_SECRET` header automatically when CRON_SECRET
// is set as a project env var — set it and this handler verifies it.
const sessionService = require('../../lib/services/session');

module.exports = async (req, res) => {
  const secret = process.env.CRON_SECRET;
  if (secret) {
    const header = req.headers.authorization;
    if (header !== `Bearer ${secret}`) {
      res.status(401).json({ success: false, message: 'Unauthorized' });
      return;
    }
  }

  const results = {};
  results.scanSessions = { mode: 'manual-review', automaticProviderSweep: false };
  results.payments = { mode: 'manual-review', automaticProviderSweep: false };
  try {
    let expired = 0;
    for (const s of await sessionService.findAll()) {
      if (s.active && sessionService.isExpired(s)) {
        await sessionService.forceLogout(s);
        expired++;
      }
    }
    results.userSessions = { expired };
  } catch (e) {
    results.userSessions = { error: e.message };
  }

  res.status(200).json({ success: true, message: 'Reconciliation sweep complete', data: results });
};
