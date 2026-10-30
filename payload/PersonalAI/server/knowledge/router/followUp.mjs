import { extractSearchConstraints, stripConstraintTerms } from '../web/queryRewrite.mjs';

// Day words. A follow-up that names its own day ("แล้วเมื่อวานล่ะ" after "ราคาทองคำแท่งวันนี้") drops the previous
// question's: the search got "ราคาทองคำแท่งวันนี้ แล้วเมื่อวานล่ะ" and the answer mixed the two days (claude-20261024).
const DAY_WORDS = /เมื่อวานซืน|เมื่อวานนี้|เมื่อวาน|วันนี้|ตอนนี้|ขณะนี้|ล่าสุด|ปัจจุบัน|พรุ่งนี้|มะรืนนี้|มะรืน|(?:สัปดาห์|อาทิตย์|เดือน|ปี)(?:นี้|ที่แล้ว|ก่อน|หน้า)|\btoday\b|\bnow\b|\blatest\b|\byesterday\b|\btomorrow\b|\b(?:this|last|next) (?:week|month|year)\b/giu;
const NAMES_DAY = new RegExp(DAY_WORDS.source, 'iu');

/** "previous + latest" where a market/period/day the latest text restates replaces the previous one. */
export function joinFollowUp(previous, latest) {
  const stated = extractSearchConstraints(latest);
  let earlier = stripConstraintTerms(previous, stated);
  if (NAMES_DAY.test(String(latest ?? ''))) earlier = earlier.replace(DAY_WORDS, '').replace(/\s+/gu, ' ').trim();
  return `${earlier} ${String(latest ?? '').trim()}`.trim();
}

const FOLLOW_UP = /^(แล้ว|และ|อีก|ถ้า|แล้วถ้า|อันนั้น|เรื่องนั้น|what about|how about|and |also |then |it |that |those |same )/iu;

// Short replies like "โอเค ขอบคุณนะ" or "555 จริงด้วย" are conversation, not a new lookup.
const ACK = /^(?:โอเค|ok|okay|ขอบคุณ|ขอบใจ|thx|thanks|thank you|ได้เลย|เข้าใจแล้ว|จริง|ใช่|ฮ่า|555|เยี่ยม|ดีมาก|สุดยอด|น่ารัก|เก่ง|อืม|อ๋อ|ไม่เป็นไร|good|great|nice|cool|lol)/iu;
const ASKS = /(ล่ะ|ละ|ไหม|มั้ย|บ้าง|อะไร|ใคร|ที่ไหน|เท่าไ[รห]|กี่|เมื่อไ[รห]|ยังไง|อย่างไร|หรือเปล่า|\?|what|who|where|when|how|which)/iu;
// A short question is a follow-up only when it leans on the previous turn ("…ล่ะ", "อายุเท่าไหร่", "ซื้อตอนนี้ดีไหม",
// "กี่บาท"). One that brings its own subject ("ปลาวาฬกินอะไร", "แมวกินอะไรได้บ้าง") starts a new topic instead of
// being glued to the previous search (which sent it to the web with the old topic's words).
const QUESTION_WORDS = /(?:อะไร|ใคร|ที่ไหน|ไหน|เท่าไหร่|เท่าไร|เท่าไหร|กี่|เมื่อไหร่|เมื่อไร|ยังไง|อย่างไร|หรือเปล่า|หรือยัง|หรือไม่|ไหม|มั้ย|มั๊ย|บ้าง|ล่ะ|ละ|what|who|where|when|how much|how many|how|which)/giu;
const LEANING = /(?:ราคา|อายุ|ขนาด|สี|น้ำหนัก|ส่วนสูง|ที่อยู่|เบอร์|เวลา|วันที่|ชื่อ|รุ่น|สเปค|คะแนน|อันดับ|ผล|ตาราง|รอบ|สาขา|ร้าน|ซื้อ|ขาย|ขึ้น|ลง|แพง|ถูก|ดี|คุ้ม|จอง|เปิด|ปิด|แข่ง|ชนะ|แพ้|ออก|เหลือ|เพิ่ม|ลด|ตอนนี้|วันนี้|พรุ่งนี้|เมื่อวาน|เมื่อคืน|ปีนี้|ปีหน้า|เดือนนี้|เดือนหน้า|สัปดาห์นี้|อาทิตย์นี้|โมง|นาที|ชั่วโมง|วัน|เดือน|ปี|บาท|คน|ครั้ง|ชิ้น|อัน|ตัว|มัน|เขา|นี้|นั้น|price|age|size|colou?r|time|date|cost|they|this|that|now|today|tomorrow|yesterday)/giu;
const PARTICLES = /(?:ครับ|คะ|ค่ะ|นะ|จ๊ะ|จ้า|หน่อย|ด้วย|เลย|แล้ว|ก็|ได้|เป็น|คือ|มี|จะ|ที่|ของ|ใน|กับ|และ|หรือ|the|is|are|it|\?|!|\s)/giu;
function leansBack(text) {
  if (/(?:ล่ะ|ละ)\s*[?!]*\s*$/u.test(text)) return true;
  return text.replace(QUESTION_WORDS, '').replace(LEANING, '').replace(PARTICLES, '').length <= 1;
}

export function resolveFollowUp(query, context = {}) {
  const text = String(query ?? '').trim();
  const previous = String(context.previousQuery ?? '').trim();
  const isFollowUp = Boolean(previous && !ACK.test(text) && (FOLLOW_UP.test(text) || (text.length <= 22 && ASKS.test(text) && leansBack(text))));
  return {
    query: isFollowUp ? joinFollowUp(previous, text) : text,
    isFollowUp,
    stickyRoute: isFollowUp && context.previousRoute ? context.previousRoute : null,
  };
}

