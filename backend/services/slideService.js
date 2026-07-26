const sharp = require('sharp');

// Slide color themes per animation style. The slide look mimics clean
// presentation graphics: solid background, bold title header, labeled icons.
const SLIDE_THEMES = {
  'Motion Graphics': {
    bgTop: '#2e5a82',
    bgBottom: '#1d3c59',
    title: '#ffffff',
    subtitle: '#8fd6f0',
    heading: '#ffffff',
    label: '#7ce87c',
    sublabel: '#c9d9e8',
    icon: '#eaf3fb',
    arrow: '#ffd24d',
    divider: 'rgba(255,255,255,0.35)',
    dots: ['#ffffff', '#e63946', '#f0c14b', '#4fc3f7'],
  },
  'Flat Design 2D': {
    bgTop: '#264653',
    bgBottom: '#1b333d',
    title: '#ffffff',
    subtitle: '#e9c46a',
    heading: '#f1faee',
    label: '#a8e6a1',
    sublabel: '#cfe0dc',
    icon: '#f1faee',
    arrow: '#e76f51',
    divider: 'rgba(255,255,255,0.3)',
    dots: ['#e9c46a', '#e76f51', '#2a9d8f', '#f1faee'],
  },
  'Kinetic Typography': {
    bgTop: '#17171f',
    bgBottom: '#0d0d13',
    title: '#ffffff',
    subtitle: '#f0c14b',
    heading: '#f0c14b',
    label: '#ffffff',
    sublabel: '#9aa2b1',
    icon: '#f0c14b',
    arrow: '#f0c14b',
    divider: 'rgba(255,255,255,0.3)',
    dots: ['#f0c14b', '#ffffff', '#4f7cff', '#f87171'],
  },
};

function getTheme(animationStyle) {
  return SLIDE_THEMES[animationStyle] || SLIDE_THEMES['Motion Graphics'];
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

/** Validate/truncate a Deep Dive recap-quiz slide (its own shape — no sections/items). */
function normalizeQuizSlide(slide) {
  const quiz = slide.quiz || {};
  const question = String(quiz.question || '').slice(0, 90);
  let choices = (Array.isArray(quiz.choices) ? quiz.choices : [])
    .slice(0, 4)
    .map((c) => ({ text: String((c && c.text) || '').slice(0, 40), correct: Boolean(c && c.correct) }))
    .filter((c) => c.text);

  if (!question || choices.length < 2) return null;

  // exactly one correct choice — coerce rather than reject the whole slide
  // over a malformed flag from Claude (matches this function's usual
  // truncate-and-continue philosophy elsewhere)
  const correctCount = choices.filter((c) => c.correct).length;
  if (correctCount !== 1) {
    const firstCorrectIndex = choices.findIndex((c) => c.correct);
    const keepIndex = firstCorrectIndex === -1 ? 0 : firstCorrectIndex;
    choices = choices.map((c, i) => ({ ...c, correct: i === keepIndex }));
  }

  return {
    title: String(slide.title || 'Quick Recap').slice(0, 30),
    subtitle: String(slide.subtitle || '').slice(0, 40),
    layout: 'quiz',
    sections: [],
    quiz: { question, choices },
  };
}

/**
 * Normalize a slide spec from Claude into a bounded, render-safe shape.
 * Layouts: "grid" (one group), "split" (two compared groups), "flow" (process steps),
 * "quiz" (Deep Dive recap question — its own shape, see normalizeQuizSlide).
 */
function normalizeSlide(slide) {
  const layout = ['grid', 'split', 'flow', 'quiz'].includes(slide.layout) ? slide.layout : 'grid';
  if (layout === 'quiz') return normalizeQuizSlide(slide);

  let sections = Array.isArray(slide.sections) ? slide.sections : [];
  sections = sections.slice(0, layout === 'split' ? 2 : 1).map((s) => ({
    heading: String(s.heading || '').slice(0, 28),
    items: (Array.isArray(s.items) ? s.items : []).slice(0, layout === 'flow' ? 5 : 4).map((it) => ({
      icon: String(it.icon || 'circle').slice(0, 40),
      label: String(it.label || '').slice(0, 26),
      sublabel: String(it.sublabel || '').slice(0, 30),
    })),
  }));
  if (!sections.length || !sections.some((s) => s.items.length)) return null;

  return {
    title: String(slide.title || '').slice(0, 30),
    subtitle: String(slide.subtitle || '').slice(0, 40),
    layout,
    sections,
  };
}

/** Flatten items with computed positions for a given canvas size. */
function computeLayout(slide, width, height) {
  const margin = width * 0.06;
  const contentTop = height * 0.26;
  const contentBottom = height * 0.94;
  const positioned = [];

  const placeGrid = (items, x0, x1, headingY) => {
    const areaW = x1 - x0;
    const cols = items.length <= 2 ? items.length : items.length === 4 ? 2 : Math.min(3, items.length);
    const rows = Math.ceil(items.length / cols);
    const areaTop = headingY + height * 0.04;
    const cellW = areaW / cols;
    const cellH = (contentBottom - areaTop) / rows;
    const iconSize = Math.min(height * 0.2, cellW * 0.42, cellH * 0.5);

    items.forEach((item, i) => {
      const row = Math.floor(i / cols);
      const colsInRow = Math.min(cols, items.length - row * cols);
      const rowOffset = (cols - colsInRow) * cellW * 0.5; // center a short last row
      const col = i - row * cols;
      positioned.push({
        ...item,
        cx: x0 + rowOffset + cellW * (col + 0.5),
        cy: areaTop + cellH * (row + 0.42),
        iconSize,
      });
    });
  };

  if (slide.layout === 'split' && slide.sections.length === 2) {
    const midX = width / 2;
    slide.sections.forEach((section, si) => {
      const x0 = si === 0 ? margin : midX + margin * 0.5;
      const x1 = si === 0 ? midX - margin * 0.5 : width - margin;
      placeGrid(section.items, x0, x1, contentTop);
    });
  } else if (slide.layout === 'flow') {
    const items = slide.sections[0].items;
    const areaW = width - margin * 2;
    const cellW = areaW / items.length;
    const iconSize = Math.min(height * 0.19, cellW * 0.45);
    items.forEach((item, i) => {
      positioned.push({
        ...item,
        cx: margin + cellW * (i + 0.5),
        cy: height * 0.52,
        iconSize,
        flowIndex: i,
      });
    });
  } else {
    placeGrid(slide.sections[0].items, margin, width - margin, contentTop);
  }

  return positioned;
}

/** Decorative dot grid in the top-right corner (like polished slide templates). */
function dotDecoration(width, height, theme) {
  const dots = [];
  const r = width * 0.006;
  const gap = width * 0.018;
  const x0 = width - gap * 5.2;
  const y0 = height * 0.035;
  for (let row = 0; row < 4; row++) {
    for (let col = 0; col < 5; col++) {
      const color = theme.dots[(row * 5 + col) % theme.dots.length];
      dots.push(`<circle cx="${x0 + col * gap}" cy="${y0 + row * gap}" r="${r}" fill="${color}"/>`);
    }
  }
  return dots.join('');
}

/**
 * Render the Deep Dive recap-quiz slide: question + answer choices, correct
 * one highlighted with a checkmark. No items/icons — shown all at once
 * (there's no natural "reveal step" progression for a quiz card).
 */
async function renderQuizStill({ slide, theme, width, height, outputPath }) {
  const margin = width * 0.08;
  const titleSize = Math.round(height * 0.08);
  const questionSize = Math.round(height * 0.048);
  const choiceSize = Math.round(height * 0.038);
  const parts = [];

  parts.push(`<text x="${width / 2}" y="${height * 0.14}" text-anchor="middle" font-family="Segoe UI, Arial, sans-serif" font-size="${titleSize}" font-weight="800" fill="${theme.title}">${escapeXml(slide.title)}</text>`);
  parts.push(dotDecoration(width, height, theme));

  const questionLines = wrapText(slide.quiz.question, Math.floor((width - margin * 2) / (questionSize * 0.52)));
  const qStartY = height * 0.26;
  const qLineGap = questionSize * 1.3;
  questionLines.forEach((line, i) => {
    parts.push(`<text x="${width / 2}" y="${qStartY + i * qLineGap}" text-anchor="middle" font-family="Segoe UI, Arial, sans-serif" font-size="${questionSize}" font-weight="700" fill="${theme.heading}">${escapeXml(line)}</text>`);
  });

  const choicesTop = qStartY + questionLines.length * qLineGap + height * 0.06;
  const choiceH = height * 0.11;
  const choiceGap = height * 0.025;
  const choiceW = width - margin * 2;

  slide.quiz.choices.forEach((choice, i) => {
    const y = choicesTop + i * (choiceH + choiceGap);
    parts.push(`<rect x="${margin}" y="${y}" width="${choiceW}" height="${choiceH}" rx="${choiceH * 0.22}" fill="${choice.correct ? 'rgba(124,232,124,0.16)' : 'rgba(255,255,255,0.06)'}" stroke="${choice.correct ? theme.label : theme.divider}" stroke-width="${choice.correct ? 3 : 1.5}"/>`);
    parts.push(`<text x="${margin + width * 0.03}" y="${y + choiceH * 0.62}" font-family="Segoe UI, Arial, sans-serif" font-size="${choiceSize}" font-weight="700" fill="${theme.label}">${escapeXml(choice.text)}</text>`);
    if (choice.correct) {
      const cx = margin + choiceW - width * 0.045;
      const cy = y + choiceH / 2;
      const s = choiceH * 0.22;
      parts.push(`<polyline points="${cx - s},${cy} ${cx - s * 0.25},${cy + s * 0.7} ${cx + s},${cy - s * 0.8}" fill="none" stroke="${theme.label}" stroke-width="${Math.max(3, s * 0.22)}" stroke-linecap="round" stroke-linejoin="round"/>`);
    }
  });

  const svg = Buffer.from(`<svg width="${width}" height="${height}" xmlns="http://www.w3.org/2000/svg">
  <defs><linearGradient id="bg" x1="0" y1="0" x2="0" y2="1">
    <stop offset="0" stop-color="${theme.bgTop}"/><stop offset="1" stop-color="${theme.bgBottom}"/>
  </linearGradient></defs>
  <rect width="${width}" height="${height}" fill="url(#bg)"/>
  ${parts.join('\n  ')}
</svg>`);

  await sharp(svg).png().toFile(outputPath);
  return outputPath;
}

/**
 * Render one still of the slide with the first `visibleCount` items shown.
 * Icons are composited by sharp separately (SVG buffers from Iconify).
 */
async function renderSlideStill({ slide, iconBuffers, theme, width, height, visibleCount, outputPath }) {
  if (slide.layout === 'quiz') {
    return renderQuizStill({ slide, theme, width, height, outputPath });
  }

  const items = computeLayout(slide, width, height);
  const visible = items.slice(0, visibleCount);

  const margin = width * 0.06;
  const titleSize = Math.round(height * 0.085);
  const subtitleSize = Math.round(height * 0.05);
  const headingSize = Math.round(height * 0.042);
  const labelSize = Math.round(height * 0.036);
  const sublabelSize = Math.round(height * 0.028);

  const titleWidth = slide.title.length * titleSize * 0.62;
  const parts = [];

  // Header: bold underlined title + colored subtitle
  parts.push(`<text x="${margin}" y="${height * 0.135}" font-family="Segoe UI, Arial, sans-serif" font-size="${titleSize}" font-weight="800" fill="${theme.title}">${escapeXml(slide.title)}</text>`);
  parts.push(`<rect x="${margin}" y="${height * 0.155}" width="${Math.max(titleWidth, width * 0.06)}" height="${height * 0.008}" fill="${theme.title}"/>`);
  if (slide.subtitle) {
    parts.push(`<text x="${margin + titleWidth + width * 0.025}" y="${height * 0.13}" font-family="Segoe UI, Arial, sans-serif" font-size="${subtitleSize}" font-weight="700" font-style="italic" fill="${theme.subtitle}">${escapeXml(slide.subtitle.toUpperCase())}</text>`);
  }
  parts.push(dotDecoration(width, height, theme));

  // Section headings (appear when the section has a visible item)
  if (slide.layout === 'split' && slide.sections.length === 2) {
    const firstCount = slide.sections[0].items.length;
    const headingXs = [width * 0.27, width * 0.73];
    slide.sections.forEach((section, si) => {
      const sectionVisible = si === 0 ? visibleCount > 0 : visibleCount > firstCount;
      if (section.heading && sectionVisible) {
        parts.push(`<text x="${headingXs[si]}" y="${height * 0.26}" text-anchor="middle" font-family="Segoe UI, Arial, sans-serif" font-size="${headingSize}" font-weight="700" letter-spacing="2" fill="${theme.heading}">${escapeXml(section.heading.toUpperCase())}</text>`);
      }
    });
    parts.push(`<line x1="${width / 2}" y1="${height * 0.24}" x2="${width / 2}" y2="${height * 0.9}" stroke="${theme.divider}" stroke-width="2"/>`);
  } else if (slide.sections[0].heading && visibleCount > 0) {
    parts.push(`<text x="${margin + width * 0.01}" y="${height * 0.26}" font-family="Segoe UI, Arial, sans-serif" font-size="${headingSize}" font-weight="700" letter-spacing="2" fill="${theme.heading}">${escapeXml(slide.sections[0].heading.toUpperCase())}</text>`);
  }

  // Flow arrows between consecutive visible items, numbered
  if (slide.layout === 'flow') {
    for (let i = 1; i < visible.length; i++) {
      const a = items[i - 1];
      const b = items[i];
      const y = a.cy;
      const x1 = a.cx + a.iconSize * 0.75;
      const x2 = b.cx - b.iconSize * 0.75;
      const ah = height * 0.012;
      parts.push(`<line x1="${x1}" y1="${y}" x2="${x2 - ah * 1.5}" y2="${y}" stroke="${theme.arrow}" stroke-width="${height * 0.007}"/>`);
      parts.push(`<polygon points="${x2},${y} ${x2 - ah * 2},${y - ah} ${x2 - ah * 2},${y + ah}" fill="${theme.arrow}"/>`);
      parts.push(`<text x="${(x1 + x2) / 2}" y="${y - height * 0.03}" text-anchor="middle" font-family="Segoe UI, Arial, sans-serif" font-size="${labelSize}" font-weight="700" fill="${theme.arrow}">${i}</text>`);
    }
  }

  // Labels under each visible item (icon itself composited separately)
  const layers = [];
  visible.forEach((item, i) => {
    const labelY = item.cy + item.iconSize * 0.72 + labelSize;
    if (item.label) {
      parts.push(`<text x="${item.cx}" y="${labelY}" text-anchor="middle" font-family="Segoe UI, Arial, sans-serif" font-size="${labelSize}" font-weight="700" fill="${theme.label}">${escapeXml(item.label)}</text>`);
    }
    if (item.sublabel) {
      parts.push(`<text x="${item.cx}" y="${labelY + sublabelSize * 1.3}" text-anchor="middle" font-family="Segoe UI, Arial, sans-serif" font-size="${sublabelSize}" fill="${theme.sublabel}">${escapeXml(item.sublabel)}</text>`);
    }
    if (!iconBuffers[i]) {
      // fallback: rounded tile with the label's first letter
      const s = item.iconSize;
      parts.push(`<rect x="${item.cx - s / 2}" y="${item.cy - s / 2}" width="${s}" height="${s}" rx="${s * 0.18}" fill="rgba(255,255,255,0.12)" stroke="${theme.icon}" stroke-width="3"/>`);
      parts.push(`<text x="${item.cx}" y="${item.cy + s * 0.16}" text-anchor="middle" font-family="Segoe UI, Arial, sans-serif" font-size="${s * 0.45}" font-weight="800" fill="${theme.icon}">${escapeXml((item.label || '?')[0].toUpperCase())}</text>`);
    }
  });

  const baseSvg = Buffer.from(`<svg width="${width}" height="${height}" xmlns="http://www.w3.org/2000/svg">
  <defs><linearGradient id="bg" x1="0" y1="0" x2="0" y2="1">
    <stop offset="0" stop-color="${theme.bgTop}"/><stop offset="1" stop-color="${theme.bgBottom}"/>
  </linearGradient></defs>
  <rect width="${width}" height="${height}" fill="url(#bg)"/>
  ${parts.join('\n  ')}
</svg>`);

  // Rasterize icons and composite them at their positions
  for (let i = 0; i < visible.length; i++) {
    const item = visible[i];
    if (!iconBuffers[i]) continue;
    try {
      const size = Math.round(item.iconSize);
      const iconPng = await sharp(iconBuffers[i]).resize(size, size, { fit: 'contain' }).png().toBuffer();
      layers.push({ input: iconPng, top: Math.round(item.cy - size / 2), left: Math.round(item.cx - size / 2) });
    } catch {
      /* fallback tile already drawn */
    }
  }

  await sharp(baseSvg).composite(layers).png().toFile(outputPath);
  return outputPath;
}

module.exports = { getTheme, normalizeSlide, renderSlideStill };
