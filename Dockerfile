# syntax=docker/dockerfile:1

# ── Base: shared by every stage ──────────────────────────────────────────
FROM node:20-slim AS base
# openssl is required by Prisma's query engine; ffmpeg is required by the
# real reel-video assembly pipeline (src/lib/video-assembly.ts) — without
# it, reel generation falls back to publishing a still image (logged
# clearly) instead of failing, but you want it installed for real video.
RUN apt-get update && apt-get install -y --no-install-recommends \
    openssl \
    ffmpeg \
    ca-certificates \
  && rm -rf /var/lib/apt/lists/*
WORKDIR /app

# ── Dependencies (cached separately from source for faster rebuilds) ────
FROM base AS deps
COPY package.json package-lock.json ./
COPY prisma ./prisma
RUN npm ci

# ── Build: compile TypeScript + generate the Prisma client ──────────────
FROM deps AS build
COPY . .
RUN npx prisma generate
RUN npm run build

# ── Production dependencies only (no devDependencies, no source) ────────
FROM base AS prod-deps
COPY package.json package-lock.json ./
COPY prisma ./prisma
RUN npm ci --omit=dev
RUN npx prisma generate

# ── Final runtime image ──────────────────────────────────────────────────
FROM base AS runtime
ENV NODE_ENV=production
COPY --from=prod-deps /app/node_modules ./node_modules
COPY --from=prod-deps /app/prisma ./prisma
COPY --from=build /app/dist ./dist
COPY package.json ./

# Non-root user — don't run the app as root in production.
RUN useradd --create-home --shell /bin/bash orbit && \
    mkdir -p /app/storage/media && chown -R orbit:orbit /app
USER orbit

EXPOSE 4000
HEALTHCHECK --interval=30s --timeout=5s --start-period=15s \
  CMD node -e "require('http').get('http://localhost:4000/health', r => process.exit(r.statusCode===200?0:1)).on('error',()=>process.exit(1))"

CMD ["node", "dist/all-in-one.js"]
