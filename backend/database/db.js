const path = require('path');
const fs = require('fs');
const { Pool } = require('pg');

// Resolve relative to the project root (backend/database/../..) so storage
// location is stable no matter what directory the server is started from.
const PROJECT_ROOT = path.join(__dirname, '..', '..');
const rawStoragePath = process.env.VIDEO_STORAGE_PATH || './videos';
const STORAGE_PATH = path.isAbsolute(rawStoragePath)
  ? rawStoragePath
  : path.join(PROJECT_ROOT, rawStoragePath);

fs.mkdirSync(STORAGE_PATH, { recursive: true });
fs.mkdirSync(path.join(STORAGE_PATH, 'audio'), { recursive: true });
fs.mkdirSync(path.join(STORAGE_PATH, 'generated'), { recursive: true });
fs.mkdirSync(path.join(STORAGE_PATH, 'avatars'), { recursive: true });

const connectionString = process.env.SUPABASE_DB_URL;
if (!connectionString) {
  throw new Error(
    'SUPABASE_DB_URL is not set. Add your Supabase Postgres connection string to .env (Settings -> Database -> Connection string).',
  );
}

// Supabase's pooled connection requires SSL; the pooler's certificate isn't
// in Node's default trust store, so we don't verify it (fine for a
// server-to-database link over a provider-managed connection).
const pool = new Pool({
  connectionString,
  ssl: { rejectUnauthorized: false },
});

pool.on('error', (err) => {
  console.error('[db] unexpected error on idle Postgres client:', err.message);
});

// --- schema (idempotent — safe to run on every startup) ---
const ready = (async () => {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS videos (
      "id" TEXT PRIMARY KEY,
      "title" TEXT NOT NULL,
      "courseContent" TEXT NOT NULL,
      "animationStyle" TEXT NOT NULL,
      "quality" TEXT NOT NULL,
      "status" TEXT NOT NULL DEFAULT 'queued',
      "progress" INTEGER NOT NULL DEFAULT 0,
      "falJobId" TEXT,
      "audioPath" TEXT,
      "videoPath" TEXT,
      "fileSize" REAL,
      "createdAt" TEXT NOT NULL,
      "completedAt" TEXT,
      "errorMessage" TEXT,
      "voiceId" TEXT,
      "userId" TEXT
    )
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS users (
      "id" TEXT PRIMARY KEY,
      "email" TEXT NOT NULL UNIQUE,
      "passwordHash" TEXT,
      "googleId" TEXT,
      "fullName" TEXT NOT NULL,
      "title" TEXT,
      "avatarPath" TEXT,
      "subscriptionId" TEXT,
      "plan" TEXT NOT NULL DEFAULT 'free',
      "billingCycle" TEXT NOT NULL DEFAULT '1',
      "planUpdatedAt" TEXT,
      "theme" TEXT NOT NULL DEFAULT 'system',
      "locale" TEXT NOT NULL DEFAULT 'en-US',
      "timezone" TEXT,
      "notifyProduct" INTEGER NOT NULL DEFAULT 1,
      "notifyMarketing" INTEGER NOT NULL DEFAULT 0,
      "notifyBilling" INTEGER NOT NULL DEFAULT 1,
      "role" TEXT NOT NULL DEFAULT 'user',
      "createdAt" TEXT NOT NULL
    )
  `);

  // migration for databases created before the admin role existed
  await pool.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS "role" TEXT NOT NULL DEFAULT 'user'`);

  // migration for databases created before PayPal billing existed
  await pool.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS "paypalSubscriptionId" TEXT`);

  // migration for databases created before Google sign-in existed
  await pool.query(`ALTER TABLE users ALTER COLUMN "passwordHash" DROP NOT NULL`);
  await pool.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS "googleId" TEXT`);
  await pool.query(`CREATE UNIQUE INDEX IF NOT EXISTS users_googleId_idx ON users ("googleId") WHERE "googleId" IS NOT NULL`);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS sessions (
      "id" TEXT PRIMARY KEY,
      "userId" TEXT NOT NULL,
      "userAgent" TEXT,
      "createdAt" TEXT NOT NULL,
      "lastSeenAt" TEXT NOT NULL
    )
  `);

  // caches the PayPal Product/Plan IDs we create for each (tier, billing cycle)
  // combo, so we create them once with PayPal and reuse them after that.
  await pool.query(`
    CREATE TABLE IF NOT EXISTS paypal_plans (
      "planId" TEXT NOT NULL,
      "cycleMonths" INTEGER NOT NULL,
      "paypalProductId" TEXT NOT NULL,
      "paypalPlanId" TEXT NOT NULL,
      "createdAt" TEXT NOT NULL,
      PRIMARY KEY ("planId", "cycleMonths")
    )
  `);

  await pool.query('CREATE INDEX IF NOT EXISTS videos_userId_idx ON videos ("userId")');
  await pool.query('CREATE INDEX IF NOT EXISTS sessions_userId_idx ON sessions ("userId")');

  console.log('[db] connected to Supabase Postgres, schema ready');
})();

// --- generic parameterized insert/update builders (quoted camelCase columns) ---
function buildInsert(table, obj) {
  const keys = Object.keys(obj);
  const columns = keys.map((k) => `"${k}"`).join(', ');
  const placeholders = keys.map((_, i) => `$${i + 1}`).join(', ');
  return { text: `INSERT INTO ${table} (${columns}) VALUES (${placeholders})`, values: keys.map((k) => obj[k]) };
}

function buildUpdate(table, id, fields) {
  const keys = Object.keys(fields);
  const setClause = keys.map((k, i) => `"${k}" = $${i + 1}`).join(', ');
  const values = keys.map((k) => fields[k]);
  values.push(id);
  return { text: `UPDATE ${table} SET ${setClause} WHERE "id" = $${values.length}`, values };
}

// --- users ---
async function createUser(user) {
  const { text, values } = buildInsert('users', user);
  await pool.query(text, values);
  return getUserById(user.id);
}

async function getUserByEmail(email) {
  const { rows } = await pool.query('SELECT * FROM users WHERE "email" = $1', [email.toLowerCase().trim()]);
  return rows[0] || null;
}

async function getUserById(id) {
  const { rows } = await pool.query('SELECT * FROM users WHERE "id" = $1', [id]);
  return rows[0] || null;
}

async function getUserByGoogleId(googleId) {
  const { rows } = await pool.query('SELECT * FROM users WHERE "googleId" = $1', [googleId]);
  return rows[0] || null;
}

/** All users with their total video count — for the admin dashboard. */
async function getAllUsersWithVideoCounts() {
  const { rows } = await pool.query(`
    SELECT u.*, COALESCE(v.count, 0)::int AS "videoCount"
    FROM users u
    LEFT JOIN (
      SELECT "userId", COUNT(*) AS count FROM videos GROUP BY "userId"
    ) v ON v."userId" = u.id
    ORDER BY u."createdAt" DESC
  `);
  return rows;
}

async function updateUser(id, fields) {
  const keys = Object.keys(fields);
  if (keys.length === 0) return getUserById(id);
  const { text, values } = buildUpdate('users', id, fields);
  await pool.query(text, values);
  return getUserById(id);
}

async function deleteUser(id) {
  await pool.query('DELETE FROM users WHERE "id" = $1', [id]);
  await pool.query('DELETE FROM sessions WHERE "userId" = $1', [id]);
  await pool.query('DELETE FROM videos WHERE "userId" = $1', [id]);
}

// --- sessions ---
async function createSession(session) {
  const { text, values } = buildInsert('sessions', session);
  await pool.query(text, values);
  return session;
}

async function getSessionById(id) {
  const { rows } = await pool.query('SELECT * FROM sessions WHERE "id" = $1', [id]);
  return rows[0] || null;
}

async function getSessionsForUser(userId) {
  const { rows } = await pool.query('SELECT * FROM sessions WHERE "userId" = $1 ORDER BY "lastSeenAt" DESC', [userId]);
  return rows;
}

async function touchSession(id) {
  await pool.query('UPDATE sessions SET "lastSeenAt" = $1 WHERE "id" = $2', [new Date().toISOString(), id]);
}

async function deleteSession(id) {
  await pool.query('DELETE FROM sessions WHERE "id" = $1', [id]);
}

async function deleteOtherSessions(userId, keepSessionId) {
  await pool.query('DELETE FROM sessions WHERE "userId" = $1 AND "id" != $2', [userId, keepSessionId]);
}

async function deleteAllSessions(userId) {
  await pool.query('DELETE FROM sessions WHERE "userId" = $1', [userId]);
}

// --- videos ---
async function createVideo(video) {
  const { text, values } = buildInsert('videos', video);
  await pool.query(text, values);
  return video;
}

async function getAllVideos() {
  const { rows } = await pool.query('SELECT * FROM videos ORDER BY "createdAt" DESC');
  return rows;
}

async function getVideosForUser(userId) {
  const { rows } = await pool.query('SELECT * FROM videos WHERE "userId" = $1 ORDER BY "createdAt" DESC', [userId]);
  return rows;
}

async function countVideosThisMonthForUser(userId) {
  const startOfMonth = new Date();
  startOfMonth.setDate(1);
  startOfMonth.setHours(0, 0, 0, 0);
  const { rows } = await pool.query(
    'SELECT COUNT(*)::int as count FROM videos WHERE "userId" = $1 AND "createdAt" >= $2',
    [userId, startOfMonth.toISOString()],
  );
  return rows[0].count;
}

async function getVideoById(id) {
  const { rows } = await pool.query('SELECT * FROM videos WHERE "id" = $1', [id]);
  return rows[0] || null;
}

async function updateVideo(id, fields) {
  const keys = Object.keys(fields);
  if (keys.length === 0) return getVideoById(id);
  const { text, values } = buildUpdate('videos', id, fields);
  await pool.query(text, values);
  return getVideoById(id);
}

async function deleteVideo(id) {
  await pool.query('DELETE FROM videos WHERE "id" = $1', [id]);
}

// --- paypal plan cache ---
async function getPaypalPlan(planId, cycleMonths) {
  const { rows } = await pool.query(
    'SELECT * FROM paypal_plans WHERE "planId" = $1 AND "cycleMonths" = $2',
    [planId, cycleMonths],
  );
  return rows[0] || null;
}

async function savePaypalPlan(entry) {
  const { text, values } = buildInsert('paypal_plans', entry);
  await pool.query(text, values);
  return entry;
}

async function getPaypalPlanByPaypalPlanId(paypalPlanId) {
  const { rows } = await pool.query('SELECT * FROM paypal_plans WHERE "paypalPlanId" = $1', [paypalPlanId]);
  return rows[0] || null;
}

module.exports = {
  ready,
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
  getUserByGoogleId,
  getAllUsersWithVideoCounts,
  updateUser,
  deleteUser,
  createSession,
  getSessionById,
  getSessionsForUser,
  touchSession,
  deleteSession,
  deleteOtherSessions,
  deleteAllSessions,
  getPaypalPlan,
  savePaypalPlan,
  getPaypalPlanByPaypalPlanId,
};
