# Kinetic OS — Backend

API server for **Kinetic OS**, the Isolated Workspace platform: lead capture & scoring, AI chat that learns the owner's tone, workflow automation, social content scheduling, and billing — built by Lead Sync Intelligence.

## Tech Stack

- **Runtime:** Node.js + TypeScript
- **Database:** PostgreSQL (with `pgvector` for embeddings) via Prisma
- **Queues/Cache:** Redis + BullMQ
- **Auth:** JWT (access + refresh tokens)
- **Billing:** Lemon Squeezy
- **AI:** OpenAI / Anthropic (configurable, with local stub mode for dev)

## Getting Started

```bash
npm install
cp .env.example .env     # fill in DB, Redis, and provider keys
npx prisma migrate dev
npm run dev
```

Server runs on `http://localhost:4000` by default.

## Modules

| Module | Responsibility |
|---|---|
| `auth` | Signup/login, JWT access+refresh, Google OAuth linking |
| `workspace` | Workspace settings, team members & role management |
| `leads` | Lead ingestion, intent scoring, CRUD |
| `chat` | LLM-powered conversational assistant (rate-limited per workspace), with real tone-learning from the owner's own sent replies (`voice-profile.ts`) once there are enough of them — see below |
| `workflows` | Automation engine with job queue (trigger → score → condition → action) |
| `knowledge` | Document ingestion, chunking, embeddings for RAG (ingestion is rate-limited) |
| `meetings` | List of booked meetings — rows are created by real Calendly/Google Calendar bookings (see Known Gaps) |
| `social` | Content generation, scheduling, and publishing across Instagram/Facebook/TikTok/LinkedIn |
| `dashboard` | Aggregated workspace metrics, framed as outcomes (new customers, hours reclaimed, meetings booked, buying intent) rather than raw platform stats |
| `settings` | API key generation/revocation, read-only integration status |
| `notifications` | In-app notification delivery |
| `billing` | Lemon Squeezy subscriptions & webhooks |
| `webhooks` | Inbound channel webhooks (WhatsApp, Instagram, Telegram, Messenger, Email) |

## Known Gaps

- **Tone-learning is real but simple.** `src/modules/chat/voice-profile.ts` pulls the owner's own most-recently-sent replies (Message rows with `sender: "AGENT"`, i.e. actually typed and sent by a person, never AI-generated ones) and feeds a handful of them into the AI's system prompt as style examples, once there are at least 5. Below that threshold it stays generic rather than personalizing off too little signal. What this is *not* yet: a persistent "learned profile" that survives independent of recent message history, decision-pattern learning beyond writing style, or the "light, unobtrusive prompts" the pitch describes for actively soliciting preferences — right now it's purely passive (learns only from replies the owner sends anyway).
- **Calendly / Google Calendar are real, but need your own credentials to actually run**: `calendar_book` workflow actions generate a real Calendly scheduling link or create a real Google Calendar event — no more logging-and-pretending. Calendly bookings create a real `Meeting` row only once the lead actually books, via the `/webhooks/calendly` webhook (register it in your Calendly account). Google Calendar bookings create the `Meeting` row immediately since there's no separate booking step. Both require env vars — see below — that don't come with the repo.
- HubSpot / Google Sheets CRM sync are similarly real but require your own credentials (same pattern as above).
- No real per-workspace OAuth connect flow for these four yet (unlike the messaging channels) — they're configured once via env vars for the whole deployment, not per-workspace in Settings.
- **Reel videos require `ffmpeg` installed on the server.** The pipeline generates a real AI graphic, script, and voiceover, then actually assembles them into a real mp4 via `ffmpeg` (`src/lib/video-assembly.ts`) — no more pretending a static image + a separate unmerged audio file is a "reel". If `ffmpeg` isn't on PATH, generation falls back to publishing the still graphic instead of failing the whole post (logged clearly either way). Install it with your platform's package manager, or use a base Docker image that includes it.
- **LinkedIn video posting isn't implemented.** LinkedIn's API needs a real multi-step asset registration + binary upload for video (unlike Instagram/Facebook/TikTok, which accept a source URL), which isn't built yet — LinkedIn reel posts are declined with a clear error rather than silently failing against the real API. Image/text posts to LinkedIn work normally.
- Generated media (graphics/voiceovers/assembled reels) is stored on local disk (`storage/media/`, served via `/media`) rather than S3/Cloudinary/etc — fine for a single server, but won't survive a redeploy or scale across multiple instances. Swap `src/lib/media-storage.ts` for real object storage before that becomes a problem.
- Test coverage is focused on auth/billing/workflows (the highest-stakes modules) — see Testing section below; leads/channels/social/knowledge aren't covered yet.
- Rate limiting currently covers `/auth`, `/chat`, and `/knowledge` ingestion (the endpoints that trigger billed AI calls or are common abuse targets) — not every route.

## Environment Variables

See `.env.example` for the full list, grouped by concern (core, database, auth, AI providers, channel adapters, scheduling, CRM sync, social publishing, billing). Leave AI provider keys blank to run in local stub mode (no external calls, deterministic fake embeddings) — useful for development without live API keys.

**"Continue with Google" sign-in** uses `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` from a Google Cloud OAuth client. Add `GOOGLE_LOGIN_REDIRECT_URI` (default `http://localhost:4000/auth/google/callback`) to that client's Authorized redirect URIs. New Google sign-ins create a workspace automatically; if the email already has a password account, Google is linked to it instead of creating a duplicate.

## Project Structure

```
src/
  modules/       # Feature modules (leads, chat, workflows, knowledge, billing, ...)
  middleware/    # Auth, error handling
  lib/           # Shared utilities (Prisma client, Redis, JWT, mailer, logger)
  config/        # Environment config
  app.ts         # Express app setup
  server.ts      # Entry point
```

## Testing

`npm test` runs the suite (Vitest). Coverage focuses on the highest-stakes modules first:

- **Auth** (`tests/modules/auth/`) — signup/login/refresh-token rotation, wrong-password handling, Google-only accounts, conflict on duplicate email.
- **Billing** (`tests/modules/billing/`) — Lemon Squeezy webhook signature verification (real HMAC, not mocked), subscription state transitions, invoice recording, missing-workspace-id handling.
- **Workflow engine** (`tests/modules/workflows/`) — dry-run mode never calls a real integration (asserted per action type), real execution paths, graceful handling of unknown action types and missing conversations.

These are unit/service tests with Prisma mocked (`vi.mock("@/lib/prisma", ...)`) rather than a live database — fast, and don't need Postgres running to execute. `tests/setup.ts` loads `.env.test` before anything else imports `src/config/env.ts` (which is required, since it validates `process.env` at import time and exits the process if invalid).

Not yet covered: leads/channels/social/knowledge modules, and no end-to-end tests against a real database. Contributions welcome — follow the existing pattern (mock Prisma + any external API client, assert on what got called).

## Deployment

**Docker** (recommended): `docker compose up --build` starts Postgres (with pgvector), Redis, the API, and both BullMQ workers (workflow + social) in one command. Copy `.env.example` to `.env` and fill in real values first — `npm run generate:secrets` will generate fresh random values for every secret that ships with an insecure default.

The `Dockerfile` installs `ffmpeg` (needed for real reel video assembly) and generates the Prisma client at build time. Runs as a non-root user.

Without Docker: `npm run build && npm start` for the API, `npm run worker` and `npm run social:worker` as separate long-running processes (they need to stay running to process queued jobs — a process manager like PM2 or systemd is recommended for production, since Node itself won't restart a crashed process).

## Monitoring

Set `SENTRY_DSN` (see `.env.example`) to report errors to Sentry instead of only logging locally. Covers: unhandled 5xx errors in Express request handlers, uncaught exceptions and unhandled promise rejections at the process level (in all three processes — API server, workflow worker, social worker), and BullMQ job failures/connection errors. Without a DSN configured, none of this reporting happens — errors are still logged locally via `pino`, just not sent anywhere.

## Product Philosophy

Per the Business Mechanics Addendum, every number this backend surfaces to the frontend is meant
to read as a business outcome, not a platform mechanic. `hoursReclaimed` in `dashboard.service.ts`
is a concrete example: rather than reporting a raw "AI reply rate %", it converts AI-handled
replies into an estimated hours-saved figure, using a deliberately conservative per-reply time
estimate (see the comment in that file) so the number stays defensible rather than a marketing
exaggeration.

## Status

Actively in development. See the [frontend repo](https://github.com/aleehassan-5/kinetic-os-frontend) for the UI.
