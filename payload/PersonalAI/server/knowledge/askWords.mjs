// Words that say WHERE to look or HOW to answer, not WHAT the question is about: "ค้นเว็บ …",
// "แล้วในคลังความรู้ของเราเขียนไว้ว่ายังไง". Searching with them makes matching worse: a library chunk never contains
// "ค้นเว็บ" or "เขียนไว้ว่ายังไง", and the library needs most key words of the question in the chunk, so the follow-up
// "ค้นเว็บ การเลือกตั้งปี 2569 … แล้วในคลังความรู้ของเราเขียนไว้ว่ายังไง" found nothing (claude-20261024, Real Chat Check
// rounds 9–10) although the same question without those words found the note.

// "ค้นเว็บ", "ช่วยค้นในอินเทอร์เน็ตให้หน่อย", "ค้นหาจากกูเกิล" (a search verb + where). "หาเว็บ…" (find a website) is a topic.
const WEB_ASK = /(?:ช่วย|ลอง)?\s*ค้น(?:หา)?\s*(?:ข้อมูล)?\s*(?:ใน|จาก|บน)?\s*(?:เว็บไซต์|เว็บ|เน็ต|อินเทอร์เน็ต|อินเตอร์เน็ต|กูเกิล|google)\s*(?:ให้\s*)?(?:หน่อย|ที|ด้วย)?/giu;
// "ดูในคลังความรู้ให้หน่อย", "แล้วในคลังความรู้ของเรา", "จาก RAG".
const LIBRARY_ASK = /(?:แล้ว)?\s*(?:ช่วย|ลอง)?\s*(?:ดู|ค้น(?:หา)?|หา|เปิด|เช็ก|เช็ค)?\s*(?:ใน|จาก|ตาม)?\s*(?:คลังความรู้|คลังข้อมูล|rag)\s*(?:ของ\s*(?:เรา|ฉัน|ผม|คุณ|เธอ|หนู|นาย))?\s*(?:ให้\s*)?(?:หน่อย|ที|ด้วย)?/giu;
// "เขียนไว้ว่ายังไง", "บอกว่าอะไร", "ว่ายังไง". A bare "ใครเขียน" stays (that one is about the author).
const ANSWER_ASK = /(?:เขียน|บอก|ระบุ|จด)\s*(?:ไว้\s*)?(?:ว่า\s*)?(?:ยังไง|อย่างไร|ไง|อะไร(?:บ้าง)?)|(?:เขียน|บอก|ระบุ|จด)\s*ไว้\s*ว่า|ว่า\s*(?:ยังไง|อย่างไร)/gu;
// The topic between the asking words: "ในคลังความรู้เขียนเรื่อง ROCm 10 ไว้ว่ายังไง" → "ROCm 10", and "มีอะไรเกี่ยวกับ X บ้าง" → "X"
// (claude-20261024, research-agent Real Chat Check: "เขียนเรื่อง ROCm 10 ไว้" was searched and the note just saved was not
// found). Only with "เรื่อง/เกี่ยวกับ" right after the verb: "จดหมายเขียนไว้ว่าอะไร" keeps "จดหมาย".
const SPLIT_ASK = /(?:เขียน|บอก|ระบุ)\s*(?:ไว้\s*)?(?:เรื่อง|เกี่ยวกับ)\s*(\S.*?)\s*(?:ไว้\s*)?(?:ว่า\s*)?(?:ยังไง|อย่างไร|ไง|อะไร(?:บ้าง)?)/gu;
const ABOUT_ASK = /(?:^|\s|แล้ว)มี\s*(?:อะไร|ข้อมูล|โน้ต|บันทึก)?\s*(?:อะไร\s*)?(?:เกี่ยวกับ|เรื่อง)\s*/gu;
const LEAD = /^(?:แล้ว|และ)\s*/u;
const TAIL = /(?:\s*(?:บ้าง|ล่ะ|ละ|นะ|หน่อย|ครับ|ค่ะ|คะ|จ้า|ด้วย))+\s*[?？!.]*$/u;

const tidy = (s) => s.replace(/\s+/gu, ' ').trim().replace(LEAD, '').replace(TAIL, '').trim();

/** The question without the asking words (may be empty when the message was nothing but asking words). */
export function stripAskWords(text) {
  return tidy(String(text ?? '').replace(WEB_ASK, ' ').replace(LIBRARY_ASK, ' ').replace(SPLIT_ASK, ' $1 ').replace(ABOUT_ASK, ' ').replace(ANSWER_ASK, ' '));
}

/** Only the web command removed ("ค้นเว็บ ราคาทองวันนี้" → "ราคาทองวันนี้"), for queries sent to the search engine. */
export function stripWebAsk(text) {
  return String(text ?? '').replace(WEB_ASK, ' ').replace(/\s+/gu, ' ').trim();
}

/**
 * Query and follow-up context for a library search, without the asking words. An ask that is nothing but asking
 * words ("แล้วในคลังความรู้ของเราเขียนไว้ว่ายังไง") searches with the previous question instead.
 */
export function searchTerms(query, context = '') {
  const q = stripAskWords(query), c = stripAskWords(context);
  if (q) return { query: q, context: c };
  return { query: c || String(query ?? '').trim(), context: '' };
}
