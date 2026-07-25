const express = require('express');
const { v4: uuidv4 } = require('uuid');
const db = require('../database/db');
const auth = require('../services/authService');
const asyncHandler = require('../utils/asyncHandler');

const router = express.Router();

// POST /api/analytics — records a page view. No auth: must work for
// logged-out visitors, which is the majority of site traffic.
router.post(
  '/',
  auth.attachUser,
  asyncHandler(async (req, res) => {
    const { path, visitorId, referrer } = req.body || {};
    if (!path || !visitorId) {
      return res.status(400).json({ message: 'path and visitorId are required' });
    }

    await db.recordPageView({
      id: uuidv4(),
      path: String(path).slice(0, 200),
      visitorId: String(visitorId).slice(0, 100),
      userId: req.user ? req.user.id : null,
      referrer: referrer ? String(referrer).slice(0, 500) : null,
      createdAt: new Date().toISOString(),
    });

    res.status(204).end();
  }),
);

module.exports = router;
