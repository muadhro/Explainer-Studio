const express = require('express');
const fs = require('fs');
const { v4: uuidv4 } = require('uuid');
const db = require('../database/db');
const fileService = require('../services/fileService');
const videoQueue = require('../queue/videoQueue');
const auth = require('../services/authService');
const asyncHandler = require('../utils/asyncHandler');
const { getPlan } = require('../config/plans');

const router = express.Router();

const VALID_STYLES = ['Animated Explainer', 'Kinetic Typography', 'Motion Graphics', 'Flat Design 2D'];
const VALID_QUALITIES = ['720p', '1080p'];

router.use(auth.attachUser, auth.requireAuth);

async function loadOwnedVideo(req, res) {
  const video = await db.getVideoById(req.params.id);
  if (!video) {
    res.status(404).json({ message: 'Video not found' });
    return null;
  }
  if (video.userId !== req.user.id) {
    res.status(403).json({ message: 'You do not have access to this video' });
    return null;
  }
  return video;
}

// POST /api/videos
router.post(
  '/',
  asyncHandler(async (req, res) => {
    const { title, courseContent, animationStyle, quality, voiceId } = req.body || {};

    if (!title || !courseContent || !animationStyle || !quality) {
      return res.status(400).json({
        message: 'title, courseContent, animationStyle, and quality are all required',
      });
    }
    if (!VALID_STYLES.includes(animationStyle)) {
      return res.status(400).json({ message: `animationStyle must be one of: ${VALID_STYLES.join(', ')}` });
    }
    if (!VALID_QUALITIES.includes(quality)) {
      return res.status(400).json({ message: `quality must be one of: ${VALID_QUALITIES.join(', ')}` });
    }

    const plan = getPlan(req.user.plan);
    const used = await db.countVideosThisMonthForUser(req.user.id);
    if (used >= plan.videosPerMonth) {
      return res.status(402).json({
        message: `You've used all ${plan.videosPerMonth} videos on the ${plan.name} plan this month. Upgrade for more.`,
      });
    }
    if (quality === '1080p' && plan.maxQuality === '720p') {
      return res.status(402).json({ message: '1080p rendering requires the Starter plan or higher.' });
    }
    const charsUsed = await db.sumNarrationCharsThisMonthForUser(req.user.id);
    if (charsUsed >= plan.monthlyCharacterBudget) {
      return res.status(402).json({
        message: `You've used your ${plan.monthlyCharacterBudget.toLocaleString()}-character narration budget on the ${plan.name} plan this month. Upgrade for more.`,
      });
    }

    const video = await db.createVideo({
      id: uuidv4(),
      title,
      courseContent,
      animationStyle,
      quality,
      voiceId: voiceId || null,
      userId: req.user.id,
      status: 'queued',
      progress: 0,
      createdAt: new Date().toISOString(),
    });

    videoQueue.enqueue(video.id);

    res.status(201).json({ jobId: video.id, status: video.status, message: 'Video generation queued' });
  }),
);

// GET /api/videos
router.get(
  '/',
  asyncHandler(async (req, res) => {
    const videos = await db.getVideosForUser(req.user.id);
    res.json({ videos, totalStorageMB: fileService.getTotalStorageUsedMB() });
  }),
);

// GET /api/videos/:id/status
router.get(
  '/:id/status',
  asyncHandler(async (req, res) => {
    const video = await loadOwnedVideo(req, res);
    if (!video) return;

    res.json({
      id: video.id,
      status: video.status,
      progress: video.progress,
      videoPath: video.videoPath,
      fileSize: video.fileSize,
      errorMessage: video.errorMessage,
    });
  }),
);

// GET /api/videos/:id/download
router.get(
  '/:id/download',
  asyncHandler(async (req, res) => {
    const video = await loadOwnedVideo(req, res);
    if (!video) return;
    if (!video.videoPath || !fs.existsSync(video.videoPath)) {
      return res.status(404).json({ message: 'Video file not available yet' });
    }

    const filename = `${fileService.sanitizeFilename(video.title)}.mp4`;
    res.download(video.videoPath, filename);
  }),
);

// GET /api/videos/:id/play
router.get(
  '/:id/play',
  asyncHandler(async (req, res) => {
    const video = await loadOwnedVideo(req, res);
    if (!video) return;
    if (!video.videoPath || !fs.existsSync(video.videoPath)) {
      return res.status(404).json({ message: 'Video file not available yet' });
    }

    const stat = fs.statSync(video.videoPath);
    const fileSize = stat.size;
    const range = req.headers.range;

    if (range) {
      const parts = range.replace(/bytes=/, '').split('-');
      const start = parseInt(parts[0], 10);
      const end = parts[1] ? parseInt(parts[1], 10) : fileSize - 1;
      const chunkSize = end - start + 1;

      res.writeHead(206, {
        'Content-Range': `bytes ${start}-${end}/${fileSize}`,
        'Accept-Ranges': 'bytes',
        'Content-Length': chunkSize,
        'Content-Type': 'video/mp4',
      });
      fs.createReadStream(video.videoPath, { start, end }).pipe(res);
    } else {
      res.writeHead(200, {
        'Content-Length': fileSize,
        'Content-Type': 'video/mp4',
      });
      fs.createReadStream(video.videoPath).pipe(res);
    }
  }),
);

// DELETE /api/videos/:id
router.delete(
  '/:id',
  asyncHandler(async (req, res) => {
    const video = await loadOwnedVideo(req, res);
    if (!video) return;

    fileService.deleteIfExists(video.videoPath);
    fileService.deleteIfExists(video.audioPath);
    await db.deleteVideo(req.params.id);

    res.json({ message: 'Video deleted' });
  }),
);

module.exports = router;
