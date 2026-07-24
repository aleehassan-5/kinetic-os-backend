# Orbit AI — Backend

Node.js + Express + TypeScript backend for the Orbit AI platform. Pairs with the
`orbit-ai-frontend` Next.js app.

## Stack

- **API**: Express + TypeScript
- **DB**: PostgreSQL + Prisma (with the `pgvector` extension for the knowledge base)
- **Queue**: Redis + BullMQ (async workflow execution)
- **Auth**: JWT access + refresh tokens
- **Billing**: Lemon Squeezy (hosted checkout + webhooks)
- **AI**: OpenAI (chat + embeddings) — runs in a deterministic local-stub mode with no key set

## Setup

```bash
cp .env.example .env          # fill in DATABASE_URL at minimum
npm install
npm run prisma:migrate        # creates tables (run: CREATE EXTENSION IF NOT EXISTS vector; once on your DB first)
npm run seed                  # demo workspace + login: are.khan@orbitai.agency / password123
npm run dev                   # API on :4000
npm run worker                # separate process: workflow execution worker (needs Redis running)
```

## Modules

- **Core** (`src/modules/auth`, `src/config`, `src/middleware`) — register/login/refresh/me, JWT middleware, role guard, centralized error handling, zod-validated env.
- **Lead Engine** (`src/modules/leads`, `src/modules/channels`, `src/modules/webhooks`) — omni-channel webhook receivers (WhatsApp, Telegram, Instagram, Messenger, Email) normalize into one `Lead`/`Conversation`/`Message` model, run keyword-based intent scoring, and emit events other modules subscribe to.
- **AI Chat + Knowledge Base** (`src/modules/knowledge`, `src/modules/chat`) — file/FAQ/URL ingestion → chunking → embeddings → pgvector storage; chat endpoint retrieves nearest chunks and grounds an LLM reply in them, with cited sources.
- **Workflow Orchestrator** (`src/modules/workflows`) — graph model (trigger → condition → action) matching the frontend Workflow Builder; a BullMQ worker executes graphs asynchronously and logs every step.
- **Billing** (`src/modules/billing`) — Lemon Squeezy hosted checkout, webhook-driven subscription/invoice sync, usage-vs-plan-limit aggregation for the Settings/Billing pages.
- **Team** (`src/modules/workspace`) — membership list/invite/role-change/remove, with real invite emails via `src/lib/mailer.ts`.
- **Notifications** (`src/modules/notifications`) — backs the frontend bell dropdown; other modules call `createNotification(...)`.
- **Social content engine** (`src/modules/social`) — AI-generates graphics (OpenAI Images) and reel scripts + captions (chat LLM), synthesizes voiceovers (ElevenLabs), schedules publishing with a BullMQ worker (`npm run social:worker`), publishes to Instagram/Facebook/TikTok/LinkedIn via per-platform adapters (`publishers/`), and listens for comment webhooks to auto-reply using the same knowledge-base-grounded chat pipeline as the Lead Inbox.

## What's real vs. stubbed

Everything above **runs** end-to-end with real logic (intent scoring, workflow graph execution, RAG retrieval, webhook signature verification). What needs YOUR credentials in `.env` before it talks to the real outside world:

| Needs a real key/account | Falls back to (no key set) |
|---|---|
| WhatsApp Cloud API, Instagram/Messenger (Meta), Telegram Bot API | Adapter logs the outbound message instead of sending; inbound webhooks still parse/score/store correctly if you POST test payloads |
| OpenAI (chat + embeddings + images) | Deterministic local hash-based embeddings, a canned "local dev mode" chat reply, and a generated placeholder graphic (inline SVG) — the whole RAG + content-generation pipeline still runs end-to-end |
| ElevenLabs (voiceover) | Script generation still runs; the post is saved without an audio URL |
| Instagram / Facebook / TikTok / LinkedIn publishing | Publisher logs what it *would* post and marks the post `FAILED` with a clear message instead of silently succeeding |
| Lemon Squeezy | Checkout/portal/cancel calls return a clear 503 until `LEMONSQUEEZY_API_KEY`/`STORE_ID` are set; webhook sync is ready to go once you add the webhook URL + secret in your LS dashboard |
| HubSpot, Calendly, Google Calendar | CRM sync / calendar-book actions log what they *would* do and return gracefully |
| Google Sheets | Real service-account JWT auth + `values.append` call — just set `GOOGLE_SHEETS_SPREADSHEET_ID`, `GOOGLE_SERVICE_ACCOUNT_EMAIL`, `GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY` |
| SMTP (invite emails) | Logs the invite instead of sending until `SMTP_HOST` is set |

## Webhook URLs to register with each provider

```
POST https://your-domain.com/webhooks/whatsapp
POST https://your-domain.com/webhooks/telegram
POST https://your-domain.com/webhooks/instagram
POST https://your-domain.com/webhooks/messenger
POST https://your-domain.com/webhooks/email        (from your inbound-parse provider, e.g. SendGrid)
POST https://your-domain.com/webhooks/lemonsqueezy
POST https://your-domain.com/webhooks/social/instagram-comments
POST https://your-domain.com/webhooks/social/facebook-comments
```

## Lemon Squeezy setup

1. Create a Store and a Product (with 3 Variants: Starter/Growth/Scale) in the Lemon Squeezy dashboard.
2. `LEMONSQUEEZY_API_KEY` — Settings → API.
3. `LEMONSQUEEZY_STORE_ID` — Settings → Stores.
4. `LEMONSQUEEZY_VARIANT_STARTER` / `_GROWTH` / `_SCALE` — each variant's id from its product page.
5. Settings → Webhooks → add `https://your-domain.com/webhooks/lemonsqueezy`, subscribe to all `subscription_*` and `order_created` events, copy the signing secret into `LEMONSQUEEZY_WEBHOOK_SECRET`.
6. `POST /billing/checkout { "planId": "growth" }` returns a hosted checkout URL to redirect the user to.

## Social content engine — quick start

```bash
npm run social:worker   # separate process: scheduled-publish worker (needs Redis running)
```

- `POST /social/posts { mode: "draft" }` — save a post idea without generating anything yet.
- `POST /social/posts { mode: "generate_and_schedule", ... }` — generates the graphic/script/caption/voiceover immediately, then either publishes right away (if `scheduledAt` is now/past) or enqueues a BullMQ job that fires at `scheduledAt`.
- `POST /social/posts/:postId/publish-now` — force-publish a generated post immediately.
- `POST /social/accounts { platform, externalId }` — connect a platform account (page id / IG business account id / TikTok open id / LinkedIn org URN) so posts know where to publish.
- Comment webhooks (`/webhooks/social/instagram-comments`, `/webhooks/social/facebook-comments`) store every inbound comment, and — if the connected account has `autoReplyComments: true` — reply automatically using the same knowledge-base-grounded chat pipeline as the Lead Inbox.

## What's left as a deliberate v1 boundary

- HubSpot's real API call was already wired in the original pass; Google Sheets now is too (see table above) — neither needs further work to go live, just credentials.
- TikTok's public API doesn't expose comment-reply endpoints to third-party apps, so TikTok comments are stored for manual reply instead of auto-replied.
- Generated media (images/voiceovers) are returned as data URLs / OpenAI-hosted URLs rather than uploaded to your own object storage (S3/R2/Cloudinary) — swap the return value in `content-generation.ts` / `voiceover.ts` for an upload call once you pick a storage provider.
