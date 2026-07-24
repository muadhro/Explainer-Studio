const { spawn } = require('child_process');
const sharp = require('sharp');
const ffmpegPath = require('ffmpeg-static');

const FPS = 25;

// Light, modern agency-style theme (mint gradient, ink outlines, teal accents)
const THEME = {
  bgTop: '#fbfdfd',
  bgBottom: '#e4f4ec',
  bgAccent: '#d9f0fb',
  ink: '#2d3748',
  inkSoft: '#64748b',
  accent: '#14b8a6',
  accent2: '#0ea5e9',
  label: '#1f2937',
  dotColors: ['#14b8a6', '#0ea5e9', '#94a3b8'],
};

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

/** Precompute per-scene static geometry: item positions, dots, timings. */
function buildScenePlan(slide, width, height, seed) {
  const rand = mulberry32(seed);
  const items = slide.sections.flatMap((s, si) => s.items.map((it) => ({ ...it, sectionIndex: si })));
  const plan = { layoutKind: slide.layout, items: [], dots: [], headings: [] };

  // ambient drifting dots
  for (let i = 0; i < 12; i++) {
    plan.dots.push({
      x: width * (0.04 + rand() * 0.92),
      y: height * (0.08 + rand() * 0.84),
      r: 2.5 + rand() * 4,
      color: THEME.dotColors[Math.floor(rand() * THEME.dotColors.length)],
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
function buildFrameSvg({ slide, plan, iconData, width, height, t, duration }) {
  const parts = [];
  const titleSize = Math.round(height * 0.075);
  const subtitleSize = Math.round(height * 0.04);
  const labelSize = Math.round(height * 0.034);
  const sublabelSize = Math.round(height * 0.026);
  const headingSize = Math.round(height * 0.04);

  // background
  parts.push(`<defs>
    <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="${THEME.bgTop}"/>
      <stop offset="0.6" stop-color="${THEME.bgBottom}"/>
      <stop offset="1" stop-color="${THEME.bgAccent}"/>
    </linearGradient>
    <clipPath id="titleClip"><rect x="0" y="0" width="${width * clamp01((t - 0.15) / 0.9)}" height="${height * 0.24}"/></clipPath>
  </defs>
  <rect width="${width}" height="${height}" fill="url(#bg)"/>`);

  // decorative dotted arcs (static)
  parts.push(`<circle cx="${width * 0.06}" cy="${height * 0.9}" r="${height * 0.22}" fill="none" stroke="${THEME.inkSoft}" stroke-width="1.5" stroke-dasharray="1 9" stroke-linecap="round" opacity="0.5"/>`);
  parts.push(`<circle cx="${width * 0.95}" cy="${height * 0.08}" r="${height * 0.18}" fill="none" stroke="${THEME.inkSoft}" stroke-width="1.5" stroke-dasharray="1 9" stroke-linecap="round" opacity="0.5"/>`);

  // ambient drifting dots
  for (const d of plan.dots) {
    const dx = Math.sin(t * d.speed + d.phase) * 9;
    const dy = Math.cos(t * d.speed * 0.8 + d.phase) * 7;
    parts.push(`<circle cx="${d.x + dx}" cy="${d.y + dy}" r="${d.r}" fill="${d.color}" opacity="${d.opacity}"/>`);
  }

  // title: wipe reveal, centered; subtitle fades in after
  const titleOp = clamp01((t - 0.1) / 0.3);
  parts.push(`<g clip-path="url(#titleClip)" opacity="${titleOp}">
    <text x="${width / 2}" y="${height * 0.13}" text-anchor="middle" font-family="Segoe UI, Arial, sans-serif" font-size="${titleSize}" font-weight="800" fill="${THEME.ink}">${escapeXml(slide.title)}</text>
  </g>`);
  if (slide.subtitle) {
    const subOp = clamp01((t - 0.7) / 0.4);
    parts.push(`<text x="${width / 2}" y="${height * 0.195}" text-anchor="middle" font-family="Segoe UI, Arial, sans-serif" font-size="${subtitleSize}" font-weight="600" fill="${THEME.accent}" opacity="${subOp}" letter-spacing="1">${escapeXml(slide.subtitle.toUpperCase())}</text>`);
  }

  // split headings
  for (const h of plan.headings || []) {
    if (!h.text) continue;
    const p = easeOutCubic((t - h.appear) / 0.4);
    if (p <= 0) continue;
    parts.push(`<text x="${h.x}" y="${height * 0.28}" text-anchor="middle" font-family="Segoe UI, Arial, sans-serif" font-size="${headingSize}" font-weight="700" fill="${THEME.inkSoft}" opacity="${p}" letter-spacing="2">${escapeXml(h.text.toUpperCase())}</text>`);
  }

  // orbit ring
  if (plan.orbitRing) {
    const p = easeOutCubic((t - 0.9) / 0.6);
    if (p > 0) {
      parts.push(`<circle cx="${plan.orbitRing.cx}" cy="${plan.orbitRing.cy}" r="${plan.orbitRing.r}" fill="none" stroke="${THEME.inkSoft}" stroke-width="1.5" stroke-dasharray="1 10" stroke-linecap="round" opacity="${0.55 * p}"/>`);
    }
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
      parts.push(`<line x1="${x1}" y1="${y}" x2="${Math.max(x1, x2 - ah * 1.5)}" y2="${y}" stroke="${THEME.accent}" stroke-width="${height * 0.006}" stroke-linecap="round"/>`);
      parts.push(`<polygon points="${x2},${y} ${x2 - ah * 2},${y - ah} ${x2 - ah * 2},${y + ah}" fill="${THEME.accent}"/>`);
      if (p > 0.85) {
        parts.push(`<text x="${(x1 + xFull) / 2}" y="${y - height * 0.028}" text-anchor="middle" font-family="Segoe UI, Arial, sans-serif" font-size="${labelSize}" font-weight="700" fill="${THEME.accent2}" opacity="${clamp01((p - 0.85) / 0.15)}">${i}</text>`);
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
    parts.push(`<circle cx="${x}" cy="${y}" r="${half * 1.45}" fill="#ffffff" stroke="${item.hero ? THEME.accent : '#dbe5ea'}" stroke-width="${item.hero ? 3 : 2}"/>`);
    const icon = iconData[i];
    if (icon) {
      parts.push(`<image x="${x - half}" y="${y - half}" width="${s * scale}" height="${s * scale}" href="${icon}"/>`);
    } else {
      parts.push(`<text x="${x}" y="${y + s * 0.14}" text-anchor="middle" font-family="Segoe UI, Arial, sans-serif" font-size="${s * 0.42}" font-weight="800" fill="${THEME.ink}">${escapeXml((item.label || '?')[0].toUpperCase())}</text>`);
    }
    if (item.label) {
      const labelY = y + half * 1.45 + labelSize * 1.15;
      parts.push(`<text x="${x}" y="${labelY}" text-anchor="middle" font-family="Segoe UI, Arial, sans-serif" font-size="${labelSize}" font-weight="700" fill="${THEME.label}">${escapeXml(item.label)}</text>`);
      if (item.sublabel) {
        parts.push(`<text x="${x}" y="${labelY + sublabelSize * 1.3}" text-anchor="middle" font-family="Segoe UI, Arial, sans-serif" font-size="${sublabelSize}" fill="${THEME.inkSoft}">${escapeXml(item.sublabel)}</text>`);
      }
    }
    parts.push('</g>');
  });

  // scene fade in/out via bg-colored overlay
  const fadeIn = 1 - clamp01(t / 0.35);
  const fadeOut = clamp01((t - (duration - 0.35)) / 0.35);
  const fade = Math.max(fadeIn, fadeOut);
  if (fade > 0.001) {
    parts.push(`<rect width="${width}" height="${height}" fill="${THEME.bgTop}" opacity="${fade}"/>`);
  }

  return `<svg width="${width}" height="${height}" xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink">${parts.join('\n')}</svg>`;
}

/** Render a full animated scene to an mp4 clip by piping frames into ffmpeg. */
async function renderAnimatedSceneClip({ slide, iconBuffers, width, height, duration, outputPath, seed }) {
  const plan = buildScenePlan(slide, width, height, seed);

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
        const svg = buildFrameSvg({ slide, plan, iconData, width, height, t, duration });
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

module.exports = { renderAnimatedSceneClip, THEME };
