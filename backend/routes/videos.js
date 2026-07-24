const express = require('express');
const fs = require('fs');
const { v4: uuidv4 } = require('uuid');
const db = require('../database/db');
const fileService = require('../services/fileService');
const videoQueue = require('../queue/videoQueue');

const router = express.Router();

const VALID_STYLES = ['Animated Explainer', 'Kinetic Typography', 'Motion Graphics', 'Flat Design 2D'];
const VALID_QUALITIES = ['720p', '1080p'];

// POST /api/videos
router.post('/', (req, res) => {
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

  const video = db.createVideo({
    id: uuidv4(),
    title,
    courseContent,
    animationStyle,
    quality,
    voiceId: voiceId || null,
    status: 'queued',
    progress: 0,
    createdAt: new Date().toISOString(),
  });

  videoQueue.enqueue(video.id);

  res.status(201).json({ jobId: video.id, status: video.status, message: 'Video generation queued' });
});

// GET /api/videos
router.get('/', (req, res) => {
  const videos = db.getAllVideos();
  res.json({ videos, totalStorageMB: fileService.getTotalStorageUsedMB() });
});

// GET /api/videos/:id/status
router.get('/:id/status', (req, res) => {
  const video = db.getVideoById(req.params.id);
  if (!video) return res.status(404).json({ message: 'Video not found' });

  res.json({
    id: video.id,
    status: video.status,
    progress: video.progress,
    videoPath: video.videoPath,
    fileSize: video.fileSize,
    errorMessage: video.errorMessage,
  });
});

// GET /api/videos/:id/download
router.get('/:id/download', (req, res) => {
  const video = db.getVideoById(req.params.id);
  if (!video) return res.status(404).json({ message: 'Video not found' });
  if (!video.videoPath || !fs.existsSync(video.videoPath)) {
    return res.status(404).json({ message: 'Video file not available yet' });
  }

  const filename = `${fileService.sanitizeFilename(video.title)}.mp4`;
  res.download(video.videoPath, filename);
});

// GET /api/videos/:id/play
router.get('/:id/play', (req, res) => {
  const video = db.getVideoById(req.params.id);
  if (!video) return res.status(404).json({ message: 'Video not found' });
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
});

// DELETE /api/videos/:id
router.delete('/:id', (req, res) => {
  const video = db.getVideoById(req.params.id);
  if (!video) return res.status(404).json({ message: 'Video not found' });

  fileService.deleteIfExists(video.videoPath);
  fileService.deleteIfExists(video.audioPath);
  db.deleteVideo(req.params.id);

  res.json({ message: 'Video deleted' });
});

module.exports = router;
