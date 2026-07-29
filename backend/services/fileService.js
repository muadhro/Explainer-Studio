const fs = require('fs');
const path = require('path');
const { STORAGE_PATH } = require('../database/db');

const AUDIO_DIR = path.join(STORAGE_PATH, 'audio');
const GENERATED_DIR = path.join(STORAGE_PATH, 'generated');
const THUMBNAILS_DIR = path.join(STORAGE_PATH, 'thumbnails');

function sanitizeFilename(name) {
  return name.replace(/[^a-z0-9_-]+/gi, '_').slice(0, 80);
}

function audioPathFor(courseTitle, videoId) {
  return path.join(AUDIO_DIR, `${sanitizeFilename(courseTitle)}_${videoId}.mp3`);
}

function videoPathFor(courseTitle, quality) {
  const timestamp = Date.now();
  const filename = `${sanitizeFilename(courseTitle)}_${timestamp}_${quality}.mp4`;
  return path.join(GENERATED_DIR, filename);
}

function thumbnailPathFor(courseTitle, videoId) {
  return path.join(THUMBNAILS_DIR, `${sanitizeFilename(courseTitle)}_${videoId}.jpg`);
}

function getFileSizeMB(filePath) {
  if (!fs.existsSync(filePath)) return 0;
  const stats = fs.statSync(filePath);
  return Math.round((stats.size / (1024 * 1024)) * 100) / 100;
}

function deleteIfExists(filePath) {
  if (filePath && fs.existsSync(filePath)) {
    fs.unlinkSync(filePath);
  }
}

function getTotalStorageUsedMB() {
  let total = 0;
  for (const dir of [AUDIO_DIR, GENERATED_DIR, THUMBNAILS_DIR]) {
    if (!fs.existsSync(dir)) continue;
    for (const file of fs.readdirSync(dir)) {
      const filePath = path.join(dir, file);
      if (fs.statSync(filePath).isFile()) {
        total += fs.statSync(filePath).size;
      }
    }
  }
  return Math.round((total / (1024 * 1024)) * 100) / 100;
}

module.exports = {
  AUDIO_DIR,
  GENERATED_DIR,
  THUMBNAILS_DIR,
  sanitizeFilename,
  audioPathFor,
  videoPathFor,
  thumbnailPathFor,
  getFileSizeMB,
  deleteIfExists,
  getTotalStorageUsedMB,
};
