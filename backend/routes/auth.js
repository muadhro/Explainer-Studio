const express = require('express');
const { v4: uuidv4 } = require('uuid');
const db = require('../database/db');
const auth = require('../services/authService');

const router = express.Router();

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

router.post('/signup', async (req, res) => {
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
  if (db.getUserByEmail(email)) {
    return res.status(409).json({ message: 'An account with that email already exists' });
  }

  const passwordHash = await auth.hashPassword(password);
  const user = db.createUser({
    id: uuidv4(),
    email: email.toLowerCase().trim(),
    passwordHash,
    fullName: fullName.trim(),
    title: null,
    plan: 'free',
    billingCycle: '1',
    theme: 'system',
    locale: 'en-US',
    createdAt: new Date().toISOString(),
  });

  const session = auth.createSessionForUser(user.id, req.headers['user-agent']);
  auth.setSessionCookie(res, session.id);
  res.status(201).json({ user: auth.sanitizeUser(user) });
});

router.post('/login', async (req, res) => {
  const { email, password } = req.body || {};
  if (!email || !password) {
    return res.status(400).json({ message: 'Email and password are required' });
  }

  const user = db.getUserByEmail(email);
  if (!user || !(await auth.verifyPassword(password, user.passwordHash))) {
    return res.status(401).json({ message: 'Incorrect email or password' });
  }

  const session = auth.createSessionForUser(user.id, req.headers['user-agent']);
  auth.setSessionCookie(res, session.id);
  res.json({ user: auth.sanitizeUser(user) });
});

router.post('/logout', auth.attachUser, (req, res) => {
  if (req.sessionId) db.deleteSession(req.sessionId);
  auth.clearSessionCookie(res);
  res.json({ message: 'Signed out' });
});

router.get('/me', auth.attachUser, (req, res) => {
  res.json({ user: auth.sanitizeUser(req.user) || null });
});

module.exports = router;
