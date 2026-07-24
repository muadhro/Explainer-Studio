const path = require('path');
const fs = require('fs');
const { DatabaseSync } = require('node:sqlite');

// Resolve relative to the project root (backend/database/../..) so storage
// location is stable no matter what directory the server is started from.
const PROJECT_ROOT = path.join(__dirname, '..', '..');
const rawStoragePath = process.env.VIDEO_STORAGE_PATH || './videos';
const STORAGE_PATH = path.isAbsolute(rawStoragePath)
  ? rawStoragePath
  : path.join(PROJECT_ROOT, rawStoragePath);
const DB_PATH = path.join(STORAGE_PATH, 'db.sqlite');

fs.mkdirSync(STORAGE_PATH, { recursive: true });
fs.mkdirSync(path.join(STORAGE_PATH, 'audio'), { recursive: true });
fs.mkdirSync(path.join(STORAGE_PATH, 'generated'), { recursive: true });

const db = new DatabaseSync(DB_PATH);
db.exec('PRAGMA journal_mode = WAL');

db.exec(`
  CREATE TABLE IF NOT EXISTS videos (
    id TEXT PRIMARY KEY,
    title TEXT NOT NULL,
    courseContent TEXT NOT NULL,
    animationStyle TEXT NOT NULL,
    quality TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'queued',
    progress INTEGER NOT NULL DEFAULT 0,
    falJobId TEXT,
    audioPath TEXT,
    videoPath TEXT,
    fileSize REAL,
    createdAt TEXT NOT NULL,
    completedAt TEXT,
    errorMessage TEXT
  )
`);

// migration for databases created before voice selection existed
try {
  db.exec('ALTER TABLE videos ADD COLUMN voiceId TEXT');
} catch {
  /* column already exists */
}

// migration for databases created before accounts existed
try {
  db.exec('ALTER TABLE videos ADD COLUMN userId TEXT');
} catch {
  /* column already exists */
}

db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id TEXT PRIMARY KEY,
    email TEXT NOT NULL UNIQUE,
    passwordHash TEXT NOT NULL,
    fullName TEXT NOT NULL,
    title TEXT,
    avatarPath TEXT,
    plan TEXT NOT NULL DEFAULT 'free',
    billingCycle TEXT NOT NULL DEFAULT '1',
    planUpdatedAt TEXT,
    theme TEXT NOT NULL DEFAULT 'system',
    locale TEXT NOT NULL DEFAULT 'en-US',
    timezone TEXT,
    notifyProduct INTEGER NOT NULL DEFAULT 1,
    notifyMarketing INTEGER NOT NULL DEFAULT 0,
    notifyBilling INTEGER NOT NULL DEFAULT 1,
    createdAt TEXT NOT NULL
  )
`);

db.exec(`
  CREATE TABLE IF NOT EXISTS sessions (
    id TEXT PRIMARY KEY,
    userId TEXT NOT NULL,
    userAgent TEXT,
    createdAt TEXT NOT NULL,
    lastSeenAt TEXT NOT NULL
  )
`);

function createUser(user) {
  db.prepare(`
    INSERT INTO users (id, email, passwordHash, fullName, title, plan, billingCycle, theme, locale, createdAt)
    VALUES (@id, @email, @passwordHash, @fullName, @title, @plan, @billingCycle, @theme, @locale, @createdAt)
  `).run(user);
  return getUserById(user.id);
}

function getUserByEmail(email) {
  return db.prepare('SELECT * FROM users WHERE email = ?').get(email.toLowerCase().trim());
}

function getUserById(id) {
  return db.prepare('SELECT * FROM users WHERE id = ?').get(id);
}

function updateUser(id, fields) {
  const keys = Object.keys(fields);
  if (keys.length === 0) return getUserById(id);
  const setClause = keys.map((k) => `${k} = @${k}`).join(', ');
  db.prepare(`UPDATE users SET ${setClause} WHERE id = @id`).run({ ...fields, id });
  return getUserById(id);
}

function deleteUser(id) {
  db.prepare('DELETE FROM users WHERE id = ?').run(id);
  db.prepare('DELETE FROM sessions WHERE userId = ?').run(id);
  db.prepare('DELETE FROM videos WHERE userId = ?').run(id);
}

function createSession(session) {
  db.prepare(`
    INSERT INTO sessions (id, userId, userAgent, createdAt, lastSeenAt)
    VALUES (@id, @userId, @userAgent, @createdAt, @lastSeenAt)
  `).run(session);
  return session;
}

function getSessionById(id) {
  return db.prepare('SELECT * FROM sessions WHERE id = ?').get(id);
}

function getSessionsForUser(userId) {
  return db.prepare('SELECT * FROM sessions WHERE userId = ? ORDER BY lastSeenAt DESC').all(userId);
}

function touchSession(id) {
  db.prepare('UPDATE sessions SET lastSeenAt = ? WHERE id = ?').run(new Date().toISOString(), id);
}

function deleteSession(id) {
  db.prepare('DELETE FROM sessions WHERE id = ?').run(id);
}

function deleteOtherSessions(userId, keepSessionId) {
  db.prepare('DELETE FROM sessions WHERE userId = ? AND id != ?').run(userId, keepSessionId);
}

function deleteAllSessions(userId) {
  db.prepare('DELETE FROM sessions WHERE userId = ?').run(userId);
}

function createVideo(video) {
  const stmt = db.prepare(`
    INSERT INTO videos (id, title, courseContent, animationStyle, quality, voiceId, userId, status, progress, createdAt)
    VALUES (@id, @title, @courseContent, @animationStyle, @quality, @voiceId, @userId, @status, @progress, @createdAt)
  `);
  stmt.run(video);
  return video;
}

function getAllVideos() {
  return db.prepare('SELECT * FROM videos ORDER BY createdAt DESC').all();
}

function getVideosForUser(userId) {
  return db.prepare('SELECT * FROM videos WHERE userId = ? ORDER BY createdAt DESC').all(userId);
}

function countVideosThisMonthForUser(userId) {
  const startOfMonth = new Date();
  startOfMonth.setDate(1);
  startOfMonth.setHours(0, 0, 0, 0);
  const row = db
    .prepare('SELECT COUNT(*) as count FROM videos WHERE userId = ? AND createdAt >= ?')
    .get(userId, startOfMonth.toISOString());
  return row.count;
}

function getVideoById(id) {
  return db.prepare('SELECT * FROM videos WHERE id = ?').get(id);
}

function updateVideo(id, fields) {
  const keys = Object.keys(fields);
  if (keys.length === 0) return getVideoById(id);
  const setClause = keys.map((k) => `${k} = @${k}`).join(', ');
  db.prepare(`UPDATE videos SET ${setClause} WHERE id = @id`).run({ ...fields, id });
  return getVideoById(id);
}

function deleteVideo(id) {
  db.prepare('DELETE FROM videos WHERE id = ?').run(id);
}

module.exports = {
  db,
  STORAGE_PATH,
  createVideo,
  getAllVideos,
  getVideosForUser,
  countVideosThisMonthForUser,
  getVideoById,
  updateVideo,
  deleteVideo,
  createUser,
  getUserByEmail,
  getUserById,
  updateUser,
  deleteUser,
  createSession,
  getSessionById,
  getSessionsForUser,
  touchSession,
  deleteSession,
  deleteOtherSessions,
  deleteAllSessions,
};
