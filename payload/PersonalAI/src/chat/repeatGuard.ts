import type { ChatMessage } from '../types';
import { textOf } from './messageUtils';

/** 8-character pieces of a text, spaces removed (Thai has no word spaces, so characters work for every language). */
function pieces(text: string, n = 8): Set<string> {
  const s = String(text ?? '').replace(/\s+/g, '');
  const out = new Set<string>();
  for (let i = 0; i + n <= s.length; i++) out.add(s.slice(i, i + n));
  return out;
}

/** Share of the shorter text's 8-character pieces that also occur in the other one (1 = one is inside the other). */
export function overlap(a: string, b: string): number {
  const A = pieces(a), B = pieces(b);
  if (!A.size || !B.size) return 0;
  let shared = 0;
  for (const p of A.size <= B.size ? A : B) if ((A.size <= B.size ? B : A).has(p)) shared++;
  return shared / Math.min(A.size, B.size);
}

const ASKS_REPEAT = /(อีกที|อีกครั้ง|พูดซ้ำ|ซ้ำอีก|ทวน|เหมือนเดิม|แบบเดิม|\bagain\b|\brepeat\b)/iu;
export const REPEAT_LIMIT = 0.45;

/**
 * claude-20261023: a draft that is (nearly) an earlier reply of this chat, word for word, gets one more try.
 * Gemma answered roleplay turns 14/18/20 with the replies of turns 6/10/12 (overlap 0.52–0.96); different replies
 * in two days of test chats never went above 0.24. Asking for the same thing again ("อีกที") is left alone.
 */
export function repeatsEarlierReply(draft: string, history: ChatMessage[], userText: string): boolean {
  if (String(draft ?? '').replace(/\s+/g, '').length < 120 || ASKS_REPEAT.test(userText ?? '')) return false;
  return history
    .filter((m) => m.role === 'assistant' && m.status !== 'error')
    .slice(-20)
    .some((m) => { const t = textOf(m); return t.replace(/\s+/g, '').length >= 120 && overlap(draft, t) >= REPEAT_LIMIT; });
}

/** Turn-context note for the second try. */
export const REPEAT_NOTE = 'ร่างคำตอบก่อนหน้านี้ซ้ำกับคำตอบเก่าในแชตนี้เกือบทั้งหมด ให้ตอบข้อความล่าสุดของผู้ใช้ใหม่ด้วยคำของตัวเอง ห้ามคัดลอกคำตอบเก่า';
