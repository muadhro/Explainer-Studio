const express = require('express');
const db = require('../database/db');
const auth = require('../services/authService');
const fileService = require('../services/fileService');
const asyncHandler = require('../utils/asyncHandler');
const { getPlan, priceForPlan } = require('../config/plans');

const router = express.Router();

router.use(auth.attachUser, auth.requireAuth, auth.requireAdmin);

// GET /api/admin/users — every account, with plan/subscription state and video count.
// This is a live snapshot (current plan + usage), not a payment history — there's no
// transactions/invoices table yet since no real charge has ever gone through
// (PayPal is still on Sandbox). Revenue below is estimated from current plan pricing.
router.get(
  '/users',
  asyncHandler(async (req, res) => {
    const users = await db.getAllUsersWithVideoCounts();
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
