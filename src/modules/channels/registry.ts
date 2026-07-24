import type { Channel } from "@prisma/client";
import type { ChannelAdapter } from "./types";
import { whatsappAdapter } from "./whatsapp.adapter";
import { telegramAdapter } from "./telegram.adapter";
import { instagramAdapter } from "./instagram.adapter";
import { messengerAdapter } from "./messenger.adapter";
import { emailAdapter } from "./email.adapter";

export const channelAdapters: Record<Channel, ChannelAdapter> = {
  WHATSAPP: whatsappAdapter,
  TELEGRAM: telegramAdapter,
  INSTAGRAM: instagramAdapter,
  MESSENGER: messengerAdapter,
  EMAIL: emailAdapter,
};

export function getAdapter(channel: Channel): ChannelAdapter {
  return channelAdapters[channel];
}
