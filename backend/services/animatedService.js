const { spawn } = require('child_process');
const sharp = require('sharp');
const ffmpegPath = require('ffmpeg-static');

const FPS = 25;

// Background palettes for the light, modern agency-style look. Each video
// gets one at random (see videoQueue.js) — Mint is the original/default.
const THEMES = {
  Mint: {
    bgTop: '#fbfdfd',
    bgBottom: '#e4f4ec',
    bgAccent: '#d9f0fb',
    ink: '#2d3748',
    inkSoft: '#64748b',
    accent: '#14b8a6',
    accent2: '#0ea5e9',
    label: '#1f2937',
    dotColors: ['#14b8a6', '#0ea5e9', '#94a3b8'],
  },
  Ocean: {
    bgTop: '#eef6fb',
    bgBottom: '#cfe6f5',
    bgAccent: '#b8d9ee',
    ink: '#0f2b3d',
    inkSoft: '#4a6b80',
    accent: '#0ea5e9',
    accent2: '#0369a1',
    label: '#0f2b3d',
    dotColors: ['#0ea5e9', '#0369a1', '#7dd3fc'],
  },
  Sunset: {
    bgTop: '#fff8f0',
    bgBottom: '#fde3d0',
    bgAccent: '#fbd0c0',
    ink: '#4a2b1f',
    inkSoft: '#8a5c47',
    accent: '#f97316',
    accent2: '#e11d48',
    label: '#4a2b1f',
    dotColors: ['#f97316', '#e11d48', '#fb923c'],
  },
  Slate: {
    bgTop: '#f8f9fa',
    bgBottom: '#e5e8eb',
    bgAccent: '#dde1e6',
    ink: '#1e293b',
    inkSoft: '#64748b',
    accent: '#3b82f6',
    accent2: '#64748b',
    label: '#1e293b',
    dotColors: ['#3b82f6', '#94a3b8', '#cbd5e1'],
  },
};
const THEME = THEMES.Mint; // back-compat alias — read-only, never mutated
const THEME_NAMES = Object.keys(THEMES);
function getTheme(name) {
  return THEMES[name] || THEMES.Mint;
}

function easeOutCubic(p) {
  return 1 - Math.pow(1 - Math.max(0, Math.min(1, p)), 3);
}

function clamp01(v) {
  return Math.max(0, Math.min(1, v));
}

// deterministic pseudo-random so every frame of a scene agrees on positions
function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
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
 * Fit a headline into at most `maxLines`, shrinking font size before giving
 * up and truncating — titles are meant to be "max 3 words" but nothing
 * downstream enforces that, so this is what actually keeps long titles from
 * running off the edges of the frame.
 */
function fitTitleLines(title, width, baseFontSize, maxLines) {
  const CHAR_WIDTH_FACTOR = 0.58; // approx average glyph width for this bold sans-serif
  const maxWidth = width * 0.86;
  let fontSize = baseFontSize;

  for (let attempt = 0; attempt < 5; attempt++) {
    const maxChars = Math.max(6, Math.floor(maxWidth / (fontSize * CHAR_WIDTH_FACTOR)));
    const lines = wrapText(title, maxChars);
    if (lines.length <= maxLines) return { lines, fontSize };
    fontSize = Math.round(fontSize * 0.85);
  }

  const maxChars = Math.max(6, Math.floor(maxWidth / (fontSize * CHAR_WIDTH_FACTOR)));
  return { lines: wrapText(title, maxChars).slice(0, maxLines), fontSize };
}

/** Precompute per-scene static geometry: item positions, dots, timings. */
function buildScenePlan(slide, width, height, seed, dotColors = ['#94a3b8']) {
  const rand = mulberry32(seed);
  const items = slide.sections.flatMap((s, si) => s.items.map((it) => ({ ...it, sectionIndex: si })));
  const plan = { layoutKind: slide.layout, items: [], dots: [], headings: [] };

  // ambient drifting dots
  for (let i = 0; i < 12; i++) {
    plan.dots.push({
      x: width * (0.04 + rand() * 0.92),
      y: height * (0.08 + rand() * 0.84),
      r: 2.5 + rand() * 4,
      color: dotColors[Math.floor(rand() * dotColors.length)],
      phase: rand() * Math.PI * 2,
      speed: 0.3 + rand() * 0.5,
      opacity: 0.35 + rand() * 0.4,
    });
  }

  const appearBase = 1.0;
  const stagger = 0.4;

  if (slide.layout === 'flow') {
    const margin = width * 0.07;
    const cellW = (width - margin * 2) / items.length;
    const iconSize = Math.min(height * 0.17, cellW * 0.42);
    items.forEach((item, i) => {
      plan.items.push({
        ...item,
        cx: margin + cellW * (i + 0.5),
        cy: height * 0.55,
        iconSize,
        appear: appearBase + i * stagger,
        fromX: 0,
        fromY: 44,
        flowIndex: i,
      });
    });
  } else if (slide.layout === 'split' && slide.sections.length === 2) {
    const firstCount = slide.sections[0].items.length;
    plan.headings = [
      { text: slide.sections[0].heading, x: width * 0.27, appear: appearBase },
      { text: slide.sections[1].heading, x: width * 0.73, appear: appearBase + firstCount * stagger },
    ];
    slide.sections.forEach((section, si) => {
      const x0 = si === 0 ? width * 0.06 : width * 0.54;
      const x1 = si === 0 ? width * 0.46 : width * 0.94;
      const cols = Math.min(2, section.items.length);
      const rows = Math.ceil(section.items.length / cols);
      const cellW = (x1 - x0) / cols;
      const cellH = (height * 0.62) / rows;
      const iconSize = Math.min(height * 0.16, cellW * 0.4);
      section.items.forEach((item, i) => {
        const row = Math.floor(i / cols);
        const colsInRow = Math.min(cols, section.items.length - row * cols);
        const rowOffset = (cols - colsInRow) * cellW * 0.5;
        const col = i - row * cols;
        const globalIndex = si === 0 ? i : firstCount + i;
        plan.items.push({
          ...item,
          sectionIndex: si,
          cx: x0 + rowOffset + cellW * (col + 0.5),
          cy: height * 0.34 + cellH * (row + 0.4),
          iconSize,
          appear: appearBase + globalIndex * stagger,
          fromX: si === 0 ? -70 : 70,
          fromY: 0,
        });
      });
    });
  } else if (slide.layout === 'quiz') {
    // Deep Dive recap: question reveals, then answer choices stagger in,
    // then an extra beat before the correct one is highlighted
    const choiceStagger = 0.5;
    const choices = slide.quiz.choices.map((c, i) => ({ ...c, appear: appearBase + i * choiceStagger }));
    const lastChoiceAppear = appearBase + (choices.length - 1) * choiceStagger;
    plan.quiz = {
      question: slide.quiz.question,
      choices,
      revealAppear: lastChoiceAppear + choiceStagger + 0.4,
    };
  } else {
    // grid -> hero + orbit: first item center, the rest orbit on a dotted ring
    const cx = width / 2;
    const cy = height * 0.59;
    const ring = height * 0.28;
    items.forEach((item, i) => {
      if (i === 0) {
        plan.items.push({
          ...item,
          cx,
          cy,
          iconSize: height * 0.2,
          appear: appearBase,
          hero: true,
          fromX: 0,
          fromY: 0,
        });
      } else {
        plan.items.push({
          ...item,
          orbit: { cx, cy, r: ring, baseAngle: -Math.PI / 2 + ((i - 1) * 2 * Math.PI) / Math.max(1, items.length - 1) },
          iconSize: height * 0.12,
          appear: appearBase + 0.5 + (i - 1) * stagger,
          fromX: 0,
          fromY: 0,
        });
      }
    });
    plan.orbitRing = { cx, cy, r: ring };
  }

  return plan;
}

/** Build one SVG frame at time t (seconds). */
function buildFrameSvg({ slide, plan, iconData, width, height, t, duration, theme = THEME }) {
  const parts = [];
  const titleSize = Math.round(height * 0.075);
  const subtitleSize = Math.round(height * 0.04);
  const labelSize = Math.round(height * 0.034);
  const sublabelSize = Math.round(height * 0.026);
  const headingSize = Math.round(height * 0.04);

  // titles are meant to be "max 3 words" but nothing enforces that upstream,
  // so shrink/wrap onto up to 2 lines rather than let long ones run off-frame
  const { lines: titleLines, fontSize: fittedTitleSize } = fitTitleLines(slide.title, width, titleSize, 2);
  const titleLineGap = fittedTitleSize * 1.15;
  const titleBaseY = height * 0.13;
  const titleStartY = titleLines.length > 1 ? titleBaseY - titleLineGap * 0.5 : titleBaseY;
  const titleClipHeight = height * 0.24 + (titleLines.length > 1 ? titleLineGap : 0);
  const subtitleY = height * 0.195 + (titleLines.length > 1 ? titleLineGap : 0);

  // background
  parts.push(`<defs>
    <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="${theme.bgTop}"/>
      <stop offset="0.6" stop-color="${theme.bgBottom}"/>
      <stop offset="1" stop-color="${theme.bgAccent}"/>
    </linearGradient>
    <clipPath id="titleClip"><rect x="0" y="0" width="${width * clamp01((t - 0.15) / 0.9)}" height="${titleClipHeight}"/></clipPath>
  </defs>
  <rect width="${width}" height="${height}" fill="url(#bg)"/>`);

  // decorative dotted arcs (static)
  parts.push(`<circle cx="${width * 0.06}" cy="${height * 0.9}" r="${height * 0.22}" fill="none" stroke="${theme.inkSoft}" stroke-width="1.5" stroke-dasharray="1 9" stroke-linecap="round" opacity="0.5"/>`);
  parts.push(`<circle cx="${width * 0.95}" cy="${height * 0.08}" r="${height * 0.18}" fill="none" stroke="${theme.inkSoft}" stroke-width="1.5" stroke-dasharray="1 9" stroke-linecap="round" opacity="0.5"/>`);

  // ambient drifting dots
  for (const d of plan.dots) {
    const dx = Math.sin(t * d.speed + d.phase) * 9;
    const dy = Math.cos(t * d.speed * 0.8 + d.phase) * 7;
    parts.push(`<circle cx="${d.x + dx}" cy="${d.y + dy}" r="${d.r}" fill="${d.color}" opacity="${d.opacity}"/>`);
  }

  // title: wipe reveal, centered; subtitle fades in after
  const titleOp = clamp01((t - 0.1) / 0.3);
  const titleTextElements = titleLines
    .map(
      (line, i) =>
        `<text x="${width / 2}" y="${Math.round(titleStartY + i * titleLineGap)}" text-anchor="middle" font-family="Segoe UI, Arial, sans-serif" font-size="${fittedTitleSize}" font-weight="800" fill="${theme.ink}">${escapeXml(line)}</text>`,
    )
    .join('\n    ');
  parts.push(`<g clip-path="url(#titleClip)" opacity="${titleOp}">
    ${titleTextElements}
  </g>`);
  if (slide.subtitle) {
    const subOp = clamp01((t - 0.7) / 0.4);
    parts.push(`<text x="${width / 2}" y="${subtitleY}" text-anchor="middle" font-family="Segoe UI, Arial, sans-serif" font-size="${subtitleSize}" font-weight="600" fill="${theme.accent}" opacity="${subOp}" letter-spacing="1">${escapeXml(slide.subtitle.toUpperCase())}</text>`);
  }

  // split headings
  for (const h of plan.headings || []) {
    if (!h.text) continue;
    const p = easeOutCubic((t - h.appear) / 0.4);
    if (p <= 0) continue;
    parts.push(`<text x="${h.x}" y="${height * 0.28}" text-anchor="middle" font-family="Segoe UI, Arial, sans-serif" font-size="${headingSize}" font-weight="700" fill="${theme.inkSoft}" opacity="${p}" letter-spacing="2">${escapeXml(h.text.toUpperCase())}</text>`);
  }

  // orbit ring
  if (plan.orbitRing) {
    const p = easeOutCubic((t - 0.9) / 0.6);
    if (p > 0) {
      parts.push(`<circle cx="${plan.orbitRing.cx}" cy="${plan.orbitRing.cy}" r="${plan.orbitRing.r}" fill="none" stroke="${theme.inkSoft}" stroke-width="1.5" stroke-dasharray="1 10" stroke-linecap="round" opacity="${0.55 * p}"/>`);
    }
  }

  // quiz recap: wrapped question, then staggered answer-choice cards, then
  // the correct one gets a checkmark after an extra "reveal" beat
  if (plan.quiz) {
    const questionSize = Math.round(height * 0.05);
    const choiceSize = Math.round(height * 0.036);
    const qLines = wrapText(plan.quiz.question, Math.floor((width * 0.78) / (questionSize * 0.55)));
    const qStartY = height * 0.34;
    const qLineGap = questionSize * 1.25;
    const qOp = clamp01((t - 0.9) / 0.4);
    if (qOp > 0) {
      qLines.forEach((line, i) => {
        parts.push(`<text x="${width / 2}" y="${qStartY + i * qLineGap}" text-anchor="middle" font-family="Segoe UI, Arial, sans-serif" font-size="${questionSize}" font-weight="700" fill="${theme.ink}" opacity="${qOp}">${escapeXml(line)}</text>`);
      });
    }

    const choicesTop = qStartY + qLines.length * qLineGap + height * 0.06;
    const choiceH = height * 0.09;
    const choiceGap = height * 0.02;
    const choiceW = width * 0.6;
    const choiceX = (width - choiceW) / 2;

    plan.quiz.choices.forEach((choice, i) => {
      const p = easeOutCubic((t - choice.appear) / 0.4);
      if (p <= 0) return;
      const y = choicesTop + i * (choiceH + choiceGap);
      const highlightP = choice.correct ? easeOutCubic((t - plan.quiz.revealAppear) / 0.4) : 0;
      parts.push(`<rect x="${choiceX}" y="${y}" width="${choiceW}" height="${choiceH}" rx="${choiceH * 0.25}" fill="#ffffff" stroke="${highlightP > 0 ? theme.accent : '#dbe5ea'}" stroke-width="${highlightP > 0 ? 3 : 2}" opacity="${p}"/>`);
      parts.push(`<text x="${choiceX + width * 0.02}" y="${y + choiceH * 0.62}" font-family="Segoe UI, Arial, sans-serif" font-size="${choiceSize}" font-weight="700" fill="${theme.ink}" opacity="${p}">${escapeXml(choice.text)}</text>`);
      if (choice.correct && highlightP > 0) {
        const cx = choiceX + choiceW - width * 0.035;
        const cy = y + choiceH / 2;
        const s = choiceH * 0.22;
        parts.push(`<polyline points="${cx - s},${cy} ${cx - s * 0.25},${cy + s * 0.7} ${cx + s},${cy - s * 0.8}" fill="none" stroke="${theme.accent}" stroke-width="${Math.max(3, s * 0.25)}" stroke-linecap="round" stroke-linejoin="round" opacity="${highlightP}"/>`);
      }
    });
  }

  // resolve current item positions (orbiters move continuously)
  const resolved = plan.items.map((item) => {
    if (item.orbit) {
      const angle = item.orbit.baseAngle + t * 0.16;
      return { ...item, cx: item.orbit.cx + Math.cos(angle) * item.orbit.r, cy: item.orbit.cy + Math.sin(angle) * item.orbit.r };
    }
    return item;
  });

  // flow arrows (draw on as the next item appears)
  if (plan.layoutKind === 'flow') {
    for (let i = 1; i < resolved.length; i++) {
      const p = easeOutCubic((t - resolved[i].appear) / 0.35);
      if (p <= 0) continue;
      const a = resolved[i - 1];
      const b = resolved[i];
      const y = a.cy;
      const x1 = a.cx + a.iconSize * 0.75;
      const xFull = b.cx - b.iconSize * 0.75;
      const x2 = x1 + (xFull - x1) * p;
      const ah = height * 0.011;
      parts.push(`<line x1="${x1}" y1="${y}" x2="${Math.max(x1, x2 - ah * 1.5)}" y2="${y}" stroke="${theme.accent}" stroke-width="${height * 0.006}" stroke-linecap="round"/>`);
      parts.push(`<polygon points="${x2},${y} ${x2 - ah * 2},${y - ah} ${x2 - ah * 2},${y + ah}" fill="${theme.accent}"/>`);
      if (p > 0.85) {
        parts.push(`<text x="${(x1 + xFull) / 2}" y="${y - height * 0.028}" text-anchor="middle" font-family="Segoe UI, Arial, sans-serif" font-size="${labelSize}" font-weight="700" fill="${theme.accent2}" opacity="${clamp01((p - 0.85) / 0.15)}">${i}</text>`);
      }
    }
  }

  // items: white circle backdrop + icon + labels, entrance + gentle bob
  resolved.forEach((item, i) => {
    const p = easeOutCubic((t - item.appear) / 0.5);
    if (p <= 0) return;
    const settled = t - item.appear > 0.5;
    const bob = settled && !item.orbit ? Math.sin((t - item.appear) * 2.1 + i * 1.3) * 3.5 : 0;
    const x = item.cx + (item.fromX || 0) * (1 - p);
    const y = item.cy + (item.fromY || 0) * (1 - p) + bob;
    const s = item.iconSize;
    const scale = 0.75 + 0.25 * p;
    const half = (s * scale) / 2;

    parts.push(`<g opacity="${p}">`);
    parts.push(`<circle cx="${x}" cy="${y}" r="${half * 1.45}" fill="#ffffff" stroke="${item.hero ? theme.accent : '#dbe5ea'}" stroke-width="${item.hero ? 3 : 2}"/>`);
    const icon = iconData[i];
    if (icon) {
      parts.push(`<image x="${x - half}" y="${y - half}" width="${s * scale}" height="${s * scale}" href="${icon}"/>`);
    } else {
      parts.push(`<text x="${x}" y="${y + s * 0.14}" text-anchor="middle" font-family="Segoe UI, Arial, sans-serif" font-size="${s * 0.42}" font-weight="800" fill="${theme.ink}">${escapeXml((item.label || '?')[0].toUpperCase())}</text>`);
    }
    if (item.label) {
      const labelY = y + half * 1.45 + labelSize * 1.15;
      parts.push(`<text x="${x}" y="${labelY}" text-anchor="middle" font-family="Segoe UI, Arial, sans-serif" font-size="${labelSize}" font-weight="700" fill="${theme.label}">${escapeXml(item.label)}</text>`);
      if (item.sublabel) {
        parts.push(`<text x="${x}" y="${labelY + sublabelSize * 1.3}" text-anchor="middle" font-family="Segoe UI, Arial, sans-serif" font-size="${sublabelSize}" fill="${theme.inkSoft}">${escapeXml(item.sublabel)}</text>`);
      }
    }
    parts.push('</g>');
  });

  // scene fade in/out via bg-colored overlay
  const fadeIn = 1 - clamp01(t / 0.35);
  const fadeOut = clamp01((t - (duration - 0.35)) / 0.35);
  const fade = Math.max(fadeIn, fadeOut);
  if (fade > 0.001) {
    parts.push(`<rect width="${width}" height="${height}" fill="${theme.bgTop}" opacity="${fade}"/>`);
  }

  return `<svg width="${width}" height="${height}" xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink">${parts.join('\n')}</svg>`;
}

/** Render a full animated scene to an mp4 clip by piping frames into ffmpeg. */
async function renderAnimatedSceneClip({ slide, iconBuffers, width, height, duration, outputPath, seed, theme = THEME }) {
  const plan = buildScenePlan(slide, width, height, seed, theme.dotColors);

  // rasterize icons once, embed as data URIs in every frame
  const iconData = [];
  for (let i = 0; i < plan.items.length; i++) {
    const buf = iconBuffers[i];
    if (!buf) {
      iconData.push(null);
      continue;
    }
    try {
      const png = await sharp(buf).resize(256, 256, { fit: 'contain' }).png().toBuffer();
      iconData.push(`data:image/png;base64,${png.toString('base64')}`);
    } catch {
      iconData.push(null);
    }
  }

  const frameCount = Math.max(FPS, Math.round(duration * FPS));

  return new Promise((resolve, reject) => {
    const proc = spawn(ffmpegPath, [
      '-y', '-hide_banner', '-loglevel', 'error',
      '-f', 'image2pipe', '-framerate', String(FPS), '-i', 'pipe:0',
      '-c:v', 'libx264', '-preset', 'fast', '-pix_fmt', 'yuv420p',
      outputPath,
    ]);
    let stderr = '';
    proc.stderr.on('data', (d) => (stderr += d.toString()));
    proc.on('error', reject);
    proc.on('close', (code) => {
      if (code === 0) resolve(outputPath);
      else reject(new Error(`ffmpeg (animated scene) exited ${code}: ${stderr.slice(-1500)}`));
    });

    (async () => {
      for (let f = 0; f < frameCount; f++) {
        const t = f / FPS;
        const svg = buildFrameSvg({ slide, plan, iconData, width, height, t, duration, theme });
        const png = await sharp(Buffer.from(svg)).png().toBuffer();
        if (!proc.stdin.write(png)) {
          await new Promise((r) => proc.stdin.once('drain', r));
        }
      }
      proc.stdin.end();
    })().catch((err) => {
      proc.stdin.destroy();
      reject(err);
    });
  });
}

module.exports = {
  renderAnimatedSceneClip,
  THEME,
  THEMES,
  THEME_NAMES,
  getTheme,
  FPS,
  buildScenePlan,
  buildFrameSvg,
  mulberry32,
  easeOutCubic,
  clamp01,
  escapeXml,
  wrapText,
  fitTitleLines,
};
