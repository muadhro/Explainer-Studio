const { updateVideo, getVideoById, getUserById, sumNarrationCharsThisMonthForUser } = require('../database/db');
const { getPlan } = require('../config/plans');
const { generateScript } = require('../services/claudeService');
const { generateVoiceover } = require('../services/elevenLabsService');
const { fetchImageForScene, fetchIcon } = require('../services/imageService');
const { composeVideo } = require('../services/composerService');
const { getTheme, normalizeSlide } = require('../services/slideService');
const fal = require('../services/falService');
const fileService = require('../services/fileService');
const fs = require('fs');
const os = require('os');
const path = require('path');

const queue = [];
let activeCount = 0;
// Video rendering is CPU-bound (ffmpeg + sharp), so real parallelism is
// bounded by actual cores, not an arbitrary number — default to the box's
// core count, override via env if you move to a bigger/smaller server.
const MAX_CONCURRENT_RENDERS = Math.max(1, Number(process.env.MAX_CONCURRENT_RENDERS) || os.cpus().length);

function enqueue(videoId) {
  queue.push(videoId);
  dispatch();
}

/**
 * Fire-and-forget progress update for use inside callbacks that can't be
 * awaited (composeVideo's onProgress, fal's poll callback). Losing one
 * progress tick to a transient DB hiccup isn't worth stalling the render.
 */
function updateProgress(videoId, progress) {
  updateVideo(videoId, { progress }).catch((err) => {
    console.error(`[queue] progress update failed for ${videoId}:`, err.message);
  });
}

/**
 * The queue lives in memory, so a server restart orphans any job that was
 * queued or mid-processing (DB row stuck at "processing" with no worker).
 * Called on startup to re-enqueue them from scratch.
 */
async function recoverPendingJobs() {
  const { getAllVideos, getUserById, updateVideo: dbUpdateVideo, deleteVideo } = require('../database/db');
  const all = await getAllVideos();
  const pending = all.filter((v) => v.status === 'queued' || v.status === 'processing');
  for (const video of pending) {
    // a video whose owner no longer exists (deleted account, or a stray row
    // from manual DB cleanup that didn't cascade) has nowhere to deliver a
    // result to — never spend real API calls re-processing it
    if (video.userId) {
      const owner = await getUserById(video.userId);
      if (!owner) {
        console.warn(`[queue] discarding orphaned video with no owner: ${video.title} (${video.id})`);
        fileService.deleteIfExists(video.videoPath);
        fileService.deleteIfExists(video.audioPath);
        await deleteVideo(video.id).catch((err) => console.error(`[queue] failed to delete orphaned video ${video.id}:`, err.message));
        continue;
      }
    }
    console.log(`[queue] recovering interrupted job: ${video.title} (${video.id})`);
    await dbUpdateVideo(video.id, { status: 'queued', progress: 0 });
    enqueue(video.id);
  }
}

/** Pull as many queued jobs as there's capacity for and start them concurrently. */
function dispatch() {
  while (activeCount < MAX_CONCURRENT_RENDERS && queue.length > 0) {
    const videoId = queue.shift();
    activeCount += 1;
    runJob(videoId);
  }
}

async function runJob(videoId) {
  try {
    await processVideo(videoId);
  } catch (err) {
    console.error(`[queue] job ${videoId} failed:`, err);
    await updateVideo(videoId, {
      status: 'failed',
      errorMessage: err.message || String(err),
    }).catch((dbErr) => console.error(`[queue] failed to record failure for ${videoId}:`, dbErr.message));
  } finally {
    activeCount -= 1;
    dispatch();
  }
}

async function processVideo(videoId) {
  const video = await getVideoById(videoId);
  if (!video) return;

  await updateVideo(videoId, { status: 'processing', progress: 5 });

  // Step 1: scene script via Claude
  const script = await generateScript(video.title, video.courseContent, video.animationStyle, video.targetDurationMinutes, video.contentDepth);
  await updateVideo(videoId, { progress: 15 });

  // Step 2: voiceover via ElevenLabs
  const fullNarration = script.scenes.map((s) => s.narration).join(' ');

  // Checked here (after the cheap Claude call, before the costlier ElevenLabs
  // call) rather than only at submit time, since the actual narration length
  // for this specific video isn't known until the script exists.
  if (video.userId) {
    const user = await getUserById(video.userId);
    if (user && user.role !== 'admin') {
      const plan = getPlan(user.plan);
      const charsUsedSoFar = await sumNarrationCharsThisMonthForUser(video.userId);
      if (charsUsedSoFar + fullNarration.length > plan.monthlyCharacterBudget) {
        throw new Error(
          `This video's narration (${fullNarration.length.toLocaleString()} characters) would exceed the ` +
            `${plan.name} plan's ${plan.monthlyCharacterBudget.toLocaleString()}-character monthly budget ` +
            `(${charsUsedSoFar.toLocaleString()} already used). Upgrade your plan or shorten the course content.`,
        );
      }
    }
  }

  const audioPath = fileService.audioPathFor(video.title, video.id);
  await generateVoiceover(fullNarration, audioPath, video.voiceId || undefined);
  await updateVideo(videoId, { audioPath, progress: 30, narrationChars: fullNarration.length });

  const renderMode = (process.env.RENDER_MODE || 'local').toLowerCase();
  const videoPath = fileService.videoPathFor(video.title, video.quality);

  if (renderMode === 'fal') {
    await renderWithFal(videoId, video, script, audioPath, videoPath);
  } else {
    await renderLocally(videoId, video, script, audioPath, videoPath);
  }

  const fileSize = fileService.getFileSizeMB(videoPath);
  fileService.deleteIfExists(audioPath); // audio is muxed into the video now

  await updateVideo(videoId, {
    status: 'complete',
    progress: 100,
    videoPath,
    audioPath: null,
    fileSize,
    completedAt: new Date().toISOString(),
  });
}

/**
 * Default pipeline: pull scene background images from the internet
 * (Pexels -> Openverse -> Wikimedia fallback chain) plus tech icons from
 * Iconify, then composite everything locally with sharp + ffmpeg.
 */
async function renderLocally(videoId, video, script, audioPath, videoPath) {
  const assetDir = fs.mkdtempSync(path.join(os.tmpdir(), 'explainer-assets-'));

  try {
    // Fetch per-scene assets (progress 30 -> 55):
    // slide scenes get themed icons per item; photo scenes get a background image
    const isAnimated = video.animationStyle === 'Animated Explainer';
    const isWhiteboard = video.animationStyle === 'Whiteboard Animation';
    const slideTheme = getTheme(video.animationStyle);
    // animated style uses dark-ink outline icons on a light background;
    // whiteboard needs genuine single-stroke icons so they can be drawn on
    // progressively (a filled icon just renders as a solid blob)
    const iconOptions = isWhiteboard
      ? { color: '#242424', size: 256, outline: true, prefixes: ['tabler', 'lucide'], requireStroke: true }
      : isAnimated
        ? { color: '#2d3748', size: 256, outline: true }
        : { color: slideTheme.icon, size: 256 };
    const sceneAssets = [];
    for (let i = 0; i < script.scenes.length; i++) {
      const scene = script.scenes[i];
      let slide = scene.sceneType !== 'photo' && scene.slide ? normalizeSlide(scene.slide) : null;

      // the Animated Explainer and Whiteboard Animation styles fully own their
      // own scene rendering (no photo backgrounds), so convert any photo scene
      // into a simple hero slide instead
      if (!slide && (isAnimated || isWhiteboard)) {
        // course titles can run much longer than the "max 3 words" a slide
        // title is meant to be — never render the full thing verbatim
        const fallbackTitle = (video.title || '').split(/\s+/).slice(0, 4).join(' ');
        slide = normalizeSlide({
          title: (scene.textOverlays && scene.textOverlays[0]) || fallbackTitle,
          subtitle: (scene.textOverlays && scene.textOverlays[1]) || '',
          layout: 'grid',
          sections: [
            { heading: '', items: [{ icon: scene.iconKeyword || 'lightbulb idea', label: '' }] },
          ],
        });
      }

      if (slide) {
        const items = slide.sections.flatMap((s) => s.items);
        const slideIcons = await Promise.all(
          items.map((item) => fetchIcon(item.icon, iconOptions)),
        );
        sceneAssets.push({ slide, slideIcons, slideTheme });
      } else {
        const [backgroundPath, iconSvg] = await Promise.all([
          fetchImageForScene(scene.imageKeywords || scene.visualDescription, assetDir, i + 1),
          scene.iconKeyword ? fetchIcon(scene.iconKeyword) : Promise.resolve(null),
        ]);
        sceneAssets.push({ backgroundPath, iconSvg });
      }

      await updateVideo(videoId, {
        progress: 30 + Math.round(((i + 1) / script.scenes.length) * 25),
      });
    }

    // Compose the final video (progress 55 -> 98)
    await composeVideo({
      scenes: script.scenes,
      sceneAssets,
      audioPath,
      quality: video.quality,
      animationStyle: video.animationStyle,
      outputPath: videoPath,
      onProgress: (pct) => updateProgress(videoId, 55 + Math.round(pct * 0.43)),
    });
  } finally {
    fs.rmSync(assetDir, { recursive: true, force: true });
  }
}

/** Optional pipeline: hand off rendering to a fal.ai model (RENDER_MODE=fal). */
async function renderWithFal(videoId, video, script, audioPath, videoPath) {
  const audioUrl = await fal.uploadFile(audioPath, 'audio/mpeg');
  const visualDescriptions = script.scenes.map((s) => ({
    sceneNumber: s.sceneNumber,
    duration: s.duration,
    visualDescription: s.visualDescription,
    textOverlays: s.textOverlays,
    transitions: s.transitions,
  }));

  const { jobId, statusUrl, responseUrl } = await fal.submitJob({
    visualDescriptions,
    audioUrl,
    quality: video.quality,
    animationStyle: video.animationStyle,
  });
  await updateVideo(videoId, { falJobId: jobId, progress: 50 });

  await fal.waitForCompletion(statusUrl, (status) => {
    const remoteProgress = typeof status.progress === 'number' ? status.progress : 0;
    const scaled = 50 + Math.min(40, Math.round(remoteProgress * 0.4));
    updateProgress(videoId, scaled);
  });

  const result = await fal.fetchResult(responseUrl);
  const remoteVideoUrl = result.video?.url || result.video_url;
  if (!remoteVideoUrl) {
    throw new Error('fal.ai response did not include a video URL');
  }

  await fal.downloadVideo(remoteVideoUrl, videoPath);
}

module.exports = { enqueue, recoverPendingJobs };
