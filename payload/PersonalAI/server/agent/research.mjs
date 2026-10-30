// Lumicos's first agent job: research a topic on the web and keep a checked note in the knowledge library
// (user, 2026-10-24: "ทำให้เธอเป็นเอเจนเลย ไอการค้นหาแล้วเอาเข้าคลังน่าสนใจมาก").
// A bounded agent, the kind that works with a small model: the program runs the steps; the model only writes the
// search queries and the note, and every fact line is checked against the sources before anything is saved.

export const MAX_QUERIES = 4;
export const MAX_SOURCES = 6;
const SNIPPET = 1100; // the whole passage Search v6 returns (claude-20261024: a 6-source note prompt was only ~1,400 tokens)

// "ค้นเรื่อง X แล้วเก็บเข้าคลัง", "ช่วยหาข้อมูลเกี่ยวกับ X แล้วบันทึกลงคลังความรู้ให้หน่อย", "research X and save it to the library"
const VERB = String.raw`(?:ช่วย\s*)?(?:ไป\s*)?(?:ค้นคว้า|ค้นหา|ค้น|หาข้อมูล|รวบรวมข้อมูล|รวบรวม|สรุป|ศึกษา|เรียนรู้)`;
const SAVE = String.raw`(?:แล้ว|และ|มา)?\s*(?:ช่วย\s*)?(?:เก็บ|บันทึก|เพิ่ม|ใส่|จด)\s*(?:ไว้\s*)?(?:เข้า|ลง|ไว้ใน|ใน|ไปที่|ไว้ที่|ไป)?\s*(?:คลังความรู้|คลังข้อมูล|คลัง|rag)`;
const ASK_TH = new RegExp(`${VERB}\\s*(.{2,160}?)\\s*${SAVE}`, 'iu');
const ASK_EN = /\bresearch\s+(.{2,160}?)\s+(?:and\s+)?(?:save|store|add|put|keep)\s+(?:it\s+|them\s+)?(?:to|in|into)\s+(?:the\s+|my\s+|our\s+)?(?:knowledge\s+)?(?:library|base|rag)\b/iu;
// "ค้นเว็บเรื่อง X", "ค้นในเน็ตหาข้อมูลเกี่ยวกับ X": the web words belong to the command, not the topic.
const LEAD = /^(?:(?:ใน|จาก|ทาง)?\s*(?:เว็บ(?:ไซต์)?|อินเทอร์เน็ต|อินเตอร์เน็ต|เน็ต|ออนไลน์|google|กูเกิล?)\s*(?=(?:หา|ดู)?\s*(?:ข้อมูล)?\s*(?:เรื่อง|เกี่ยวกับ)|$))?(?:(?:หา|ดู)\s*)?(?:ข้อมูล\s*)?(?:เรื่อง|เกี่ยวกับ|ของ)?\s*/iu;
const TAIL = /(?:\s*(?:ให้หน่อย|หน่อย|ด้วย|นะ|ที))+$/u;
// "สรุปแล้วเพิ่มเข้าคลัง", "ค้นอันนี้เก็บเข้าคลัง": save what was said, not a new topic (the existing save offer handles that).
const NO_TOPIC = /^(?:แล้ว|นี้|อันนี้|ข้อมูลนี้|เรื่องนี้|ทั้งหมด|ให้|ไว้|ที่คุย(?:กัน)?(?:มา)?|คำตอบ(?:นี้)?)$/u;

/** The topic of a "research it and keep it in the library" request, or null. */
export function researchTopic(text) {
  const t = String(text ?? '').replace(/\s+/gu, ' ').trim();
  const m = t.match(ASK_TH) ?? t.match(ASK_EN);
  if (!m) return null;
  const topic = m[1].replace(LEAD, '').replace(TAIL, '').trim().replace(/^["“'']+|["”'']+$/gu, '').trim();
  return topic.length >= 2 && !NO_TOPIC.test(topic) ? topic.slice(0, 160) : null;
}

// "อัปเดตเรื่อง X ในคลัง", "อัปเดตข้อมูล X ในคลังความรู้ให้หน่อย", "ค้นเรื่อง X ใหม่แล้วอัปเดตในคลัง", "update X in the library"
// (claude-20261025): research X again, save the new note and move the old note of X into knowledge/_archive.
const UPDATE_VERB = String.raw`(?:อัปเดต|อัพเดต|อัพเดท|อัปเดท)`;
const LIBRARY = String.raw`(?:คลังความรู้|คลังข้อมูล|คลัง|rag)`;
const POLITE_END = String.raw`(?:\s*(?:ให้\s*)?(?:หน่อย|ด้วย|นะ|ที|ครับ|ค่ะ|คะ|เลย))*\s*[.!]?\s*$`;
const UPDATE_TH = new RegExp(`(?:^|\\s)(?:ช่วย\\s*)?${UPDATE_VERB}\\s*(?:ข้อมูล\\s*)?(?:เรื่อง\\s*)?(.{2,120}?)\\s*(?:ใน|ที่|ของ|เข้า)\\s*${LIBRARY}${POLITE_END}`, 'iu');
const UPDATE_TH2 = new RegExp(`(?:^|\\s)(?:ช่วย\\s*)?(?:ค้น(?:หา|คว้า)?|หาข้อมูล)\\s*(?:เรื่อง\\s*)?(.{2,120}?)\\s*ใหม่\\s*(?:แล้ว|และ)?\\s*(?:ช่วย\\s*)?${UPDATE_VERB}\\s*(?:ใน|ที่|เข้า)?\\s*${LIBRARY}${POLITE_END}`, 'iu');
// "อัปเดตคลังเรื่อง X", "อัปเดตคลังความรู้เกี่ยวกับ X" (library first, topic after)
const UPDATE_TH3 = new RegExp(`(?:^|\\s)(?:ช่วย\\s*)?${UPDATE_VERB}\\s*${LIBRARY}\\s*(?:เรื่อง|เกี่ยวกับ|หัวข้อ)\\s*(.{2,120}?)${POLITE_END}`, 'iu');
const UPDATE_EN = /\bupdate\s+(.{2,120}?)\s+in\s+(?:the\s+|my\s+)?(?:knowledge\s+)?(?:library|base|rag)\b/iu;
/** "อัปเดตคลัง" / "อัปเดตข้อมูลในคลัง" with no topic: it is an update request, only the topic is missing. */
const UPDATE_BARE = new RegExp(`^\\s*(?:ช่วย\\s*)?${UPDATE_VERB}\\s*(?:ข้อมูล\\s*)?(?:(?:ใน|ที่|ของ|เข้า)\\s*)?${LIBRARY}${POLITE_END}`, 'iu');
export function updateMissingTopic(text) { return UPDATE_BARE.test(String(text ?? '').replace(/\s+/gu, ' ').trim()) && !updateTopic(text); }
/** The topic of an "update the note about X in the library" request, or null. */
export function updateTopic(text) {
  const t = String(text ?? '').replace(/\s+/gu, ' ').trim();
  const m = t.match(UPDATE_TH) ?? t.match(UPDATE_TH2) ?? t.match(UPDATE_TH3) ?? t.match(UPDATE_EN);
  if (!m) return null;
  const topic = m[1].replace(LEAD, '').replace(TAIL, '').trim().replace(/^["“'']+|["”'']+$/gu, '').trim();
  return topic.length >= 2 && !NO_TOPIC.test(topic) ? topic.slice(0, 160) : null;
}

// What a scheduled job asks for besides research/update (claude-20261025): "สรุปข่าว AI ให้หน่อย", "ค้นข่าวหุ้นไทยแล้วสรุปให้ฟัง",
// "สรุปราคาทองให้หน่อย", "บอกราคาน้ำมันหน่อย". Read only from a message that also says when (schedule.mjs).
const BRIEF_NEWS = /^(?:ช่วย\s*)?(?:สรุป|รายงาน|ส่ง|เล่า|บอก|อัปเดต|อัพเดต)\s*ข่าว\s*(.{0,80}?)(?:\s*(?:ให้\s*(?:หน่อย|ฟัง|อ่าน|ดู|ด้วย|ที)?|หน่อย|ด้วย|ที|นะ|ครับ|ค่ะ|คะ))*\s*[.!]?$/u;
const BRIEF_NEWS2 = /^(?:ช่วย\s*)?(?:ค้น(?:หา)?|หา|ดู)\s*ข่าว\s*(.{0,80}?)\s*(?:แล้ว|และ)?\s*(?:มา)?\s*(?:สรุป|รายงาน|เล่า|บอก)(?:\s*(?:ให้\s*(?:หน่อย|ฟัง|อ่าน|ดู)?|หน่อย|ด้วย|ที|นะ))*\s*[.!]?$/u;
const BRIEF_OTHER = /^(?:ช่วย\s*)?(?:สรุป|รายงาน|บอก|แจ้ง|เช็[กค])\s*(?:เรื่อง|ข้อมูล)?\s*(.{2,80}?)\s*(?:ให้\s*(?:หน่อย|ฟัง|อ่าน|ดู|ด้วย|ที)|หน่อย)(?:\s*(?:นะ|ครับ|ค่ะ|คะ))*\s*[.!]?$/u;
/** {topic, news} of a "summarize the news on X for me" job, or null. No topic: today's headlines. */
export function briefTopic(text) {
  const t = String(text ?? '').replace(/\s+/gu, ' ').trim();
  let m = t.match(BRIEF_NEWS) ?? t.match(BRIEF_NEWS2);
  if (m) {
    const topic = m[1].replace(/^(?:เรื่อง|เกี่ยวกับ|ของ)\s*/u, '').replace(TAIL, '').trim();
    return { topic: topic.length >= 1 && !/^(?:วันนี้|ล่าสุด|เช้านี้|ประจำวัน)$/u.test(topic) ? topic.slice(0, 120) : 'ข่าวเด่นวันนี้', news: true };
  }
  m = t.match(BRIEF_OTHER);
  if (m && !NO_TOPIC.test(m[1].trim())) return { topic: m[1].replace(TAIL, '').trim().slice(0, 120), news: false };
  return null;
}

/** "ยกเลิกงานค้นคว้า", "หยุดงานค้นหา", "ยกเลิกงานสรุปไฟล์" (acted on only while a job is queued or running) */
export const CANCEL_ASK = /^\s*(?:ช่วย\s*)?(?:ยกเลิก|หยุด)\s*(?:งาน)?\s*(?:ค้นคว้า|ค้นหา|ค้น|research|อัปเดต|อัพเดต|สรุป|วางแผน(?:เที่ยว)?|(?:ทำ)?(?:แบบทดสอบ|ข้อสอบ))|^\s*(?:ช่วย\s*)?(?:ยกเลิก|หยุด)\s*งาน\s*(?:ทั้งหมด|เบื้องหลัง|ของ\s*(?:lumicos|โนวา))|^\s*(?:cancel|stop)\s+(?:the\s+)?research/iu;
/** "งานค้นคว้าถึงไหนแล้ว", "งานค้นเสร็จยัง", "งานสรุปไฟล์เสร็จยัง" */
export const STATUS_ASK = /งาน\s*(?:ค้นคว้า|ค้นหา|ค้น|อัปเดต|อัพเดต|สรุป(?:ไฟล์|ข่าว)?|เบื้องหลัง|วางแผนเที่ยว|แผนเที่ยว|(?:ทำ)?(?:แบบทดสอบ|ข้อสอบ)).{0,40}?(?:ถึงไหน|ไปถึงไหน|เป็นไง|เป็นยังไง|เสร็จ(?:หรือ)?ยัง|คืบหน้า|มีอะไรบ้าง|อยู่ไหม|ค้างอยู่)|research\s+(?:status|progress)/iu;

/** Today in Thai (Bangkok), e.g. "24 ตุลาคม 2569". */
export function thaiToday(now = Date.now()) {
  const d = new Date(now + 7 * 3_600_000);
  const months = ['มกราคม', 'กุมภาพันธ์', 'มีนาคม', 'เมษายน', 'พฤษภาคม', 'มิถุนายน', 'กรกฎาคม', 'สิงหาคม', 'กันยายน', 'ตุลาคม', 'พฤศจิกายน', 'ธันวาคม'];
  return `${d.getUTCDate()} ${months[d.getUTCMonth()]} ${d.getUTCFullYear() + 543}`;
}

/** The topic first, then the model's queries (one per line), without numbering or quotes; at most MAX_QUERIES. */
export function parseQueries(text, topic) {
  const lines = String(text ?? '').replace(/<think>[\s\S]*?<\/think>/g, '').split(/\r?\n/)
    .map((l) => l.replace(/^\s*(?:[-*•]|\d+[.)])\s*/u, '').replace(/^["“'']+|["”'']+$/gu, '').replace(/\s+/gu, ' ').trim())
    // not an intro or a label ("นี่คือคำค้น 3 คำ:", "Here are three queries:", "คำค้นภาษาไทย:")
    .filter((l) => l.length >= 3 && l.length <= 120 && !/[:：]$/u.test(l) && !/^(?:queries?|คำค้น|search(?:es)?)\s*[:：]?$|^(?:นี่คือ|ต่อไปนี้|ได้เลย|here (?:are|is)|sure\b|okay\b)/iu.test(l));
  const seen = new Set();
  return [topic, ...lines].filter((q) => { const k = String(q).toLowerCase(); if (!q || seen.has(k)) return false; seen.add(k); return true; }).slice(0, MAX_QUERIES);
}

const urlKey = (u) => String(u ?? '').replace(/^https?:\/\/(www\.)?/i, '').replace(/[#?].*$/, '').replace(/\/+$/, '').toLowerCase();

/** Up to `max` distinct sources, taken in turn from each query's results so every angle contributes. */
export function collectSources(lists, max = MAX_SOURCES) {
  const seen = new Set(), out = [];
  for (let i = 0; out.length < max; i++) {
    let any = false;
    for (const list of lists) {
      const r = list?.[i];
      if (!r) continue;
      any = true;
      const key = urlKey(r.url), text = String(r.snippet ?? '').replace(/\s+/gu, ' ').trim();
      if (!key || seen.has(key) || text.length < 40) continue;
      seen.add(key);
      out.push({ title: String(r.title ?? '').replace(/\s+/gu, ' ').trim().slice(0, 200), url: r.url, text: text.slice(0, SNIPPET), publishedAt: r.publishedAt ?? null });
      if (out.length >= max) break;
    }
    if (!any) break;
  }
  return out;
}

const arabic = (s) => String(s).replace(/[๐-๙]/gu, (c) => String(c.charCodeAt(0) - 0x0e50));
const NUM = /\d[\d,]*(?:\.\d+)*/g;
/** Numbers a line states (2+ digits; thousands commas removed; "[2]" source marks ignored). */
export function numbersIn(line) {
  return [...arabic(String(line).replace(/\[\d{1,2}\]/g, ' ')).matchAll(NUM)].map((m) => m[0].replace(/,(?=\d{3}(?:\D|$))/g, '').replace(/[,.]+$/, ''))
    .filter((n) => n.replace(/\D/g, '').length >= 2);
}
/** Is the number in the text? Trailing zeros do not matter (12 = 12.0, 1234.50 = 1,234.5); a year also counts in
 *  the other era (2569 = 2026); a dotted version must appear as written, except for ".0" parts at the end
 *  (10.1 = 10.1.0: claude-20261024, a real run cut "ROCm Core SDK 10.1" because the release notes write 10.1.0). */
export function numberIn(num, text) {
  const t = arabic(text).replace(/(\d),(?=\d{3}(?:\D|$))/g, '$1');
  let n = num;
  if ((n.match(/\./g) ?? []).length > 1) {
    const short = n.replace(/(?:\.0+)+$/, '');
    if ((short.match(/\./g) ?? []).length > 1) return new RegExp(`(?<![\\d.])${short.replace(/\./g, '\\.')}(?:\\.0+)*(?![\\d]|\\.\\d)`).test(t);
    n = short;
  }
  const base = n.includes('.') ? n.replace(/0+$/, '').replace(/\.$/, '') : n;
  const forms = new Set([base]);
  if (/^\d{4}$/.test(base)) { const y = Number(base); forms.add(String(y > 2400 ? y - 543 : y + 543)); }
  if (/^0\d+$/.test(base)) forms.add(String(Number(base))); // "05" in a date = 5
  return [...forms].some((v) => new RegExp(`(?<![\\d.])${v.replace(/\./g, '\\.')}${v.includes('.') ? '0*' : ''}(?:\\.0+)*(?![\\d]|\\.\\d)`).test(t));
}

// What the model was shown for a source (sourceBlock below), date included: a real run cut a line for "2026-10-05",
// which only the source's date carried (claude-20261024).
const sourceText = (s) => `${s.title} ${s.url} ${s.publishedAt ? String(s.publishedAt).slice(0, 10) : ''} ${s.text}`;
/** One row per line of the note except the title and blank lines: fact lines ("- … [n]"), the "สรุป:" and
 *  "ยังไม่แน่ชัด:" lines, and anything else (which fails: only lines that can be checked are kept). */
export function checkNote(note, sources) {
  const all = sources.map(sourceText).join('\n');
  const rows = [];
  let titled = false;
  for (const [index, raw] of String(note ?? '').split(/\r?\n/).entries()) {
    const line = raw.trim();
    if (!line) continue;
    if (!titled && /^#\s+\S/u.test(line)) { titled = true; continue; }
    const fact = /^[-•*]\s+/u.test(line), summary = /^สรุป\s*[:：]/u.test(line), unsure = /^ยังไม่แน่ชัด\s*[:：]/u.test(line);
    if (!fact && !summary && !unsure) { rows.push({ index, line, fact, summary, cites: [], problems: ['ไม่อยู่ในรูปแบบโน้ต (ข้อเท็จจริงต้องขึ้นต้นด้วย "- " และจบด้วย [n])'] }); continue; }
    const cites = [...new Set([...line.matchAll(/\[(\d{1,2})\]/g)].map((m) => Number(m[1])).filter((n) => n >= 1 && n <= sources.length))];
    const problems = [];
    if (fact && !cites.length) problems.push('ไม่มีเลขแหล่ง [n] ท้ายบรรทัด');
    const pool = cites.length ? cites.map((n) => sourceText(sources[n - 1])).join('\n') : all;
    for (const num of numbersIn(line)) if (!numberIn(num, pool)) problems.push(`ตัวเลข ${num} ไม่มีในแหล่ง${cites.length ? ` ${cites.map((n) => `[${n}]`).join('')}` : ''}`);
    rows.push({ index, line, fact, summary, cites, problems });
  }
  return rows;
}

/** The note without lines that still fail; counts the checked facts. */
export function keepChecked(note, rows) {
  const bad = new Map(rows.filter((r) => r.problems.length).map((r) => [r.index, r]));
  const lines = String(note ?? '').split(/\r?\n/);
  const text = lines.filter((_, i) => !bad.has(i)).join('\n').replace(/\n{3,}/g, '\n\n').trim();
  return { text, removed: [...bad.values()].map((r) => ({ line: r.line, problems: r.problems })), facts: rows.filter((r) => r.fact && !r.problems.length).length };
}

/** From the "# title" line on; <think> blocks, code fences and bold marks removed; "1. …" items become "- …";
 *  a bare "สรุป:" takes the next line. */
export function cleanNote(text) {
  const t = String(text ?? '').replace(/<think>[\s\S]*?<\/think>/g, '').replace(/^```(?:markdown|md)?\s*$/gim, '').replace(/\*\*|__/g, '')
    .replace(/^\s*\d{1,2}[.)]\s+/gmu, '- ').replace(/^(สรุป\s*[:：])[ \t]*\n+(?![ \t]*(?:[-•*#]|ยังไม่แน่ชัด))[ \t]*(\S.*)$/mu, '$1 $2').trim();
  const at = t.search(/^#\s+\S/m);
  return (at > 0 ? t.slice(at) : t).trim();
}
export const titleOf = (note) => String(note ?? '').match(/^#\s+(.+)$/m)?.[1]?.trim() ?? '';
export const summaryOf = (note) => String(note ?? '').match(/^สรุป\s*[:：]\s*(.+)$/mu)?.[1]?.trim() ?? '';
const withoutTitle = (note) => String(note ?? '').replace(/^#\s+.+\n?/m, '').trim();

const sourceBlock = (sources) => sources.map((s, i) => `[${i + 1}] ${s.title || s.url} — ${s.url}${s.publishedAt ? ` (${String(s.publishedAt).slice(0, 10)})` : ''}\n${s.text}`).join('\n\n');
const NOTE_RULES = 'You write a short research note for a personal knowledge library, in Thai, using ONLY the numbered sources. Format exactly:\n'
  + '# <short title>\nสรุป: <2–3 sentences>\n- <one fact per line, ending with its source number(s) like [2] or [1][3]>\n'
  + 'ยังไม่แน่ชัด: <optional, one line on what the sources do not settle>\n'
  + 'Write 4–10 fact lines. Copy numbers, dates and names exactly as the sources write them. If sources disagree, say so in one line with both values and both source numbers. '
  + 'Never add anything that is not in the sources, and never write a fact line without [n]. Output only the note.';

// mode 'news' / 'brief' (claude-20261025, scheduled jobs): a short summary posted in the chat instead of a library note
const BRIEF_RULES = 'You write a short brief in Thai for the user, using ONLY the numbered sources. Format exactly:\n'
  + '# <short title>\nสรุป: <1–2 sentences>\n- <one point per line, ending with its source number(s) like [2] or [1][3]>\n'
  + 'Write 3–6 points. Copy numbers, dates and names exactly as the sources write them. Never add anything that is not in the sources, '
  + 'and never write a point without [n]. Output only the brief.';
const NEWS_RULES = 'You write a short news brief in Thai for the user, using ONLY the numbered sources. Format exactly:\n'
  + '# <short title>\nสรุป: <1–2 sentences on the main news>\n- <one news item per line, with its date when the source gives one, ending with its source number(s) like [2]>\n'
  + 'Write 3–6 items, newest first; skip items older than about a week when newer ones exist. Copy numbers, dates and names exactly as the sources write them. '
  + 'Never add anything that is not in the sources, and never write an item without [n]. Output only the brief.';
const RULES = { note: NOTE_RULES, brief: BRIEF_RULES, news: NEWS_RULES };
const PLAN = {
  note: 'You plan web searches for a research task. Write 3 search queries that together cover the topic: one in Thai, one in English, and one for a specific angle (latest news, official source, or key numbers). One query per line, no numbering, no quotes, no explanation.',
  brief: 'You plan web searches for a short up-to-date summary. Write 3 search queries that together cover the topic as it is today: one in Thai, one in English, and one with the current month and year. One query per line, no numbering, no quotes, no explanation.',
  news: 'You plan web searches for today\'s news brief. Write 3 search queries for the latest news on the topic: one in Thai, one in English, and one with the current month and year. One query per line, no numbering, no quotes, no explanation.',
};

export const queryMessages = (topic, today, mode = 'note') => [
  { role: 'system', content: PLAN[mode] ?? PLAN.note },
  { role: 'user', content: `หัวข้อ: ${topic}\nวันนี้: ${today}` },
];
export const noteMessages = (topic, sources, today, mode = 'note') => [
  { role: 'system', content: RULES[mode] ?? NOTE_RULES },
  { role: 'user', content: `หัวข้อ: ${topic}\nวันนี้: ${today}\n\nแหล่งข้อมูล:\n${sourceBlock(sources)}` },
];
export const reviseMessages = (note, rows, sources, mode = 'note') => [
  { role: 'system', content: RULES[mode] ?? NOTE_RULES },
  { role: 'user', content: `โน้ตนี้มีบรรทัดที่ตรวจกับแหล่งแล้วไม่ผ่าน:\n${rows.filter((r) => r.problems.length).map((r) => `- "${r.line}": ${r.problems.join('; ')}`).join('\n')}\n`
    + `แก้เฉพาะบรรทัดเหล่านี้ให้ตรงกับแหล่ง (ใส่เลขแหล่งที่ถูก หรือคัดลอกตัวเลขตามแหล่ง) หรือลบบรรทัดนั้นทิ้ง แล้วส่งโน้ตทั้งฉบับกลับมาในรูปแบบเดิม\n\nโน้ต:\n${note}\n\nแหล่งข้อมูล:\n${sourceBlock(sources)}` },
];

/**
 * Runs one research job. ask(messages, params) → model text; search(query) → web results ({title,url,snippet,publishedAt});
 * save({title, body, sources, topic}) → {file}. Returns {status: 'saved' | 'not-enough', ...}; throws when cancelled.
 * mode 'brief' / 'news' writes a short summary for the chat instead and saves nothing: {status: 'ready', text, ...}.
 */
export async function runResearch({ topic, ask, search, save, onStep = () => {}, signal, today = thaiToday(), mode = 'note' }) {
  const step = (s) => { signal?.throwIfAborted(); onStep(s); };
  const forChat = mode === 'brief' || mode === 'news';
  step({ stage: 'plan', text: 'วางคำค้น' });
  let queries;
  try { queries = parseQueries(await ask(queryMessages(topic, today, mode), { maxTokens: 160, temperature: 0.4 }), topic); }
  catch (e) { if (signal?.aborted) throw e; queries = [topic]; }
  const lists = [];
  for (const [i, q] of queries.entries()) {
    step({ stage: 'search', text: `ค้นเว็บ ${i + 1}/${queries.length}: ${q}`, query: q });
    lists.push(await search(q).catch(() => []));
  }
  signal?.throwIfAborted();
  const sources = collectSources(lists);
  if (sources.length < 2) return { status: 'not-enough', reason: `เจอแหล่งที่ใช้ได้แค่ ${sources.length} แหล่ง`, queries, sources, removed: [] };
  step({ stage: 'write', text: `${forChat ? 'เขียนสรุป' : 'เขียนโน้ต'}จาก ${sources.length} แหล่ง` });
  let note = cleanNote(await ask(noteMessages(topic, sources, today, mode), { maxTokens: forChat ? 700 : 1000, temperature: 0.3 }));
  let rows = checkNote(note, sources), revised = false;
  const failing = rows.filter((r) => r.problems.length).length;
  if (failing) {
    step({ stage: 'check', text: `ตรวจกับแหล่งแล้วไม่ผ่าน ${failing} บรรทัด: ให้แก้ 1 รอบ` });
    const fixed = cleanNote(await ask(reviseMessages(note, rows, sources, mode), { maxTokens: forChat ? 700 : 1000, temperature: 0.2 }));
    if (/^[-•*]\s+/mu.test(fixed)) { note = fixed; rows = checkNote(note, sources); revised = true; }
  } else step({ stage: 'check', text: 'ตรวจกับแหล่งแล้วผ่านทุกบรรทัด' });
  const { text, removed, facts } = keepChecked(note, rows);
  if (facts < 2) return { status: 'not-enough', reason: `ข้อเท็จจริงที่ตรวจผ่านมีแค่ ${facts} ข้อ`, queries, sources, removed, revised };
  const title = titleOf(text) || topic;
  if (forChat) return { status: 'ready', text, body: withoutTitle(text), title, summary: summaryOf(text), facts, removed, revised, queries, sources };
  step({ stage: 'save', text: 'บันทึกเข้าคลังความรู้' });
  const saved = await save({ title, body: withoutTitle(text), sources, topic });
  return { status: 'saved', file: saved?.file, title, summary: summaryOf(text), facts, removed, revised, queries, sources };
}
