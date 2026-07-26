import { z } from "zod";

export const connectChannelSchema = z.discriminatedUnion("channel", [
  z.object({
    channel: z.literal("WHATSAPP"),
    phoneNumberId: z.string().min(1),
    accessToken: z.string().min(1),
    appSecret: z.string().optional(),
  }),
  z.object({
    channel: z.literal("TELEGRAM"),
    botToken: z.string().min(1),
  }),
  z.object({
    channel: z.literal("INSTAGRAM"),
    pageId: z.string().min(1),
    pageAccessToken: z.string().min(1),
  }),
  z.object({
    channel: z.literal("MESSENGER"),
    pageId: z.string().min(1),
    pageAccessToken: z.string().min(1),
  }),
  z.object({
    channel: z.literal("EMAIL"),
    fromAddress: z.string().email(),
  }),
]);

export type ConnectChannelInput = z.infer<typeof connectChannelSchema>;
