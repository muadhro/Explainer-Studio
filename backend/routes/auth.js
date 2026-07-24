const express = require('express');
const { v4: uuidv4 } = require('uuid');
const db = require('../database/db');
const auth = require('../services/authService');
const google = require('../services/googleAuthService');
const asyncHandler = require('../utils/asyncHandler');

const router = express.Router();
const FRONTEND_URL = process.env.FRONTEND_URL || 'http://localhost:5173';
const OAUTH_STATE_COOKIE = 'google_oauth_state';

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

router.post('/signup', asyncHandler(async (req, res) => {
  const { fullName, email, password } = req.body || {};

  if (!fullName || !email || !password) {
    return res.status(400).json({ message: 'fullName, email, and password are required' });
  }
  if (!EMAIL_RE.test(email)) {
    return res.status(400).json({ message: 'Enter a valid email address' });
  }
  if (String(password).length < 8) {
    return res.status(400).json({ message: 'Password must be at least 8 characters' });
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
    subscriptionId: `SUB-${uuidv4().split('-')[0].toUpperCase()}`,
    plan: 'free',
    billingCycle: '1',
    planUpdatedAt: now,
    theme: 'system',
    locale: 'en-US',
    createdAt: now,
  });

  const session = await auth.createSessionForUser(user.id, req.headers['user-agent']);
  auth.setSessionCookie(res, session.id);
  res.status(201).json({ user: auth.sanitizeUser(user) });
}));

router.post('/login', asyncHandler(async (req, res) => {
  const { email, password } = req.body || {};
  if (!email || !password) {
    return res.status(400).json({ message: 'Email and password are required' });
  }

  const user = await db.getUserByEmail(email);
  if (!user || !user.passwordHash || !(await auth.verifyPassword(password, user.passwordHash))) {
    return res.status(401).json({
      message: user && !user.passwordHash
        ? 'This account signs in with Google — use the "Continue with Google" button'
        : 'Incorrect email or password',
    });
  }

  const session = await auth.createSessionForUser(user.id, req.headers['user-agent']);
  auth.setSessionCookie(res, session.id);
  res.json({ user: auth.sanitizeUser(user) });
}));

router.post('/logout', auth.attachUser, asyncHandler(async (req, res) => {
  if (req.sessionId) await db.deleteSession(req.sessionId);
  auth.clearSessionCookie(res);
  res.json({ message: 'Signed out' });
}));

router.get('/me', auth.attachUser, (req, res) => {
  res.json({ user: auth.sanitizeUser(req.user) || null });
});

// --- Google OAuth ---
router.get('/google', (req, res) => {
  if (!google.isConfigured()) {
    return res.redirect(`${FRONTEND_URL}/login?error=google_not_configured`);
  }
  const state = google.generateState();
  res.cookie(OAUTH_STATE_COOKIE, state, {
    httpOnly: true,
    sameSite: 'lax',
    maxAge: 5 * 60 * 1000,
  });
  res.redirect(google.buildAuthorizationUrl(state));
});

router.get(
  '/google/callback',
  asyncHandler(async (req, res) => {
    const { code, state, error: googleError } = req.query;
    const expectedState = req.cookies?.[OAUTH_STATE_COOKIE];
    res.clearCookie(OAUTH_STATE_COOKIE);

    if (googleError) {
      return res.redirect(`${FRONTEND_URL}/login?error=google_denied`);
    }
    if (!code || !state || !expectedState || state !== expectedState) {
      return res.redirect(`${FRONTEND_URL}/login?error=google_auth_failed`);
    }

    let profile;
    try {
      const tokens = await google.exchangeCodeForTokens(code);
      profile = await google.fetchGoogleProfile(tokens.access_token);
    } catch (err) {
      console.error('[auth] Google OAuth failed:', err.message);
      return res.redirect(`${FRONTEND_URL}/login?error=google_auth_failed`);
    }
    if (!profile.email) {
      return res.redirect(`${FRONTEND_URL}/login?error=google_no_email`);
    }

    let user = await db.getUserByGoogleId(profile.sub);

    if (!user) {
      // link to an existing password account with the same email, else create fresh
      const existingByEmail = await db.getUserByEmail(profile.email);
      if (existingByEmail) {
        user = await db.updateUser(existingByEmail.id, { googleId: profile.sub });
      } else {
        const now = new Date().toISOString();
        user = await db.createUser({
          id: uuidv4(),
          email: profile.email.toLowerCase().trim(),
          googleId: profile.sub,
          fullName: profile.name || profile.email.split('@')[0],
          title: null,
          avatarPath: profile.picture || null,
          subscriptionId: `SUB-${uuidv4().split('-')[0].toUpperCase()}`,
          plan: 'free',
          billingCycle: '1',
          planUpdatedAt: now,
          theme: 'system',
          locale: 'en-US',
          createdAt: now,
        });
      }
    }

    const session = await auth.createSessionForUser(user.id, req.headers['user-agent']);
    auth.setSessionCookie(res, session.id);
    res.redirect(FRONTEND_URL);
  }),
);

module.exports = router;
