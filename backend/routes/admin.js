const express = require('express');
const { v4: uuidv4 } = require('uuid');
const db = require('../database/db');
const auth = require('../services/authService');
const fileService = require('../services/fileService');
const asyncHandler = require('../utils/asyncHandler');
const { getPlan, priceForPlan } = require('../config/plans');

const router = express.Router();

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

router.use(auth.attachUser, auth.requireAuth, auth.requireAdmin);

// GET /api/admin/users — every account, with plan/subscription state and video count.
// This is a live snapshot (current plan + usage), not a payment history — there's no
// transactions/invoices table yet since no real charge has ever gone through
// (PayPal is still on Sandbox). Revenue below is estimated from current plan pricing.
router.get(
  '/users',
  asyncHandler(async (req, res) => {
    let users = await db.getAllUsersWithVideoCounts();

    // backfill for accounts created before subscription IDs existed
    const missing = users.filter((u) => !u.subscriptionId);
    if (missing.length) {
      await Promise.all(
        missing.map((u) =>
          db.updateUser(u.id, { subscriptionId: `SUB-${uuidv4().split('-')[0].toUpperCase()}` }),
        ),
      );
      users = await db.getAllUsersWithVideoCounts();
    }

    const shaped = users.map((u) => {
      const plan = getPlan(u.plan);
      const price = priceForPlan(u.plan, u.billingCycle);
      const { passwordHash, ...safe } = u;
      return {
        ...safe,
        hasPassword: Boolean(passwordHash),
        planName: plan.name,
        monthlyValue: price.monthly,
      };
    });
    res.json({ users: shaped });
  }),
);

// POST /api/admin/users — admin creates a new user account directly.
router.post(
  '/users',
  asyncHandler(async (req, res) => {
    const { fullName, email, password, role } = req.body || {};

    if (!fullName || !email || !password) {
      return res.status(400).json({ message: 'fullName, email, and password are required' });
    }
    if (!EMAIL_RE.test(email)) {
      return res.status(400).json({ message: 'Enter a valid email address' });
    }
    if (String(password).length < 8) {
      return res.status(400).json({ message: 'Password must be at least 8 characters' });
    }
    if (role && role !== 'user' && role !== 'admin') {
      return res.status(400).json({ message: 'role must be "user" or "admin"' });
    }
    if (await db.getUserByEmail(email)) {
      return res.status(409).json({ message: 'An account with that email already exists' });
    }

    const passwordHash = await auth.hashPassword(password);
    const now = new Date().toISOString();
    const user = await db.createUser({
      id: uuidv4(),
      email: email.toLowerCase().trim(),
      passwordHash,
      fullName: fullName.trim(),
      title: null,
      role: role || 'user',
      subscriptionId: `SUB-${uuidv4().split('-')[0].toUpperCase()}`,
      plan: 'free',
      billingCycle: '1',
      planUpdatedAt: now,
      theme: 'system',
      locale: 'en-US',
      createdAt: now,
    });

    res.status(201).json({ user: auth.sanitizeUser(user) });
  }),
);

// DELETE /api/admin/users/:id — admin removes a user account.
router.delete(
  '/users/:id',
  asyncHandler(async (req, res) => {
    const { id } = req.params;

    if (id === req.user.id) {
      return res.status(400).json({ message: 'You cannot delete your own account' });
    }

    const target = await db.getUserById(id);
    if (!target) {
      return res.status(404).json({ message: 'User not found' });
    }

    if (target.role === 'admin') {
      const users = await db.getAllUsersWithVideoCounts();
      const adminCount = users.filter((u) => u.role === 'admin').length;
      if (adminCount <= 1) {
        return res.status(400).json({ message: 'Cannot delete the last remaining admin' });
      }
    }

    await db.deleteUser(id);
    res.json({ message: 'User deleted' });
  }),
);

// GET /api/admin/stats — dashboard summary numbers.
router.get(
  '/stats',
  asyncHandler(async (req, res) => {
    const users = await db.getAllUsersWithVideoCounts();

    const planCounts = {};
    let mrr = 0;
    let activePaidSubscriptions = 0;
    let totalVideos = 0;

    for (const u of users) {
      planCounts[u.plan] = (planCounts[u.plan] || 0) + 1;
      totalVideos += u.videoCount;
      if (u.plan !== 'free') {
        const price = priceForPlan(u.plan, u.billingCycle);
        mrr += price.monthly;
        activePaidSubscriptions += 1;
      }
    }

    res.json({
      totalUsers: users.length,
      activePaidSubscriptions,
      estimatedMRR: Math.round(mrr * 100) / 100,
      totalVideos,
      totalStorageMB: fileService.getTotalStorageUsedMB(),
      planCounts,
      adminCount: users.filter((u) => u.role === 'admin').length,
      googleLinkedCount: users.filter((u) => u.googleId).length,
    });
  }),
);

module.exports = router;
