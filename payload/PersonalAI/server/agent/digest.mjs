// An attached file into the knowledge library (claude-20261025, user: "ทำให้ lumicos เป็น Agent ในส่วนอื่นต่อได้เลย"):
// "สรุปไฟล์นี้แล้วเก็บเข้าคลัง" writes a checked note from a PDF/Word/Excel/text file; "เก็บไฟล์นี้เข้าคลัง" stores the file
// itself so the library indexes its whole text. Bounded like research: the program reads the file in parts, the model only
// lists facts and writes the note, and every number in the note must appear in the part it came from.
import { numbersIn, numberIn, cleanNote, checkNote, keepChecked, titleOf, summaryOf } from './research.mjs';

export const PART_CHARS = 4000;
export const MAX_PARTS = 12;
const LIBRARY = String.raw`(?:คลังความรู้|คลังข้อมูล|คลัง|rag)`;
const FILE_WORD = String.raw`(?:ไฟล์|เอกสาร|pdf|รายงาน|บทความ|สไลด์|ตาราง)`;
const THIS = String.raw`(?:นี้|นี่|ที่แนบ(?:มา|ไป)?|ที่ส่ง(?:มา|ไป)|ทั้งหมด|พวกนี้|อันนี้|ข้างบน)`;
const INTO = String.raw`(?:ไว้\s*)?(?:เข้า|ลง|ไว้ใน|ใน|ไปที่|ไว้ที่|ไป)?\s*${LIBRARY}`;
const DIGEST_TH = new RegExp(`สรุป\\s*(?:เนื้อหา\\s*)?(?:ใน\\s*)?(${FILE_WORD})?\\s*${THIS}?\\s*(?:ให้\\s*)?(?:แล้ว|และ)?\\s*(?:ช่วย\\s*)?(?:เก็บ|บันทึก|เพิ่ม|ใส่|จด)\\s*${INTO}`, 'iu');
const DIGEST_EN = /\bsummari[sz]e\s+(?:this|the|these|attached)\s+(file|document|pdf)s?\s+(?:and\s+)?(?:save|store|add|put|keep)\b/iu;
const STORE_TH = new RegExp(`^(?:ช่วย\\s*)?(?:เก็บ|บันทึก|เพิ่ม|ใส่|เอา|ย้าย|นำ)\\s*(${FILE_WORD})\\s*${THIS}?\\s*(?:ไป\\s*)?(?:ใส่|เก็บ)?\\s*${INTO}`, 'iu');
const STORE_EN = /^(?:please\s+)?(?:save|store|add|put)\s+(?:this|these|the|attached)\s+(files?|documents?|pdfs?)\s+(?:to|in|into)\s+(?:the\s+|my\s+)?(?:knowledge\s+)?(?:library|base)/iu;

/** {kind: 'digest' | 'store-file', mentionsFile} for "สรุปไฟล์นี้แล้วเก็บเข้าคลัง" / "เก็บไฟล์นี้เข้าคลัง", or null. */
export function fileAsk(text) {
  const t = String(text ?? '').replace(/\s+/gu, ' ').trim();
  let m = t.match(DIGEST_TH) ?? t.match(DIGEST_EN);
  if (m) return { kind: 'digest', mentionsFile: !!m[1] };
  m = t.match(STORE_TH) ?? t.match(STORE_EN);
  if (m) return { kind: 'store-file', mentionsFile: true };
  return null;
}

/** Parts of about `size` characters, cut at a paragraph, line or sentence end when there is one. */
export function splitParts(text, size = PART_CHARS) {
  const t = String(text ?? '').replace(/\r\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim();
  const parts = [];
  for (let i = 0; i < t.length;) {
    if (t.length - i <= size) { parts.push(t.slice(i).trim()); break; }
    const window = t.slice(i, i + size);
    let cut = Math.max(window.lastIndexOf('\n\n'), window.lastIndexOf('\n'));
    if (cut < size * 0.5) cut = Math.max(window.lastIndexOf('. '), window.lastIndexOf(' '));
    if (cut < size * 0.5) cut = size;
    parts.push(t.slice(i, i + cut).trim());
    i += cut;
  }
  return parts.filter(Boolean);
}

/** The "- …" lines of a model answer (numbered items count), at most `max`. */
export function factLines(text, max = 8) {
  return cleanNote(text).split('\n').map((l) => l.trim()).filter((l) => /^[-•*]\s+\S/u.test(l))
    .map((l) => l.replace(/^[-•*]\s+/u, '').trim()).filter((l) => l.length >= 4).slice(0, max);
}

const FILE_NOTE_RULES = 'You write a short note for a personal knowledge library, in Thai, using ONLY the document text. Format exactly:\n'
  + '# <short title>\nสรุป: <2–3 sentences on what the document is about>\n- <one fact per line, ending with [1]>\n'
  + 'Write 3–10 fact lines. Copy numbers, dates, names and codes exactly as the document writes them. Never add anything that is not in the document. Output only the note.';
const PART_RULES = 'You read one part of a document and list its key facts for a personal knowledge library. Write 3–8 facts in Thai, one per line starting with "- ". '
  + 'Copy numbers, dates, names and codes exactly as the text writes them. Use only this part, do not guess, no commentary. Output only the list.';
const REDUCE_RULES = 'You write a short note for a personal knowledge library, in Thai, from facts already taken out of a document. Format exactly:\n'
  + '# <short title>\nสรุป: <2–3 sentences on what the document is about>\n- <one fact per line, ending with the part number(s) it came from like [2] or [1][3]>\n'
  + 'Write 4–12 fact lines: keep the most important, merge duplicates. Copy numbers, dates, names and codes exactly. Never add anything that is not in the facts. Output only the note.';

export const directMessages = (name, text) => [
  { role: 'system', content: FILE_NOTE_RULES },
  { role: 'user', content: `ไฟล์: ${name}\n\n[1]\n${text}` },
];
export const partMessages = (name, text, index, count) => [
  { role: 'system', content: PART_RULES },
  { role: 'user', content: `ไฟล์: ${name} · ส่วนที่ ${index + 1} จาก ${count}\n\n${text}` },
];
export const reduceMessages = (name, facts, count) => [
  { role: 'system', content: REDUCE_RULES },
  { role: 'user', content: `ไฟล์: ${name} (อ่าน ${count} ส่วน)\n\nข้อเท็จจริงแยกตามส่วน:\n${facts.map((f) => `[${f.part}] ${f.line}`).join('\n')}` },
];
const reviseMessages = (note, rows, name, text) => [
  { role: 'system', content: FILE_NOTE_RULES },
  { role: 'user', content: `โน้ตนี้มีบรรทัดที่ตรวจกับเนื้อไฟล์แล้วไม่ผ่าน:\n${rows.filter((r) => r.problems.length).map((r) => `- "${r.line}": ${r.problems.join('; ')}`).join('\n')}\n`
    + `แก้เฉพาะบรรทัดเหล่านี้ให้ตรงกับเนื้อไฟล์ หรือลบบรรทัดนั้นทิ้ง แล้วส่งโน้ตทั้งฉบับกลับมาในรูปแบบเดิม\n\nโน้ต:\n${note}\n\nไฟล์: ${name}\n[1]\n${text}` },
];
const withoutTitle = (note) => String(note ?? '').replace(/^#\s+.+\n?/m, '').trim();

/**
 * Summarizes a file's text into a note. ask(messages, params) → model text; save({title, body, fileName, parts}) → {file}.
 * One part: the note is written from the text and checked (one revision). Several parts: facts per part (numbers
 * checked against that part), then one note from those facts (numbers checked against the parts it cites).
 * Returns {status: 'saved' | 'not-enough', ...}; throws when cancelled.
 */
export async function runDigest({ name, text, ask, save, onStep = () => {}, signal }) {
  const step = (s) => { signal?.throwIfAborted(); onStep(s); };
  const all = splitParts(text), parts = all.slice(0, MAX_PARTS);
  if (!parts.length) return { status: 'not-enough', reason: 'ไฟล์นี้ไม่มีตัวหนังสือให้อ่าน (อาจเป็นภาพสแกน)', parts: 0, totalParts: 0, removed: [] };
  const sources = parts.map((p, i) => ({ title: `ส่วนที่ ${i + 1}`, url: '', text: p }));
  const labels = parts.map((p, i) => ({ label: parts.length === 1 ? '(ทั้งไฟล์)' : `ส่วนที่ ${i + 1} จาก ${all.length}` }));
  const shown = all.length > parts.length ? ` (ไฟล์ยาว อ่าน ${parts.length} ส่วนแรกจาก ${all.length} ส่วน)` : '';
  let note, revised = false, dropped = [];
  if (parts.length === 1) {
    step({ stage: 'write', text: `อ่านไฟล์แล้ว เขียนโน้ต` });
    note = cleanNote(await ask(directMessages(name, parts[0]), { maxTokens: 900, temperature: 0.3 }));
    const rows = checkNote(note, sources);
    if (rows.some((r) => r.problems.length)) {
      step({ stage: 'check', text: `ตรวจกับเนื้อไฟล์แล้วไม่ผ่าน ${rows.filter((r) => r.problems.length).length} บรรทัด: ให้แก้ 1 รอบ` });
      const fixed = cleanNote(await ask(reviseMessages(note, rows, name, parts[0]), { maxTokens: 900, temperature: 0.2 }));
      if (/^[-•*]\s+/mu.test(fixed)) { note = fixed; revised = true; }
    } else step({ stage: 'check', text: 'ตรวจกับเนื้อไฟล์แล้วผ่านทุกบรรทัด' });
  } else {
    step({ stage: 'read', text: `แบ่งไฟล์เป็น ${parts.length} ส่วน${shown}` });
    const facts = [];
    for (const [i, part] of parts.entries()) {
      step({ stage: 'part', text: `สรุปส่วนที่ ${i + 1}/${parts.length}` });
      const out = await ask(partMessages(name, part, i, parts.length), { maxTokens: 500, temperature: 0.2 });
      for (const line of factLines(out)) {
        const missing = numbersIn(line).filter((n) => !numberIn(n, part));
        if (missing.length) dropped.push({ line: `[${i + 1}] ${line}`, problems: missing.map((n) => `ตัวเลข ${n} ไม่มีในส่วนที่ ${i + 1}`) });
        else facts.push({ part: i + 1, line });
      }
    }
    if (facts.length < 2) return { status: 'not-enough', reason: `ได้ข้อเท็จจริงที่ตรวจผ่านแค่ ${facts.length} ข้อ`, parts: parts.length, totalParts: all.length, removed: dropped };
    step({ stage: 'write', text: `เขียนโน้ตจาก ${facts.length} ข้อ` });
    note = cleanNote(await ask(reduceMessages(name, facts.slice(0, 80), parts.length), { maxTokens: 1000, temperature: 0.3 }));
  }
  const { text: kept, removed, facts } = keepChecked(note, checkNote(note, sources));
  if (facts < 2) return { status: 'not-enough', reason: `ข้อเท็จจริงที่ตรวจผ่านมีแค่ ${facts} ข้อ`, parts: parts.length, totalParts: all.length, removed: [...dropped, ...removed], revised };
  const title = titleOf(kept) || name;
  step({ stage: 'save', text: 'บันทึกเข้าคลังความรู้' });
  const saved = await save({ title, body: withoutTitle(kept), fileName: name, parts: labels });
  return { status: 'saved', file: saved?.file, title, summary: summaryOf(kept), facts, removed: [...dropped, ...removed], revised, parts: parts.length, totalParts: all.length };
}
