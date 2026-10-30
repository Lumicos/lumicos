// Memory candidates: things in a user message that MIGHT be worth remembering.
// Nothing here saves anything. Candidates are shown to the user, who decides:
// Save / Edit / Ignore. Rules are deliberately conservative.
import { similarity } from './text.mjs';

const QUESTION = /[?？]\s*$|(?:ไหม|มั้ย|หรือเปล่า|หรือยัง|อะไร|ยังไง|อย่างไร|ทำไม|เท่าไร|เท่าไหร่|ที่ไหน|ใคร|กี่)\s*(?:ครับ|ค่ะ|คะ|นะ|จ๊ะ)?\s*$|^(?:what|how|why|when|where|who|which|can|could|would|should|is|are|do|does|did)\b/i;
const GREETING = /^(?:hi|hello|hey|yo|thanks|thank you|ok|okay|good (?:morning|night)|สวัสดี|หวัดดี|ขอบคุณ|โอเค|ดี(?:ครับ|ค่ะ)?|555+|ฮ่า+)\b/i;
const THAI = /[฀-๿]/;

const RULES = [
  {
    // "remember that …" / "จำไว้ว่า …" — the user explicitly asks.
    id: 'explicit',
    re: /(?:^|\s)(?:please\s+)?(?:remember(?:\s+that)?|keep in mind(?:\s+that)?|don't forget(?:\s+that)?|note that|make a note(?:\s+that)?|take note(?:\s+that)?)[\s:,-]+(.{3,})/i,
    reTh: /(?:ช่วย)?(?:จำ|จด)(?:ไว้|เอาไว้)?(?:ด้วย)?(?:นะ)?(?:ว่า)[\s:]*(.{3,})/,
    explicit: true,
    importance: 4,
  },
  {
    id: 'name',
    re: /\b(?:my name is|call me)\s+([\p{L}][\p{L}\d-]{0,30})/iu,
    reTh: /(?:ฉัน|ผม|เรา|หนู|ดิฉัน|กู)ชื่อ\s*([^\s,.!?]{1,30})/,
    type: 'user_fact',
    make: (m, th) => (th ? `ผู้ใช้ชื่อ ${m[1]}` : `User's name is ${m[1]}.`),
    tags: ['name'],
    importance: 5,
  },
  {
    id: 'naming-ai',
    re: /\b(?:your name is|i(?:'ll| will) call you)\s+([\p{L}][\p{L}\d-]{0,30})/iu,
    reTh: /(?:ตั้งชื่อ|เรียก)(?:คุณ|เธอ|นาย)ว่า\s*([^\s,.!?]{1,30})/,
    type: 'relationship',
    make: (m, th) => (th ? `ผู้ใช้เรียก AI ว่า ${m[1]}` : `The user calls the AI "${m[1]}".`),
    tags: ['name'],
    importance: 4,
  },
  {
    id: 'hardware',
    re: /\b(?:RX|RTX|GTX|Arc)\s?\d{3,4}\b|\bRyzen\s?\d\s?\d{3,4}|\bi[3579][-\s]?\d{4,5}|\b\d{1,3}\s?GB\s?(?:RAM|VRAM)\b/i,
    requires: /\b(?:my|i have|i use|i'm using|i am using|mine)\b|ของ(?:ฉัน|ผม|เรา)|เครื่อง(?:ฉัน|ผม|เรา)?|(?:ฉัน|ผม|เรา)(?:ใช้|มี)|สเปค/i,
    type: 'user_fact',
    tags: ['hardware'],
    importance: 4,
  },
  {
    id: 'decision',
    re: /\b(?:i(?:'ve| have)? decided|we(?:'ve| have)? decided|let's go with|we'll use|i'll use|going with|switch(?:ed|ing)? to)\b/i,
    reTh: /ตัดสินใจ|ตกลง(?:ใช้|เลือก)|เลือกใช้|จะใช้.+เป็นหลัก|เปลี่ยนไปใช้/,
    type: 'decision',
    importance: 3,
  },
  {
    id: 'project',
    re: /\bi(?:'m| am) (?:building|developing|working on|making)\b|\bmy project\b/i,
    reTh: /(?:ฉัน|ผม|เรา)?กำลัง(?:ทำ|พัฒนา|สร้าง)(?:โปรเจ|โปรแกรม|แอป|ระบบ|เว็บ)|โปรเจกต์(?:ของ)?(?:ฉัน|ผม|เรา)|โปรเจค(?:ของ)?(?:ฉัน|ผม|เรา)/,
    type: 'project',
    importance: 3,
  },
  {
    id: 'instruction',
    re: /\b(?:i want you to|i'd like you to|please always|always answer|never answer|from now on)\b/i,
    reTh: /(?:อยากให้|ขอให้)(?:คุณ|เธอ|นาย)|ต่อไปนี้(?:ให้)?|ตอบ(?:เป็น|แบบ).+(?:เสมอ|ตลอด)/,
    type: 'instruction',
    importance: 3,
  },
  {
    id: 'preference',
    re: /\bi (?:really )?(?:prefer|like|love|hate|dislike|don't like|do not like|enjoy)\b/i,
    reTh: /(?:ฉัน|ผม|เรา|หนู)(?:ชอบ|ไม่ชอบ|เกลียด|ชอบมาก)|(?:ชอบ|ไม่ชอบ)(?:ให้|แบบ|ที่)/,
    type: 'preference',
    importance: 3,
  },
];

/** Guess a type for explicit "remember …" content. */
function guessType(text) {
  for (const r of RULES) {
    if (r.explicit || !r.type) continue;
    if (r.re?.test(text) || r.reTh?.test(text)) return r.type;
  }
  if (/(?:คุณ|เธอ|you\b)/i.test(text)) return 'relationship';
  return 'general';
}

function sentences(text) {
  return text
    .split(/\n+|(?<=[.!?。])\s+/)
    .map((s) => s.trim())
    .filter(Boolean);
}

const tidy = (s) => s.replace(/\s+/g, ' ').replace(/^[\s,:-]+|[\s,]+$/g, '').slice(0, 280);

/**
 * @param {string} text user message
 * @param {{ existing?: {content:string}[], pending?: string[] }} ctx memories/candidates to avoid duplicating
 * @returns {{ type, content, tags, importance, rule }[]}
 */
export function extractCandidates(text, { existing = [], pending = [] } = {}) {
  const message = String(text ?? '').trim();
  if (message.length < 6 || message.length > 1500) return [];
  const out = [];

  for (const sentence of sentences(message)) {
    if (sentence.length < 6 || GREETING.test(sentence) && sentence.length < 25) continue;
    const th = THAI.test(sentence);

    for (const rule of RULES) {
      const m = (th && rule.reTh ? rule.reTh.exec(sentence) : null) ?? rule.re?.exec(sentence);
      if (!m) continue;
      // Questions are not facts — unless the user explicitly asked to remember.
      if (!rule.explicit && QUESTION.test(sentence)) continue;
      if (rule.requires && !rule.requires.test(sentence)) continue;

      let content;
      let type = rule.type;
      if (rule.explicit) {
        content = tidy(m[1]);
        type = guessType(content);
      } else if (rule.make) content = rule.make(m, th);
      else content = tidy(sentence);
      if (content.length < 4) continue;

      out.push({ type, content, tags: rule.tags ?? [], importance: rule.importance, rule: rule.id });
      break; // one candidate per sentence
    }
  }

  // Drop near-duplicates of each other, of saved memories and of pending candidates.
  const known = [...existing.map((m) => m.content), ...pending];
  const unique = [];
  for (const c of out) {
    if (known.some((k) => similarity(k, c.content) >= 0.6)) continue;
    if (unique.some((u) => similarity(u.content, c.content) >= 0.6)) continue;
    unique.push(c);
  }
  return unique.slice(0, 3);
}

/** Filters model-proposed candidates (from "Find memories") against saved ones. */
export function dedupeCandidates(candidates, { existing = [] } = {}) {
  const known = existing.map((m) => m.content);
  const out = [];
  for (const c of candidates ?? []) {
    const content = tidy(String(c?.content ?? ''));
    if (content.length < 4) continue;
    if (known.some((k) => similarity(k, content) >= 0.6)) continue;
    if (out.some((u) => similarity(u.content, content) >= 0.6)) continue;
    out.push({ type: c.type ?? 'general', content, tags: Array.isArray(c.tags) ? c.tags : [], importance: Number(c.importance) || 3, rule: 'model' });
  }
  return out.slice(0, 8);
}
