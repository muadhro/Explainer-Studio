require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });

const path = require('path');
const express = require('express');
const cors = require('cors');
const cookieParser = require('cookie-parser');
const db = require('./database/db'); // ensures storage folders + Postgres schema exist
const videosRouter = require('./routes/videos');
const authRouter = require('./routes/auth');
const accountRouter = require('./routes/account');
const adminRouter = require('./routes/admin');
const contactRouter = require('./routes/contact');
const analyticsRouter = require('./routes/analytics');

const app = express();
const PORT = process.env.PORT || 5000;

app.use(cors({ origin: true, credentials: true }));
app.use(express.json({ limit: '10mb' }));
app.use(cookieParser());
app.use('/avatars', express.static(path.join(db.STORAGE_PATH, 'avatars')));

app.use('/api/auth', authRouter);
app.use('/api/account', accountRouter);
app.use('/api/videos', videosRouter);
app.use('/api/admin', adminRouter);
app.use('/api/contact', contactRouter);
app.use('/api/analytics', analyticsRouter);

app.get('/api/voices', async (req, res) => {
  try {
    const { listVoices } = require('./services/elevenLabsService');
    res.json({ voices: await listVoices() });
  } catch (err) {
    res.status(502).json({ message: err.message, voices: [] });
  }
});

app.get('/api/health', (req, res) => {
  res.json({ status: 'ok' });
});

app.use((err, req, res, next) => {
  console.error(err);
  res.status(500).json({ message: err.message || 'Internal server error' });
});

db.ready
  .then(() => {
    app.listen(PORT, () => {
      console.log(`AI Explainer backend listening on port ${PORT}`);
      // pick up any jobs that were interrupted by a restart
      require('./queue/videoQueue').recoverPendingJobs().catch((err) => {
        console.error('[queue] failed to recover pending jobs:', err);
      });
    });
  })
  .catch((err) => {
    console.error('Failed to connect to Supabase Postgres:', err.message);
    process.exit(1);
  });
