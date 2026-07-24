# AI Explainer Video Generator

Turn course content (markdown or plain text) into an animated explainer video. The pipeline uses
Claude to break content into a scene-by-scene script, ElevenLabs to generate a voiceover, and
fal.ai to render the animated video, then stores everything locally in SQLite + the filesystem.

## Tech Stack

- **Frontend:** React + TypeScript + Vite
- **Backend:** Node.js + Express
- **Script generation:** Claude API
- **Text-to-speech:** ElevenLabs API
- **Scene images:** pulled from the internet — Pexels (optional key) → Openverse → Wikimedia
  Commons fallback chain, plus tech icons from Iconify (no key needed)
- **Video rendering:** local compositing with sharp + ffmpeg (default), or fal.ai API (optional)
- **Storage:** SQLite (`videos/db.sqlite`) + local filesystem (`videos/audio`, `videos/generated`)
- **Job queue:** simple in-memory FIFO queue (no Redis)

## Folder Structure

```
/
├── frontend/           React + TypeScript + Vite app
├── backend/             Express API + processing pipeline
│   ├── routes/videos.js
│   ├── services/         claudeService, elevenLabsService, falService, fileService
│   ├── queue/videoQueue.js
│   └── database/db.js
├── videos/              created at runtime: audio/, generated/, db.sqlite
├── .env.example
└── README.md
```

## 1. Getting API Keys

Required:

- **Claude API key** — create one at [console.anthropic.com](https://console.anthropic.com/settings/keys).
- **ElevenLabs API key** — sign up at [elevenlabs.io](https://elevenlabs.io), then find your key under
  Profile Settings → API Keys.

Optional:

- **Pexels API key** (free) — [pexels.com/api](https://www.pexels.com/api/). Gives higher-quality
  stock photos for scene backgrounds. Without it, images come from Openverse and Wikimedia Commons,
  which need no key at all.
- **fal.ai API key** — only needed if you set `RENDER_MODE=fal`. Note:
  `backend/services/falService.js` targets a placeholder model endpoint (`fal-ai/video-generation`) —
  swap `FAL_MODEL_ENDPOINT` for the actual fal.ai model you want and adjust the request/response
  field names to match that model's schema. The default `RENDER_MODE=local` needs no fal.ai account.

Copy `.env.example` to `.env` in the project root and fill in your keys.

## 2. Running Locally

Requires Node.js 22.5+ (the backend uses Node's built-in `node:sqlite` module, so no native
build tools or extra database dependency are required).

```bash
# Backend
cd backend
npm install
npm run dev        # starts Express on http://localhost:5000

# Frontend (in a separate terminal)
cd frontend
npm install
npm run dev         # starts Vite on http://localhost:5173
```

The Vite dev server proxies `/api/*` requests to the backend (see `frontend/vite.config.ts`), so just
open `http://localhost:5173` and use the app normally.

On first run, the backend automatically creates `videos/audio/`, `videos/generated/`, and
`videos/db.sqlite` with the required schema — no manual database setup needed.

## 3. How Storage Is Organized

- **`videos/db.sqlite`** — single `videos` table tracking every job: title, course content, style,
  quality, status, progress, fal.ai job id, file paths, file size, and timestamps.
- **`videos/audio/`** — intermediate ElevenLabs MP3 narration files. Deleted automatically once the
  final video finishes rendering.
- **`videos/generated/`** — final MP4s, named `{courseTitle}_{timestamp}_{quality}.mp4`.
- The Dashboard shows total disk usage across both folders ("You're using X MB").
- Deleting a video from the Dashboard removes both its database row and its file(s) on disk.

## 4. Processing Pipeline

1. `POST /api/videos` validates input, inserts a `queued` row, and enqueues the job.
2. The in-memory queue processes jobs one at a time:
   - **Claude** turns the course content into a JSON scene breakdown (narration, text overlays,
     image search keywords, icon keyword, duration per scene).
   - **ElevenLabs** synthesizes the combined narration into an MP3.
   - **Local render mode (default):** most scenes are rendered as professional presentation-style
     slides — Claude designs each slide (title, subtitle, layout, labeled icon items) and the
     backend draws it as crisp vector graphics with icons from Iconify. Three layouts: grid
     (concept group), split (two-side comparison), and flow (numbered step-by-step chain).
     - The **"Animated Explainer"** style renders true frame-by-frame motion graphics on a light
       agency-style theme: wipe-reveal titles, staggered slide-in items with gentle bob, orbiting
       icon rings for concept groups, draw-on numbered arrows for flows, and drifting ambient dots.
     - The other three styles render dark presentation slides where items appear step by step.
     - Scenes Claude marks as "photo" instead get a background image from the internet (Pexels if
       a key is set, otherwise Openverse, then Wikimedia Commons) with a caption band and Ken Burns
       zoom.
     Scene durations are auto-scaled to match the narration length, clips are concatenated, and the
     voiceover is muxed in as an AAC track.
   - **Narration voice** is selectable per video (male/female voices listed from your ElevenLabs
     account via `GET /api/voices`), and narration text is automatically rewritten for clarity
     before TTS (IP addresses become "192 dot 168 dot 1 dot 1", domains "google dot com", etc.).
   - **fal.ai mode (`RENDER_MODE=fal`):** the audio is uploaded to fal.ai and rendering is handed
     off to a fal.ai model, polled every 5 seconds.
   - The finished MP4 lands in `videos/generated/`, the intermediate audio file is cleaned up, and
     the DB row is marked `complete`.
3. If any step throws, the job is marked `failed` with `errorMessage` set.
4. If no usable image is found for a scene, it falls back to a dark gradient background — the video
   still renders.

## 5. API Endpoints

| Method | Path                      | Description                                  |
| ------ | ------------------------- | --------------------------------------------- |
| POST   | `/api/videos`              | Queue a new video generation job              |
| GET    | `/api/videos`               | List all videos + total storage used          |
| GET    | `/api/videos/:id/status`    | Poll status/progress for one job              |
| GET    | `/api/videos/:id/download`  | Download the finished MP4                     |
| GET    | `/api/videos/:id/play`      | Stream the MP4 (supports range requests)      |
| DELETE | `/api/videos/:id`           | Delete a video's DB row and files on disk     |

## 6. Example Course Content for Testing

Paste this into the Upload page to try the pipeline end-to-end:

```markdown
# Introduction to Photosynthesis

Photosynthesis is the process by which green plants, algae, and some bacteria convert light
energy into chemical energy stored in glucose. It takes place mainly in the chloroplasts of
plant cells, using a green pigment called chlorophyll.

## The Light-Dependent Reactions

These reactions occur in the thylakoid membranes and require direct sunlight. Water molecules
are split, releasing oxygen as a byproduct, while energy is captured in the molecules ATP and
NADPH.

## The Calvin Cycle

Also known as the light-independent reactions, the Calvin Cycle takes place in the stroma of
the chloroplast. It uses the ATP and NADPH produced earlier to convert carbon dioxide into
glucose through a series of enzyme-driven steps.

## Why Photosynthesis Matters

Photosynthesis is the foundation of nearly all life on Earth. It produces the oxygen we breathe
and forms the base of the food chain by converting solar energy into a usable chemical form.
```

Course Title: `Introduction to Photosynthesis`
Animation Style: `Motion Graphics`
Quality: `720p`

## Notes & Limitations

- The job queue is in-memory and single-process — jobs are lost if the backend restarts mid-run, and
  there is no horizontal scaling. Swap in a persistent queue (BullMQ/Redis, etc.) for production use.
- `falService.js` assumes a generic fal.ai queue-based model API (submit → poll `status_url` → fetch
  `response_url`). Update the model endpoint and payload shape to match the specific fal.ai model you
  choose for animation generation.
- No authentication/authorization is implemented — this is a local, single-user scaffold.
