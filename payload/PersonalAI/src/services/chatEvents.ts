/**
 * Tiny event bus for generation lifecycle events.
 * Nothing subscribes yet. Future modules hook in here instead of
 * changing the chat code:
 *   - TTS: listen to 'token' / 'end' to speak sentences as they stream
 *   - VTuber: listen to 'start' / 'end' for talking animation & emotions
 *   - Memory: listen to 'end' to store the finished exchange
 */
import type { ChatMessage, GenerationStats } from '../types';

export type ChatEventMap = {
  start: { conversationId: string; messageId: string };
  token: { conversationId: string; messageId: string; text: string };
  end: { conversationId: string; message: ChatMessage; stats?: GenerationStats; stopped: boolean };
  error: { conversationId: string; messageId: string; error: string };
};

type Handler<K extends keyof ChatEventMap> = (payload: ChatEventMap[K]) => void;

const handlers = new Map<keyof ChatEventMap, Set<(payload: any) => void>>();

export const chatEvents = {
  on<K extends keyof ChatEventMap>(event: K, handler: Handler<K>) {
    if (!handlers.has(event)) handlers.set(event, new Set());
    handlers.get(event)!.add(handler);
    return () => handlers.get(event)?.delete(handler);
  },
  emit<K extends keyof ChatEventMap>(event: K, payload: ChatEventMap[K]) {
    handlers.get(event)?.forEach((h) => h(payload));
  },
};
