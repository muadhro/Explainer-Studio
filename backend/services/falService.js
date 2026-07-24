const fs = require('fs');
const fetch = require('node-fetch');

const FAL_QUEUE_URL = 'https://queue.fal.run';
const FAL_MODEL_ENDPOINT = 'fal-ai/video-generation'; // swap for the specific fal.ai model you use
const POLL_INTERVAL_MS = 5000;

function authHeaders() {
  const apiKey = process.env.FAL_API_KEY;
  if (!apiKey) {
    throw new Error('FAL_API_KEY is not set');
  }
  return {
    authorization: `Key ${apiKey}`,
    'content-type': 'application/json',
  };
}

async function submitJob({ visualDescriptions, audioUrl, quality, animationStyle }) {
  const response = await fetch(`${FAL_QUEUE_URL}/${FAL_MODEL_ENDPOINT}`, {
    method: 'POST',
    headers: authHeaders(),
    body: JSON.stringify({
      visual_descriptions: visualDescriptions,
      audio_url: audioUrl,
      quality,
      animation_style: animationStyle,
    }),
  });

  if (!response.ok) {
    const errText = await response.text();
    throw new Error(`fal.ai submit error (${response.status}): ${errText}`);
  }

  const data = await response.json();
  return { jobId: data.request_id, statusUrl: data.status_url, responseUrl: data.response_url };
}

async function pollJobStatus(statusUrl) {
  const response = await fetch(statusUrl, { headers: authHeaders() });
  if (!response.ok) {
    const errText = await response.text();
    throw new Error(`fal.ai status error (${response.status}): ${errText}`);
  }
  return response.json();
}

async function waitForCompletion(statusUrl, onProgress) {
  while (true) {
    const status = await pollJobStatus(statusUrl);

    if (typeof onProgress === 'function') {
      onProgress(status);
    }

    if (status.status === 'COMPLETED') {
      return status;
    }
    if (status.status === 'FAILED' || status.status === 'ERROR') {
      throw new Error(`fal.ai job failed: ${status.error || 'unknown error'}`);
    }

    await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS));
  }
}

async function fetchResult(responseUrl) {
  const response = await fetch(responseUrl, { headers: authHeaders() });
  if (!response.ok) {
    const errText = await response.text();
    throw new Error(`fal.ai result error (${response.status}): ${errText}`);
  }
  return response.json();
}

async function downloadVideo(videoUrl, outputPath) {
  const response = await fetch(videoUrl);
  if (!response.ok) {
    throw new Error(`Failed to download video from fal.ai (${response.status})`);
  }
  const buffer = await response.buffer();
  fs.writeFileSync(outputPath, buffer);
  return outputPath;
}

// fal.ai model inputs (e.g. audio_url) generally need a publicly reachable URL.
// This uploads a local file to fal's storage so it can be referenced by the job.
async function uploadFile(localPath, contentType = 'audio/mpeg') {
  const fileBuffer = fs.readFileSync(localPath);
  const response = await fetch('https://rest.alpha.fal.ai/storage/upload', {
    method: 'POST',
    headers: {
      authorization: `Key ${process.env.FAL_API_KEY}`,
      'content-type': contentType,
    },
    body: fileBuffer,
  });

  if (!response.ok) {
    const errText = await response.text();
    throw new Error(`fal.ai storage upload error (${response.status}): ${errText}`);
  }

  const data = await response.json();
  return data.url;
}

module.exports = {
  submitJob,
  pollJobStatus,
  waitForCompletion,
  fetchResult,
  downloadVideo,
  uploadFile,
  POLL_INTERVAL_MS,
};
