const express = require('express');
const fs = require('fs');
const path = require('path');
const db = require('../database/db');
const auth = require('../services/authService');
const { getPlan, getCycle, priceForPlan, PLANS, BILLING_CYCLES } = require('../config/plans');

const router = express.Router();
const AVATAR_DIR = path.join(db.STORAGE_PATH, 'avatars');
fs.mkdirSync(AVATAR_DIR, { recursive: true });

router.use(auth.attachUser, auth.requireAuth);

// --- Profile ---
router.patch('/profile', (req, res) => {
  const { fullName, title, avatarDataUrl } = req.body || {};
  const fields = {};

  if (fullName !== undefined) {
    if (!String(fullName).trim()) return res.status(400).json({ message: 'Full name cannot be empty' });
    fields.fullName = String(fullName).trim();
  }
  if (title !== undefined) {
    fields.title = String(title).trim() || null;
  }
  if (avatarDataUrl) {
    const match = /^data:(image\/(png|jpeg|jpg|webp));base64,(.+)$/.exec(avatarDataUrl);
    if (!match) return res.status(400).json({ message: 'Avatar must be a PNG, JPEG, or WebP image' });
    const buffer = Buffer.from(match[3], 'base64');
    if (buffer.length > 2 * 1024 * 1024) {
      return res.status(400).json({ message: 'Avatar must be under 2MB' });
    }
    const ext = match[2] === 'jpeg' ? 'jpg' : match[2];
    const filePath = path.join(AVATAR_DIR, `${req.user.id}.${ext}`);
    fs.writeFileSync(filePath, buffer);
    fields.avatarPath = `/avatars/${req.user.id}.${ext}`;
  }

  const user = db.updateUser(req.user.id, fields);
  res.json({ user: auth.sanitizeUser(user) });
});

// --- Security: password ---
router.post('/password', async (req, res) => {
  const { currentPassword, newPassword } = req.body || {};
  if (!currentPassword || !newPassword) {
    return res.status(400).json({ message: 'Current and new password are required' });
  }
  if (String(newPassword).length < 8) {
    return res.status(400).json({ message: 'New password must be at least 8 characters' });
  }

  const valid = await auth.verifyPassword(currentPassword, req.user.passwordHash);
  if (!valid) return res.status(401).json({ message: 'Current password is incorrect' });

  const passwordHash = await auth.hashPassword(newPassword);
  db.updateUser(req.user.id, { passwordHash });
  res.json({ message: 'Password updated' });
});

// --- Security: sessions ---
router.get('/sessions', (req, res) => {
  const sessions = db.getSessionsForUser(req.user.id).map((s) => ({
    ...s,
    current: s.id === req.sessionId,
  }));
  res.json({ sessions });
});

router.delete('/sessions/:id', (req, res) => {
  db.deleteSession(req.params.id);
  res.json({ message: 'Session revoked' });
});

router.post('/sessions/logout-others', (req, res) => {
  db.deleteOtherSessions(req.user.id, req.sessionId);
  res.json({ message: 'Signed out of all other devices' });
});

// --- Preferences ---
router.patch('/preferences', (req, res) => {
  const { theme, locale, timezone, notifyProduct, notifyMarketing, notifyBilling } = req.body || {};
  const fields = {};

  if (theme !== undefined) {
    if (!['light', 'dark', 'system'].includes(theme)) return res.status(400).json({ message: 'Invalid theme' });
    fields.theme = theme;
  }
  if (locale !== undefined) fields.locale = String(locale);
  if (timezone !== undefined) fields.timezone = String(timezone);
  if (notifyProduct !== undefined) fields.notifyProduct = notifyProduct ? 1 : 0;
  if (notifyMarketing !== undefined) fields.notifyMarketing = notifyMarketing ? 1 : 0;
  if (notifyBilling !== undefined) fields.notifyBilling = notifyBilling ? 1 : 0;

  const user = db.updateUser(req.user.id, fields);
  res.json({ user: auth.sanitizeUser(user) });
});

// --- Billing ---
router.get('/billing', (req, res) => {
  const plan = getPlan(req.user.plan);
  const cycle = getCycle(req.user.billingCycle);
  const price = priceForPlan(plan.id, cycle.months);
  const videosUsed = db.countVideosThisMonthForUser(req.user.id);

  res.json({
    plan: { ...plan, cycle: cycle.months, price },
    usage: { videosUsed, videosLimit: plan.videosPerMonth },
    // no real payment processor is connected — this is a placeholder history
    invoices: [],
    plans: PLANS,
    billingCycles: BILLING_CYCLES,
  });
});

router.post('/billing/plan', (req, res) => {
  const { planId, billingCycle } = req.body || {};
  if (!PLANS.some((p) => p.id === planId)) {
    return res.status(400).json({ message: 'Unknown plan' });
  }
  if (!BILLING_CYCLES.some((c) => String(c.months) === String(billingCycle))) {
    return res.status(400).json({ message: 'Invalid billing cycle' });
  }

  const user = db.updateUser(req.user.id, {
    plan: planId,
    billingCycle: String(billingCycle),
    planUpdatedAt: new Date().toISOString(),
  });
  res.json({
    user: auth.sanitizeUser(user),
    message:
      'Plan updated. No payment was charged — connect a payment processor (e.g. Stripe) to bill real cards.',
  });
});

// --- Privacy: export ---
router.get('/export', (req, res) => {
  const videos = db.getVideosForUser(req.user.id);
  const payload = {
    exportedAt: new Date().toISOString(),
    account: auth.sanitizeUser(req.user),
    videos,
  };
  res.setHeader('Content-Disposition', `attachment; filename="account-export-${req.user.id}.json"`);
  res.json(payload);
});

// --- Privacy: delete account ---
router.post('/delete', async (req, res) => {
  const { password } = req.body || {};
  if (!password) return res.status(400).json({ message: 'Password confirmation is required' });

  const valid = await auth.verifyPassword(password, req.user.passwordHash);
  if (!valid) return res.status(401).json({ message: 'Incorrect password' });

  const fileService = require('../services/fileService');
  for (const video of db.getVideosForUser(req.user.id)) {
    fileService.deleteIfExists(video.videoPath);
    fileService.deleteIfExists(video.audioPath);
  }
  const avatarPath = req.user.avatarPath ? path.join(db.STORAGE_PATH, req.user.avatarPath.replace(/^\/avatars\//, 'avatars/')) : null;
  if (avatarPath) fileService.deleteIfExists(avatarPath);

  db.deleteUser(req.user.id);
  auth.clearSessionCookie(res);
  res.json({ message: 'Account deleted' });
});

module.exports = router;
