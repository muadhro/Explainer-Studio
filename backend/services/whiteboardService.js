const { spawn } = require('child_process');
const sharp = require('sharp');
const ffmpegPath = require('ffmpeg-static');
const { svgPathProperties } = require('svg-path-properties');
const {
  FPS,
  buildScenePlan,
  easeOutCubic,
  clamp01,
  escapeXml,
  fitTitleLines,
} = require('./animatedService');

// Cream "paper" whiteboard, dark ink strokes, two marker accent colors
const THEME = {
  bg: '#fdfbf4',
  grid: '#eae4d2',
  ink: '#242424',
  inkSoft: '#5b5b5b',
  accent: '#2563eb',
  accent2: '#dc2626',
  label: '#242424',
};

const DRAW_DURATION = 1.0; // seconds for a single icon to fully "draw" on

// --- SVG icon geometry: parse a fetched (raw, un-rasterized) icon SVG into
// drawable stroke elements with per-element length + point-at-length, so we
// can reveal them progressively via stroke-dasharray/stroke-dashoffset. ---

function parseAttrString(str) {
  const attrs = {};
  const re = /([a-zA-Z_:-]+)="([^"]*)"/g;
  let m;
  while ((m = re.exec(str))) attrs[m[1]] = m[2];
  return attrs;
}

function serializeAttrs(attrs) {
  return Object.entries(attrs)
    .map(([k, v]) => `${k}="${v}"`)
    .join(' ');
}

function computeGeometry(type, attrs) {
  switch (type) {
    case 'path': {
      const props = new svgPathProperties(attrs.d || '');
      const length = props.getTotalLength();
      return { length, pointAt: (len) => props.getPointAtLength(Math.max(0, Math.min(len, length))) };
    }
    case 'circle': {
      const cx = parseFloat(attrs.cx) || 0;
      const cy = parseFloat(attrs.cy) || 0;
      const r = parseFloat(attrs.r) || 0;
      const length = 2 * Math.PI * r;
      return {
        length,
        pointAt: (len) => {
          const angle = r ? len / r : 0;
          return { x: cx + r * Math.cos(angle), y: cy + r * Math.sin(angle) };
        },
      };
    }
    case 'line': {
      const x1 = parseFloat(attrs.x1) || 0;
      const y1 = parseFloat(attrs.y1) || 0;
      const x2 = parseFloat(attrs.x2) || 0;
      const y2 = parseFloat(attrs.y2) || 0;
      const length = Math.hypot(x2 - x1, y2 - y1);
      return {
        length,
        pointAt: (len) => {
          const p = length ? len / length : 0;
          return { x: x1 + (x2 - x1) * p, y: y1 + (y2 - y1) * p };
        },
      };
    }
    case 'rect': {
      const x = parseFloat(attrs.x) || 0;
      const y = parseFloat(attrs.y) || 0;
      const w = parseFloat(attrs.width) || 0;
      const h = parseFloat(attrs.height) || 0;
      const length = 2 * (w + h);
      return {
        length,
        pointAt: (len) => {
          let d = Math.max(0, Math.min(len, length));
          if (d <= w) return { x: x + d, y };
          d -= w;
          if (d <= h) return { x: x + w, y: y + d };
          d -= h;
          if (d <= w) return { x: x + w - d, y: y + h };
          d -= w;
          return { x, y: y + h - d };
        },
      };
    }
    case 'polyline': {
      const pts = (attrs.points || '')
        .trim()
        .split(/\s+/)
        .filter(Boolean)
        .map((p) => p.split(',').map(Number));
      const segLens = [];
      let length = 0;
      for (let i = 1; i < pts.length; i++) {
        const l = Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]);
        segLens.push(l);
        length += l;
      }
      return {
        length,
        pointAt: (len) => {
          let d = Math.max(0, Math.min(len, length));
          for (let i = 0; i < segLens.length; i++) {
            if (d <= segLens[i] || i === segLens.length - 1) {
              const p = segLens[i] ? Math.min(1, d / segLens[i]) : 0;
              return { x: pts[i][0] + (pts[i + 1][0] - pts[i][0]) * p, y: pts[i][1] + (pts[i + 1][1] - pts[i][1]) * p };
            }
            d -= segLens[i];
          }
          return { x: pts[0] ? pts[0][0] : 0, y: pts[0] ? pts[0][1] : 0 };
        },
      };
    }
    case 'ellipse': {
      const cx = parseFloat(attrs.cx) || 0;
      const cy = parseFloat(attrs.cy) || 0;
      const rx = parseFloat(attrs.rx) || 0;
      const ry = parseFloat(attrs.ry) || 0;
      const h = rx + ry ? Math.pow((rx - ry) / (rx + ry), 2) : 0;
      const length = Math.PI * (rx + ry) * (1 + (3 * h) / (10 + Math.sqrt(4 - 3 * h)));
      return {
        length,
        pointAt: (len) => {
          const angle = length ? (len / length) * 2 * Math.PI : 0;
          return { x: cx + rx * Math.cos(angle), y: cy + ry * Math.sin(angle) };
        },
      };
    }
    default:
      return { length: 0, pointAt: () => ({ x: 0, y: 0 }) };
  }
}

/** Parse a raw (non-rasterized) icon SVG buffer/string into drawable geometry. */
function parseIconGeometry(svgInput) {
  if (!svgInput) return null;
  const svgText = Buffer.isBuffer(svgInput) ? svgInput.toString('utf8') : String(svgInput);

  const vbMatch = svgText.match(/viewBox="([\d.\-\s]+)"/);
  const viewBox = vbMatch ? vbMatch[1].trim().split(/\s+/).map(Number) : [0, 0, 24, 24];

  const groupMatch = svgText.match(/<g\b([^>]*)>/);
  const inherited = groupMatch ? parseAttrString(groupMatch[1]) : {};

  const elements = [];
  const tagRe = /<(path|circle|line|rect|polyline|ellipse)\b([^>]*?)\/>/g;
  let m;
  while ((m = tagRe.exec(svgText))) {
    const type = m[1];
    const own = parseAttrString(m[2]);
    const attrs = { ...inherited, ...own };
    delete attrs.id;

    // Some icons matched under the tabler/lucide prefix filter are still
    // filled glyphs (fill="#..." with no stroke), not the single-stroke
    // outline style this style depends on — stroke-dasharray does nothing
    // on a filled shape, it just renders as a solid blob immediately.
    // Reject any element that isn't a real unfilled stroke.
    const isUnfilled = (attrs.fill || '').toLowerCase() === 'none';
    const hasStroke = Boolean(attrs.stroke) && attrs.stroke.toLowerCase() !== 'none';
    if (!isUnfilled || !hasStroke) continue;

    const { length, pointAt } = computeGeometry(type, attrs);
    if (length > 0) elements.push({ type, attrs, length, pointAt });
  }

  const totalLength = elements.reduce((sum, e) => sum + e.length, 0);
  if (!totalLength) return null;
  return { viewBox, elements, totalLength };
}

/**
 * Render the portion of an icon drawn so far (by cumulative stroke length,
 * elements drawn in document order) plus the current pen-tip position.
 * `transform` maps the icon's own viewBox coordinate space onto the frame.
 */
function renderIconAtProgress(geometry, drawnLength, transform) {
  if (!geometry || drawnLength <= 0) return { svg: '', tip: null };
  let remaining = Math.min(drawnLength, geometry.totalLength);
  const parts = [];
  // point-at-length in viewBox-local space; the wrapping <g transform> below
  // maps element coordinates onto the frame, so map the tip the same way
  let tipLocal = null;

  for (const el of geometry.elements) {
    const draw = Math.max(0, Math.min(remaining, el.length));
    if (draw > 0) {
      const attrs = { ...el.attrs };
      if (draw < el.length) {
        attrs['stroke-dasharray'] = `${el.length} ${el.length}`;
        attrs['stroke-dashoffset'] = String(el.length - draw);
      }
      parts.push(`<${el.type} ${serializeAttrs(attrs)}/>`);
      tipLocal = el.pointAt(draw);
    }
    remaining -= el.length;
  }

  const tip = tipLocal
    ? { x: transform.tx + tipLocal.x * transform.scale, y: transform.ty + tipLocal.y * transform.scale }
    : null;

  return {
    svg: `<g transform="translate(${transform.tx} ${transform.ty}) scale(${transform.scale})">${parts.join('')}</g>`,
    tip,
  };
}

function iconTransform(cx, cy, targetSize, viewBox) {
  const [vbX, vbY, vbW] = viewBox;
  const scale = vbW ? targetSize / vbW : 1;
  const tx = cx - targetSize / 2 - vbX * scale;
  const ty = cy - targetSize / 2 - vbY * scale;
  return { scale, tx, ty };
}

function penMarker(tip, color) {
  if (!tip) return '';
  return `<g transform="translate(${tip.x} ${tip.y})">
    <circle r="10" fill="${color}" opacity="0.92"/>
    <circle r="3.5" fill="#ffffff" opacity="0.75"/>
  </g>`;
}

/** Build one whiteboard SVG frame at time t (seconds). */
function buildFrameSvg({ slide, plan, iconGeometry, width, height, t, duration }) {
  const parts = [];
  const titleSize = Math.round(height * 0.078);
  const subtitleSize = Math.round(height * 0.038);
  const labelSize = Math.round(height * 0.036);
  const sublabelSize = Math.round(height * 0.026);
  const headingSize = Math.round(height * 0.04);
  const fontStack = 'Caveat, Segoe UI, cursive';

  const { lines: titleLines, fontSize: fittedTitleSize } = fitTitleLines(slide.title, width, titleSize, 2);
  const titleLineGap = fittedTitleSize * 1.1;
  const titleBaseY = height * 0.14;
  const titleStartY = titleLines.length > 1 ? titleBaseY - titleLineGap * 0.5 : titleBaseY;
  const titleClipHeight = height * 0.26 + (titleLines.length > 1 ? titleLineGap : 0);
  const subtitleY = height * 0.205 + (titleLines.length > 1 ? titleLineGap : 0);

  // paper background + faint grid
  parts.push(`<defs>
    <pattern id="grid" width="${height * 0.045}" height="${height * 0.045}" patternUnits="userSpaceOnUse">
      <path d="M ${height * 0.045} 0 L 0 0 0 ${height * 0.045}" fill="none" stroke="${THEME.grid}" stroke-width="1"/>
    </pattern>
    <clipPath id="titleClip"><rect x="0" y="0" width="${width * clamp01((t - 0.15) / 0.9)}" height="${titleClipHeight}"/></clipPath>
  </defs>
  <rect width="${width}" height="${height}" fill="${THEME.bg}"/>
  <rect width="${width}" height="${height}" fill="url(#grid)" opacity="0.5"/>`);

  // title: wipe reveal, centered; subtitle fades in after
  const titleOp = clamp01((t - 0.1) / 0.3);
  const titleTextElements = titleLines
    .map(
      (line, i) =>
        `<text x="${width / 2}" y="${Math.round(titleStartY + i * titleLineGap)}" text-anchor="middle" font-family="${fontStack}" font-size="${fittedTitleSize}" font-weight="700" fill="${THEME.ink}">${escapeXml(line)}</text>`,
    )
    .join('\n    ');
  parts.push(`<g clip-path="url(#titleClip)" opacity="${titleOp}">
    ${titleTextElements}
  </g>`);
  if (slide.subtitle) {
    const subOp = clamp01((t - 0.7) / 0.4);
    parts.push(`<text x="${width / 2}" y="${subtitleY}" text-anchor="middle" font-family="${fontStack}" font-size="${subtitleSize}" font-weight="400" fill="${THEME.accent}" opacity="${subOp}">${escapeXml(slide.subtitle)}</text>`);
  }

  // split headings
  for (const h of plan.headings || []) {
    if (!h.text) continue;
    const p = easeOutCubic((t - h.appear) / 0.4);
    if (p <= 0) continue;
    parts.push(`<text x="${h.x}" y="${height * 0.28}" text-anchor="middle" font-family="${fontStack}" font-size="${headingSize}" font-weight="700" fill="${THEME.inkSoft}" opacity="${p}">${escapeXml(h.text)}</text>`);
  }

  // resolve item positions — whiteboard ink is static once drawn (no orbit
  // drift or idle bob; that reads as "floating", not "drawn on a surface")
  const resolved = plan.items.map((item) => {
    if (item.orbit) {
      const angle = item.orbit.baseAngle;
      return { ...item, cx: item.orbit.cx + Math.cos(angle) * item.orbit.r, cy: item.orbit.cy + Math.sin(angle) * item.orbit.r };
    }
    return item;
  });

  // flow arrows (draw on as the next item appears) — same growth technique
  // as the Animated Explainer engine, re-themed to ink/marker colors
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
      parts.push(`<line x1="${x1}" y1="${y}" x2="${Math.max(x1, x2 - ah * 1.5)}" y2="${y}" stroke="${THEME.accent}" stroke-width="${height * 0.005}" stroke-linecap="round"/>`);
      parts.push(`<polygon points="${x2},${y} ${x2 - ah * 2},${y - ah} ${x2 - ah * 2},${y + ah}" fill="${THEME.accent}"/>`);
    }
  }

  // items: icon drawn stroke-by-stroke with a pen tip, label fades in after
  resolved.forEach((item, i) => {
    const drawP = clamp01((t - item.appear) / DRAW_DURATION);
    if (drawP <= 0) return;
    const geometry = iconGeometry[i];
    const s = item.iconSize;

    if (geometry) {
      const transform = iconTransform(item.cx, item.cy, s, geometry.viewBox);
      const drawnLength = drawP * geometry.totalLength;
      const { svg, tip } = renderIconAtProgress(geometry, drawnLength, transform);
      parts.push(svg);
      if (drawP < 1) {
        parts.push(penMarker(tip, i % 2 === 0 ? THEME.accent : THEME.accent2));
      }
    } else {
      // no icon resolved — draw a simple placeholder ink circle instead
      const op = easeOutCubic(drawP);
      parts.push(`<circle cx="${item.cx}" cy="${item.cy}" r="${s * 0.28}" fill="none" stroke="${THEME.ink}" stroke-width="3" opacity="${op}"/>`);
    }

    if (item.label) {
      const labelOp = clamp01((drawP - 0.85) / 0.15);
      if (labelOp > 0) {
        const labelY = item.cy + s * 0.62 + labelSize * 1.1;
        parts.push(`<text x="${item.cx}" y="${labelY}" text-anchor="middle" font-family="${fontStack}" font-size="${labelSize}" font-weight="700" fill="${THEME.label}" opacity="${labelOp}">${escapeXml(item.label)}</text>`);
        if (item.sublabel) {
          parts.push(`<text x="${item.cx}" y="${labelY + sublabelSize * 1.3}" text-anchor="middle" font-family="${fontStack}" font-size="${sublabelSize}" fill="${THEME.inkSoft}" opacity="${labelOp}">${escapeXml(item.sublabel)}</text>`);
        }
      }
    }
  });

  // scene fade in/out via bg-colored overlay
  const fadeIn = 1 - clamp01(t / 0.35);
  const fadeOut = clamp01((t - (duration - 0.35)) / 0.35);
  const fade = Math.max(fadeIn, fadeOut);
  if (fade > 0.001) {
    parts.push(`<rect width="${width}" height="${height}" fill="${THEME.bg}" opacity="${fade}"/>`);
  }

  return `<svg width="${width}" height="${height}" xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink">${parts.join('\n')}</svg>`;
}

/** Render a full whiteboard scene to an mp4 clip by piping frames into ffmpeg. */
async function renderWhiteboardSceneClip({ slide, iconBuffers, width, height, duration, outputPath, seed }) {
  const plan = buildScenePlan(slide, width, height, seed);
  const iconGeometry = plan.items.map((_, i) => parseIconGeometry(iconBuffers[i]));

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
      else reject(new Error(`ffmpeg (whiteboard scene) exited ${code}: ${stderr.slice(-1500)}`));
    });

    (async () => {
      for (let f = 0; f < frameCount; f++) {
        const t = f / FPS;
        const svg = buildFrameSvg({ slide, plan, iconGeometry, width, height, t, duration });
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

module.exports = { renderWhiteboardSceneClip, buildFrameSvg, buildScenePlan, parseIconGeometry, THEME };
