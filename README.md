# Orbit AI — Backend

API server for **Orbit AI**, an omni-channel AI automation platform: lead capture & scoring, AI chat, workflow automation, social content scheduling, and billing.

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
| `chat` | LLM-powered conversational assistant (rate-limited per workspace) |
| `workflows` | Automation engine with job queue (trigger → score → condition → action) |
| `knowledge` | Document ingestion, chunking, embeddings for RAG (ingestion is rate-limited) |
| `meetings` | List of booked meetings — rows are created by real Calendly/Google Calendar bookings (see Known Gaps) |
| `social` | Content generation, scheduling, and publishing across Instagram/Facebook/TikTok/LinkedIn |
| `dashboard` | Aggregated workspace metrics (leads, reply rate, meetings, intent score, channel mix) |
| `settings` | API key generation/revocation, read-only integration status |
| `notifications` | In-app notification delivery |
| `billing` | Lemon Squeezy subscriptions & webhooks |
| `webhooks` | Inbound channel webhooks (WhatsApp, Instagram, Telegram, Messenger, Email) |

## Known Gaps

- **Calendly / Google Calendar are real, but need your own credentials to actually run**: `calendar_book` workflow actions generate a real Calendly scheduling link or create a real Google Calendar event — no more logging-and-pretending. Calendly bookings create a real `Meeting` row only once the lead actually books, via the `/webhooks/calendly` webhook (register it in your Calendly account). Google Calendar bookings create the `Meeting` row immediately since there's no separate booking step. Both require env vars — see below — that don't come with the repo.
- HubSpot / Google Sheets CRM sync are similarly real but require your own credentials (same pattern as above).
- No real per-workspace OAuth connect flow for these four yet (unlike the messaging channels) — they're configured once via env vars for the whole deployment, not per-workspace in Settings.
- **Reel videos require `ffmpeg` installed on the server.** The pipeline generates a real AI graphic, script, and voiceover, then actually assembles them into a real mp4 via `ffmpeg` (`src/lib/video-assembly.ts`) — no more pretending a static image + a separate unmerged audio file is a "reel". If `ffmpeg` isn't on PATH, generation falls back to publishing the still graphic instead of failing the whole post (logged clearly either way). Install it with your platform's package manager, or use a base Docker image that includes it.
- **LinkedIn video posting isn't implemented.** LinkedIn's API needs a real multi-step asset registration + binary upload for video (unlike Instagram/Facebook/TikTok, which accept a source URL), which isn't built yet — LinkedIn reel posts are declined with a clear error rather than silently failing against the real API. Image/text posts to LinkedIn work normally.
- Generated media (graphics/voiceovers/assembled reels) is stored on local disk (`storage/media/`, served via `/media`) rather than S3/Cloudinary/etc — fine for a single server, but won't survive a redeploy or scale across multiple instances. Swap `src/lib/media-storage.ts` for real object storage before that becomes a problem.
- No automated test suite yet.
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

## Status

Actively in development. See the [frontend repo](https://github.com/aleehassan-5/orbit-ai-frontend) for the UI.
