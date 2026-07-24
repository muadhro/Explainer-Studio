# Explainer Studio

Turn course content (markdown or plain text) into an animated explainer video. The pipeline uses
Claude to break content into a scene-by-scene script, ElevenLabs to generate a voiceover, and
renders locally, then stores everything in SQLite + the filesystem — behind real user accounts,
a 4-tier pricing page, and a full account settings area.

## Tech Stack

- **Frontend:** React + TypeScript + Vite, Apple-inspired design system (custom dropdowns, Inter
  font, light/dark theming)
- **Backend:** Node.js + Express
- **Accounts:** email/password auth with bcrypt + server-side sessions (own implementation, no
  third-party auth provider). Google/Microsoft/GitHub SSO buttons exist in the UI but are disabled
  until you supply OAuth credentials.
- **Billing:** 4 plan tiers with 1/3/6/12-month commitment discounts, enforced server-side (video
  quota, max quality). No payment processor is wired up — plan switches update the stored plan but
  do not charge a card. Connect Stripe (or similar) to bill for real.
- **Script generation:** Claude API
- **Text-to-speech:** ElevenLabs API, with TTS-friendly narration rewriting (IPs/domains spoken
  out) and a full voice picker with previews
- **Scene images:** pulled from the internet — Pexels (optional key) → Openverse → Wikimedia
  Commons fallback chain, plus tech icons from Iconify (no key needed)
- **Video rendering:** local compositing with sharp + ffmpeg (default), or fal.ai API (optional)
- **Storage:** SQLite (`videos/db.sqlite`) + local filesystem (`videos/audio`, `videos/generated`,
  `videos/avatars`)
- **Job queue:** in-memory FIFO queue (no Redis), with automatic recovery of interrupted jobs on
  server restart

## Folder Structure

```
/
├── frontend/            React + TypeScript + Vite app
│   └── src/
│       ├── pages/         Upload, Dashboard, Login, Signup, Pricing, Account, Legal
│       ├── components/    AppleSelect, UserMenu, ProtectedRoute, VideoCard, StatusBadge
│       └── AuthContext.tsx
├── backend/             Express API + processing pipeline
│   ├── routes/            videos.js, auth.js, account.js
│   ├── services/          claudeService, elevenLabsService, falService, fileService,
│   │                       imageService, slideService, animatedService, composerService,
│   │                       authService
│   ├── config/plans.js     pricing tiers + billing cycle discounts
│   ├── queue/videoQueue.js
│   └── database/db.js
├── videos/              created at runtime: audio/, generated/, avatars/, db.sqlite
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

All `/api/videos` and `/api/account` routes require a signed-in session (cookie-based) and are
scoped to the current user.

| Method | Path                         | Description                                          |
| ------ | ---------------------------- | ----------------------------------------------------- |
| POST   | `/api/auth/signup`           | Create an account, starts a session                   |
| POST   | `/api/auth/login`             | Sign in, starts a session                              |
| POST   | `/api/auth/logout`            | End the current session                                |
| GET    | `/api/auth/me`                | Current signed-in user, or `null`                      |
| POST   | `/api/videos`                 | Queue a new video job (enforces plan quota/quality)     |
| GET    | `/api/videos`                 | List the current user's videos + total storage used    |
| GET    | `/api/videos/:id/status`      | Poll status/progress for one job                       |
| GET    | `/api/videos/:id/download`    | Download the finished MP4                               |
| GET    | `/api/videos/:id/play`        | Stream the MP4 (supports range requests)                |
| DELETE | `/api/videos/:id`             | Delete a video's DB row and files on disk               |
| GET    | `/api/voices`                 | List ElevenLabs voices (id, name, gender, preview URL)  |
| PATCH  | `/api/account/profile`        | Update name / title / avatar                            |
| POST   | `/api/account/password`       | Change password                                         |
| GET    | `/api/account/sessions`       | List active sessions (devices)                          |
| DELETE | `/api/account/sessions/:id`   | Revoke one session                                       |
| POST   | `/api/account/sessions/logout-others` | Sign out every other device                     |
| PATCH  | `/api/account/preferences`    | Update theme / locale / timezone / notification flags   |
| GET    | `/api/account/billing`        | Current plan, usage this month, all plans + cycles       |
| POST   | `/api/account/billing/plan`   | Switch plan/cycle (no real charge — see Billing above)   |
| GET    | `/api/account/export`         | Download a JSON export of the account + all videos       |
| POST   | `/api/account/delete`         | Permanently delete the account (requires password)       |

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

## 7. Accounts, Pricing & Settings

- **Sign up / Log in** at `/signup` and `/login`. Sessions are stored server-side (a `sessions`
  table) and referenced by an httpOnly cookie — no JWT, no external auth provider needed for
  email/password. Google/Microsoft/GitHub buttons are visible but disabled until you add real
  OAuth app credentials.
- **Pricing** (`/pricing`) has 4 tiers — Free, Starter ($25), Creator ($65, marked Popular), Studio
  ($149) — defined in `backend/config/plans.js`. A 1/3/6/12-month toggle applies 0/10/15/20%
  monthly-equivalent discounts. Selecting a plan while signed in calls
  `POST /api/account/billing/plan`, which updates the stored plan immediately — **no card is ever
  charged**, since no payment processor is connected. Wire in Stripe (or similar) and swap that
  route's body for real checkout/subscription calls when you're ready to take payments.
- **Plan limits are enforced for real**: each plan's monthly video quota and max quality (720p vs
  1080p) are checked server-side on every `POST /api/videos` — not just a UI suggestion.
- **Account Settings** (`/account`) has 5 tabs: Profile (name/title/avatar), Security
  (password, sessions list with per-device revoke, a 2FA toggle that's honestly labeled "coming
  soon"), Billing (plan, usage bar, payment method / invoices placeholders), Preferences
  (notifications, language, timezone, light/dark/system theme — genuinely applied site-wide via a
  `data-theme` attribute), and Privacy (JSON data export, Terms/Privacy placeholder pages, and
  account deletion with password confirmation).

## Notes & Limitations

- The job queue is in-memory and single-process, but interrupted jobs (server restarted mid-render)
  are automatically re-queued on startup — see `recoverPendingJobs()` in `videoQueue.js`. There's
  still no horizontal scaling; swap in a persistent queue (BullMQ/Redis, etc.) for that.
- `falService.js` assumes a generic fal.ai queue-based model API (submit → poll `status_url` → fetch
  `response_url`). Update the model endpoint and payload shape to match the specific fal.ai model you
  choose for animation generation.
- No real payment processor or OAuth SSO is connected (see Accounts section above) — both are
  reversible additions to the existing routes/UI, not a redesign.
- `/terms` and `/privacy` are placeholder pages. Replace their content before launching to real
  users.
