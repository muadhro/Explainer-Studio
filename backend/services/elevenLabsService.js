const fs = require('fs');
const fetch = require('node-fetch');

const ELEVENLABS_API_URL = 'https://api.elevenlabs.io/v1';
// "Alice - Clear, Engaging Educator" — a premade voice available on all plans
// (library voices like Rachel are blocked on the free tier's API).
const DEFAULT_VOICE_ID = 'Xb7hH8MSUJpSbSDYk0k2';

/**
 * Rewrite technical strings so the TTS reads them clearly instead of
 * rushing through them ("192.168.1.1" -> "192 dot 168 dot 1 dot 1").
 */
function makeTtsFriendly(text) {
  let out = String(text);

  // IP addresses: speak each octet with "dot" and slight pauses
  out = out.replace(/\b(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})\b/g, '$1 dot $2 dot $3 dot $4');

  // domain names: "google.com" -> "google dot com" (also www. prefix)
  out = out.replace(/\bwww\./gi, 'w w w dot ');
  out = out.replace(/\b([a-z0-9-]+)\.(com|net|org|io|dev|co|edu|gov|ai)\b/gi, '$1 dot $2');

  // slashes and other symbols the voice tends to swallow
  out = out.replace(/(\d)\/(\d)/g, '$1 slash $2');
  out = out.replace(/\s*->\s*/g, ' to ');
  out = out.replace(/\s*&\s*/g, ' and ');

  // collapse whitespace
  return out.replace(/\s{2,}/g, ' ').trim();
}

async function generateVoiceover(text, outputPath, voiceId) {
  if (!voiceId) {
    voiceId = process.env.ELEVENLABS_VOICE_ID || DEFAULT_VOICE_ID;
  }
  text = makeTtsFriendly(text);
  const apiKey = process.env.ELEVENLABS_API_KEY;
  if (!apiKey) {
    throw new Error('ELEVENLABS_API_KEY is not set');
  }

  const response = await fetch(`${ELEVENLABS_API_URL}/text-to-speech/${voiceId}`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      accept: 'audio/mpeg',
      'xi-api-key': apiKey,
    },
    body: JSON.stringify({
      text,
      model_id: 'eleven_multilingual_v2',
      // higher stability = steadier, clearer delivery for instructional content
      voice_settings: { stability: 0.65, similarity_boost: 0.8, style: 0.15 },
    }),
  });

  if (!response.ok) {
    const errText = await response.text();
    throw new Error(`ElevenLabs API error (${response.status}): ${errText}`);
  }

  const buffer = await response.buffer();
  fs.writeFileSync(outputPath, buffer);
  return outputPath;
}

/**
 * Group ElevenLabs' character-level alignment into word-level {text, start, end}
 * timings (seconds), splitting on whitespace in the exact text that was spoken.
 */
function wordTimingsFromAlignment(alignment) {
  const chars = alignment.characters || [];
  const starts = alignment.character_start_times_seconds || [];
  const ends = alignment.character_end_times_seconds || [];
  const words = [];
  let cur = '';
  let curStart = null;

  for (let i = 0; i < chars.length; i++) {
    const ch = chars[i];
    if (/\s/.test(ch)) {
      if (cur) {
        words.push({ text: cur, start: curStart, end: ends[i - 1] });
        cur = '';
        curStart = null;
      }
      continue;
    }
    if (curStart === null) curStart = starts[i];
    cur += ch;
  }
  if (cur) words.push({ text: cur, start: curStart, end: ends[chars.length - 1] });

  return words;
}

/**
 * Same as generateVoiceover, but requests per-character timing alignment so
 * callers can derive word-level start/end times for burned-in captions —
 * synced to the real TTS pacing rather than an estimated words-per-second rate.
 */
async function generateVoiceoverWithTimestamps(text, outputPath, voiceId) {
  if (!voiceId) {
    voiceId = process.env.ELEVENLABS_VOICE_ID || DEFAULT_VOICE_ID;
  }
  text = makeTtsFriendly(text);
  const apiKey = process.env.ELEVENLABS_API_KEY;
  if (!apiKey) {
    throw new Error('ELEVENLABS_API_KEY is not set');
  }

  const response = await fetch(`${ELEVENLABS_API_URL}/text-to-speech/${voiceId}/with-timestamps`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      accept: 'application/json',
      'xi-api-key': apiKey,
    },
    body: JSON.stringify({
      text,
      model_id: 'eleven_multilingual_v2',
      voice_settings: { stability: 0.65, similarity_boost: 0.8, style: 0.15 },
    }),
  });

  if (!response.ok) {
    const errText = await response.text();
    throw new Error(`ElevenLabs API error (${response.status}): ${errText}`);
  }

  const data = await response.json();
  fs.writeFileSync(outputPath, Buffer.from(data.audio_base64, 'base64'));

  const words = data.alignment ? wordTimingsFromAlignment(data.alignment) : [];
  return { path: outputPath, words };
}

let voicesCache = { at: 0, voices: null };

/** List the account's available voices (cached 10 min). */
async function listVoices() {
  if (voicesCache.voices && Date.now() - voicesCache.at < 10 * 60 * 1000) {
    return voicesCache.voices;
  }

  const apiKey = process.env.ELEVENLABS_API_KEY;
  if (!apiKey) throw new Error('ELEVENLABS_API_KEY is not set');

  const response = await fetch(`${ELEVENLABS_API_URL}/voices`, {
    headers: { 'xi-api-key': apiKey },
  });
  if (!response.ok) {
    throw new Error(`ElevenLabs voices error (${response.status})`);
  }

  const data = await response.json();
  const voices = (data.voices || []).map((v) => {
    const [shortName, description] = String(v.name || '').split(' - ');
    return {
      id: v.voice_id,
      name: shortName || v.name,
      description: description || v.labels?.description || '',
      gender: v.labels?.gender || 'unknown',
      accent: v.labels?.accent || '',
      previewUrl: v.preview_url || null,
    };
  });

  voicesCache = { at: Date.now(), voices };
  return voices;
}

module.exports = { generateVoiceover, generateVoiceoverWithTimestamps, makeTtsFriendly, listVoices, DEFAULT_VOICE_ID };
