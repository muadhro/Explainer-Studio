const express = require('express');
const fs = require('fs');
const path = require('path');
const { v4: uuidv4 } = require('uuid');
const db = require('../database/db');
const auth = require('../services/authService');
const fileService = require('../services/fileService');
const asyncHandler = require('../utils/asyncHandler');
const paypal = require('../services/paypalService');
const { getPlan, getCycle, priceForPlan, PLANS, BILLING_CYCLES } = require('../config/plans');

const FRONTEND_URL = process.env.FRONTEND_URL || 'http://localhost:5173';

const router = express.Router();
const AVATAR_DIR = path.join(db.STORAGE_PATH, 'avatars');
fs.mkdirSync(AVATAR_DIR, { recursive: true });

router.use(auth.attachUser, auth.requireAuth);

// --- Profile ---
router.patch(
  '/profile',
  asyncHandler(async (req, res) => {
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

    const user = await db.updateUser(req.user.id, fields);
    res.json({ user: auth.sanitizeUser(user) });
  }),
);

// --- Security: password ---
router.post(
  '/password',
  asyncHandler(async (req, res) => {
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
    await db.updateUser(req.user.id, { passwordHash });
    res.json({ message: 'Password updated' });
  }),
);

// --- Security: sessions ---
router.get(
  '/sessions',
  asyncHandler(async (req, res) => {
    const sessions = (await db.getSessionsForUser(req.user.id)).map((s) => ({
      ...s,
      current: s.id === req.sessionId,
    }));
    res.json({ sessions });
  }),
);

router.delete(
  '/sessions/:id',
  asyncHandler(async (req, res) => {
    await db.deleteSession(req.params.id);
    res.json({ message: 'Session revoked' });
  }),
);

router.post(
  '/sessions/logout-others',
  asyncHandler(async (req, res) => {
    await db.deleteOtherSessions(req.user.id, req.sessionId);
    res.json({ message: 'Signed out of all other devices' });
  }),
);

// --- Preferences ---
router.patch(
  '/preferences',
  asyncHandler(async (req, res) => {
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

    const user = await db.updateUser(req.user.id, fields);
    res.json({ user: auth.sanitizeUser(user) });
  }),
);

function addMonths(isoDate, months) {
  const d = new Date(isoDate);
  d.setMonth(d.getMonth() + months);
  return d.toISOString();
}

// --- Billing ---
router.get(
  '/billing',
  asyncHandler(async (req, res) => {
    let user = req.user;

    // backfill for accounts created before subscription IDs existed
    if (!user.subscriptionId) {
      user = await db.updateUser(user.id, { subscriptionId: `SUB-${uuidv4().split('-')[0].toUpperCase()}` });
    }

    const plan = getPlan(user.plan);
    const cycle = getCycle(user.billingCycle);
    const price = priceForPlan(plan.id, cycle.months);
    const videosUsed = await db.countVideosThisMonthForUser(user.id);
    const periodStart = user.planUpdatedAt || user.createdAt;
    const expiresAt = plan.id === 'free' ? null : addMonths(periodStart, cycle.months);

    res.json({
      subscriptionId: user.subscriptionId,
      plan: { ...plan, cycle: cycle.months, price },
      periodStart,
      expiresAt,
      usage: { videosUsed, videosLimit: plan.videosPerMonth },
      // no real payment processor is connected — this is a placeholder history
      invoices: [],
      plans: PLANS,
      billingCycles: BILLING_CYCLES,
    });
  }),
);

router.post(
  '/billing/plan',
  asyncHandler(async (req, res) => {
    const { planId, billingCycle } = req.body || {};
    if (!PLANS.some((p) => p.id === planId)) {
      return res.status(400).json({ message: 'Unknown plan' });
    }
    if (!BILLING_CYCLES.some((c) => String(c.months) === String(billingCycle))) {
      return res.status(400).json({ message: 'Invalid billing cycle' });
    }

    // Real checkout for paid plans goes through PayPal (see /billing/paypal/*)
    // — this endpoint only ever assigns a plan without charging anything, so
    // it's for the Free plan and admin/manual overrides.
    const user = await db.updateUser(req.user.id, {
      plan: planId,
      billingCycle: String(billingCycle),
      planUpdatedAt: new Date().toISOString(),
      paypalSubscriptionId: planId === 'free' ? null : req.user.paypalSubscriptionId,
    });
    res.json({
      user: auth.sanitizeUser(user),
      message: 'Plan updated without a charge.',
    });
  }),
);

// --- Billing: PayPal checkout ---
router.post(
  '/billing/paypal/create-subscription',
  asyncHandler(async (req, res) => {
    const { planId, billingCycle } = req.body || {};
    const plan = PLANS.find((p) => p.id === planId);
    if (!plan) return res.status(400).json({ message: 'Unknown plan' });
    if (plan.id === 'free') return res.status(400).json({ message: 'The Free plan needs no checkout' });
    if (!BILLING_CYCLES.some((c) => String(c.months) === String(billingCycle))) {
      return res.status(400).json({ message: 'Invalid billing cycle' });
    }

    // PayPal appends its own `subscription_id` (and `ba_token`/`token`) query
    // params to return_url on redirect — no templating needed here.
    const { subscriptionId, approveUrl } = await paypal.createSubscription({
      planId: plan.id,
      cycleMonths: Number(billingCycle),
      returnUrl: `${FRONTEND_URL}/pricing?paypal=success`,
      cancelUrl: `${FRONTEND_URL}/pricing?paypal=cancelled`,
      subscriberEmail: req.user.email,
      subscriberName: req.user.fullName,
    });

    if (!approveUrl) {
      return res.status(502).json({ message: 'PayPal did not return an approval link' });
    }
    res.json({ subscriptionId, approveUrl });
  }),
);

router.post(
  '/billing/paypal/confirm',
  asyncHandler(async (req, res) => {
    const { subscriptionId } = req.body || {};
    if (!subscriptionId) return res.status(400).json({ message: 'subscriptionId is required' });

    const subscription = await paypal.getSubscription(subscriptionId);
    if (subscription.status !== 'ACTIVE') {
      return res.status(400).json({ message: `Subscription is not active yet (status: ${subscription.status})` });
    }

    const mapping = await db.getPaypalPlanByPaypalPlanId(subscription.plan_id);
    if (!mapping) {
      return res.status(502).json({ message: "Couldn't match this subscription to a known plan" });
    }

    const user = await db.updateUser(req.user.id, {
      plan: mapping.planId,
      billingCycle: String(mapping.cycleMonths),
      planUpdatedAt: new Date().toISOString(),
      paypalSubscriptionId: subscription.id,
    });

    res.json({ user: auth.sanitizeUser(user), message: 'Subscription active — plan updated.' });
  }),
);

// --- Privacy: export ---
router.get(
  '/export',
  asyncHandler(async (req, res) => {
    const videos = await db.getVideosForUser(req.user.id);
    const payload = {
      exportedAt: new Date().toISOString(),
      account: auth.sanitizeUser(req.user),
      videos,
    };
    res.setHeader('Content-Disposition', `attachment; filename="account-export-${req.user.id}.json"`);
    res.json(payload);
  }),
);

// --- Privacy: delete account ---
router.post(
  '/delete',
  asyncHandler(async (req, res) => {
    const { password } = req.body || {};
    if (!password) return res.status(400).json({ message: 'Password confirmation is required' });

    const valid = await auth.verifyPassword(password, req.user.passwordHash);
    if (!valid) return res.status(401).json({ message: 'Incorrect password' });

    for (const video of await db.getVideosForUser(req.user.id)) {
      fileService.deleteIfExists(video.videoPath);
      fileService.deleteIfExists(video.audioPath);
    }
    const avatarPath = req.user.avatarPath
      ? path.join(db.STORAGE_PATH, req.user.avatarPath.replace(/^\/avatars\//, 'avatars/'))
      : null;
    if (avatarPath) fileService.deleteIfExists(avatarPath);

    await db.deleteUser(req.user.id);
    auth.clearSessionCookie(res);
    res.json({ message: 'Account deleted' });
  }),
);

module.exports = router;
