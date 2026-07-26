const fs = require('fs');
const path = require('path');
const fetch = require('node-fetch');

const USER_AGENT = 'AI-Explainer-Video-Generator/1.0 (local educational tool)';

// --- Source 1: Pexels (requires PEXELS_API_KEY, best quality photos) ---
async function searchPexels(query) {
  const apiKey = process.env.PEXELS_API_KEY;
  if (!apiKey) return null;

  const url = `https://api.pexels.com/v1/search?query=${encodeURIComponent(query)}&per_page=3&orientation=landscape`;
  const res = await fetch(url, { headers: { Authorization: apiKey } });
  if (!res.ok) return null;

  const data = await res.json();
  const photo = data.photos && data.photos[0];
  return photo ? photo.src.large2x || photo.src.large : null;
}

// --- Source 2: Openverse (no key, openly licensed images) ---
async function searchOpenverse(query) {
  const url = `https://api.openverse.org/v1/images/?q=${encodeURIComponent(query)}&page_size=5&license_type=commercial,modification`;
  const res = await fetch(url, { headers: { 'User-Agent': USER_AGENT } });
  if (!res.ok) return null;

  const data = await res.json();
  const results = (data.results || []).filter((r) => {
    const ext = (r.url || '').split('.').pop().toLowerCase().split('?')[0];
    return ['jpg', 'jpeg', 'png', 'webp'].includes(ext);
  });
  return results.length ? results[0].url : null;
}

// --- Source 3: Wikimedia Commons (no key, great for technical diagrams) ---
async function searchWikimedia(query) {
  const params = new URLSearchParams({
    action: 'query',
    generator: 'search',
    gsrsearch: `filetype:bitmap ${query}`,
    gsrnamespace: '6',
    gsrlimit: '5',
    prop: 'imageinfo',
    iiprop: 'url|mime',
    iiurlwidth: '1600',
    format: 'json',
  });
  const res = await fetch(`https://commons.wikimedia.org/w/api.php?${params}`, {
    headers: { 'User-Agent': USER_AGENT },
  });
  if (!res.ok) return null;

  const data = await res.json();
  const pages = data.query && data.query.pages ? Object.values(data.query.pages) : [];
  for (const page of pages) {
    const info = page.imageinfo && page.imageinfo[0];
    if (info && info.mime && ['image/jpeg', 'image/png'].includes(info.mime)) {
      return info.thumburl || info.url;
    }
  }
  return null;
}

// a "stroke icon" set (tabler/lucide) can still contain individual filled
// glyphs (fill="#..." with no stroke) — those render as solid blobs and
// can't be progressively drawn via stroke-dasharray, so callers that need
// a genuine outline (e.g. the whiteboard style) should reject those
function isStrokeSvg(svgText) {
  return svgText.includes('fill="none"') && /stroke="(?!none")[^"]/.test(svgText);
}

// --- Iconify (no key): find a tech icon SVG for a keyword ---
async function fetchIcon(keyword, options = {}) {
  const color = (options.color || '#ffffff').replace('#', '%23');
  const size = options.size || 180;
  // restrict to outline/line icon families for the light "Animated Explainer" look
  const prefixes = options.prefixes || ['tabler', 'lucide', 'ph', 'solar', 'hugeicons'];
  const prefixParam = options.outline ? `&prefixes=${prefixes.join(',')}` : '';
  const limit = options.requireStroke ? 8 : 5;
  try {
    let searchRes = await fetch(
      `https://api.iconify.design/search?query=${encodeURIComponent(keyword)}&limit=${limit}${prefixParam}`,
      { headers: { 'User-Agent': USER_AGENT } },
    );
    if (!searchRes.ok) return null;
    let searchData = await searchRes.json();
    let candidates = searchData.icons || [];

    // outline sets didn't have it — fall back to any icon set
    if (!candidates.length && prefixParam) {
      searchRes = await fetch(
        `https://api.iconify.design/search?query=${encodeURIComponent(keyword)}&limit=${limit}`,
        { headers: { 'User-Agent': USER_AGENT } },
      );
      if (!searchRes.ok) return null;
      searchData = await searchRes.json();
      candidates = searchData.icons || [];
    }
    if (!candidates.length) return null;

    // try each candidate in ranked order until one actually satisfies the
    // caller's requirements, instead of committing to the first match
    for (const icon of candidates) {
      const [prefix, name] = icon.split(':');
      const svgRes = await fetch(
        `https://api.iconify.design/${prefix}/${name}.svg?color=${color}&width=${size}&height=${size}`,
        { headers: { 'User-Agent': USER_AGENT } },
      );
      if (!svgRes.ok) continue;
      const svg = await svgRes.text();
      if (!svg.startsWith('<svg')) continue;
      if (options.requireStroke && !isStrokeSvg(svg)) continue;
      return Buffer.from(svg);
    }
    return null;
  } catch {
    return null;
  }
}

async function downloadImage(url, outputPath) {
  const res = await fetch(url, { headers: { 'User-Agent': USER_AGENT }, timeout: 30000 });
  if (!res.ok) throw new Error(`Image download failed (${res.status}): ${url}`);
  const buffer = await res.buffer();
  fs.writeFileSync(outputPath, buffer);
  return outputPath;
}

/**
 * Try each source in order until one returns a usable image.
 * Returns the local file path, or null if nothing was found.
 */
async function fetchImageForScene(keywords, outputDir, sceneNumber) {
  const query = Array.isArray(keywords) ? keywords.join(' ') : String(keywords || '');
  if (!query.trim()) return null;

  const sources = [searchPexels, searchOpenverse, searchWikimedia];
  for (const source of sources) {
    try {
      const url = await source(query);
      if (!url) continue;
      const ext = url.split('.').pop().toLowerCase().split('?')[0];
      const safeExt = ['jpg', 'jpeg', 'png', 'webp'].includes(ext) ? ext : 'jpg';
      const outputPath = path.join(outputDir, `scene_${sceneNumber}_bg.${safeExt}`);
      await downloadImage(url, outputPath);
      return outputPath;
    } catch (err) {
      console.warn(`[imageService] ${source.name} failed for "${query}": ${err.message}`);
    }
  }
  return null;
}

module.exports = { fetchImageForScene, fetchIcon, downloadImage };
