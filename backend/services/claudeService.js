const fetch = require('node-fetch');

const CLAUDE_API_URL = 'https://api.anthropic.com/v1/messages';
const CLAUDE_MODEL = 'claude-sonnet-5';

function buildPrompt(courseTitle, courseContent, animationStyle) {
  return `You are a scriptwriter for animated explainer videos. Convert the following course content into a scene-by-scene video script for a "${animationStyle}" style animation.

Course Title: ${courseTitle}

Course Content:
${courseContent}

Break the content into logical scenes (one per major topic/heading/paragraph). Each scene is a clean presentation-style slide with icons, labels, and diagrams — like a professional explainer video. Respond with ONLY valid JSON matching this exact shape, no markdown fences, no commentary:

{
  "scenes": [
    {
      "sceneNumber": 1,
      "duration": 10,
      "narration": "text to speak",
      "sceneType": "slide",
      "slide": {
        "title": "DNS",
        "subtitle": "Domain Name System",
        "layout": "split",
        "sections": [
          {
            "heading": "Computers",
            "items": [
              { "icon": "desktop computer", "label": "192.168.1.1", "sublabel": "" }
            ]
          }
        ]
      },
      "textOverlays": ["short headline"],
      "imageKeywords": "",
      "iconKeyword": "",
      "transitions": "fade"
    }
  ]
}

Layout guide (pick per scene):
- "grid": one group of related concepts, 1 section with 1-4 items.
- "split": a comparison or two sides of an idea, exactly 2 sections with 1-4 items each.
- "flow": a step-by-step process, 1 section with 2-5 items shown left-to-right with numbered arrows.

Rules:
- Use at most 10 scenes; merge minor topics together rather than exceeding 10.
- sceneType is "slide" for almost every scene. Use "photo" ONLY for an intro or outro scene where a real photograph helps; then fill imageKeywords (concrete photographable subject) and iconKeyword instead of slide, and put a headline in textOverlays[0].
- slide.title: max 3 words, punchy. slide.subtitle: max 5 words.
- item.icon: 1-3 generic words that will match a tech icon library (e.g. "server", "laptop", "globe network", "email", "shield lock", "database"). item.label: max 20 chars. item.sublabel: optional detail, max 24 chars.
- Every item label must be meaningful (a name, number, or term from the content — never "item 1").
- narration should be conversational and roughly match the scene duration (about 2.5 words per second).
- narration is read aloud by a text-to-speech voice, so write for the ear: short sentences with commas for natural pauses. Never dump raw technical strings — introduce them ("the address one ninety-two dot one sixty-eight dot one dot one"), give numbers room to breathe, and spell acronyms that are spoken letter-by-letter with spaces on first use (e.g. "D N S"). Avoid parentheses, slashes, and symbols in narration.`;
}

function extractJson(text) {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const raw = fenced ? fenced[1] : text;
  const start = raw.indexOf('{');
  const end = raw.lastIndexOf('}');
  if (start === -1 || end === -1) {
    throw new Error('Claude response did not contain JSON');
  }
  return JSON.parse(raw.slice(start, end + 1));
}

async function generateScript(courseTitle, courseContent, animationStyle) {
  const apiKey = process.env.CLAUDE_API_KEY;
  if (!apiKey) {
    throw new Error('CLAUDE_API_KEY is not set');
  }

  const response = await fetch(CLAUDE_API_URL, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model: CLAUDE_MODEL,
      max_tokens: 16000,
      messages: [
        {
          role: 'user',
          content: buildPrompt(courseTitle, courseContent, animationStyle),
        },
      ],
    }),
  });

  if (!response.ok) {
    const errText = await response.text();
    throw new Error(`Claude API error (${response.status}): ${errText}`);
  }

  const data = await response.json();
  if (data.stop_reason === 'max_tokens') {
    throw new Error('Script generation was cut off (course content too long) — try splitting the course into smaller parts');
  }
  const text = data.content?.map((block) => block.text || '').join('') || '';
  const parsed = extractJson(text);

  if (!Array.isArray(parsed.scenes)) {
    throw new Error('Claude response missing "scenes" array');
  }

  return parsed;
}

module.exports = { generateScript };
