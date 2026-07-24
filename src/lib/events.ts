import { EventEmitter } from "events";

export type OrbitEventName =
  | "lead.created"
  | "lead.message.inbound"
  | "lead.intent.threshold_crossed"
  | "meeting.booked";

export interface OrbitEventPayloads {
  "lead.created": { workspaceId: string; leadId: string };
  "lead.message.inbound": { workspaceId: string; leadId: string; conversationId: string; messageId: string; text: string };
  "lead.intent.threshold_crossed": { workspaceId: string; leadId: string; score: number };
  "meeting.booked": { workspaceId: string; leadId: string; meetingId: string };
}

class TypedEventBus extends EventEmitter {
  emitEvent<T extends OrbitEventName>(name: T, payload: OrbitEventPayloads[T]) {
    this.emit(name, payload);
  }
  onEvent<T extends OrbitEventName>(name: T, listener: (payload: OrbitEventPayloads[T]) => void) {
    this.on(name, listener);
  }
}

export const eventBus = new TypedEventBus();
eventBus.setMaxListeners(50);
