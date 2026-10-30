// Runs Lumicos's agent jobs in the background (server/agent):
//   research  "ค้นเรื่อง X แล้วเก็บเข้าคลัง"        web research → checked note in the knowledge library (research.mjs)
//   update    "อัปเดตเรื่อง X ในคลัง"              the same, then the old note of X moves into knowledge/_archive
//   brief     "ทุกเช้า 7 โมง สรุปข่าว X ให้หน่อย"   a short checked summary posted in the chat (scheduled jobs)
//   digest    "สรุปไฟล์นี้แล้วเก็บเข้าคลัง"         an attached file → checked note in the library (digest.mjs)
//   store     "เก็บไฟล์นี้เข้าคลัง"                the attached file itself into knowledge/files/
//   trip      "วางแผนเที่ยวเชียงใหม่ 3 วัน 2 คืน"    web research → a checked day-by-day plan as Word + Excel files (trip.mjs)
//   quiz      "ทำแบบทดสอบภาษาจีน HSK 2 20 ข้อ"   checked ABCD questions → Word (answer key on its own page) + Excel (quiz.mjs)
//   sales     "ทำ excel ยอดขาย ลาเต้ 55 บาท"      a sales workbook with formulas, made at once without the model (sales.mjs)
// plus schedules ("ทุกวันจันทร์ ค้นเรื่อง X แล้วเก็บเข้าคลัง", "ดูงานที่ตั้งเวลาไว้", "ยกเลิกงานตั้งเวลาข้อ 1"; schedule.mjs).
// Chats and calls go first: a model step is queued only when no chat is waiting, takes one short model turn of its own
// on the helper slot (the chat slot's prompt cache stays warm), and gives the turn back at once when a chat is sent or
// a call starts; that step is redone afterwards. Progress and the final report go into the chat message that started
// the job (a scheduled run posts a new message). Jobs: data/agent-tasks.json · schedules: data/agent-schedules.json.
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { runResearch, researchTopic, updateTopic, updateMissingTopic, briefTopic, thaiToday, CANCEL_ASK, STATUS_ASK } from './research.mjs';
import { parseWhen, withoutWhen, nextRun, lastDue, describeRule, formatWhen, sameDay, scheduleCommand, pickSchedules } from './schedule.mjs';
import { fileAsk, runDigest } from './digest.mjs';
import { findTopicNotes, archiveNotes, saveFileNote, storeFile, thaiDay } from './notes.mjs';
import { tripAsk, runTrip, tripBlocks, tripXlsx, tripReport, tripTitle, tripLabel } from './trip.mjs';
import { quizAsk, runQuiz, quizBlocks, quizXlsx, quizTitle, quizReport } from './quiz.mjs';
import { salesAsk, salesWorkbook, salesFileName, salesReport } from './sales.mjs';
import { buildDocx } from './docxOut.mjs';
import { fileSlug, writeOut, fileChip } from './outputs.mjs';
import { extractText } from '../files/fileContext.mjs';

export const MAX_ACTIVE = 3; // jobs queued or running at once (a scheduled run is never refused)
export const MAX_SCHEDULES = 10;
export const MAX_FILES = 3; // attached files per digest / store request
const STEP_WAIT_MS = 20 * 60_000; // a step that could not get the model for this long fails the job
const WEB_WAIT_MS = 10 * 60_000; // a due scheduled run waits this long for the web search to come up after a start
const YIELD = Object.freeze(new Error('ให้แชตหรือสายโทรไปก่อน'));
const ACTIVE = ['queued', 'running'];
const DAY = 86_400_000;
const STATUS_TH = { saved: 'บันทึกแล้ว', done: 'เสร็จ', 'not-enough': 'ข้อมูลไม่พอ ไม่ได้บันทึก', failed: 'หยุดกลางทาง', cancelled: 'ยกเลิกแล้ว', interrupted: 'หยุดเพราะ Lumicos ปิด' };
// The words each kind uses in its messages. Progress messages start with "<progress>: “…”" and acknowledgements with
// "รับงาน…แล้ว" (Real Chat Check waits while a message still looks like that).
const KIND = {
  research: { progress: 'งานค้นคว้า', ack: 'รับงานค้นคว้าแล้ว', cancel: 'ยกเลิกงานค้นคว้า' },
  update: { progress: 'งานอัปเดตคลัง', ack: 'รับงานอัปเดตคลังแล้ว', cancel: 'ยกเลิกงานอัปเดตคลัง' },
  brief: { progress: 'งานสรุป', ack: 'รับงานสรุปแล้ว', cancel: 'ยกเลิกงานสรุป' },
  news: { progress: 'งานสรุปข่าว', ack: 'รับงานสรุปข่าวแล้ว', cancel: 'ยกเลิกงานสรุปข่าว' },
  digest: { progress: 'งานสรุปไฟล์', ack: 'รับงานสรุปไฟล์แล้ว', cancel: 'ยกเลิกงานสรุปไฟล์' },
  trip: { progress: 'งานวางแผนเที่ยว', ack: 'รับงานวางแผนเที่ยวแล้ว', cancel: 'ยกเลิกงานวางแผนเที่ยว' },
  quiz: { progress: 'งานทำแบบทดสอบ', ack: 'รับงานทำแบบทดสอบแล้ว', cancel: 'ยกเลิกงานทำแบบทดสอบ' },
};
const kindOf = (t) => KIND[t.kind === 'brief' && t.news ? 'news' : t.kind] ?? KIND.research;
const closedText = (t) => `${kindOf(t).progress} “${t.topic}” หยุดไปเพราะ Lumicos ปิดก่อนทำเสร็จ สั่งใหม่ได้เลย`;
/** "ค้นคว้า “ROCm 10” → คลังความรู้", "สรุปข่าว “AI”", "สรุปไฟล์ “x.pdf” → คลังความรู้" */
export function labelOf(job) {
  if (job.kind === 'update') return `อัปเดต “${job.topic}” ในคลังความรู้`;
  if (job.kind === 'brief') return job.news ? (job.topic === 'ข่าวเด่นวันนี้' ? 'สรุปข่าวเด่นวันนี้' : `สรุปข่าว “${job.topic}”`) : `สรุป “${job.topic}”`;
  if (job.kind === 'digest') return `สรุปไฟล์ “${job.topic}” → คลังความรู้`;
  if (job.kind === 'trip') return `วางแผนเที่ยว “${job.topic}” → ไฟล์ Word + Excel`;
  if (job.kind === 'quiz') return `ทำ “${job.topic}” → ไฟล์ Word + Excel`;
  return `ค้นคว้า “${job.topic}” → คลังความรู้`;
}
const sleep = (ms, signal) => new Promise((resolve, reject) => {
  if (signal?.aborted) return reject(signal.reason);
  const done = () => { clearTimeout(t); reject(signal.reason); };
  const t = setTimeout(() => { signal?.removeEventListener('abort', done); resolve(); }, ms);
  signal?.addEventListener('abort', done, { once: true });
});
const readJson = (file) => { try { const v = JSON.parse(fs.readFileSync(file, 'utf8')); return Array.isArray(v) ? v : []; } catch { return []; } };
const writeJson = (file, value, what) => { if (!file) return; try { fs.writeFileSync(file, JSON.stringify(value, null, 1)); } catch (e) { console.warn(`[agent] ${what} not saved:`, e.message); } };

/** The chat text for a finished research job. */
export function researchReport(topic, r) {
  if (r.status !== 'saved') return `ค้นเรื่อง “${topic}” แล้ว แต่ยังไม่บันทึกเข้าคลัง: ${r.reason}\nลองระบุหัวข้อให้ชัดขึ้น หรือใช้ชื่อภาษาอังกฤษของเรื่องนั้นแล้วสั่งใหม่ได้`;
  return [`บันทึกเข้าคลังความรู้แล้ว: ${r.title}`, `ไฟล์: knowledge/${r.file}`, r.summary ? `สรุป: ${r.summary}` : '',
    `ข้อเท็จจริงที่ตรวจตัวเลขกับแหล่งแล้ว ${r.facts} ข้อ จาก ${r.sources.length} แหล่ง${r.removed?.length ? ` · ตัดออก ${r.removed.length} บรรทัดที่ตรวจกับแหล่งไม่ผ่าน` : ''}`,
    r.existing?.length ? `มีโน้ตเรื่องนี้อยู่แล้ว ${r.existing.length} ไฟล์ ถ้าจะให้แทนที่โน้ตเก่า สั่ง "อัปเดตเรื่อง ${topic} ในคลัง"` : '',
    `ถามต่อได้ เช่น "ในคลังความรู้เขียนเรื่อง ${topic} ไว้ว่ายังไง"`].filter(Boolean).join('\n');
}
/** The chat text for a finished update job. */
export function updateReport(topic, r) {
  if (r.status !== 'saved') return `ค้นเรื่อง “${topic}” ใหม่แล้ว แต่ยังไม่ได้อัปเดตคลัง: ${r.reason}\nโน้ตเดิมยังอยู่ที่เดิม ลองสั่งใหม่ภายหลังได้`;
  return [`อัปเดตคลังความรู้แล้ว: ${r.title}`, `ไฟล์: knowledge/${r.file}`,
    r.archived?.length ? `โน้ตเก่าย้ายไปเก็บแล้ว (ไม่ได้ลบ):\n${r.archived.map((f) => `- knowledge/${f}`).join('\n')}` : 'ยังไม่มีโน้ตเรื่องนี้ในคลังมาก่อน เลยบันทึกเป็นโน้ตใหม่',
    r.summary ? `สรุป: ${r.summary}` : '',
    `ข้อเท็จจริงที่ตรวจตัวเลขกับแหล่งแล้ว ${r.facts} ข้อ จาก ${r.sources.length} แหล่ง${r.removed?.length ? ` · ตัดออก ${r.removed.length} บรรทัดที่ตรวจกับแหล่งไม่ผ่าน` : ''}`].filter(Boolean).join('\n');
}
/** The chat text for a finished brief: the brief itself, its [n] marks are the message's sources E1… in order. */
export function briefReport(job, r, today = thaiToday()) {
  const head = job.news ? (job.topic === 'ข่าวเด่นวันนี้' ? 'สรุปข่าวเด่น' : `สรุปข่าว “${job.topic}”`) : `สรุป “${job.topic}”`;
  if (r.status !== 'ready') return `${head}: ค้นแล้วแต่ยังสรุปไม่ได้ (${r.reason})`;
  return [`${head} · ${today}`, r.body,
    `(ตรวจตัวเลขกับแหล่งแล้ว ${r.facts} ข้อ จาก ${r.sources.length} แหล่ง${r.removed?.length ? ` · ตัดออก ${r.removed.length} บรรทัดที่ตรวจไม่ผ่าน` : ''})`].join('\n');
}
/** The chat text for a finished digest of one or more files. */
export function digestReport(results) {
  const parts = results.map(({ name, r }) => {
    if (r.status !== 'saved') return `อ่านไฟล์ “${name}” แล้ว แต่ยังไม่บันทึกเข้าคลัง: ${r.reason}`;
    return [`บันทึกเข้าคลังความรู้แล้ว: ${r.title}`, `ไฟล์: knowledge/${r.file}`, r.summary ? `สรุป: ${r.summary}` : '',
      `ข้อเท็จจริงที่ตรวจตัวเลขกับเนื้อไฟล์แล้ว ${r.facts} ข้อ จาก “${name}”${r.totalParts > r.parts ? ` (ไฟล์ยาว อ่าน ${r.parts} ส่วนแรกจาก ${r.totalParts} ส่วน)` : ''}${r.removed?.length ? ` · ตัดออก ${r.removed.length} บรรทัดที่ตรวจไม่ผ่าน` : ''}`,
      `ถามต่อได้ เช่น "ในคลังความรู้เขียนเรื่อง ${r.title} ไว้ว่ายังไง"`].filter(Boolean).join('\n');
  });
  return parts.join('\n\n');
}

/** Attached documents of a chat message: [{id, name, kind}] (images do not count). */
export function attachmentsOf(message) {
  return (message?.parts ?? []).filter((p) => p?.type === 'attachment' && p.id && p.name).map((p) => ({ id: p.id, name: p.name, kind: p.kind })).slice(0, MAX_FILES);
}
/** The documents attached to the latest earlier user message that had some (looking back a few messages). */
function recentAttachments(history = [], current) {
  const users = history.filter((m) => m?.role === 'user' && m !== current && m.id !== current?.id).slice(-3).reverse();
  for (const m of users) { const files = attachmentsOf(m); if (files.length) return files; }
  return [];
}
/** What a job request inside a scheduled message asks for, or null. */
function jobOf(text) {
  const update = updateTopic(text);
  if (update) return { kind: 'update', topic: update };
  const topic = researchTopic(text);
  if (topic) return { kind: 'research', topic };
  const brief = briefTopic(text);
  if (brief) return { kind: 'brief', topic: brief.topic, news: brief.news };
  return null;
}

export class AgentService {
  constructor({ store, models, config, webGateway, webStatus, library, runtime, callBusy, attachments, files, extract = extractText }) {
    Object.assign(this, { store, models, config, webGateway, webStatus, library, runtime, callBusy, attachments, files, extract });
    this.tasks = new Map(); this.steps = new Set(); this.tail = Promise.resolve();
    this.pollMs = 1500; this.retryMs = 5000; this.stepWaitMs = STEP_WAIT_MS; this.webWaitMs = WEB_WAIT_MS; // tests shorten them
    this.now = () => Date.now();
    this.file = config?.dataDir ? path.join(config.dataDir, 'agent-tasks.json') : null;
    this.scheduleFile = config?.dataDir ? path.join(config.dataDir, 'agent-schedules.json') : null;
    this.schedules = new Map(readJson(this.scheduleFile).filter((s) => s?.id && s.rule).map((s) => [s.id, s]));
    this.load();
  }

  load() {
    const saved = readJson(this.file);
    if (!saved.length) return;
    for (const t of saved) {
      if (!t?.id) continue;
      if (ACTIVE.includes(t.status)) { // Lumicos closed before it finished: say so in its chat message once
        t.status = 'interrupted';
        this.showTask(t, closedText(t));
      }
      this.tasks.set(t.id, t);
    }
    this.save();
  }
  save() { writeJson(this.file, this.list().slice(-50), 'task list'); }
  list() { return [...this.tasks.values()].map(({ controller: _controller, ...t }) => t); }
  active() { return [...this.tasks.values()].filter((t) => ACTIVE.includes(t.status)); }
  busy() { return this.active().length > 0; }
  /** Puts text (and chips for made files: extra.files [{path, bytes}]) into a chat message. */
  show(conversationId, replyId, text, { files, ...extra } = {}) {
    const parts = [{ type: 'text', text }, ...(files ?? []).map(fileChip)];
    try { this.store.message(conversationId, replyId, (m) => ({ ...m, status: 'done', error: undefined, parts, ...extra })); } catch { /* chat deleted meanwhile */ }
  }
  /** A task's message: scheduled runs keep their "🗓 งานตั้งเวลา …" first line. */
  showTask(task, text, extra) { this.show(task.conversationId, task.replyId, task.header ? `${task.header}\n${text}` : text, extra); }
  webReady() { return Promise.resolve().then(() => this.webStatus?.()).then((s) => s?.ready === true).catch(() => false); }

  /**
   * What a chat message asks of the agent, or null. ctx: {message (the user message), history (messages before the
   * reply)}. Order matters: schedule commands, files, a job with a time ("ทุกเช้า … สรุปข่าว …"), update, research,
   * cancel (only while a job is active) and status, then trip, quiz and sales.
   */
  classify(text, { message, history } = {}) {
    const t = String(text ?? '');
    const command = scheduleCommand(t);
    if (command) return command;
    const file = fileAsk(t);
    if (file) {
      const here = attachmentsOf(message);
      const files = here.length ? here : file.mentionsFile ? recentAttachments(history, message) : [];
      if (files.length) return { kind: file.kind, files };
      if (file.mentionsFile) return { kind: 'file-missing', want: file.kind, images: (message?.parts ?? []).some((p) => p?.type === 'image') };
    }
    const when = parseWhen(t, this.now());
    if (when) {
      const job = jobOf(withoutWhen(t, when.spans).replace(/(?:^|\s)(?:ช่วย\s*)?(?:ตั้งเวลา|ตั้งงาน(?:ให้)?)(?=\s|$)/u, ' ').trim());
      if (job) return { kind: 'schedule-create', rule: when.rule, timeGuessed: when.timeGuessed, job };
    }
    // "ตั้งเวลา …" that could not be read as a schedule: say so, never let the model claim it was set
    if (/^\s*(?:ช่วย\s*)?(?:ตั้งเวลา|ตั้งงาน(?:ให้)?|schedule\b)/iu.test(t)) return { kind: 'schedule-unclear' };
    const update = updateTopic(t);
    if (update) return { kind: 'update', topic: update };
    if (updateMissingTopic(t)) return { kind: 'update-missing' };
    const topic = researchTopic(t);
    if (topic) return { kind: 'research', topic };
    if (CANCEL_ASK.test(t) && this.active().length) return { kind: 'cancel' };
    if (STATUS_ASK.test(t)) return { kind: 'status' };
    if (/^\s*(?:ช่วย\s*)?(?:ยกเลิก|หยุด|ไม่ต้อง|ไม่เอา)/u.test(t)) return null; // "ยกเลิกงานวางแผนเที่ยว" with nothing running
    const trip = tripAsk(t);
    if (trip) return trip.missing ? { kind: 'trip-missing' } : { kind: 'trip', req: trip };
    const quiz = quizAsk(t);
    if (quiz) return { kind: 'quiz', req: quiz };
    const sales = attachmentsOf(message).length ? null : salesAsk(t); // a file attached: the chat reads it instead
    if (sales) return { kind: 'sales', req: sales };
    return null;
  }

  /** Carries out what classify() found. ctx: {conversationId, replyId, characterId, private, webOff}. */
  async handle(ask, ctx) {
    const { conversationId, replyId } = ctx;
    switch (ask.kind) {
      case 'research': return this.acceptResearch({ ...ctx, topic: ask.topic });
      case 'update': return this.accept({ ...ctx, kind: 'update', topic: ask.topic });
      case 'digest': return this.acceptDigest({ ...ctx, files: ask.files });
      case 'store-file': return this.storeFiles({ ...ctx, files: ask.files });
      case 'file-missing': return this.show(conversationId, replyId, ask.images
        ? 'ตอนนี้สรุปหรือเก็บเข้าคลังได้เฉพาะไฟล์เอกสาร (PDF, Word, Excel, ข้อความ) ยังไม่รับรูปภาพ'
        : 'ยังไม่เห็นไฟล์แนบ แนบไฟล์ (PDF, Word, Excel หรือไฟล์ข้อความ) มาในข้อความเดียวกันแล้วสั่งใหม่ได้เลย');
      case 'trip': return this.acceptTrip({ ...ctx, req: ask.req });
      case 'trip-missing': return this.show(conversationId, replyId, 'จะไปเที่ยวที่ไหนดี บอกปลายทางมาพร้อมจำนวนวันได้เลย เช่น “วางแผนเที่ยวเชียงใหม่ 3 วัน 2 คืน งบ 10000 บาท”');
      case 'quiz': return this.acceptQuiz({ ...ctx, req: ask.req });
      case 'sales': return this.makeSales({ ...ctx, req: ask.req });
      case 'schedule-create': return this.createSchedule({ ...ctx, ...ask });
      case 'schedule-unclear': return this.show(conversationId, replyId, ['ยังไม่ได้ตั้งเวลา เพราะอ่านเวลาหรืองานจากข้อความไม่ออก', 'พิมพ์เวลาพร้อมงาน เช่น',
        '• “ทุกเช้า 7 โมง สรุปข่าว AI ให้หน่อย”', '• “ทุกวัน 9 โมงเช้า สรุปข่าว AI”', '• “ทุกวันจันทร์ 08:30 ค้นเรื่อง ROCm แล้วเก็บเข้าคลัง”', '• “พรุ่งนี้ 9 โมง อัปเดตเรื่อง X ในคลัง”'].join('\n'));
      case 'update-missing': return this.show(conversationId, replyId, 'จะอัปเดตเรื่องอะไรในคลัง บอกหัวข้อมาด้วยได้เลย เช่น “อัปเดตเรื่อง ROCm 10 ในคลัง”');
      case 'schedule-list': return this.listSchedules(ctx);
      case 'schedule-cancel': return this.cancelSchedules({ ...ctx, target: ask.target });
      case 'schedule-run': return this.runScheduleNow({ ...ctx, target: ask.target });
      case 'cancel': return this.cancelAll(conversationId, replyId);
      case 'status': return this.showStatus(conversationId, replyId);
      default: return null;
    }
  }

  /** "ค้นเรื่อง X แล้วเก็บเข้าคลัง": answers in the reply and queues the job (one job runs at a time). */
  acceptResearch(args) { return this.accept({ ...args, kind: 'research' }); }

  /** A web job (research, update, brief) asked for in a chat: refuses with a reason, or answers and queues it. */
  async accept({ conversationId, replyId, kind, topic, news = false, private: isPrivate = false, webOff = false, header, scheduleId }) {
    const job = { kind, topic, news }, words = kindOf(job), what = `${words.progress}เรื่อง “${topic}”`;
    const refuse = (text) => { this.show(conversationId, replyId, header ? `${header}\n${text}` : text); return null; };
    if (isPrivate) return refuse(`แชตส่วนตัวจะไม่บันทึกอะไรลงคลัง เลยไม่รับ${what} ในแชตนี้ สั่งในแชตปกติได้เลย`);
    if (webOff) return refuse(`ตอนนี้ตั้งค่าปิดการค้นเว็บอยู่ เลยเริ่ม${what} ไม่ได้ เปิดการค้นเว็บในตั้งค่าก่อนแล้วสั่งใหม่ได้`);
    if (!await this.webReady()) return refuse(`ตอนนี้ระบบค้นเว็บยังไม่พร้อม เลยเริ่ม${what} ไม่ได้ ลองใหม่อีกสักครู่`);
    const ahead = this.active();
    if (!scheduleId && ahead.length >= MAX_ACTIVE) return refuse(`คิวงานเต็มแล้ว (${ahead.map((t) => `“${t.topic}”`).join(', ')}) รอให้เสร็จก่อนแล้วสั่งใหม่ได้`);
    const lead = {
      research: 'จะค้นเว็บหลายแหล่ง เขียนโน้ตที่ทุกข้อมีแหล่งอ้าง ตรวจตัวเลขกับแหล่ง แล้วเก็บเข้าคลังความรู้ ใช้เวลาราว 1–3 นาที ระหว่างนี้คุยเรื่องอื่นได้ (พิมพ์ “ยกเลิกงานค้นคว้า” ถ้าจะหยุด)',
      update: 'จะค้นเว็บใหม่ เขียนโน้ตที่ตรวจตัวเลขกับแหล่งแล้ว เก็บเข้าคลังความรู้ แล้วย้ายโน้ตเก่าของเรื่องนี้ไปไว้ใน knowledge/_archive (ไม่ลบ) ใช้เวลาราว 1–3 นาที ระหว่างนี้คุยเรื่องอื่นได้',
      brief: 'จะค้นเว็บหลายแหล่ง แล้วสรุปสั้น ๆ ที่ตรวจตัวเลขกับแหล่งแล้วไว้ในข้อความนี้ ใช้เวลาราว 1–2 นาที',
    }[kind];
    return this.queue({ kind, topic, news, conversationId, replyId, header, scheduleId },
      `${words.ack}: “${topic}”\n${lead}${ahead.length ? `\nต่อคิวหลังงานก่อนหน้า ${ahead.length} งาน` : ''}`);
  }

  /** "สรุปไฟล์นี้แล้วเก็บเข้าคลัง" with a file attached: answers and queues the digest. */
  acceptDigest({ conversationId, replyId, files, private: isPrivate = false }) {
    const names = files.map((f) => `“${f.name}”`).join(', ');
    if (isPrivate) return this.show(conversationId, replyId, `แชตส่วนตัวจะไม่บันทึกอะไรลงคลัง เลยไม่รับงานสรุปไฟล์ ${names} ในแชตนี้`);
    if (!this.attachments) return this.show(conversationId, replyId, 'ตอนนี้อ่านไฟล์แนบไม่ได้ (ระบบไฟล์แนบไม่พร้อม)');
    const ahead = this.active();
    if (ahead.length >= MAX_ACTIVE) return this.show(conversationId, replyId, `คิวงานเต็มแล้ว (${ahead.map((t) => `“${t.topic}”`).join(', ')}) รอให้เสร็จก่อนแล้วสั่งใหม่ได้`);
    return this.queue({ kind: 'digest', topic: files.map((f) => f.name).join(', '), files, conversationId, replyId },
      `${KIND.digest.ack}: ${names}\nจะอ่านไฟล์ทีละส่วน เขียนโน้ตที่ตรวจตัวเลขกับเนื้อไฟล์ แล้วเก็บเข้าคลังความรู้ ใช้เวลาราว 1–3 นาที ระหว่างนี้คุยเรื่องอื่นได้${ahead.length ? `\nต่อคิวหลังงานก่อนหน้า ${ahead.length} งาน` : ''}`);
  }

  /** "วางแผนเที่ยวเชียงใหม่ 3 วัน 2 คืน": refuses with a reason, or answers and queues the plan. */
  async acceptTrip({ conversationId, replyId, req, private: isPrivate = false, webOff = false }) {
    const label = tripLabel(req), refuse = (text) => { this.show(conversationId, replyId, text); return null; };
    if (isPrivate) return refuse('แชตส่วนตัวไม่รับงานวางแผนเที่ยว (งานนี้ค้นเว็บและสร้างไฟล์เก็บไว้) สั่งในแชตปกติได้เลย');
    if (!this.files) return refuse('ตอนนี้สร้างไฟล์ไม่ได้ (ระบบไฟล์ไม่พร้อม)');
    if (webOff) return refuse(`ตอนนี้ตั้งค่าปิดการค้นเว็บอยู่ เลยวางแผนเที่ยว “${label}” ไม่ได้ (ต้องค้นที่เที่ยวและราคาจากเว็บ) เปิดการค้นเว็บในตั้งค่าก่อนแล้วสั่งใหม่ได้`);
    if (!await this.webReady()) return refuse(`ตอนนี้ระบบค้นเว็บยังไม่พร้อม เลยเริ่มวางแผนเที่ยว “${label}” ไม่ได้ ลองใหม่อีกสักครู่`);
    const ahead = this.active();
    if (ahead.length >= MAX_ACTIVE) return refuse(`คิวงานเต็มแล้ว (${ahead.map((t) => `“${t.topic}”`).join(', ')}) รอให้เสร็จก่อนแล้วสั่งใหม่ได้`);
    return this.queue({ kind: 'trip', topic: label, req, conversationId, replyId },
      `${KIND.trip.ack}: “${label}”\nจะค้นที่เที่ยว ร้านอาหาร และราคาจากเว็บหลายแหล่ง จัดเป็นแผนรายวัน ตรวจชื่อสถานที่และตัวเลขกับแหล่ง แล้วทำเป็นไฟล์ Word กับ Excel ใช้เวลาราว 2–5 นาที ระหว่างนี้คุยเรื่องอื่นได้ (พิมพ์ “ยกเลิกงานวางแผนเที่ยว” ถ้าจะหยุด)${ahead.length ? `\nต่อคิวหลังงานก่อนหน้า ${ahead.length} งาน` : ''}`);
  }

  /** "ทำแบบทดสอบภาษาจีน HSK 2 20 ข้อ": refuses with a reason, or answers and queues the quiz (no web needed). */
  acceptQuiz({ conversationId, replyId, req, private: isPrivate = false }) {
    const title = quizTitle(req);
    if (isPrivate) return this.show(conversationId, replyId, 'แชตส่วนตัวไม่รับงานทำแบบทดสอบ (งานนี้สร้างไฟล์เก็บไว้) สั่งในแชตปกติได้เลย');
    if (!this.files) return this.show(conversationId, replyId, 'ตอนนี้สร้างไฟล์ไม่ได้ (ระบบไฟล์ไม่พร้อม)');
    const ahead = this.active();
    if (ahead.length >= MAX_ACTIVE) return this.show(conversationId, replyId, `คิวงานเต็มแล้ว (${ahead.map((t) => `“${t.topic}”`).join(', ')}) รอให้เสร็จก่อนแล้วสั่งใหม่ได้`);
    return this.queue({ kind: 'quiz', topic: title, req, conversationId, replyId },
      `${KIND.quiz.ack}: “${title}” ${req.count} ข้อ\nจะเขียนทีละ 5 ข้อ ตรวจว่าทุกข้อมี 4 ตัวเลือกไม่ซ้ำกัน ให้โมเดลลองทำโดยไม่เห็นเฉลยแล้วตัดข้อที่ตอบไม่ตรง กระจายเฉลย A–D ให้เท่า ๆ กัน แล้วทำเป็นไฟล์ Word (หน้าเฉลยแยก) กับ Excel ใช้เวลาราว ${Math.max(1, Math.round(req.count / 5))}–${Math.max(2, Math.round(req.count / 3))} นาที ระหว่างนี้คุยเรื่องอื่นได้${ahead.length ? `\nต่อคิวหลังงานก่อนหน้า ${ahead.length} งาน` : ''}`);
  }

  /** "ทำ excel ยอดขาย …": the workbook is made at once (no model), saved in spreadsheets/ and shown in the reply. */
  async makeSales({ conversationId, replyId, req, private: isPrivate = false }) {
    if (isPrivate) return this.show(conversationId, replyId, 'แชตส่วนตัวไม่สร้างไฟล์เก็บไว้ สั่งทำไฟล์ Excel ยอดขายในแชตปกติได้เลย');
    if (!this.files) return this.show(conversationId, replyId, 'ตอนนี้สร้างไฟล์ไม่ได้ (ระบบไฟล์ไม่พร้อม)');
    try {
      const out = await writeOut(this.files, salesFileName(req, thaiDay(this.now())), await salesWorkbook({ ...req, now: this.now() }));
      this.show(conversationId, replyId, salesReport(req, out.path), { files: [out] });
      return out;
    } catch (e) { this.show(conversationId, replyId, `ทำไฟล์ Excel ไม่สำเร็จ: ${String(e?.message ?? e).slice(0, 200)}`); return null; }
  }

  queue(fields, ackText) {
    const task = { id: randomUUID(), status: 'queued', createdAt: Date.now(), steps: [], ...fields, controller: new AbortController() };
    this.tasks.set(task.id, task); this.save();
    this.showTask(task, ackText);
    this.tail = this.tail.then(() => this.run(task)).catch((e) => console.warn('[agent] job failed:', e?.message ?? e));
    return task;
  }

  /** "เก็บไฟล์นี้เข้าคลัง": copies the attached files into knowledge/files/ and indexes them (no model needed). */
  async storeFiles({ conversationId, replyId, files, private: isPrivate = false }) {
    if (isPrivate) return this.show(conversationId, replyId, 'แชตส่วนตัวจะไม่บันทึกอะไรลงคลัง เลยไม่เก็บไฟล์จากแชตนี้');
    if (!this.attachments || !this.library?.folder) return this.show(conversationId, replyId, 'ตอนนี้เก็บไฟล์เข้าคลังไม่ได้ (ระบบไฟล์แนบหรือคลังความรู้ไม่พร้อม)');
    const lines = [];
    for (const f of files) {
      try {
        const { file } = await this.attachments.get(f.id);
        const saved = await storeFile(this.library, file, f.name);
        lines.push(`เก็บไฟล์ “${f.name}” เข้าคลังความรู้แล้ว: knowledge/${saved.file}${saved.status === 'failed' ? ' (แต่ทำดัชนีไม่สำเร็จ ค้นในคลังอาจไม่เจอ)' : ''}`);
      } catch (e) { lines.push(`เก็บไฟล์ “${f.name}” ไม่สำเร็จ: ${String(e?.message ?? e).slice(0, 200)}`); }
    }
    if (lines.some((l) => l.startsWith('เก็บไฟล์') && l.includes('แล้ว'))) lines.push('ถามเนื้อหาในไฟล์ได้เลย เช่น "ในคลังความรู้เขียนเรื่อง … ไว้ว่ายังไง"');
    this.show(conversationId, replyId, lines.join('\n'));
    return lines;
  }

  /** "ยกเลิกงานค้นคว้า": stops every queued or running job. */
  cancelAll(conversationId, replyId) {
    const active = this.active();
    for (const t of active) t.controller?.abort(new Error('ผู้ใช้ยกเลิก'));
    const allResearch = active.every((t) => t.kind === 'research');
    this.show(conversationId, replyId, !active.length ? 'ตอนนี้ไม่มีงานที่กำลังทำอยู่'
      : allResearch ? `ยกเลิกงานค้นคว้า ${active.map((t) => `“${t.topic}”`).join(', ')} แล้ว`
        : `ยกเลิกงานแล้ว: ${active.map((t) => labelOf(t)).join(', ')}`);
    return active.length;
  }

  /** "งานค้นคว้าถึงไหนแล้ว" */
  showStatus(conversationId, replyId) {
    const active = this.active(), recent = this.list().filter((t) => !ACTIVE.includes(t.status)).slice(-3).reverse();
    const lines = active.length ? ['งานที่กำลังทำ:', ...active.map((t) => `• ${labelOf(t)} — ${t.status === 'queued' ? 'รอคิว' : t.steps.at(-1)?.text ?? 'เริ่มแล้ว'}`)] : ['ตอนนี้ไม่มีงานค้างอยู่'];
    if (recent.length) lines.push('', 'งานล่าสุด:', ...recent.map((t) => `• ${labelOf(t)} — ${STATUS_TH[t.status] ?? t.status}${t.result?.file ? ` (knowledge/${t.result.file})` : t.result?.path ? ` (${t.result.path})` : ''}`));
    const scheduled = this.scheduleList().length;
    if (scheduled) lines.push('', `มีงานตั้งเวลาไว้ ${scheduled} งาน (ดูได้ด้วย "ดูงานที่ตั้งเวลาไว้")`);
    this.show(conversationId, replyId, lines.join('\n'));
  }

  async run(task) {
    const signal = task.controller.signal;
    const finish = (status, text, extra) => { task.status = status; task.finishedAt = Date.now(); delete task.controller; this.save(); this.showTask(task, text, extra); };
    if (signal.aborted) { if (this.closing) finish('interrupted', closedText(task)); else finish('cancelled', `${kindOf(task).cancel} “${task.topic}” แล้ว`); return; }
    task.status = 'running'; task.startedAt = Date.now(); this.save();
    const lines = [`${kindOf(task).progress}: “${task.topic}”`];
    const onStep = (s) => { task.steps.push({ at: Date.now(), stage: s.stage, text: s.text }); lines.push(`• ${s.text}`); this.showTask(task, lines.join('\n')); };
    const ask = (messages, params) => this.ask(messages, params, signal, task.id);
    try {
      if (task.kind === 'digest') return await this.runDigestTask(task, { ask, onStep, signal, finish });
      if (task.kind === 'trip') return await this.runTripTask(task, { ask, onStep, signal, finish });
      if (task.kind === 'quiz') return await this.runQuizTask(task, { ask, onStep, signal, finish });
      const mode = task.kind === 'brief' ? (task.news ? 'news' : 'brief') : 'note';
      const result = await runResearch({ topic: task.topic, signal, ask, onStep, mode,
        search: (query) => this.search(query, signal),
        save: (note) => this.library.saveNote(note) });
      if (result.status === 'saved' && this.library?.folder) {
        const others = (await findTopicNotes(this.library.folder, task.topic).catch(() => [])).filter((f) => f !== result.file);
        if (task.kind === 'update' && others.length) result.archived = await archiveNotes(this.library.folder, others).catch(() => []);
        else if (task.kind === 'research') result.existing = others;
      }
      task.result = { file: result.file, title: result.title, facts: result.facts, removed: result.removed?.length ?? 0, revised: !!result.revised, queries: result.queries, sources: result.sources?.map((s) => s.url), reason: result.reason,
        ...(result.archived ? { archived: result.archived } : {}),
        // what the check cut, for reviewing the quality later (not shown in the chat)
        removedLines: (result.removed ?? []).slice(0, 8).map((x) => ({ line: String(x.line).slice(0, 300), problems: x.problems })) };
      const citations = (result.sources ?? []).map((s, i) => ({ contractVersion: 1, id: `E${i + 1}`, kind: 'web', title: s.title, url: s.url, publishedAt: s.publishedAt ?? null }));
      const text = task.kind === 'brief' ? briefReport(task, result) : task.kind === 'update' ? updateReport(task.topic, result) : researchReport(task.topic, result);
      finish(result.status === 'ready' ? 'done' : result.status, text, citations.length ? { citations } : {});
    } catch (e) {
      const cancelled = signal.aborted;
      task.error = String(cancelled ? signal.reason?.message ?? 'ยกเลิก' : e?.message ?? e).slice(0, 300);
      if (this.closing) finish('interrupted', closedText(task));
      else finish(cancelled ? 'cancelled' : 'failed', cancelled ? `${kindOf(task).cancel} “${task.topic}” แล้ว` : `${kindOf(task).progress}เรื่อง “${task.topic}” หยุดกลางทาง: ${task.error}`);
    } finally {
      try { await this.store.persist(); } catch {}
    }
  }

  async runDigestTask(task, { ask, onStep, signal, finish }) {
    const results = [];
    for (const f of task.files ?? []) {
      signal.throwIfAborted();
      let r;
      try {
        const { info, file } = await this.attachments.get(f.id);
        onStep({ stage: 'read', text: `อ่านไฟล์ “${f.name}”` });
        const { text } = await this.extract(info.name, await fsp.readFile(file));
        r = await runDigest({ name: f.name, text, ask, signal, onStep,
          save: (note) => saveFileNote(this.library, note) });
      } catch (e) {
        if (signal.aborted) throw e;
        r = { status: 'failed', reason: String(e?.message ?? e).slice(0, 200) };
      }
      results.push({ name: f.name, r });
    }
    const saved = results.filter((x) => x.r.status === 'saved');
    task.result = { files: results.map(({ name, r }) => ({ name, status: r.status, file: r.file, title: r.title, facts: r.facts, reason: r.reason })),
      file: saved[0]?.r.file, removedLines: results.flatMap(({ r }) => r.removed ?? []).slice(0, 8).map((x) => ({ line: String(x.line).slice(0, 300), problems: x.problems })) };
    finish(saved.length ? 'saved' : 'not-enough', digestReport(results));
  }

  async runTripTask(task, { ask, onStep, signal, finish }) {
    const req = task.req, r = await runTrip({ req, ask, onStep, signal, today: thaiToday(this.now()), now: this.now(), search: (query) => this.search(query, signal) });
    let out = null, sheet = null;
    if (r.status === 'ready') {
      onStep({ stage: 'save', text: 'ทำไฟล์ Word และ Excel' });
      const base = `documents/trips/${thaiDay(this.now())}-${fileSlug(tripTitle(req), 60)}`;
      out = await writeOut(this.files, `${base}.docx`, await buildDocx({ title: tripTitle(req), blocks: tripBlocks(req, r, thaiToday(this.now())) }));
      sheet = await writeOut(this.files, `${base}.xlsx`, await tripXlsx(req, r, thaiToday(this.now())));
    }
    task.result = { path: out?.path, title: tripTitle(req), checked: r.checked, removed: r.removed?.length ?? 0, revised: !!r.revised, queries: r.queries, sources: r.sources?.map((s) => s.url), reason: r.reason,
      removedLines: (r.removed ?? []).slice(0, 8).map((x) => ({ line: String(x.line).slice(0, 300), problems: x.problems })) };
    const citations = r.status === 'ready' ? r.sources.map((s, i) => ({ contractVersion: 1, id: `E${i + 1}`, kind: 'web', title: s.title, url: s.url, publishedAt: s.publishedAt ?? null })) : [];
    finish(r.status === 'ready' ? 'done' : r.status, tripReport(req, r, out?.path, sheet?.path), { ...(citations.length ? { citations } : {}), ...(out ? { files: [out, sheet] } : {}) });
  }

  async runQuizTask(task, { ask, onStep, signal, finish }) {
    const req = task.req, title = quizTitle(req), r = await runQuiz({ req, ask, onStep, signal });
    let files = [];
    if (r.status === 'ready') {
      onStep({ stage: 'save', text: 'ทำไฟล์ Word และ Excel' });
      const base = `documents/quizzes/${thaiDay(this.now())}-${fileSlug(title, 60)}`;
      files = [await writeOut(this.files, `${base}.docx`, await buildDocx({ title, blocks: quizBlocks(req, r.questions, thaiToday(this.now())) })),
        await writeOut(this.files, `${base}.xlsx`, await quizXlsx(req, r.questions))];
    }
    task.result = { path: files[0]?.path, title, questions: r.questions?.length ?? 0, dropped: r.dropped?.length ?? 0, reason: r.reason,
      droppedLines: (r.dropped ?? []).slice(0, 8).map((x) => ({ q: String(x.q).slice(0, 200), problems: x.problems })) };
    finish(r.status === 'ready' ? 'done' : r.status, quizReport(req, r, files.map((f) => f.path)), files.length ? { files } : {});
  }

  async search(query, signal) {
    const r = await this.webGateway.search({ query, limit: 5 }, { signal, timeoutMs: 30000 });
    return r?.results ?? [];
  }

  // ---- schedules -------------------------------------------------------------------------------------------
  scheduleList() { return [...this.schedules.values()].filter((s) => s.enabled !== false).sort((a, b) => a.createdAt - b.createdAt); }
  saveSchedules() { writeJson(this.scheduleFile, [...this.schedules.values()], 'schedules'); }

  /** "ทุกเช้า 7 โมง สรุปข่าว AI ให้หน่อย" */
  createSchedule({ conversationId, replyId, characterId = null, private: isPrivate = false, webOff = false, rule, timeGuessed, job }) {
    const now = this.now(), show = (text) => { this.show(conversationId, replyId, text); return null; };
    const label = labelOf(job);
    if (isPrivate) return show(`แชตส่วนตัวตั้งงานล่วงหน้าไม่ได้ (${label}) สั่งในแชตปกติได้เลย`);
    if (rule.type === 'once' && rule.at <= now) return show(`เวลานั้น (${formatWhen(rule.at, now)}) ผ่านไปแล้ว เลยยังไม่ได้ตั้ง${label} บอกเวลาที่ยังไม่ถึงแล้วสั่งใหม่ได้`);
    if (this.scheduleList().length >= MAX_SCHEDULES) return show(`ตั้งงานไว้ครบ ${MAX_SCHEDULES} งานแล้ว ยกเลิกงานเก่าก่อน (“ดูงานที่ตั้งเวลาไว้”) แล้วสั่งใหม่ได้`);
    const s = { id: randomUUID(), kind: job.kind, topic: job.topic, news: !!job.news, rule, label, conversationId, characterId, createdAt: now, lastSlot: null, enabled: true, runs: 0 };
    this.schedules.set(s.id, s); this.saveSchedules();
    const n = this.scheduleList().indexOf(s) + 1, next = nextRun(rule, now);
    const lines = [`ตั้งงานแล้ว: ${label} · ${describeRule(rule)}`,
      rule.type === 'once' ? `เวลา: ${formatWhen(rule.at, now)} · ผลจะขึ้นในแชตนี้` : `ครั้งถัดไป: ${next ? formatWhen(next, now) : '-'} · ผลจะขึ้นในแชตนี้`];
    if (timeGuessed) lines.push('ไม่ได้บอกเวลา เลยตั้งไว้ 07:00 ถ้าจะเปลี่ยน ยกเลิกแล้วสั่งใหม่พร้อมเวลา');
    if (rule.weekDefault) lines.push('ไม่ได้บอกวัน เลยตั้งเป็นทุกวันจันทร์');
    if (webOff) lines.push('ตอนนี้ตั้งค่าปิดการค้นเว็บอยู่ งานนี้จะทำได้ก็ต่อเมื่อเปิดการค้นเว็บ');
    lines.push(rule.type === 'once' ? 'ถ้าตอนนั้น Lumicos ปิดอยู่ จะทำให้ตอนเปิดครั้งถัดไป (ภายใน 24 ชั่วโมง)' : 'ถ้าถึงเวลาแล้ว Lumicos ปิดอยู่ จะทำให้ตอนเปิดครั้งถัดไปภายในวันเดียวกัน',
      `ลองทำตอนนี้: “ทำงานตั้งเวลาข้อ ${n} ตอนนี้เลย” · ดูทั้งหมด: “ดูงานที่ตั้งเวลาไว้” · ยกเลิก: “ยกเลิกงานตั้งเวลาข้อ ${n}”`);
    show(lines.join('\n'));
    return s;
  }

  /** "ดูงานที่ตั้งเวลาไว้" */
  listSchedules({ conversationId, replyId }) {
    const now = this.now(), list = this.scheduleList();
    if (!list.length) return this.show(conversationId, replyId, 'ยังไม่มีงานตั้งเวลา ลองสั่งเช่น “ทุกเช้า 7 โมง สรุปข่าว AI ให้หน่อย” หรือ “ทุกวันจันทร์ 9 โมง ค้นเรื่อง ROCm แล้วเก็บเข้าคลัง”');
    this.show(conversationId, replyId, [`งานตั้งเวลา ${list.length} งาน:`, ...this.scheduleLines(list, now),
      'สั่งได้: “ทำงานตั้งเวลาข้อ 1 ตอนนี้เลย” · “ยกเลิกงานตั้งเวลาข้อ 1” · “ยกเลิกงานตั้งเวลาทั้งหมด”'].join('\n'));
    return list;
  }
  scheduleLines(list, now = this.now()) {
    const all = this.scheduleList();
    return list.map((s) => {
      const next = nextRun(s.rule, now), last = s.lastRunAt ? ` · ล่าสุด ${formatWhen(s.lastRunAt, now)}` : '';
      return `${all.indexOf(s) + 1}. ${s.label} · ${describeRule(s.rule)} · ครั้งถัดไป ${next ? formatWhen(next, now) : '-'}${last}`;
    });
  }

  /** "ยกเลิกงานตั้งเวลาข้อ 2", "ยกเลิกงานตั้งเวลาทั้งหมด", "ยกเลิกงานตั้งเวลาสรุปข่าว AI" */
  cancelSchedules({ conversationId, replyId, target }) {
    const list = this.scheduleList(), picked = pickSchedules(list, target);
    if (!list.length) return this.show(conversationId, replyId, 'ตอนนี้ไม่มีงานตั้งเวลาให้ยกเลิก');
    if (!picked.length) {
      return this.show(conversationId, replyId, [target ? `ไม่เจองานตั้งเวลาที่ตรงกับ “${target}”` : `มีงานตั้งเวลา ${list.length} งาน ยกเลิกข้อไหนดี`,
        ...this.scheduleLines(list), 'พิมพ์เช่น “ยกเลิกงานตั้งเวลาข้อ 1” หรือ “ยกเลิกงานตั้งเวลาทั้งหมด”'].join('\n'));
    }
    const lines = this.scheduleLines(picked);
    for (const s of picked) this.schedules.delete(s.id);
    this.saveSchedules();
    this.show(conversationId, replyId, [`ยกเลิกงานตั้งเวลาแล้ว ${picked.length} งาน:`, ...lines.map((l) => l.replace(/ · ครั้งถัดไป .*$/u, ''))].join('\n'));
    return picked;
  }

  /** "ทำงานตั้งเวลาข้อ 1 ตอนนี้เลย": runs it now in this chat (its schedule stays as it was). */
  async runScheduleNow({ conversationId, replyId, target, webOff = false }) {
    const list = this.scheduleList(), picked = pickSchedules(list, target);
    if (picked.length !== 1) {
      return this.show(conversationId, replyId, !list.length ? 'ยังไม่มีงานตั้งเวลาให้สั่งทำ'
        : [picked.length ? 'ตรงกับหลายงาน เลือกข้อเดียว' : target ? `ไม่เจองานตั้งเวลาที่ตรงกับ “${target}”` : `มีงานตั้งเวลา ${list.length} งาน ทำข้อไหนดี`,
          ...this.scheduleLines(list), 'พิมพ์เช่น “ทำงานตั้งเวลาข้อ 1 ตอนนี้เลย”'].join('\n'));
    }
    return this.fire(picked[0], { conversationId, replyId, manual: true, webOff });
  }

  /** Starts the schedule clock: a first check after Lumicos has had time to load, then every 30 seconds. */
  startSchedules({ firstDelayMs = 90_000, everyMs = 30_000 } = {}) {
    if (this.firstTimer || this.timer) return;
    this.firstTimer = setTimeout(() => {
      void this.tick();
      this.timer = setInterval(() => void this.tick(), everyMs); this.timer.unref?.();
    }, firstDelayMs);
    this.firstTimer.unref?.();
  }

  /**
   * Runs each schedule whose time has come and not yet run. A run missed while Lumicos was off is made at the next
   * check the same day (a one-off within 24 hours); older ones are skipped. Waits up to webWaitMs for the web search
   * after a start. Several missed days run once, not once per day.
   */
  async tick(now = this.now()) {
    if (this.closing || this.ticking) return;
    this.ticking = true;
    try {
      for (const s of this.scheduleList()) {
        const due = lastDue(s.rule, now);
        if (due == null || due <= (s.lastSlot ?? s.createdAt)) continue;
        if (s.rule.type === 'once' ? now - due > DAY : !sameDay(due, now)) {
          s.lastSlot = due; s.missed = (s.missed ?? 0) + 1;
          if (s.rule.type === 'once') this.schedules.delete(s.id);
          this.saveSchedules();
          continue;
        }
        if (!await this.webReady() && now - (s.waitingSince ??= now) < this.webWaitMs) continue;
        delete s.waitingSince;
        s.lastSlot = due; s.runs = (s.runs ?? 0) + 1; s.lastRunAt = now;
        if (s.rule.type === 'once') this.schedules.delete(s.id);
        this.saveSchedules();
        await this.fire(s).catch((e) => console.warn('[agent] scheduled run failed to start:', e?.message ?? e));
      }
    } finally { this.ticking = false; }
  }

  /** Starts one run of a schedule: in the given reply (run now) or a new message in its chat. */
  async fire(s, { conversationId, replyId, manual = false, webOff } = {}) {
    const header = `🗓 งานตั้งเวลา: ${s.label} · ${describeRule(s.rule)}${manual ? ' · สั่งทำตอนนี้' : ''}`;
    let conv = conversationId, reply = replyId;
    if (!reply) ({ conversationId: conv, replyId: reply } = await this.post(s, `${header}\nรับงานตั้งเวลาแล้ว กำลังเริ่ม…`));
    const prefs = this.store.state?.preferences?.knowledge ?? {};
    const off = webOff ?? (prefs.searchMode === 'OFF' || (prefs.searchMode === undefined && prefs.webEnabled === false));
    return this.accept({ kind: s.kind, topic: s.topic, news: s.news, conversationId: conv, replyId: reply, header, scheduleId: s.id, webOff: off });
  }

  /** A new assistant message at the end of a schedule's chat (or of "🗓 งานตั้งเวลาของ Lumicos" when that chat is gone). */
  async post(s, text) {
    try { return { conversationId: s.conversationId, replyId: this.postMessage(s.conversationId, text) }; }
    catch (e) { if (e?.status !== 404) throw e; }
    s.conversationId = await this.inbox(s);
    this.saveSchedules();
    return { conversationId: s.conversationId, replyId: this.postMessage(s.conversationId, text) };
  }
  postMessage(conversationId, text) {
    const id = randomUUID(), at = Date.now();
    this.store.patch(conversationId, (c) => ({ ...c, messages: [...c.messages, { id, role: 'assistant', createdAt: at, status: 'done', parts: [{ type: 'text', text }], agentSchedule: true }], updatedAt: at }));
    return id;
  }
  async inbox(s) {
    const found = this.store.state.conversations.find((c) => c.agentInbox);
    if (found) return found.id;
    const id = randomUUID(), at = Date.now();
    const conversation = { id, title: '🗓 งานตั้งเวลาของ Lumicos', titleLocked: true, characterId: s.characterId ?? 'default-mina', messages: [], createdAt: at, updatedAt: at, agentInbox: true };
    for (let i = 0; ; i++) {
      try { await this.store.transaction({ revision: this.store.state.revision, upsert: [conversation] }); return id; }
      catch (e) { if (e?.status !== 409 || i >= 2) throw e; }
    }
  }

  // ---- model steps -----------------------------------------------------------------------------------------
  /** A chat was sent or a call is starting: stop the running model step (it is redone later) and wait until it let go. */
  async yieldNow() {
    const running = [...this.steps];
    if (!running.length) return;
    for (const s of running) s.controller.abort(YIELD);
    await Promise.race([Promise.all(running.map((s) => s.done)), sleep(5000)]);
    // The aborted request may hold the GPU lock a moment longer (its stream closes asynchronously).
    for (let i = 0; i < 40 && this.models.comfy?.compute?.active; i++) await sleep(50);
  }

  /** A chat is waiting for the model, or a call is starting, on or ending: those go first. */
  othersFirst() { return (this.models.pendingChats ?? 0) > 0 || !!this.models.callSession || !!this.callBusy?.(); }

  /** One model step: waits while others go first or the model is switching; redone after a yield. */
  async ask(messages, params = {}, signal, correlationId) {
    const started = Date.now();
    for (;;) {
      while (this.othersFirst() || this.models.busy) {
        if (Date.now() - started > this.stepWaitMs) throw new Error('รอคิวโมเดลนานเกิน 20 นาที');
        await sleep(this.pollMs, signal);
      }
      signal?.throwIfAborted();
      const controller = new AbortController(), onAbort = () => controller.abort(signal.reason);
      signal?.addEventListener('abort', onAbort, { once: true });
      const run = this.models.enqueueBackground(() => this.modelStep(messages, params, controller.signal, correlationId, started));
      const step = { controller, done: run.then(() => {}, () => {}) };
      this.steps.add(step);
      try { return await run; }
      catch (e) { if (signal?.aborted || (e !== YIELD && controller.signal.reason !== YIELD)) throw e; }
      finally { this.steps.delete(step); signal?.removeEventListener('abort', onAbort); }
    }
  }

  async modelStep(messages, { maxTokens = 800, temperature = 0.3 } = {}, signal, correlationId, started = Date.now()) {
    signal.throwIfAborted();
    if (this.othersFirst()) throw YIELD;
    const runtime = await this.runtime();
    let turn;
    for (;;) { // the GPU may be busy for a while (an image job, a model loading)
      try { turn = await this.models.begin(['text'], 'chat'); break; }
      catch (e) {
        if (this.othersFirst()) throw YIELD;
        if (Date.now() - started > this.stepWaitMs) throw e;
        await sleep(this.retryMs, signal);
      }
    }
    const info = this.models.turns?.get(turn.id); if (info) info.device = 'internal';
    const heartbeat = setInterval(() => { try { this.models.touch(turn.id); } catch {} }, 15000); heartbeat.unref?.();
    try {
      signal.throwIfAborted();
      const base = `http://127.0.0.1:${this.config.port}`;
      const transport = (url, init = {}) => fetch(new URL(url, base), { ...init, headers: { ...init.headers, 'X-Lumicos-Internal': this.config.internalToken, 'X-Lumicos-Turn': turn.id } });
      const provider = new runtime.LlamaCppProvider('/llama', transport, () => turn.id);
      let text = '', failed = null;
      await provider.streamChat({ purpose: 'agent', correlationId, enableThinking: false, params: { temperature, topP: 0.9, maxTokens }, messages },
        { onToken: (t) => { text += t; }, onError: (e) => { failed = e; }, onDone: () => {} }, signal);
      signal.throwIfAborted();
      if (failed) throw new Error(String(failed?.message ?? failed));
      return text;
    } finally { clearInterval(heartbeat); await this.models.end(turn.id).catch(() => {}); }
  }

  /** Lumicos is shutting down: each unfinished job says so in its chat message now (the store is saved right after). */
  close() {
    this.closing = true;
    clearTimeout(this.firstTimer); clearInterval(this.timer);
    for (const t of this.active()) { t.status = 'interrupted'; this.showTask(t, closedText(t)); t.controller?.abort(new Error('Lumicos ปิด')); }
    this.save();
  }
}
