// claude-20261025: Lumicos's agent jobs beyond research (user: "ทำให้ lumicos เป็น Agent ในส่วนอื่นต่อได้เลย"):
// update a library note, scheduled briefs/research ("ทุกเช้า 7 โมง สรุปข่าว AI ให้หน่อย"), summarize an attached file into the
// library, store an attached file. Through the server chat path with a fake model, web and attachments.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { updateTopic, briefTopic, runResearch } from '../agent/research.mjs';
import { fileAsk, splitParts, factLines, runDigest } from '../agent/digest.mjs';
import { findTopicNotes, archiveNotes, saveFileNote, storeFile, noteTopic } from '../agent/notes.mjs';
import { AgentService, labelOf } from '../agent/agentService.mjs';
import { KnowledgeLibrary } from '../knowledge/library.mjs';
import { ConversationStore } from '../chat/conversationStore.mjs';
import { ChatService } from '../chat/chatService.mjs';
import { ModelService } from '../llama/modelService.mjs';
import { extractText } from '../files/fileContext.mjs';
import * as runtime from '../../.runtime/chat.mjs';

const wait = (ms) => new Promise((r) => setTimeout(r, ms));
async function until(check, what, ms = 5000) {
  for (const end = Date.now() + ms; Date.now() < end; await wait(5)) if (check()) return;
  assert.fail(`timed out waiting for ${what}`);
}
const bkk = (y, mo, d, h = 0, mi = 0) => Date.UTC(y, mo - 1, d, h, mi) - 7 * 3_600_000;

// ---- a small web and a model that answers by prompt ----------------------------------------------------------
const WEB = {
  'ROCm 10': [['AMD ROCm 10 announced', 'https://amd.example/rocm10', 'AMD released ROCm 10 in 2026 with new features for developers and HPC users.'],
    ['ROCm 10 OS support', 'https://docs.example/os', 'ROCm 10 supports Ubuntu 24.04 and RHEL 9.4 as host operating systems for GPUs.']],
  'ROCm 10 release notes': [['ROCm 10 installer', 'https://docs.example/install', 'The ROCm 10 installer is a 3.5 GB download that includes the HIP SDK and libraries.']],
  'AI': [['AI news today', 'https://news.example/ai1', 'On 24 October 2026 a lab released a model with 12 billion parameters for phones.'],
    ['AI chips', 'https://news.example/ai2', 'Chip makers said on 23 October 2026 that AI accelerator sales grew 40 percent this year.']],
  'AI ข่าวล่าสุด': [['ข่าว AI', 'https://news.example/ai3', 'วันที่ 24 ตุลาคม 2569 มีการเปิดตัวผู้ช่วย AI ภาษาไทยรุ่นใหม่ รองรับ 5 ภาษา สำหรับโทรศัพท์']],
};
const webSearch = async (q) => (WEB[q] ?? []).map(([title, url, snippet], i) => ({ id: String(i + 1), title, url, snippet, publishedAt: '2026-10-24T00:00:00Z' }));
const PLAN = { 'ROCm 10': 'ROCm 10 release notes', AI: 'AI ข่าวล่าสุด' };
// sources come out as 1 amd, 2 installer, 3 os for ROCm 10; 1 ai1, 2 ai3, 3 ai2 for AI
const NOTE = '# ROCm 10 ใหม่\nสรุป: ROCm 10 ออกในปี 2026\n- ROCm 10 ออกในปี 2026 [1]\n- ตัวติดตั้งขนาด 3.5 GB [2]\n- รองรับ Ubuntu 24.04 [3]';
const BRIEF = '# ข่าว AI วันนี้\nสรุป: มีโมเดลใหม่สำหรับโทรศัพท์และยอดขายชิปโต\n- 24 ต.ค. 2026 เปิดตัวโมเดล 12 พันล้านพารามิเตอร์สำหรับโทรศัพท์ [1]\n- ผู้ช่วย AI ภาษาไทยรุ่นใหม่รองรับ 5 ภาษา [2]\n- ยอดขายชิป AI โต 40 เปอร์เซ็นต์ [3]\n- ยอดผู้ใช้ 999 ล้านคน [1]';
function modelFor(messages) {
  const sys = messages[0].content, user = messages.at(-1).content;
  if (sys.startsWith('You plan web searches')) return PLAN[user.match(/หัวข้อ: (.+)/)[1]] ?? '';
  if (sys.startsWith('You write a short news brief') || sys.startsWith('You write a short brief')) return user.startsWith('โน้ตนี้มีบรรทัด') ? BRIEF.replace('- ยอดผู้ใช้ 999 ล้านคน [1]\n', '').replace(/\n- ยอดผู้ใช้ 999 ล้านคน \[1\]$/, '') : BRIEF;
  if (sys.startsWith('You read one part of a document')) {
    const part = user.match(/ส่วนที่ (\d+)/)[1];
    return part === '1' ? '- รหัสโครงการ ม่วง-42\n- ผู้รับผิดชอบคือคุณดาวเรือง\n- งบประมาณ 120,000 บาท\n- ประชุมครั้งถัดไป 777 คน' : '- กำหนดส่ง 5 พ.ย. 2569\n- ทีมมี 7 คน รวมผู้ประสานงาน 2 คน';
  }
  if (sys.includes('from facts already taken out of a document')) return '# สรุปประชุมโครงการม่วง-42\nสรุป: บันทึกประชุมโครงการม่วง-42\n- รหัสโครงการ ม่วง-42 [1]\n- งบประมาณ 120,000 บาท [1]\n- กำหนดส่ง 5 พ.ย. 2569 [2]\n- ผู้ประสานงาน 2 คน [2]';
  if (sys.includes('using ONLY the document text')) {
    return user.startsWith('โน้ตนี้มีบรรทัด') ? '# ประชุมทีม\nสรุป: ประชุมทีมเรื่องโครงการม่วง-42\n- รหัสโครงการ ม่วง-42 [1]\n- กำหนดส่ง 5 พ.ย. 2569 [1]'
      : '# ประชุมทีม\nสรุป: ประชุมทีมเรื่องโครงการม่วง-42\n- รหัสโครงการ ม่วง-42 [1]\n- กำหนดส่ง 5 พ.ย. 2569 [1]\n- งบ 999 บาท [1]';
  }
  return user.startsWith('โน้ตนี้มีบรรทัด') ? NOTE : NOTE;
}

test('update and brief requests, and what a schedule asks for', () => {
  assert.equal(updateTopic('อัปเดตเรื่อง ROCm 10 ในคลัง'), 'ROCm 10');
  assert.equal(updateTopic('อัปเดตข้อมูล Gemma 4 ในคลังความรู้ให้หน่อย'), 'Gemma 4');
  assert.equal(updateTopic('ค้นเรื่อง ROCm 10 ใหม่แล้วอัปเดตในคลัง'), 'ROCm 10');
  assert.equal(updateTopic('update ROCm 10 in the library'), 'ROCm 10');
  for (const t of ['ROCm อัปเดตล่าสุดเมื่อไหร่ในคลังมีไหม', 'อัปเดตให้หน่อย', 'ค้นเรื่อง ROCm แล้วเก็บเข้าคลัง']) assert.equal(updateTopic(t), null, t);
  assert.deepEqual(briefTopic('สรุปข่าว AI ให้หน่อย'), { topic: 'AI', news: true });
  assert.deepEqual(briefTopic('สรุปข่าวให้หน่อย'), { topic: 'ข่าวเด่นวันนี้', news: true });
  assert.deepEqual(briefTopic('ค้นข่าวหุ้นไทยแล้วสรุปให้ฟัง'), { topic: 'หุ้นไทย', news: true });
  assert.deepEqual(briefTopic('สรุปราคาทองให้หน่อย'), { topic: 'ราคาทอง', news: false });
  assert.deepEqual(briefTopic('บอกราคาน้ำมันหน่อย'), { topic: 'ราคาน้ำมัน', news: false });
  for (const t of ['สรุปให้หน่อย', 'ค้นเรื่อง ROCm แล้วเก็บเข้าคลัง', 'ราคาทองวันนี้']) assert.equal(briefTopic(t), null, t);
  assert.equal(labelOf({ kind: 'brief', topic: 'AI', news: true }), 'สรุปข่าว “AI”');
  assert.equal(labelOf({ kind: 'update', topic: 'ROCm 10' }), 'อัปเดต “ROCm 10” ในคลังความรู้');
});

test('a news brief is written for the chat: checked like a note, nothing saved', async () => {
  const asks = [];
  const r = await runResearch({ topic: 'AI', mode: 'news', today: '25 ตุลาคม 2569', search: webSearch, save: async () => assert.fail('a brief saves nothing'),
    ask: async (messages, params) => { asks.push({ messages, params }); return modelFor(messages); } });
  assert.equal(r.status, 'ready');
  assert.match(asks[0].messages[0].content, /today's news brief/);
  assert.match(asks[1].messages[0].content, /news brief in Thai/);
  assert.equal(asks[1].params.maxTokens, 700);
  assert.ok(!r.text.includes('999') && r.facts === 3, r.text);
  assert.match(r.body, /^สรุป: มีโมเดลใหม่/);
});

test('notes of a topic are found, archived (moved, not deleted), and file notes and files are kept', async (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lumicos-notes-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const lib = { folder: dir, workspaceId: 'default', synced: 0, async sync() { this.synced++; }, sources: { getByUri: () => ({ status: 'ready' }) },
    status() { return { documents: fs.existsSync(path.join(dir, 'files')) ? fs.readdirSync(path.join(dir, 'files')).map((n) => ({ name: `files/${n}`, status: 'ready' })) : [] }; } };
  const save = (topic, title) => KnowledgeLibrary.prototype.saveNote.call(lib, { title, topic, body: 'สรุป: ทดสอบ\n- ข้อหนึ่ง 2026 [1]', sources: [{ title: 'a', url: 'https://a' }] });
  const a = await save('ROCm 10 ของ AMD', 'ROCm 10 รุ่นแรก');
  await wait(15);
  const b = await save('ROCm 10', 'ROCm 10 รุ่นสอง');
  await save('ข่าว AI สัปดาห์นี้', 'ข่าว AI');
  assert.equal(noteTopic(fs.readFileSync(path.join(dir, a.file), 'utf8')), 'ROCm 10 ของ AMD');
  assert.deepEqual(await findTopicNotes(dir, 'ROCm 10'), [b.file, a.file], 'newest first; "ROCm 10" finds "ROCm 10 ของ AMD"');
  assert.deepEqual(await findTopicNotes(dir, 'AI'), [], '"AI" is too short a part of "ข่าว AI สัปดาห์นี้"');
  const moved = await archiveNotes(dir, [a.file]);
  assert.deepEqual(moved, [`_archive/${a.file}`]);
  assert.ok(!fs.existsSync(path.join(dir, a.file)) && fs.existsSync(path.join(dir, moved[0])));
  assert.deepEqual(await findTopicNotes(dir, 'ROCm 10'), [b.file], 'archived notes are not found again');
  const note = await saveFileNote(lib, { title: 'สรุปประชุม', body: 'สรุป: ประชุมทีม\n- รหัส ม่วง-42 [1]', fileName: 'meeting notes.txt', parts: [{ label: '(ทั้งไฟล์)' }] });
  const md = fs.readFileSync(path.join(dir, note.file), 'utf8');
  assert.match(md, /^# สรุปประชุม\n\nบันทึกเมื่อ \d{4}-\d{2}-\d{2} · ที่มา: Lumicos สรุปจากไฟล์ "meeting notes\.txt" · ตรวจตัวเลขในแต่ละข้อกับเนื้อไฟล์แล้ว\n/);
  assert.ok(md.includes('## ที่มา\n1. ไฟล์ "meeting notes.txt" (ทั้งไฟล์)'));
  const src = path.join(dir, 'upload.pdf'); fs.writeFileSync(src, '%PDF-1.4 test');
  const s1 = await storeFile(lib, src, 'report.pdf'), s2 = await storeFile(lib, src, 'report.pdf');
  assert.deepEqual([s1.file, s2.file], ['files/report.pdf', 'files/report-2.pdf']);
  assert.equal(s1.status, 'ready');
  assert.ok(fs.existsSync(src), 'the attachment itself stays where it was');
});

test('file requests: summarize into the library or store the file; parts and fact lines', () => {
  assert.deepEqual(fileAsk('สรุปไฟล์นี้แล้วเก็บเข้าคลัง'), { kind: 'digest', mentionsFile: true });
  assert.deepEqual(fileAsk('ช่วยสรุปเอกสารที่แนบมาแล้วบันทึกลงคลังความรู้หน่อย'), { kind: 'digest', mentionsFile: true });
  assert.deepEqual(fileAsk('สรุปแล้วเก็บเข้าคลัง'), { kind: 'digest', mentionsFile: false }, 'acted on only with a file attached to that message');
  assert.deepEqual(fileAsk('summarize this file and save it'), { kind: 'digest', mentionsFile: true });
  assert.deepEqual(fileAsk('เก็บไฟล์นี้เข้าคลัง'), { kind: 'store-file', mentionsFile: true });
  assert.deepEqual(fileAsk('เอาไฟล์พวกนี้ใส่คลังความรู้'), { kind: 'store-file', mentionsFile: true });
  for (const t of ['ค้นเรื่อง ROCm แล้วเก็บเข้าคลัง', 'สรุปข่าว AI สัปดาห์นี้ แล้วเก็บไว้ในคลัง', 'ไฟล์นี้เขียนว่าอะไร', 'ในคลังความรู้มีไฟล์อะไรบ้าง']) assert.equal(fileAsk(t), null, t);
  const text = Array.from({ length: 30 }, (_, i) => `ย่อหน้าที่ ${i + 1} ${'ข้อความ '.repeat(40)}`).join('\n\n');
  const parts = splitParts(text, 1000);
  assert.ok(parts.length > 5 && parts.every((p) => p.length <= 1000 && p.startsWith('ย่อหน้าที่')), 'cut at paragraph ends');
  assert.equal(parts.join('\n\n').replace(/\s+/g, ''), text.replace(/\s+/g, ''), 'nothing lost');
  assert.deepEqual(factLines('นี่คือข้อเท็จจริง:\n1. ข้อแรก 2026\n- ข้อสอง\n* ข้อสาม\nท้าย'), ['ข้อแรก 2026', 'ข้อสอง', 'ข้อสาม']);
});

test('summarizing a file: one part is checked and revised once; several parts are checked per part and again in the note', async () => {
  const saved = [];
  const save = async (note) => { saved.push(note); return { file: 'learned/2026-10/x.md' }; };
  const small = 'บันทึกประชุมทีม 23 ต.ค. 2569\nรหัสโครงการ: ม่วง-42\nผู้รับผิดชอบ: คุณดาวเรือง\nกำหนดส่ง: 5 พ.ย. 2569\n';
  const one = await runDigest({ name: 'meeting.txt', text: small, save, ask: async (m) => modelFor(m) });
  assert.equal(one.status, 'saved');
  assert.equal(one.revised, true, '"งบ 999 บาท" is not in the file: one revision');
  assert.equal(one.facts, 2);
  assert.deepEqual(saved[0].parts, [{ label: '(ทั้งไฟล์)' }]);
  const big = `${'ส่วนแรก รหัสโครงการ ม่วง-42 ผู้รับผิดชอบคุณดาวเรือง งบประมาณ 120,000 บาท\n'.repeat(60)}\n\n${'ส่วนสอง กำหนดส่ง 5 พ.ย. 2569 ผู้ประสานงาน 2 คน\n'.repeat(60)}`;
  const steps = [];
  const many = await runDigest({ name: 'big.txt', text: big, save, ask: async (m) => modelFor(m), onStep: (s) => steps.push(s.stage) });
  assert.equal(many.status, 'saved');
  assert.ok(many.parts >= 2, `${many.parts} parts`);
  assert.ok(many.removed.some((x) => x.line.includes('777 คน')), 'a fact whose number is not in its part is dropped before the note');
  assert.equal(many.facts, 4);
  assert.deepEqual(steps.filter((s) => s === 'part').length, many.parts);
  assert.equal((await runDigest({ name: 'empty.pdf', text: '   ', save, ask: async () => '' })).status, 'not-enough');
});

/** The server chat path with a fake model, web and attachments: ChatService + AgentService as service.mjs wires them. */
async function world(t, { webReady = true, now } = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lumicos-jobs-'));
  const store = new ConversationStore(path.join(dir, 'conversations.json'));
  const calls = [];
  const models = { turns: new Map(), enqueueChat: ModelService.prototype.enqueueChat, enqueueBackground: ModelService.prototype.enqueueBackground,
    async begin() { if (this.turns.size) throw new Error('โมเดลกำลังเปลี่ยนหรือมีงานตอบอยู่'); const id = randomUUID(); this.turns.set(id, {}); return { id, profile: { ctx: 8192, capabilities: { tools: false }, generation: { maxTokens: 100 } } }; },
    touch() {}, async end(id) { this.turns.delete(id); } };
  const config = { port: 0, allowedOrigins: [], internalToken: randomUUID(), dataDir: dir };
  const chats = new ChatService({ store, models, config, tools: { definitions: () => [] } });
  const service = { memory: { retrieve: async () => [], candidates: async () => [], dedupe: async (c) => c }, tools: { list: async () => [] } };
  chats.runtime = async () => ({ ...runtime, createServiceClient: () => service, LlamaCppProvider: class {
    async streamChat(request, cb) { calls.push(request.purpose); cb.onToken(request.purpose === 'agent' ? modelFor(request.messages) : 'ok'); cb.onDone({ stopped: false }); } } });
  const folder = path.join(dir, 'knowledge');
  const library = { folder, workspaceId: 'default', async sync() {}, sources: { getByUri: () => ({ status: 'ready' }) }, status: () => ({ documents: [] }),
    saveNote(note) { return KnowledgeLibrary.prototype.saveNote.call(this, note); } };
  const uploads = new Map();
  const attachments = { async get(id) { const u = uploads.get(id); if (!u) throw Object.assign(new Error('Attachment not found'), { status: 404 }); return { info: { name: u.name }, file: u.file }; } };
  const web = { ready: webReady };
  const agent = new AgentService({ store, models, config, library, attachments, extract: extractText, runtime: () => chats.runtime(),
    webGateway: { search: async (input) => ({ results: await webSearch(input.query) }) }, webStatus: async () => ({ ready: web.ready }) });
  agent.pollMs = 5; agent.retryMs = 5; agent.webWaitMs = 60_000;
  if (now) agent.now = () => now.value;
  chats.agent = agent; models.yieldBackground = () => agent.yieldNow();
  t.after(async () => { chats.close(); await agent.tail; await models.chatTail; await store.close(); fs.rmSync(dir, { recursive: true, force: true }); });
  async function newChat(extra = {}) {
    const id = randomUUID();
    await store.transaction({ revision: store.state.revision, upsert: [{ id, title: 't', characterId: runtime.DEFAULT_CHARACTER.id, messages: [], ...extra }] });
    return id;
  }
  async function send(text, { conversationId, files = [], settings = {} } = {}) {
    const id = conversationId ?? await newChat();
    const parts = [{ type: 'text', text }];
    for (const f of files) {
      const fid = randomUUID(), file = path.join(dir, `${fid}-${f.name}`);
      fs.writeFileSync(file, f.text); uploads.set(fid, { name: f.name, file });
      parts.push({ type: 'attachment', id: fid, name: f.name, size: f.text.length, kind: 'text', context: f.text, complete: true, totalChunks: 1 });
    }
    const job = await chats.submit({ requestId: randomUUID(), conversationId: id, user: { id: randomUUID(), role: 'user', parts }, settings });
    await until(() => !['queued', 'running'].includes(store.state.jobs.find((j) => j.id === job.id).status), `the chat job for "${text}"`);
    const reply = () => store.conversation(id).messages.find((m) => m.id === job.replyId);
    return { id, job, reply, text: () => reply().parts.map((p) => p.text).join('') };
  }
  const log = () => fs.readFileSync(path.join(dir, 'logs', 'tool-decisions.jsonl'), 'utf8').trim().split('\n').map((l) => JSON.parse(l));
  return { store, models, agent, chats, calls, send, newChat, dir, folder, web, log, until };
}

test('"อัปเดตเรื่อง X ในคลัง": a new note, the old one moved into _archive, both named in the report', async (t) => {
  const w = await world(t);
  const first = await w.send('ค้นเรื่อง ROCm 10 แล้วเก็บเข้าคลัง');
  await w.agent.tail;
  const oldFile = first.text().match(/^ไฟล์: knowledge\/(\S+)$/m)[1];
  const again = await w.send('ค้นเรื่อง ROCm 10 แล้วเก็บเข้าคลัง');
  await w.agent.tail;
  assert.match(again.text(), /มีโน้ตเรื่องนี้อยู่แล้ว 1 ไฟล์ ถ้าจะให้แทนที่โน้ตเก่า สั่ง "อัปเดตเรื่อง ROCm 10 ในคลัง"/);
  const secondFile = again.text().match(/^ไฟล์: knowledge\/(\S+)$/m)[1];
  const up = await w.send('อัปเดตเรื่อง ROCm 10 ในคลัง', { settings: { tools: { confirmWrites: false } } });
  assert.match(up.text(), /^รับงานอัปเดตคลังแล้ว: “ROCm 10”|^งานอัปเดตคลัง: “ROCm 10”/);
  await w.agent.tail;
  const text = up.text();
  assert.match(text, /^อัปเดตคลังความรู้แล้ว: ROCm 10 ใหม่\nไฟล์: knowledge\/learned\/\d{4}-\d{2}\/\S+\.md\nโน้ตเก่าย้ายไปเก็บแล้ว \(ไม่ได้ลบ\):\n- knowledge\/_archive\/learned\//);
  for (const f of [oldFile, secondFile]) {
    assert.ok(!fs.existsSync(path.join(w.folder, f)), `${f} left learned/`);
    assert.ok(fs.existsSync(path.join(w.folder, '_archive', f)), `${f} is in _archive`);
  }
  assert.equal(up.reply().citations.length, 3);
  assert.equal(w.log().find((e) => e.jobId === up.job.id).reason, 'update');
  assert.deepEqual(w.agent.list().at(-1).result.archived.sort(), [`_archive/${oldFile}`, `_archive/${secondFile}`].sort());
});

test('a schedule from the chat: confirmed with the next time, listed, run now as a brief, cancelled', async (t) => {
  const now = { value: bkk(2026, 10, 25, 4, 30) };
  const w = await world(t, { now });
  const made = await w.send('ทุกวัน 6 โมงเช้า สรุปข่าว AI ให้หน่อย');
  assert.equal(made.text().split('\n').slice(0, 2).join('\n'), 'ตั้งงานแล้ว: สรุปข่าว “AI” · ทุกวัน 06:00\nครั้งถัดไป: วันนี้ 06:00 · ผลจะขึ้นในแชตนี้');
  assert.match(made.text(), /ลองทำตอนนี้: “ทำงานตั้งเวลาข้อ 1 ตอนนี้เลย”/);
  assert.equal(w.calls.length, 0, 'no model turn for setting it up');
  const list = await w.send('ดูงานที่ตั้งเวลาไว้', { conversationId: made.id });
  assert.match(list.text(), /^งานตั้งเวลา 1 งาน:\n1\. สรุปข่าว “AI” · ทุกวัน 06:00 · ครั้งถัดไป วันนี้ 06:00\n/);
  const run = await w.send('ทำงานตั้งเวลาข้อ 1 ตอนนี้เลย', { conversationId: made.id });
  await w.agent.tail;
  const text = run.text();
  assert.match(text, /^🗓 งานตั้งเวลา: สรุปข่าว “AI” · ทุกวัน 06:00 · สั่งทำตอนนี้\nสรุปข่าว “AI” · \d+ \S+ \d{4}\nสรุป: มีโมเดลใหม่/);
  assert.ok(text.includes('- ยอดขายชิป AI โต 40 เปอร์เซ็นต์ [3]') && !text.includes('999'), text);
  assert.deepEqual(run.reply().citations.map((c) => c.url), ['https://news.example/ai1', 'https://news.example/ai3', 'https://news.example/ai2']);
  assert.equal(w.agent.scheduleList()[0].lastSlot, null, 'running it now does not count as the scheduled run');
  const status = await w.send('งานค้นคว้าถึงไหนแล้ว', { conversationId: made.id });
  assert.match(status.text(), /สรุปข่าว “AI” — เสร็จ/);
  assert.match(status.text(), /มีงานตั้งเวลาไว้ 1 งาน/);
  const cancel = await w.send('ยกเลิกงานตั้งเวลาทั้งหมด', { conversationId: made.id });
  assert.equal(cancel.text(), 'ยกเลิกงานตั้งเวลาแล้ว 1 งาน:\n1. สรุปข่าว “AI” · ทุกวัน 06:00');
  assert.equal(w.agent.scheduleList().length, 0);
  assert.deepEqual(JSON.parse(fs.readFileSync(path.join(w.dir, 'agent-schedules.json'), 'utf8')), []);
  const none = await w.send('ดูงานที่ตั้งเวลาไว้', { conversationId: made.id });
  assert.match(none.text(), /^ยังไม่มีงานตั้งเวลา/);
});

test('the schedule clock: runs at the time in a new message, once; a missed run is made later the same day, not the next', async (t) => {
  const now = { value: bkk(2026, 10, 25, 4, 30) };
  const w = await world(t, { now });
  const made = await w.send('ทุกวัน 6 โมงเช้า สรุปข่าว AI ให้หน่อย');
  const count = () => w.store.conversation(made.id).messages.length;
  const before = count();
  await w.agent.tick(bkk(2026, 10, 25, 5, 59));
  assert.equal(count(), before, 'not yet');
  await w.agent.tick(bkk(2026, 10, 25, 6, 0));
  assert.equal(count(), before + 1, 'a new message at the end of the chat');
  await w.agent.tail;
  const msg = w.store.conversation(made.id).messages.at(-1);
  assert.equal(msg.role, 'assistant');
  assert.match(msg.parts[0].text, /^🗓 งานตั้งเวลา: สรุปข่าว “AI” · ทุกวัน 06:00\nสรุปข่าว “AI” · /);
  assert.equal(msg.citations.length, 3);
  await w.agent.tick(bkk(2026, 10, 25, 6, 30));
  assert.equal(count(), before + 1, 'the same slot does not run twice');
  // Lumicos was off at 06:00 the next day and opened at 09:15: made then (same day)
  await w.agent.tick(bkk(2026, 10, 26, 9, 15));
  assert.equal(count(), before + 2);
  await w.agent.tail;
  // off for two days, opened at 05:00 on the 28th: the 27th's run is skipped, the 28th's comes at 06:00
  await w.agent.tick(bkk(2026, 10, 28, 5, 0));
  assert.equal(count(), before + 2);
  assert.equal(w.agent.scheduleList()[0].missed, 1);
  await w.agent.tick(bkk(2026, 10, 28, 6, 1));
  assert.equal(count(), before + 3);
  await w.agent.tail;
  assert.equal(w.agent.scheduleList()[0].runs, 3);
});

test('scheduled runs: a one-off runs once and is gone; the web search may come up late; a deleted chat gets an inbox', async (t) => {
  const now = { value: bkk(2026, 10, 25, 4, 30) };
  const w = await world(t, { now });
  const once = await w.send('อีก 5 นาที ค้นเรื่อง ROCm 10 แล้วเก็บเข้าคลัง');
  assert.match(once.text(), /^ตั้งงานแล้ว: ค้นคว้า “ROCm 10” → คลังความรู้ · ครั้งเดียว อา\. 25 ต\.ค\. 04:35\nเวลา: วันนี้ 04:35/);
  w.web.ready = false;
  await w.agent.tick(bkk(2026, 10, 25, 4, 36));
  assert.equal(w.store.conversation(once.id).messages.length, 2, 'waits for the web search after a start');
  w.web.ready = true;
  await w.agent.tick(bkk(2026, 10, 25, 4, 37));
  await w.agent.tail;
  const last = w.store.conversation(once.id).messages.at(-1).parts[0].text;
  assert.match(last, /^🗓 งานตั้งเวลา: ค้นคว้า “ROCm 10” → คลังความรู้ · ครั้งเดียว .*\nบันทึกเข้าคลังความรู้แล้ว: ROCm 10 ใหม่/);
  assert.equal(w.agent.scheduleList().length, 0, 'a one-off is done after it ran');
  // a weekly job whose chat was deleted posts into "🗓 งานตั้งเวลาของ Lumicos"
  const weekly = await w.send('ทุกวันจันทร์ 9 โมง สรุปข่าว AI ให้หน่อย');
  await w.store.transaction({ revision: w.store.state.revision, remove: [weekly.id] });
  await w.agent.tick(bkk(2026, 10, 26, 9, 0));
  await w.agent.tail;
  const inbox = w.store.state.conversations.find((c) => c.agentInbox);
  assert.equal(inbox.title, '🗓 งานตั้งเวลาของ Lumicos');
  assert.match(inbox.messages.at(-1).parts[0].text, /^🗓 งานตั้งเวลา: สรุปข่าว “AI” · ทุกวันจันทร์ 09:00\nสรุปข่าว “AI”/);
  assert.equal(w.agent.scheduleList()[0].conversationId, inbox.id);
});

test('schedules that are refused: a time already past, private chats, too many; web search off is warned about', async (t) => {
  const now = { value: bkk(2026, 10, 25, 9, 0) };
  const w = await world(t, { now });
  assert.match((await w.send('วันนี้ 7 โมง สรุปข่าว AI ให้หน่อย')).text(), /^เวลานั้น \(วันนี้ 07:00\) ผ่านไปแล้ว/);
  const priv = await w.newChat();
  w.store.state.conversations.find((c) => c.id === priv).private = true;
  assert.match((await w.send('ทุกเช้า 7 โมง สรุปข่าว AI ให้หน่อย', { conversationId: priv })).text(), /^แชตส่วนตัวตั้งงานล่วงหน้าไม่ได้/);
  const off = await w.send('ทุกเช้า 7 โมง สรุปข่าว AI ให้หน่อย', { settings: { knowledge: { searchMode: 'OFF' } } });
  assert.match(off.text(), /ตอนนี้ตั้งค่าปิดการค้นเว็บอยู่ งานนี้จะทำได้ก็ต่อเมื่อเปิดการค้นเว็บ/);
  for (let i = 0; i < 9; i++) await w.send(`ทุกวันจันทร์ ${i + 8} โมง สรุปข่าวเรื่อง ${i} ให้หน่อย`);
  assert.equal(w.agent.scheduleList().length, 10);
  assert.match((await w.send('ทุกวันอังคาร 9 โมง สรุปข่าว AI')).text(), /^ตั้งงานไว้ครบ 10 งานแล้ว/);
  const guessed = await w.send('ยกเลิกงานตั้งเวลาข้อ 3');
  assert.match(guessed.text(), /^ยกเลิกงานตั้งเวลาแล้ว 1 งาน:\n3\. สรุปข่าว “1”/);
  const which = await w.send('ยกเลิกงานตั้งเวลา');
  assert.match(which.text(), /^มีงานตั้งเวลา 9 งาน ยกเลิกข้อไหนดี\n1\. /);
});

test('"สรุปไฟล์นี้แล้วเก็บเข้าคลัง" with a file attached: a checked note from the file, saved in the library', async (t) => {
  const w = await world(t);
  const notes = 'บันทึกประชุมทีม 23 ต.ค. 2569\nรหัสโครงการ: ม่วง-42\nผู้รับผิดชอบ: คุณดาวเรือง\nกำหนดส่ง: 5 พ.ย. 2569\n';
  const r = await w.send('สรุปไฟล์นี้แล้วเก็บเข้าคลัง', { files: [{ name: 'meeting-notes.txt', text: notes }] });
  assert.match(r.text(), /^รับงานสรุปไฟล์แล้ว: “meeting-notes\.txt”|^งานสรุปไฟล์: “meeting-notes\.txt”/);
  await w.agent.tail;
  assert.match(r.text(), /^บันทึกเข้าคลังความรู้แล้ว: ประชุมทีม\nไฟล์: knowledge\/learned\/\d{4}-\d{2}\/\S+\.md\nสรุป: ประชุมทีมเรื่องโครงการม่วง-42\nข้อเท็จจริงที่ตรวจตัวเลขกับเนื้อไฟล์แล้ว 2 ข้อ จาก “meeting-notes\.txt”/);
  assert.match(r.text(), /ถามต่อได้ เช่น "ในคลังความรู้เขียนเรื่อง ประชุมทีม ไว้ว่ายังไง"$/);
  const file = r.text().match(/^ไฟล์: knowledge\/(\S+)$/m)[1];
  const md = fs.readFileSync(path.join(w.folder, file), 'utf8');
  assert.match(md, /ที่มา: Lumicos สรุปจากไฟล์ "meeting-notes\.txt"/);
  assert.ok(md.includes('- รหัสโครงการ ม่วง-42 [1]') && !md.includes('999'));
  assert.ok(w.calls.every((p) => p === 'agent'), 'the request itself took no chat turn');
  // the file attached to the previous message counts when this one says "ไฟล์"
  const later = await w.send('สรุปไฟล์ที่ส่งไปแล้วเก็บเข้าคลังด้วย', { conversationId: r.id });
  assert.match(later.text(), /^รับงานสรุปไฟล์แล้ว: “meeting-notes\.txt”|^งานสรุปไฟล์|^บันทึกเข้าคลัง/);
  await w.agent.tail;
});

test('"เก็บไฟล์นี้เข้าคลัง" stores the file itself; without a file Lumicos says so; "สรุปแล้วเพิ่มเข้าคลัง" without one is ordinary chat', async (t) => {
  const w = await world(t);
  const r = await w.send('เก็บไฟล์นี้เข้าคลัง', { files: [{ name: 'spec.md', text: '# สเปก\nความจุ 512 GB\n' }] });
  assert.match(r.text(), /^เก็บไฟล์ “spec\.md” เข้าคลังความรู้แล้ว: knowledge\/files\/spec\.md\n/);
  assert.equal(fs.readFileSync(path.join(w.folder, 'files', 'spec.md'), 'utf8'), '# สเปก\nความจุ 512 GB\n');
  assert.equal(w.calls.length, 0);
  const missing = await w.send('สรุปไฟล์นี้แล้วเก็บเข้าคลัง');
  assert.match(missing.text(), /^ยังไม่เห็นไฟล์แนบ/);
  const plain = await w.send('สรุปแล้วเพิ่มเข้าคลัง');
  assert.equal(plain.text(), 'ok', 'no file and no "ไฟล์": the chat answers as before');
});

import { updateMissingTopic } from '../agent/research.mjs';
test('update with no topic is recognised so the agent can ask (fix 20261026)', () => {
  for (const t of ['อัปเดตคลัง', 'อัปเดตข้อมูลในคลังให้หน่อย', 'ช่วยอัพเดตคลังความรู้ด้วย']) assert.equal(updateMissingTopic(t), true, t);
  for (const t of ['อัปเดตเรื่อง ROCm 10 ในคลัง', 'สรุปข่าว AI']) assert.equal(updateMissingTopic(t), false, t);
});

test('"ตั้งเวลา …" in front of a schedule is taken as the command, not part of the job (fix 20261026)', () => {
  const a = Object.create(AgentService.prototype); a.now = () => Date.UTC(2026, 9, 26); a.active = () => [];
  const kind = (t) => a.classify(t, { message: { parts: [] }, history: [] })?.kind;
  for (const t of ['ตั้งเวลา สรุปข่าว AI ทุก 9 โมงเช้า', 'ตั้งเวลา สรุปข่าว AI ทุกวัน 08.30 น.', 'ตั้งเวลา ทุกเช้า 7 โมง สรุปข่าว AI']) assert.equal(kind(t), 'schedule-create', t);
  assert.equal(kind('ตั้งเวลา เดี๋ยวๆ มั่วๆ'), 'schedule-unclear');
  assert.equal(kind('อัปเดตคลัง'), 'update-missing');
});

test('"อัปเดตคลังเรื่อง X" (library first) is an update of X (fix 20261026)', () => {
  assert.equal(updateTopic('อัปเดตคลังเรื่อง Kpop'), 'Kpop');
  assert.equal(updateTopic('ช่วยอัปเดตคลังความรู้เกี่ยวกับ ROCm 10 หน่อย'), 'ROCm 10');
  assert.equal(updateMissingTopic('อัปเดตคลังเรื่อง Kpop'), false);
});

test('"อัปเดตเรื่อง X ในคลัง" asks first (confirmWrites): allow runs it, deny changes nothing (fix 20261026)', async (t) => {
  const w = await world(t);
  const ask = async (text) => {
    const conversationId = await w.newChat();
    const job = await w.chats.submit({ requestId: randomUUID(), conversationId, user: { id: randomUUID(), role: 'user', parts: [{ type: 'text', text }] }, settings: {} });
    const reply = () => w.store.conversation(conversationId).messages.find((m) => m.id === job.replyId);
    await until(() => reply()?.toolRuns?.[0]?.status === 'awaiting', 'the approval card');
    return { job, reply, run: reply().toolRuns[0] };
  };
  const a = await ask('อัปเดตเรื่อง ROCm 10 ในคลัง');
  assert.equal(a.run.permission, 'write'); assert.equal(a.run.tool, 'update_library_note'); assert.match(a.run.preview.details, /_archive/);
  assert.equal(w.agent.active().length, 0, 'nothing queued before the answer');
  w.chats.approve(a.run.id, true);
  await until(() => /^(?:รับงาน|งาน)อัปเดตคลัง/.test(a.reply().parts.map((p) => p.text).join('')), 'the job accepted after allow');
  assert.equal(a.reply().toolRuns[0].status, 'done');
  await w.agent.tail;
  const d = await ask('อัปเดตเรื่อง ROCm 10 ในคลัง');
  w.chats.approve(d.run.id, false);
  await until(() => d.reply().toolRuns[0].status === 'denied', 'denied');
  assert.match(d.reply().parts[0].text, /ยังไม่มีอะไรถูกเปลี่ยน/);
  assert.equal(w.agent.active().length, 0);
});
