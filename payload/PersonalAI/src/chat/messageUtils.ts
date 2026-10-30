import type { ChatMessage, MessagePart, Role } from '../types';

export const uid = () => crypto.randomUUID();

export function textOf(message: Pick<ChatMessage, 'parts'>): string {
  return message.parts
    .filter((p): p is Extract<MessagePart, { type: 'text' }> => p.type === 'text')
    .map((p) => p.text)
    .join('');
}

export function makeMessage(role: Role, text: string, extra: Partial<ChatMessage> = {}): ChatMessage {
  return { id: uid(), role, parts: [{ type: 'text', text }], createdAt: Date.now(), ...extra };
}

/** Appends streamed text to the last text part (creating one if needed). */
export function appendText(message: ChatMessage, text: string): ChatMessage {
  const parts = [...message.parts];
  const last = parts[parts.length - 1];
  if (last?.type === 'text') parts[parts.length - 1] = { ...last, text: last.text + text };
  else parts.push({ type: 'text', text });
  return { ...message, parts };
}

export function setText(message: ChatMessage, text: string): ChatMessage {
  const others = message.parts.filter((p) => p.type !== 'text');
  return { ...message, parts: [{ type: 'text', text }, ...others] };
}

export function titleFrom(text: string) {
  const t = text.replace(/\s+/g, ' ').trim();
  return t.length > 42 ? t.slice(0, 42).trimEnd() + '…' : t || 'New chat';
}
