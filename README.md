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
| `leads` | Lead ingestion, intent scoring, CRUD |
| `chat` | LLM-powered conversational assistant |
| `workflows` | Automation engine with job queue (trigger → score → condition → action) |
| `knowledge` | Document ingestion, chunking, embeddings for RAG |
| `notifications` | In-app notification delivery |
| `billing` | Lemon Squeezy subscriptions & webhooks |
| `webhooks` | Inbound channel webhooks (WhatsApp, Instagram, Telegram, Messenger, Email) |

## Environment Variables

See `.env.example` for the full list, grouped by concern (core, database, auth, AI providers, channel adapters, scheduling, CRM sync, social publishing, billing). Leave AI provider keys blank to run in local stub mode (no external calls, deterministic fake embeddings) — useful for development without live API keys.

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
