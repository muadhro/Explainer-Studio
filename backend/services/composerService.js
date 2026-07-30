const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');
const sharp = require('sharp');
const ffmpegPath = require('ffmpeg-static');
const { renderSlideStill } = require('./slideService');
const { renderAnimatedSceneClip, getTheme: getAnimatedTheme } = require('./animatedService');
const { renderWhiteboardSceneClip, getTheme: getWhiteboardTheme } = require('./whiteboardService');

const FPS = 25;

const STYLE_THEMES = {
  'Kinetic Typography': { band: 'rgba(10,10,20,0.82)', accent: '#f0c14b', font: 'Segoe UI' },
  'Motion Graphics': { band: 'rgba(8,20,40,0.78)', accent: '#4f7cff', font: 'Segoe UI' },
  'Flat Design 2D': { band: 'rgba(20,30,25,0.78)', accent: '#4ade80', font: 'Segoe UI' },
  'Animated Explainer': { band: 'rgba(20,30,40,0.72)', accent: '#14b8a6', font: 'Segoe UI' },
};

const QUALITY_DIMENSIONS = {
  '720p': { width: 1280, height: 720 },
  '1080p': { width: 1920, height: 1080 },
  '1440p': { width: 2560, height: 1440 },
  '4K': { width: 3840, height: 2160 },
};

function runFfmpeg(args) {
  return new Promise((resolve, reject) => {
    const proc = spawn(ffmpegPath, ['-y', '-hide_banner', '-loglevel', 'error', ...args]);
    let stderr = '';
    proc.stderr.on('data', (d) => (stderr += d.toString()));
    proc.on('error', reject);
    proc.on('close', (code) => {
      if (code === 0) resolve();
      else reject(new Error(`ffmpeg exited with code ${code}: ${stderr.slice(-2000)}`));
    });
  });
}

function probeDurationSeconds(mediaPath) {
  return new Promise((resolve, reject) => {
    // ffmpeg -i prints duration to stderr; parse it (avoids needing ffprobe binary)
    const proc = spawn(ffmpegPath, ['-hide_banner', '-i', mediaPath]);
    let stderr = '';
    proc.stderr.on('data', (d) => (stderr += d.toString()));
    proc.on('close', () => {
      const m = stderr.match(/Duration:\s*(\d+):(\d+):(\d+\.\d+)/);
      if (!m) return reject(new Error(`Could not read duration of ${mediaPath}`));
      resolve(parseInt(m[1], 10) * 3600 + parseInt(m[2], 10) * 60 + parseFloat(m[3]));
    });
    proc.on('error', reject);
  });
}

/** Grab a single still frame from a finished video as a small preview thumbnail. */
async function extractThumbnail(videoPath, outputPath) {
  const duration = await probeDurationSeconds(videoPath).catch(() => 0);
  // 2s in is past every style's fade-in (all ≤0.6s), but clamp for very short clips
  const atSeconds = duration > 3 ? 2 : 0;

  await runFfmpeg([
    '-ss', String(atSeconds),
    '-i', videoPath,
    '-frames:v', '1',
    '-update', '1',
    '-vf', 'scale=480:-1',
    outputPath,
  ]);
  return outputPath;
}

function assTimestamp(seconds) {
  const s = Math.max(0, Number(seconds) || 0);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  return `${h}:${String(m).padStart(2, '0')}:${sec.toFixed(2).padStart(5, '0')}`;
}

function escapeAssText(text) {
  return String(text).replace(/\\/g, '\\\\').replace(/[{}]/g, '');
}

// ffmpeg's ass= filter argument is itself a mini option-string, so ':' has to
// be escaped or it's parsed as a key=value separator (breaks Windows drive
// letters like "C:\..." in particular).
function escapeFilterPath(p) {
  return String(p).replace(/\\/g, '/').replace(/:/g, '\\:');
}

/**
 * Build a one-word-at-a-time ASS subtitle track from real TTS word timings —
 * the bold, center-screen caption style short-form video uses for retention.
 * Positioned as an opaque bar so it stays readable over any scene background.
 */
function buildCaptionAss({ words, width, height, outputPath }) {
  const fontSize = Math.round(height * 0.062);
  const marginV = Math.round(height * 0.1);
  const header = `[Script Info]
ScriptType: v4.00+
PlayResX: ${width}
PlayResY: ${height}
ScaledBorderAndShadow: yes

[V4+ Styles]
Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding
Style: Caption,Arial,${fontSize},&H00FFFFFF,&H000000FF,&H00000000,&H26000000,-1,0,0,0,100,100,0,0,3,0,0,2,60,60,${marginV},1

[Events]
Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text
`;

  const events = words
    .filter((w) => w.text && Number.isFinite(w.start) && Number.isFinite(w.end) && w.end > w.start)
    .map((w) => `Dialogue: 0,${assTimestamp(w.start)},${assTimestamp(w.end)},Caption,,0,0,0,,${escapeAssText(w.text.toUpperCase())}`)
    .join('\n');

  fs.writeFileSync(outputPath, header + events + '\n');
  return outputPath;
}

/** Burn word-by-word captions into a rendered (silent) video via libass. */
async function burnCaptions(inputVideo, captionWords, width, height, workDir, outputPath) {
  const assPath = path.join(workDir, 'captions.ass');
  buildCaptionAss({ words: captionWords, width, height, outputPath: assPath });

  await runFfmpeg([
    '-i', inputVideo,
    '-vf', `ass=filename='${escapeFilterPath(assPath)}'`,
    '-r', String(FPS),
    '-c:v', 'libx264',
    '-preset', 'fast',
    outputPath,
  ]);
  return outputPath;
}

function escapeXml(text) {
  return String(text)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function wrapText(text, maxChars) {
  const words = String(text).split(/\s+/);
  const lines = [];
  let line = '';
  for (const word of words) {
    if ((line + ' ' + word).trim().length > maxChars && line) {
      lines.push(line.trim());
      line = word;
    } else {
      line = `${line} ${word}`;
    }
  }
  if (line.trim()) lines.push(line.trim());
  return lines;
}

/**
 * Build the overlay SVG for a scene: bottom band with the scene's text overlays,
 * an accent bar, and an optional icon in the top-right corner.
 */
function buildOverlaySvg({ width, height, textOverlays, theme, hasIcon }) {
  const titleSize = Math.round(height * 0.055);
  const subSize = Math.round(height * 0.036);
  const maxChars = Math.floor(width / (titleSize * 0.52));

  const overlays = (textOverlays || []).slice(0, 3);
  const allLines = [];
  overlays.forEach((overlay, i) => {
    const size = i === 0 ? titleSize : subSize;
    for (const line of wrapText(overlay, i === 0 ? maxChars : Math.floor(maxChars * 1.4))) {
      allLines.push({ text: line, size, bold: i === 0 });
    }
  });

  const lineGap = Math.round(height * 0.016);
  const bandPadding = Math.round(height * 0.045);
  const textHeight = allLines.reduce((sum, l) => sum + l.size + lineGap, 0);
  const bandHeight = Math.min(height * 0.5, textHeight + bandPadding * 2);
  const bandY = height - bandHeight;

  let y = bandY + bandPadding + (allLines[0] ? allLines[0].size : 0);
  const textElements = allLines
    .map((l) => {
      const el = `<text x="${Math.round(width * 0.05)}" y="${Math.round(y)}" font-family="${theme.font}, Arial, sans-serif" font-size="${l.size}" font-weight="${l.bold ? '700' : '400'}" fill="#ffffff">${escapeXml(l.text)}</text>`;
      y += l.size + lineGap;
      return el;
    })
    .join('\n  ');

  // Badge circle behind the icon; the icon itself is composited separately
  // (rasterized by sharp) because inline-embedding foreign SVGs breaks their viewBox.
  const iconSize = Math.round(height * 0.14);
  const iconMargin = Math.round(width * 0.04);
  const badge = hasIcon
    ? `<circle cx="${width - iconMargin - iconSize / 2}" cy="${Math.round(height * 0.07) + iconSize / 2}" r="${Math.round(iconSize * 0.85)}" fill="${theme.band}"/>`
    : '';

  return Buffer.from(`<svg width="${width}" height="${height}" xmlns="http://www.w3.org/2000/svg">
  <rect x="0" y="${bandY}" width="${width}" height="${bandHeight}" fill="${theme.band}"/>
  <rect x="0" y="${bandY}" width="${Math.round(width * 0.006)}" height="${bandHeight}" fill="${theme.accent}"/>
  ${textElements}
  ${badge}
</svg>`);
}

/** Compose a single scene frame: background image (or gradient) + overlay band. */
async function buildScenePng({ backgroundPath, textOverlays, theme, width, height, outputPath, iconSvg }) {
  let base;
  if (backgroundPath && fs.existsSync(backgroundPath)) {
    base = sharp(backgroundPath).resize(width, height, { fit: 'cover', position: 'attention' });
  } else {
    // no image found — dark gradient fallback so text still reads well
    const gradient = Buffer.from(`<svg width="${width}" height="${height}">
      <defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1">
        <stop offset="0" stop-color="#1a2036"/><stop offset="1" stop-color="#0c0f1a"/>
      </linearGradient></defs>
      <rect width="${width}" height="${height}" fill="url(#g)"/>
    </svg>`);
    base = sharp(gradient);
  }

  const overlay = buildOverlaySvg({ width, height, textOverlays, theme, hasIcon: Boolean(iconSvg) });
  const layers = [{ input: overlay, top: 0, left: 0 }];

  if (iconSvg) {
    const iconSize = Math.round(height * 0.14);
    const iconMargin = Math.round(width * 0.04);
    try {
      const iconPng = await sharp(iconSvg).resize(iconSize, iconSize, { fit: 'contain' }).png().toBuffer();
      layers.push({ input: iconPng, top: Math.round(height * 0.07), left: width - iconMargin - iconSize });
    } catch (err) {
      console.warn(`[composer] icon rasterization failed, skipping: ${err.message}`);
    }
  }

  await base
    .composite(layers)
    .png()
    .toFile(outputPath);
  return outputPath;
}

/** Render a still into a fixed clip (no zoom) — used for slide reveal steps. */
async function renderStillClip(png, duration, fadeIn, fadeOut, outputPath) {
  const fade = Math.min(0.4, duration / 3);
  const filters = ['format=yuv420p'];
  if (fadeIn) filters.push(`fade=t=in:st=0:d=${fade}`);
  if (fadeOut) filters.push(`fade=t=out:st=${Math.max(0, duration - fade)}:d=${fade}`);

  await runFfmpeg([
    '-loop', '1',
    '-i', png,
    '-t', String(duration),
    '-vf', filters.join(','),
    '-r', String(FPS),
    '-c:v', 'libx264',
    '-preset', 'fast',
    outputPath,
  ]);
  return outputPath;
}

/**
 * Render a slide scene as a sequence of reveal steps: items appear one by one
 * (like slide-deck build animations), each step holding for an equal share of
 * the scene duration.
 */
async function renderSlideSceneClips({ slide, slideIcons, theme, duration, width, height, workDir, sceneIndex }) {
  const itemCount = slide.sections.reduce((sum, s) => sum + s.items.length, 0);
  // Cap reveal steps so each holds >= 1.2s and the scene never outruns its slot;
  // when capped, multiple items appear per step.
  const steps = Math.max(1, Math.min(itemCount, Math.floor(duration / 1.2)));
  const stepDuration = duration / steps;
  const clips = [];

  for (let step = 1; step <= steps; step++) {
    const visibleCount = Math.ceil((itemCount * step) / steps);
    const png = path.join(workDir, `scene_${sceneIndex}_step_${step}.png`);
    await renderSlideStill({
      slide,
      iconBuffers: slideIcons,
      theme,
      width,
      height,
      visibleCount,
      outputPath: png,
    });

    const clip = path.join(workDir, `scene_${sceneIndex}_step_${step}.mp4`);
    await renderStillClip(png, stepDuration, step === 1, step === steps, clip);
    clips.push(clip);
  }

  return clips;
}

/** Render one scene PNG into a video clip with Ken Burns zoom + fade in/out. */
async function renderSceneClip(scenePng, duration, width, height, outputPath) {
  const frames = Math.max(1, Math.round(duration * FPS));
  const fade = Math.min(0.6, duration / 4);
  // upscale before zoompan to avoid jitter, subtle zoom to 1.08x over the clip
  const vf = [
    `scale=${width * 2}:${height * 2}`,
    `zoompan=z='min(1+0.08*on/${frames},1.08)':x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':d=${frames}:s=${width}x${height}:fps=${FPS}`,
    `fade=t=in:st=0:d=${fade}`,
    `fade=t=out:st=${Math.max(0, duration - fade)}:d=${fade}`,
    'format=yuv420p',
  ].join(',');

  await runFfmpeg([
    '-loop', '1',
    '-i', scenePng,
    '-t', String(duration),
    '-vf', vf,
    '-r', String(FPS),
    '-c:v', 'libx264',
    '-preset', 'fast',
    outputPath,
  ]);
  return outputPath;
}

/**
 * Full local render: scenes -> stills -> clips -> concat -> mux narration audio.
 * Scene durations are rescaled so total video length matches the narration length.
 */
async function composeVideo({ scenes, sceneAssets, audioPath, quality, animationStyle, animatedThemeName, captionWords, outputPath, onProgress }) {
  const { width, height } = QUALITY_DIMENSIONS[quality] || QUALITY_DIMENSIONS['720p'];
  const theme = STYLE_THEMES[animationStyle] || STYLE_THEMES['Motion Graphics'];
  // resolved once per video (not per scene) so every scene in a video stays
  // visually consistent — animatedThemeName is picked randomly upstream in
  // videoQueue.js; falls back to the default palette if omitted
  const animatedTheme = getAnimatedTheme(animatedThemeName);
  const whiteboardTheme = getWhiteboardTheme();
  const workDir = fs.mkdtempSync(path.join(os.tmpdir(), 'explainer-'));

  try {
    const audioDuration = await probeDurationSeconds(audioPath);
    const scriptedTotal = scenes.reduce((sum, s) => sum + (Number(s.duration) || 8), 0);
    const scale = audioDuration > 0 && scriptedTotal > 0 ? (audioDuration + 0.5) / scriptedTotal : 1;

    const clipPaths = [];
    for (let i = 0; i < scenes.length; i++) {
      const scene = scenes[i];
      const assets = sceneAssets[i] || {};
      const duration = Math.max(2, (Number(scene.duration) || 8) * scale);

      if (assets.slide && animationStyle === 'Animated Explainer') {
        // fully animated light-theme scene (frame-by-frame motion graphics)
        const clipPath = path.join(workDir, `clip_${i + 1}.mp4`);
        await renderAnimatedSceneClip({
          slide: assets.slide,
          iconBuffers: assets.slideIcons || [],
          width,
          height,
          duration,
          outputPath: clipPath,
          seed: i + 1,
          theme: animatedTheme,
        });
        clipPaths.push(clipPath);
      } else if (assets.slide && animationStyle === 'Whiteboard Animation') {
        // hand-drawing effect: icons stroke themselves on, pen-tip tracks the ink
        const clipPath = path.join(workDir, `clip_${i + 1}.mp4`);
        await renderWhiteboardSceneClip({
          slide: assets.slide,
          iconBuffers: assets.slideIcons || [],
          width,
          height,
          duration,
          outputPath: clipPath,
          seed: i + 1,
          theme: whiteboardTheme,
        });
        clipPaths.push(clipPath);
      } else if (assets.slide) {
        // professional slide scene with progressive item reveal
        const clips = await renderSlideSceneClips({
          slide: assets.slide,
          slideIcons: assets.slideIcons || [],
          theme: assets.slideTheme,
          duration,
          width,
          height,
          workDir,
          sceneIndex: i + 1,
        });
        clipPaths.push(...clips);
      } else {
        // photo scene: background image + caption band, Ken Burns zoom
        const scenePng = path.join(workDir, `scene_${i + 1}.png`);
        await buildScenePng({
          backgroundPath: assets.backgroundPath,
          iconSvg: assets.iconSvg,
          textOverlays: scene.textOverlays && scene.textOverlays.length ? scene.textOverlays : [scene.narration ? String(scene.narration).slice(0, 80) : ''],
          theme,
          width,
          height,
          outputPath: scenePng,
        });

        const clipPath = path.join(workDir, `clip_${i + 1}.mp4`);
        await renderSceneClip(scenePng, duration, width, height, clipPath);
        clipPaths.push(clipPath);
      }

      if (onProgress) onProgress(Math.round(((i + 1) / scenes.length) * 100));
    }

    // concat all clips, then mux the narration
    const concatList = path.join(workDir, 'concat.txt');
    fs.writeFileSync(concatList, clipPaths.map((p) => `file '${p.replace(/\\/g, '/').replace(/'/g, "'\\''")}'`).join('\n'));

    const silentVideo = path.join(workDir, 'combined.mp4');
    await runFfmpeg(['-f', 'concat', '-safe', '0', '-i', concatList, '-c', 'copy', silentVideo]);

    let videoForMux = silentVideo;
    if (captionWords && captionWords.length) {
      const captionedVideo = path.join(workDir, 'captioned.mp4');
      await burnCaptions(silentVideo, captionWords, width, height, workDir, captionedVideo);
      videoForMux = captionedVideo;
    }

    // Deliberately NOT using -shortest here: composed video is intentionally
    // ~0.5s longer than the narration (see the `scale` buffer above), and
    // -shortest would trim that buffer straight back off — which silently
    // ate the final scene's own 0.35s fade-out on every single video,
    // freezing on a mid-content frame instead of ending gracefully. Without
    // -shortest, the video plays out its full length (audio just goes
    // silent slightly early, which is inaudible).
    await runFfmpeg([
      '-i', videoForMux,
      '-i', audioPath,
      '-c:v', 'copy',
      '-c:a', 'aac',
      '-b:a', '192k',
      outputPath,
    ]);

    return outputPath;
  } finally {
    fs.rmSync(workDir, { recursive: true, force: true });
  }
}

module.exports = { composeVideo, probeDurationSeconds, extractThumbnail, QUALITY_DIMENSIONS };
