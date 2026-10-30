/**
 * Prompt + parser for "Suggest memories from this chat": asks the local model
 * to list long-term facts worth remembering. Results are only SUGGESTIONS;
 * the user approves each one.
 */
import { textOf } from '../chat/messageUtils';
import type { LLMMessage } from '../providers/types';
import { MEMORY_TYPES, type ChatMessage, type MemoryType } from '../types';

export function buildExtractionMessages(history: ChatMessage[]): LLMMessage[] {
  const transcript = history
    .filter((m) => (m.role === 'user' || m.role === 'assistant') && !m.isGreeting)
    .slice(-16)
    .map((m) => `${m.role === 'user' ? 'USER' : 'ASSISTANT'}: ${textOf(m).slice(0, 800)}`)
    .join('\n');

  return [
    {
      role: 'system',
      content: `You extract long-term memories about the USER from a conversation.
Only include stable, useful facts: preferences, hardware/tools they use, projects, decisions, important names, recurring goals, standing instructions.
Do NOT include: greetings, jokes, temporary states, questions, things the assistant guessed, or general knowledge.
Do NOT promote fictional roleplay/scene facts, persona/control metadata, or descriptions of Lumicos's canonical identity into personal memories.
Write each memory as one short sentence in the same language the user used.
Types: ${MEMORY_TYPES.join(', ')}.
Reply with ONLY a JSON array, e.g. [{"type":"preference","content":"User prefers concise answers.","tags":["style"]}]. Reply [] if there is nothing worth remembering.`,
    },
    { role: 'user', content: `Conversation:\n${transcript}\n\nJSON array of memories:` },
  ];
}

export function parseExtraction(text: string): { type: MemoryType; content: string; tags: string[] }[] {
  const start = text.indexOf('[');
  const end = text.lastIndexOf(']');
  if (start < 0 || end <= start) return [];
  try {
    const arr = JSON.parse(text.slice(start, end + 1).replace(/,\s*([}\]])/g, '$1'));
    if (!Array.isArray(arr)) return [];
    return arr
      .filter((x) => x && typeof x.content === 'string' && x.content.trim())
      .map((x) => ({
        type: (MEMORY_TYPES as readonly string[]).includes(x.type) ? x.type : 'general',
        content: String(x.content).trim(),
        tags: Array.isArray(x.tags) ? x.tags.map(String) : [],
      }));
  } catch {
    return [];
  }
}
