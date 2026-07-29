const fetch = require('node-fetch');

const CLAUDE_API_URL = 'https://api.anthropic.com/v1/messages';
const CLAUDE_MODEL = 'claude-sonnet-5';

function buildPrompt(courseTitle, courseContent, animationStyle, targetDurationMinutes, contentDepth) {
  const isDeepDive = contentDepth === 'deep-dive';
  const targetSeconds = targetDurationMinutes ? targetDurationMinutes * 60 : null;
  const targetWords = targetSeconds ? Math.round(targetSeconds * 2.5) : null;
  // ~12s/scene is the natural pace elsewhere in this prompt (2.5 words/sec,
  // typical scene narration) — scale scene count to the requested runtime
  // instead of leaving it at the flat default of 10 regardless of length.
  const baseMaxScenes = targetSeconds ? Math.max(3, Math.min(24, Math.round(targetSeconds / 12))) : 10;
  // Deep Dive is allowed to run past the selected target (decided: richer
  // content and the mandatory quiz scene take priority over hitting the
  // exact target length), so give it real headroom above the normal cap.
  const maxScenes = isDeepDive ? Math.min(32, baseMaxScenes + 8) : baseMaxScenes;

  const targetLengthNote = targetSeconds
    ? isDeepDive
      ? `\nTarget video length: approximately ${targetDurationMinutes} minute${targetDurationMinutes === 1 ? '' : 's'} (~${targetSeconds} seconds, ~${targetWords} words of narration). This is a Deep Dive video, so treat this as a floor, not a ceiling — it's fine to run longer if the added examples and the closing quiz scene need the room. Don't pad artificially, but don't compress good detail just to hit the target either.\n`
      : `\nTarget video length: approximately ${targetDurationMinutes} minute${targetDurationMinutes === 1 ? '' : 's'} (~${targetSeconds} seconds, ~${targetWords} words of narration total across all scenes). Pace scene count and narration length to hit this target — pad with more detail/examples from the content if it's short of the target, or condense/merge scenes if the content would otherwise run long.\n`
    : '';

  const layoutGuide = `Layout guide (pick per scene):
- "grid": one group of related concepts, 1 section with 1-4 items.
- "split": a comparison or two sides of an idea, exactly 2 sections with 1-4 items each.
- "flow": a step-by-step process, 1 section with 2-5 items shown left-to-right with numbered arrows.${
    isDeepDive
      ? `\n- "quiz": ONLY for the mandatory final recap scene (see rules below) — no sections/items, use a "quiz" object instead.`
      : ''
  }`;

  const deepDiveExampleRule = isDeepDive
    ? `\n- For each major concept, weave in one concrete, technically plausible illustrative example (a sample request/response, a realistic data snippet, a representative numeric breakdown, a worked scenario) grounded in your own subject-matter knowledge of the topic. These make abstract ideas concrete. Do NOT claim an example is drawn from the provided course content unless it clearly is — these are illustrative aids you're constructing, not quoted material, and narration should never overstate their authenticity.\n- The FINAL scene MUST be a recap quiz: sceneType "slide", slide.layout "quiz", with a "quiz" object instead of "sections": { "question": "...", "choices": [{ "text": "...", "correct": true }, { "text": "...", "correct": false }, ...] } — 2 to 4 choices, exactly one with "correct": true. The narration for this scene should pose the question aloud, name each choice, then reveal and explain why the correct answer is correct — written conversationally, like the rest of the narration.`
    : '';

  return `You are a scriptwriter for animated explainer videos. Convert the following course content into a scene-by-scene video script for a "${animationStyle}" style animation.

Course Title: ${courseTitle}

Course Content:
${courseContent}
${targetLengthNote}

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

${layoutGuide}

Rules:
- Use at most ${maxScenes} scenes; merge minor topics together rather than exceeding that.
- sceneType is "slide" for almost every scene. Use "photo" ONLY for an intro or outro scene where a real photograph helps; then fill imageKeywords (concrete photographable subject) and iconKeyword instead of slide, and put a headline in textOverlays[0].
- slide.title: max 3 words, must directly name the concept being taught (e.g. "OSI Model", "DNS Lookup", "TCP Handshake") — never a metaphorical, poetic, or vague phrase (e.g. NOT "The Language Machines Speak"). slide.subtitle: max 5 words.
- item.icon: 1-3 generic words that will match a tech icon library (e.g. "server", "laptop", "globe network", "email", "shield lock", "database"). item.label: max 20 chars. item.sublabel: optional detail, max 24 chars.
- Every item label must be meaningful (a name, number, or term from the content — never "item 1").
- narration should be conversational and roughly match the scene duration (about 2.5 words per second).
- narration is read aloud by a text-to-speech voice, so write for the ear: short sentences with commas for natural pauses. Never dump raw technical strings — introduce them ("the address one ninety-two dot one sixty-eight dot one dot one"), give numbers room to breathe, and spell acronyms that are spoken letter-by-letter with spaces on first use (e.g. "D N S"). Avoid parentheses, slashes, and symbols in narration.${deepDiveExampleRule}`;
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

async function generateScript(courseTitle, courseContent, animationStyle, targetDurationMinutes, contentDepth) {
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
      // Deep Dive allows more scenes (up to 32 vs 24), so give the response
      // more room before it risks getting cut off mid-JSON.
      max_tokens: contentDepth === 'deep-dive' ? 24000 : 16000,
      messages: [
        {
          role: 'user',
          content: buildPrompt(courseTitle, courseContent, animationStyle, targetDurationMinutes, contentDepth),
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
