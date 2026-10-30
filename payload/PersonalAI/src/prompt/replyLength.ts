// Reply length by message type (step 3b). The persona already says "casual replies 1–3 sentences", but the model
// drifts long; a one-line rule on THIS turn plus a generous token cap keeps replies proportionate.
export type ReplyLength = 'ack' | 'short' | 'explain' | 'long';

const ACK = /^(?:ok|okay|โอเค|ได้|ครับ|ค่ะ|คะ|จ้า|จ้ะ|อืม|อ๋อ|อ่อ|เออ|เข้าใจแล้ว|เข้าใจ|ขอบคุณ|ขอบใจ|thx|thanks|thank you|สวัสดี|หวัดดี|hello|hi|hey|555+|ฮ่า+|ดี|ดีมาก|เยี่ยม|เจ๋ง|ไม่แย่(?:\s*ๆ)?|พอแล้ว|แค่นี้|ไม่เป็นไร|ช่างมัน|บาย|bye|ราตรีสวัสดิ์|ฝันดี|ไว้คุยกันใหม่)(?:\s*(?:นะ|เลย|จ้า|ครับ|ค่ะ|คะ|เนอะ|แหละ))*[\s!.~ๆ]*$/iu;
// The user asked for something that is long by nature, or for detail.
const LONG = /(ละเอียด|ยาว\s*ๆ|เต็มที่|ทีละขั้น|ขั้นตอน|เขียน|แต่ง|ร่าง|เรียงความ|รายงาน|แปลบทความ|วางแผน|เปรียบเทียบ|วิเคราะห์|สอน|ตัวอย่าง|โค้ด|เล่านิทาน|เล่าเรื่อง|in detail|step[- ]by[- ]step|\bwrite\b|\bdraft\b|\bessay\b|\bcode\b|\bcompare\b|\banaly[sz]e\b|tutorial|\bstory\b|```)/iu;
const SHORT_ASK = /(สั้น\s*ๆ|แบบย่อ|ย่อ\s*ๆ|ประโยคเดียว|บรรทัดเดียว|briefly|\bshort\b|tl;dr|one sentence|in a word)/iu;
// An explanation question deserves one compact paragraph, not a one-liner and not an essay.
const EXPLAIN = /(ทำไม|เพราะอะไร|อย่างไร|ยังไง|คืออะไร|หมายถึง|อธิบาย|ต่างกัน|\bwhy\b|\bhow\b|what is|what's|explain)/iu;

export function classifyReplyLength(text: string, opts: { hasAttachment?: boolean } = {}): ReplyLength | undefined {
  const t = String(text ?? '').trim();
  if (!t) return undefined;
  if (ACK.test(t)) return 'ack';
  if (opts.hasAttachment) return undefined;
  if (SHORT_ASK.test(t)) return 'short';
  if (LONG.test(t) || t.length > 240) return 'long';
  if (EXPLAIN.test(t)) return 'explain';
  return t.length <= 90 ? 'short' : 'explain';
}

/** Generous caps (≈4× the target) so a drifting model is cut off, not a well-behaved one. Tokens. */
export const REPLY_TOKEN_CAP: Record<ReplyLength, number | undefined> = { ack: 160, short: 450, explain: 800, long: undefined };

const RULES: Record<ReplyLength, string> = {
  ack: 'Reply length: the user sent a short acknowledgement, greeting or goodbye. Answer in one short line. No advice, recap, list, or follow-up question.',
  short: 'Reply length: this is casual conversation or a simple question. Answer directly in 1–3 sentences; add detail only if the user asks.',
  explain: 'Reply length: answer in one compact paragraph (about 3–6 sentences), no headings or lists, and no closing offer or question unless a real decision is left.',
  long: '',
};
export const replyLengthRule = (len?: ReplyLength) => (len ? RULES[len] : '');

// "ไม่เกิน 3 บรรทัด", "ตอบคำเดียว": an explicit limit from the user, followed exactly (claude-20261023: asked for at
// most 3 lines, Gemma added a lead-in line "นี่คือสูตร…:" on top of the 3 steps).
const TH_NUM: Record<string, number> = { หนึ่ง: 1, สอง: 2, สาม: 3, สี่: 4, ห้า: 5, หก: 6, เจ็ด: 7, แปด: 8, เก้า: 9, สิบ: 10 };
const LIMIT = /(?:ไม่เกิน|แค่|เพียง|สัก|ขอ)\s*(\d{1,2}|หนึ่ง|สอง|สาม|สี่|ห้า|หก|เจ็ด|แปด|เก้า|สิบ)\s*(บรรทัด|ข้อ|ประโยค|คำ|ย่อหน้า)/u;
const ONE = /(คำเดียว|ประโยคเดียว|บรรทัดเดียว|ข้อเดียว|ย่อหน้าเดียว|in one word|one word|one sentence|one line)/iu;
export function formatLimitRule(text: string): string {
  const t = String(text ?? '');
  const one = t.match(ONE);
  const m = one ? null : t.match(LIMIT);
  if (!one && !m) return '';
  const asked = one ? `"${one[1]}"` : `at most ${TH_NUM[m![1]] ?? Number(m![1])} ${m![2]}`;
  return `Format: the user asked for ${asked}. Give exactly that and nothing else: no lead-in line (such as "นี่คือ…:"), no closing line, no extra notes.`;
}
