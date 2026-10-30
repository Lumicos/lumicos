// A multiple-choice quiz with an answer key (claude-20261025, user: "ทำแบบทดสอบภาษาจีนแบบมีคำตอบ ABCD"): "ทำแบบทดสอบภาษาจีน HSK 2
// 20 ข้อ", "ออกข้อสอบวิทยาศาสตร์ ม.2 เรื่องเซลล์ 10 ข้อ ABCD". Bounded: the model writes questions five at a time in a fixed
// format; the program keeps only well-formed ones (4 different options, one answer, Chinese present in a Chinese quiz, no
// repeats), asks the model to answer each kept question without the key and drops those it answers differently, spreads the
// right answers evenly over A–D, and writes the quiz and a separate answer key (Word + Excel).
import ExcelJS from 'exceljs';

export const MAX_QUESTIONS = 30;
const BATCH = 5;
const LETTERS = ['A', 'B', 'C', 'D'];
const THAI_LETTERS = { 'ก': 'A', 'ข': 'B', 'ค': 'C', 'ง': 'D' };
const LANGS = [
  [/ภาษา\s*จีน|จีนกลาง|\bHSK\b|chinese|mandarin|(?:^|\s)จีน(?=\s|$|\d)/iu, 'zh', 'ภาษาจีน'],
  [/ภาษา\s*อังกฤษ|\bTOEIC\b|\bIELTS\b|\bTOEFL\b|english/iu, 'en', 'ภาษาอังกฤษ'],
  [/ภาษา\s*ญี่ปุ่น|\bJLPT\b|japanese/iu, 'ja', 'ภาษาญี่ปุ่น'],
  [/ภาษา\s*เกาหลี|\bTOPIK\b|korean/iu, 'ko', 'ภาษาเกาหลี'],
];
const NOUN = String.raw`(?:แบบทดสอบ|ข้อสอบ|ควิซ|quiz|แบบฝึกหัด|โจทย์|คำถาม\s*ปรนัย)`;
// "ออก/สร้าง/แต่ง/เขียน/ขอ…ข้อสอบ" always means "make one"; "ทำแบบทดสอบ" can also mean taking one ("พรุ่งนี้ต้องไปทำข้อสอบ"),
// so it needs a sign that the user wants one made (ช่วย / ให้หน่อย / a count / ABCD / an answer key).
const ASK_SURE = new RegExp(`(?:ช่วย\\s*(?:ทำ|ออก|สร้าง|แต่ง|เขียน|จัด)|ออก|สร้าง|แต่ง|เขียน|ขอ|อยากได้|จัดทำ|generate|create|make)\\s*(?:ชุด\\s*)?${NOUN}\\s*(.*)$`, 'iu');
const ASK_TAM = new RegExp(`ทำ\\s*(?:ชุด\\s*)?${NOUN}\\s*(.*)$`, 'iu');
const FOR_ME = /ให้\s*(?:หน่อย|ที|ด้วย|ผม|ฉัน|เรา|หนู|ได้\s*(?:ไหม|มั้ย))|หน่อย|\d+\s*ข้อ|abcd|ปรนัย|ตัวเลือก|เฉลย|choice/iu;
const TAKING = /(?:ไป|ต้อง|เพิ่ง|กำลัง|เคย|จะ)\s*ทำ\s*(?:แบบทดสอบ|ข้อสอบ)|(?:แบบทดสอบ|ข้อสอบ)\S*\s*(?:มา|เสร็จ|ได้|ไม่ได้|ผิด|ถูก|ไม่ทัน|ยาก|ง่าย|ไม่ไหว)(?:\s|$)/u;
const CHOICE = /abcd|a\s*b\s*c\s*d|ก\s*ข\s*ค\s*ง|ปรนัย|ตัวเลือก|ช้อยส์|ชอยส์|choice|multiple|\d+\s*ข้อ|เฉลย/iu;
const NOT_A_QUIZ = /บุคลิก|mbti|\biq\b|ไอคิว|ความเครียด|ซึมเศร้า|ดวง|ความรัก|ทำนาย|สุขภาพจิต|จากไฟล์|ไฟล์นี้|ที่แนบ/iu;
const NOT_A_SUBJECT = /^(?:เก่า|ปีก่อน|ปีที่แล้ว|ย้อนหลัง|จริง|ล่าสุด|อีก|เพิ่ม|ใหม่|นี้|นั้น)$/u;

/** {subject, lang, level, topic, count} of a "make me a quiz" request, or null. */
export function quizAsk(input) {
  const text = String(input ?? '').replace(/[๐-๙]/gu, (c) => String(c.charCodeAt(0) - 0x0e50)).replace(/\s+/gu, ' ').trim();
  if (NOT_A_QUIZ.test(text)) return null;
  let m = text.match(ASK_SURE);
  if (!m) {
    m = text.match(ASK_TAM);
    if (!m || !FOR_ME.test(text) || (TAKING.test(text) && !CHOICE.test(text))) return null;
  }
  const noun = text.match(new RegExp(NOUN, 'iu'))[0];
  const lang = LANGS.find(([re]) => re.test(text));
  if (!/แบบทดสอบ|ข้อสอบ|ควิซ|quiz/iu.test(noun) && !CHOICE.test(text)) return null;
  const rest = m[1];
  const count = Math.min(MAX_QUESTIONS, Math.max(1, Number(text.match(/(\d{1,3})\s*ข้อ/u)?.[1] ?? 10)));
  const level = text.match(/\bHSK\s*([1-9])/iu)?.[0].replace(/\s+/g, ' ').toUpperCase() ?? text.match(/\bJLPT\s*N?\s*([1-5])/iu)?.[0].replace(/\s+/g, ' ').toUpperCase()
    ?? text.match(/\bTOPIK\s*[1-6]/iu)?.[0].replace(/\s+/g, ' ').toUpperCase() ?? text.match(/(?<![ก-ฮ])((?:ม|ป)\.\s*[1-6])/u)?.[1].replace(/\s+/g, '')
    ?? text.match(/ระดับ\s*(เริ่มต้น|ต้น|ง่าย|กลาง|ปานกลาง|ยาก|สูง)/u)?.[0] ?? null;
  const topic = text.match(/เรื่อง\s*(.+?)(?=\s*(?:\d+\s*ข้อ|แบบ|มีเฉลย|พร้อมเฉลย|abcd|ปรนัย|ให้หน่อย|หน่อย|ระดับ|$))/iu)?.[1].trim() || null;
  let subject = lang?.[2];
  if (!subject) {
    subject = rest.replace(/(?:\d+\s*ข้อ|แบบ\s*(?:มี)?\s*(?:คำตอบ|ตัวเลือก)?\s*(?:abcd|ก\s*ข\s*ค\s*ง)|abcd|ปรนัย|(?:มี|พร้อม)\s*เฉลย|4\s*ตัวเลือก|ให้\s*(?:หน่อย|ที|ด้วย|ผม|ฉัน|เรา|หนู)|หน่อย|ด้วย|นะ|เรื่อง\s*.+$|ระดับ\s*\S+|(?:ม|ป)\.\s*[1-6]|ได้\s*(?:ไหม|มั้ย))/giu, ' ')
      .replace(/^(?:วิชา|เกี่ยวกับ)\s*/u, '').replace(/\s+/gu, ' ').trim();
    if (!subject && topic) subject = topic;
  }
  if (!subject || NOT_A_SUBJECT.test(subject)) return null;
  return { subject: subject.slice(0, 60), lang: lang?.[1] ?? null, level, topic: topic?.slice(0, 80) ?? null, count };
}

const LANG_RULES = {
  zh: 'Test Chinese for a Thai learner: meanings of words (show the Chinese word in simplified characters with pinyin in brackets, options in Thai), choosing the right word for a blank in a short Chinese sentence, pinyin and tones, measure words, simple grammar. Every question must contain Chinese characters. Keep the vocabulary within the level.',
  en: 'Test English for a Thai learner: word meanings, choosing the right word or form for a blank, simple grammar, short reading lines. Keep the vocabulary within the level.',
  ja: 'Test Japanese for a Thai learner: word meanings (Japanese with reading in brackets, options in Thai), particles, choosing the right word for a blank, simple grammar. Every question must contain Japanese.',
  ko: 'Test Korean for a Thai learner: word meanings (Korean with romanization in brackets, options in Thai), particles, choosing the right word for a blank, simple grammar. Every question must contain Korean.',
};
const FORMAT = 'Format exactly, nothing else:\nข้อ 1: <question>\nA) <option>\nB) <option>\nC) <option>\nD) <option>\nตอบ: <A, B, C or D>\nอธิบาย: <one short sentence in Thai on why, without option letters>\n(a blank line between questions)';

export const writeMessages = (req, n, avoid = []) => [
  { role: 'system', content: `You write multiple-choice quiz questions in Thai. Write exactly ${n} questions. Each has exactly 4 options A–D and exactly one correct answer. ${FORMAT}\n`
    + `Rules: options are short and all different; only one is right; no "all of the above" or "none of the above"; vary the question types; never repeat a question under "ห้ามซ้ำ". `
    + (LANG_RULES[req.lang] ?? 'Use only well-established facts; no trick questions.') },
  { role: 'user', content: `วิชา: ${req.subject}${req.level ? `\nระดับ: ${req.level}` : ''}${req.topic ? `\nเรื่อง: ${req.topic}` : ''}\nจำนวน: ${n} ข้อ${avoid.length ? `\nห้ามซ้ำ:\n${avoid.slice(-40).map((q) => `- ${q}`).join('\n')}` : ''}` },
];
export const answerMessages = (questions) => [
  { role: 'system', content: 'You are taking a quiz. Answer each question with one letter. Reply with one line per question, like "1: B", nothing else.' },
  { role: 'user', content: questions.map((q, i) => `${i + 1}. ${q.q}\n${q.options.map((o, k) => `${LETTERS[k]}) ${o}`).join('\n')}`).join('\n\n') },
];

const norm = (s) => String(s ?? '').toLowerCase().replace(/[\s.,!?。，？！:：;；"'“”‘’()（）[\]]+/gu, '');
/** Questions in the fixed format (numbered "ข้อ N:" / "N." / "Q1"; options A) / A. / ก.; "ตอบ: B" / "เฉลย: ข" / "Answer: B"). */
export function parseQuestions(text) {
  const out = [];
  const blocks = String(text ?? '').replace(/<think>[\s\S]*?<\/think>/g, '').replace(/\*\*/g, '').split(/^\s*(?:ข้อ(?:ที่)?\s*\d+\s*[:：.)]|\d{1,2}\s*[.)]|Q\s*\d+\s*[:：.)]?)\s*/imu).slice(1);
  for (const block of blocks) {
    const lines = block.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
    const options = [], q = [];
    let answer = null, explain = '';
    for (const line of lines) {
      const opt = line.match(/^([A-Da-dกขคง])\s*[).:：]\s*(.+)$/u);
      const ans = line.match(/^(?:ตอบ|เฉลย|คำตอบ|answer)\s*[:：]?\s*(?:ข้อ\s*)?([A-Da-dกขคง])(?![A-Za-zก-๙])/iu);
      const why = line.match(/^(?:อธิบาย|เหตุผล|explanation)\s*[:：]\s*(.+)$/iu);
      if (ans) answer = THAI_LETTERS[ans[1]] ?? ans[1].toUpperCase();
      else if (why) explain = why[1];
      else if (opt && options.length < 4) options.push(opt[2].trim());
      else if (!options.length) q.push(line);
    }
    out.push({ q: q.join(' ').trim(), options, answer: answer ? LETTERS.indexOf(answer) : -1, explain: explain.trim() });
  }
  return out;
}

/** What is wrong with a question ([] when it can be kept). */
export function checkQuestion(item, { lang, seen = new Set() } = {}) {
  const problems = [];
  if (item.q.length < 4) problems.push('ไม่มีคำถาม');
  if (item.options.length !== 4 || item.options.some((o) => !o)) problems.push('ตัวเลือกไม่ครบ 4 ข้อ');
  else if (new Set(item.options.map(norm)).size !== 4) problems.push('ตัวเลือกซ้ำกัน');
  if (item.answer < 0 || item.answer > 3) problems.push('ไม่มีเฉลย');
  if (item.options.some((o) => /ถูกทุกข้อ|ผิดทุกข้อ|ไม่มีข้อใดถูก|ทุกข้อที่กล่าวมา|all of the above|none of the above/iu.test(o))) problems.push('มีตัวเลือกแบบ "ถูกทุกข้อ"');
  const script = { zh: /[一-鿿]/u, ja: /[぀-ヿ一-鿿]/u, ko: /[가-힯]/u }[lang];
  if (script && !script.test(`${item.q} ${item.options.join(' ')}`)) problems.push('ไม่มีตัวอักษรของภาษานั้นในข้อ');
  if (seen.has(norm(item.q))) problems.push('ซ้ำกับข้อก่อนหน้า');
  return problems;
}

/** "1: B" lines → [1, …] (0-based letters by question number), -1 where missing. */
export function parseAnswers(text, n) {
  const got = Array(n).fill(-1);
  for (const m of String(text ?? '').matchAll(/(?:^|\n)\s*(?:ข้อ\s*)?(\d{1,2})\s*[:：.)-]\s*(?:ข้อ\s*)?([A-Da-dกขคง])(?![A-Za-zก-๙])/gu)) {
    const i = Number(m[1]) - 1, letter = THAI_LETTERS[m[2]] ?? m[2].toUpperCase();
    if (i >= 0 && i < n) got[i] = LETTERS.indexOf(letter);
  }
  return got;
}

// An explanation that names a letter ("ข้อ B ถูก") would be wrong once the options move.
const LETTER_REF = /(?:ข้อ|ตัวเลือก|คำตอบ|ตอบ|option|answer|choice)\s*\(?[A-Dก-ง](?![a-zก-๙])|(?<![A-Za-z])[A-D]\)/iu;
/** Moves each right answer to a letter so A–D are used about equally (in a shuffled order seeded by `seed`). */
export function balanceAnswers(questions, seed = 1) {
  let s = (seed >>> 0) || 1;
  const rnd = () => ((s = (s * 48271) % 2147483647) / 2147483647);
  const targets = questions.map((_, i) => i % 4);
  for (let i = targets.length - 1; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); [targets[i], targets[j]] = [targets[j], targets[i]]; }
  return questions.map((q, i) => {
    const want = targets[i];
    if (q.answer === want) return q;
    const options = [...q.options];
    [options[q.answer], options[want]] = [options[want], options[q.answer]];
    return { ...q, options, answer: want, explain: LETTER_REF.test(q.explain) ? '' : q.explain };
  });
}

/**
 * Writes the quiz. ask(messages, params) → model text. Returns {status: 'ready' | 'not-enough', questions, dropped, ...};
 * throws when cancelled.
 */
export async function runQuiz({ req, ask, onStep = () => {}, signal, seed = Date.now() }) {
  const step = (s) => { signal?.throwIfAborted(); onStep(s); };
  const kept = [], dropped = [], seen = new Set();
  const maxRounds = Math.ceil(req.count / BATCH) + 2;
  for (let round = 0; round < maxRounds && kept.length < req.count; round++) {
    const n = Math.min(BATCH, req.count - kept.length);
    step({ stage: 'write', text: `เขียนข้อ ${kept.length + 1}–${kept.length + n} จาก ${req.count}` });
    const fresh = [];
    for (const item of parseQuestions(await ask(writeMessages(req, n, kept.map((q) => q.q)), { maxTokens: 220 * n + 120, temperature: 0.6 }))) {
      const problems = checkQuestion(item, { lang: req.lang, seen });
      if (problems.length) { dropped.push({ q: item.q, problems }); continue; }
      seen.add(norm(item.q)); fresh.push(item);
      if (fresh.length >= n) break;
    }
    if (!fresh.length) continue;
    step({ stage: 'check', text: `ตรวจคำตอบ ${fresh.length} ข้อ` });
    const answers = parseAnswers(await ask(answerMessages(fresh), { maxTokens: 12 * fresh.length + 20, temperature: 0 }), fresh.length);
    fresh.forEach((item, i) => {
      if (answers[i] === item.answer) kept.push(item);
      else dropped.push({ q: item.q, problems: [answers[i] < 0 ? 'ตอบซ้ำไม่ได้' : `ตอบซ้ำได้ ${LETTERS[answers[i]]} ไม่ตรงเฉลย ${LETTERS[item.answer]}`] });
    });
  }
  if (kept.length < Math.min(req.count, 3)) return { status: 'not-enough', reason: `ได้ข้อที่ผ่านการตรวจแค่ ${kept.length} ข้อ`, questions: kept, dropped };
  const questions = balanceAnswers(kept.slice(0, req.count), seed);
  return { status: 'ready', questions, dropped, short: questions.length < req.count };
}

export const quizTitle = (req) => `แบบทดสอบ${req.subject}${req.level ? ` ${req.level}` : ''}${req.topic && req.topic !== req.subject ? ` เรื่อง${req.topic}` : ''}`;
/** How many right answers each letter got: "A 5 · B 5 · C 5 · D 5". */
export const letterSpread = (questions) => LETTERS.map((l, k) => `${l} ${questions.filter((q) => q.answer === k).length}`).join(' · ');

/** Word blocks: the quiz, then the answer key on its own page. */
export function quizBlocks(req, questions, today) {
  const blocks = [
    { type: 'paragraph', text: `ชื่อ ………………………………………  วันที่ ……………………  คะแนน ……… / ${questions.length}` },
    { type: 'note', text: `เลือกคำตอบที่ถูกต้องที่สุดเพียงข้อเดียว · ${questions.length} ข้อ · ทำโดย Lumicos ${today}` },
  ];
  questions.forEach((q, i) => {
    blocks.push({ type: 'paragraph', text: `**${i + 1}.** ${q.q}`, keepNext: true });
    blocks.push({ type: 'options', items: q.options.map((o, k) => `${LETTERS[k]}) ${o}`), columns: q.options.every((o) => o.length <= 22) ? 2 : 1 });
  });
  blocks.push({ type: 'heading', level: 1, text: 'เฉลย', pageBreakBefore: true },
    { type: 'table', rows: [['ข้อ', 'ตอบ', 'คำอธิบาย'], ...questions.map((q, i) => [String(i + 1), LETTERS[q.answer], q.explain || '-'])], widths: [8, 8, 84] });
  return blocks;
}

/** The same quiz as a sheet (to paste into Google Forms, Quizizz, …). */
export async function quizXlsx(req, questions) {
  const wb = new ExcelJS.Workbook();
  wb.creator = 'Lumicos';
  const ws = wb.addWorksheet('แบบทดสอบ');
  ws.columns = [{ header: 'ข้อ', width: 6 }, { header: 'คำถาม', width: 60 }, { header: 'A', width: 24 }, { header: 'B', width: 24 }, { header: 'C', width: 24 }, { header: 'D', width: 24 }, { header: 'คำตอบ', width: 8 }, { header: 'คำอธิบาย', width: 50 }];
  questions.forEach((q, i) => ws.addRow([i + 1, q.q, ...q.options, LETTERS[q.answer], q.explain]));
  ws.getRow(1).font = { bold: true, name: 'Tahoma' };
  ws.getRow(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFEDEFF5' } };
  ws.views = [{ state: 'frozen', ySplit: 1 }];
  ws.eachRow((row, n) => { if (n > 1) row.alignment = { wrapText: true, vertical: 'top' }; });
  return Buffer.from(await wb.xlsx.writeBuffer());
}

/** The chat text for a finished quiz. paths: [docx, xlsx]. */
export function quizReport(req, r, paths = []) {
  const title = quizTitle(req);
  if (r.status !== 'ready') return `ทำ “${title}” ไม่สำเร็จ: ${r.reason}\nลองสั่งใหม่ หรือระบุเรื่องให้แคบลง เช่น “ทำแบบทดสอบภาษาจีน HSK 1 เรื่องตัวเลข 10 ข้อ”`;
  const q = r.questions;
  const lines = [`${title} เสร็จแล้ว: ${q.length} ข้อ${r.short ? ` (ได้ข้อที่ผ่านการตรวจ ${q.length} จาก ${req.count} ข้อ)` : ''}`,
    paths[0] ? `ไฟล์ Word (ข้อสอบ แล้วเฉลยแยกหน้าสุดท้าย): ${paths[0]}` : '', paths[1] ? `ไฟล์ Excel (คำถาม ตัวเลือก เฉลย คำอธิบาย): ${paths[1]}` : '',
    `เฉลยกระจาย: ${letterSpread(q)}`,
    `ตรวจแล้ว: ทุกข้อมี 4 ตัวเลือกไม่ซ้ำกันและมีคำตอบเดียว · ให้โมเดลลองทำซ้ำโดยไม่เห็นเฉลย${r.dropped?.length ? ` ตัดข้อที่ไม่ผ่านไป ${r.dropped.length} ข้อ` : ' ผ่านทุกข้อ'}`,
    '', 'ตัวอย่าง 2 ข้อแรก:'];
  q.slice(0, 2).forEach((x, i) => lines.push(`${i + 1}. ${x.q}`, `   ${x.options.map((o, k) => `${LETTERS[k]}) ${o}`).join('   ')}`));
  lines.push('', 'ควรอ่านทวนก่อนใช้จริง เพราะโมเดลตรวจคำตอบของตัวเองได้ไม่ครบทุกกรณี');
  return lines.filter((l, i) => l !== '' || lines[i - 1] !== '').join('\n');
}
