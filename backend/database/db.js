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

function createVideo(video) {
  const stmt = db.prepare(`
    INSERT INTO videos (id, title, courseContent, animationStyle, quality, voiceId, status, progress, createdAt)
    VALUES (@id, @title, @courseContent, @animationStyle, @quality, @voiceId, @status, @progress, @createdAt)
  `);
  stmt.run(video);
  return video;
}

function getAllVideos() {
  return db.prepare('SELECT * FROM videos ORDER BY createdAt DESC').all();
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
  getVideoById,
  updateVideo,
  deleteVideo,
};
