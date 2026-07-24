require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });

const express = require('express');
const cors = require('cors');
require('./database/db'); // ensures storage folders + sqlite schema exist
const videosRouter = require('./routes/videos');

const app = express();
const PORT = process.env.PORT || 5000;

app.use(cors());
app.use(express.json({ limit: '10mb' }));

app.use('/api/videos', videosRouter);

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

app.listen(PORT, () => {
  console.log(`AI Explainer backend listening on port ${PORT}`);
  // pick up any jobs that were interrupted by a restart
  require('./queue/videoQueue').recoverPendingJobs();
});
