import express from "express";
import cors from "cors";
import helmet from "helmet";
import morgan from "morgan";
import { env } from "@/config/env";
import { notFoundHandler, errorHandler } from "@/middleware/error-handler";
import { MEDIA_DIR, MEDIA_URL_PREFIX } from "@/lib/media-storage";

import authRoutes from "@/modules/auth/auth.routes";
import leadsRoutes from "@/modules/leads/leads.routes";
import webhooksRoutes from "@/modules/webhooks/webhooks.routes";
import knowledgeRoutes from "@/modules/knowledge/knowledge.routes";
import chatRoutes from "@/modules/chat/chat.routes";
import workflowRoutes from "@/modules/workflows/workflow.routes";
import notificationsRoutes from "@/modules/notifications/notifications.routes";
import teamRoutes from "@/modules/workspace/team.routes";
import workspaceRoutes from "@/modules/workspace/workspace.routes";
import billingRoutes from "@/modules/billing/billing.routes";
import lemonSqueezyWebhookRoutes from "@/modules/billing/lemonsqueezy.webhook.routes";
import socialRoutes from "@/modules/social/social.routes";
import socialWebhooksRoutes from "@/modules/social/social-webhooks.routes";
import dashboardRoutes from "@/modules/dashboard/dashboard.routes";
import channelConnectionsRoutes from "@/modules/channels/channel-connections.routes";
import apiKeysRoutes from "@/modules/settings/api-keys.routes";
import integrationsRoutes from "@/modules/settings/integrations.routes";
import meetingsRoutes from "@/modules/meetings/meetings.routes";
import listingsRoutes from "@/modules/listings/listings.routes";

export const app = express();

app.use(helmet());
app.use(cors({ origin: env.WEB_APP_URL, credentials: true }));
app.use(morgan(env.NODE_ENV === "development" ? "dev" : "combined"));

// Capture the raw request body alongside the parsed JSON so webhook handlers
// (WhatsApp/Meta/Telegram/Lemon Squeezy) can verify HMAC signatures against
// the exact bytes that were sent — signatures break if you re-serialize
// the parsed object instead of using the original bytes.
app.use(
  express.json({
    limit: "5mb",
    verify: (req, _res, buf) => {
      (req as express.Request & { rawBody?: string }).rawBody = buf.toString();
    },
  })
);

app.get("/health", (_req, res) => res.status(200).json({ status: "ok", timestamp: new Date().toISOString() }));

// Locally-generated social content (AI graphics, voiceovers, assembled reel
// videos) — see src/lib/media-storage.ts for why this exists instead of
// inlining base64 or relying on OpenAI/ElevenLabs' own (expiring) URLs.
app.use(MEDIA_URL_PREFIX, express.static(MEDIA_DIR, { maxAge: "7d", immutable: true }));

app.use("/auth", authRoutes);
app.use("/leads", leadsRoutes);
app.use("/webhooks", webhooksRoutes);
app.use("/webhooks/lemonsqueezy", lemonSqueezyWebhookRoutes);
app.use("/knowledge", knowledgeRoutes);
app.use("/chat", chatRoutes);
app.use("/workflows", workflowRoutes);
app.use("/dashboard", dashboardRoutes);
app.use("/api-keys", apiKeysRoutes);
app.use("/integrations", integrationsRoutes);
app.use("/meetings", meetingsRoutes);
app.use("/listings", listingsRoutes);
app.use("/notifications", notificationsRoutes);
app.use("/team", teamRoutes);
app.use("/workspace", workspaceRoutes);
app.use("/billing", billingRoutes);
app.use("/social", socialRoutes);
app.use("/webhooks/social", socialWebhooksRoutes);
app.use("/channel-connections", channelConnectionsRoutes);

app.use(notFoundHandler);
app.use(errorHandler);
