const bcrypt = require('bcryptjs');
const crypto = require('crypto');
const db = require('../database/db');

const SESSION_COOKIE = 'session_id';
const SESSION_MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000; // 30 days

async function hashPassword(password) {
  return bcrypt.hash(password, 10);
}

async function verifyPassword(password, hash) {
  return bcrypt.compare(password, hash);
}

async function createSessionForUser(userId, userAgent) {
  const session = {
    id: crypto.randomUUID(),
    userId,
    userAgent: userAgent || 'Unknown device',
    createdAt: new Date().toISOString(),
    lastSeenAt: new Date().toISOString(),
  };
  await db.createSession(session);
  return session;
}

function setSessionCookie(res, sessionId) {
  res.cookie(SESSION_COOKIE, sessionId, {
    httpOnly: true,
    sameSite: 'lax',
    maxAge: SESSION_MAX_AGE_MS,
  });
}

function clearSessionCookie(res) {
  res.clearCookie(SESSION_COOKIE);
}

/** Express middleware: resolves req.user from the session cookie, if any. Does not block. */
async function attachUser(req, res, next) {
  try {
    const sessionId = req.cookies?.[SESSION_COOKIE];
    if (!sessionId) return next();

    const session = await db.getSessionById(sessionId);
    if (!session) return next();

    const user = await db.getUserById(session.userId);
    if (!user) return next();

    await db.touchSession(sessionId);
    req.user = user;
    req.sessionId = sessionId;
    next();
  } catch (err) {
    next(err);
  }
}

/** Express middleware: 401s if no authenticated user. Use after attachUser. */
function requireAuth(req, res, next) {
  if (!req.user) {
    return res.status(401).json({ message: 'Not signed in' });
  }
  next();
}

/** Express middleware: 403s if the signed-in user isn't an admin. Use after requireAuth. */
function requireAdmin(req, res, next) {
  if (req.user.role !== 'admin') {
    return res.status(403).json({ message: 'Admin access required' });
  }
  next();
}

function sanitizeUser(user) {
  if (!user) return null;
  const { passwordHash, ...safe } = user;
  return safe;
}

module.exports = {
  SESSION_COOKIE,
  hashPassword,
  verifyPassword,
  createSessionForUser,
  setSessionCookie,
  clearSessionCookie,
  attachUser,
  requireAuth,
  requireAdmin,
  sanitizeUser,
};
