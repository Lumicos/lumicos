// claude-20261024: Lumicos's first agent job (user: "ทำให้เธอเป็นเอเจนเลย ไอการค้นหาแล้วเอาเข้าคลังน่าสนใจมาก"):
// "ค้นเรื่อง X แล้วเก็บเข้าคลัง" researches X on the web in the background, checks every fact line against the sources
// and saves the note into the knowledge library. Chats and calls keep priority over its model steps.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { researchTopic, CANCEL_ASK, STATUS_ASK, parseQueries, collectSources, numbersIn, numberIn, checkNote, keepChecked, cleanNote, runResearch } from '../agent/research.mjs';
import { AgentService, researchReport, MAX_ACTIVE } from '../agent/agentService.mjs';
import { KnowledgeLibrary } from '../knowledge/library.mjs';
import { citationEvidence, withoutSourceMarks } from '../knowledge/chat/citations.mjs';
import { ConversationStore } from '../chat/conversationStore.mjs';
import { ChatService } from '../chat/chatService.mjs';
import { ModelService } from '../llama/modelService.mjs';
import { VoiceService } from '../voice/voiceService.mjs';
import * as runtime from '../../.runtime/chat.mjs';

const wait = (ms) => new Promise((r) => setTimeout(r, ms));
async function until(check, what, ms = 5000) {
  for (const end = Date.now() + ms; Date.now() < end; await wait(5)) if (check()) return;
  assert.fail(`timed out waiting for ${what}`);
}

test('which messages start a research job, and the topic they name', () => {
  const cases = {
    'ค้นเรื่อง ROCm 10 ของ AMD แล้วเก็บเข้าคลัง': 'ROCm 10 ของ AMD',
    'ช่วยหาข้อมูลเกี่ยวกับ Gemma 4 แล้วบันทึกลงคลังความรู้ให้หน่อย': 'Gemma 4',
    'ค้นคว้าเรื่องรถไฟฟ้าสายสีม่วง เก็บเข้าคลังด้วย': 'รถไฟฟ้าสายสีม่วง',
    'ค้นเว็บเรื่อง llama.cpp ROCm แล้วเก็บเข้าคลัง': 'llama.cpp ROCm',
    'ไปค้นในเว็บเรื่อง การเลือกตั้ง 2569 มาเก็บไว้ในคลังที': 'การเลือกตั้ง 2569',
    'ค้นในเน็ตหาข้อมูลเกี่ยวกับ Qwen 3.5 แล้วใส่คลังความรู้': 'Qwen 3.5',
    'เรียนรู้เรื่องการปลูกทุเรียน แล้วจดไว้ในคลัง': 'การปลูกทุเรียน',
    'ค้นออนไลน์แบงก์กิ้งที่ดีที่สุด แล้วเก็บเข้าคลัง': 'ออนไลน์แบงก์กิ้งที่ดีที่สุด',
    'research ROCm 10 and save it to the library': 'ROCm 10',
  };
  for (const [text, topic] of Object.entries(cases)) assert.equal(researchTopic(text), topic, text);
  // Saving what was already said (the existing save offer), searching inside the library, plain questions: not a job.
  for (const text of ['ค้นเว็บแล้วเก็บเข้าคลัง', 'สรุปเรื่องนี้แล้วเก็บเข้าคลัง', 'สรุปที่คุยกันมาแล้วเก็บเข้าคลัง', 'ถูกต้อง เก็บเข้าคลังได้เลย',
    'ค้นในคลังเรื่อง ROCm', 'ในคลังความรู้เขียนเรื่อง ROCm 10 ไว้ว่ายังไง', 'ข่าว AI วันนี้', 'ค้นเว็บ ราคาน้ำมันดีเซลวันนี้'])
    assert.equal(researchTopic(text), null, text);
  for (const text of ['ยกเลิกงานค้นคว้า', 'หยุดค้นก่อน', 'cancel research']) assert.ok(CANCEL_ASK.test(text), text);
  assert.ok(!CANCEL_ASK.test('ยกเลิกนัดพรุ่งนี้'));
  for (const text of ['งานค้นคว้าถึงไหนแล้ว', 'งานค้นเสร็จยัง', 'งานค้นคว้าเรื่อง ROCm เป็นไงบ้าง']) assert.ok(STATUS_ASK.test(text), text);
  assert.ok(!STATUS_ASK.test('ช่วยค้นงานวิจัยเรื่องนี้'));
});

test('queries start with the topic; sources come from every query in turn, once each', () => {
  assert.deepEqual(parseQueries('1. ROCm 10 release notes\n- "ROCm 10 ข่าว"\nROCm 10 release notes\nคำค้น:\nx', 'ROCm 10'), ['ROCm 10', 'ROCm 10 release notes', 'ROCm 10 ข่าว']);
  assert.equal(parseQueries('a1 b\nc2 d\ne3 f\ng4 h\ni5 j', 't t').length, 4);
  assert.deepEqual(parseQueries('นี่คือคำค้น 3 คำ:\nHere are the queries\nคำค้นภาษาไทย:\nROCm 10 คืออะไร', 'ROCm 10'), ['ROCm 10', 'ROCm 10 คืออะไร']);
  const long = (s) => `${s} ${'x'.repeat(50)}`;
  const sources = collectSources([
    [{ title: 'A', url: 'https://a.com/1', snippet: long('a1') }, { title: 'A2', url: 'https://a.com/2', snippet: long('a2') }],
    [{ title: 'dup', url: 'http://www.a.com/1/', snippet: long('dup') }, { title: 'short', url: 'https://s.com', snippet: 'too short' }, { title: 'B', url: 'https://b.com', snippet: long('b') }],
  ], 3);
  assert.deepEqual(sources.map((s) => s.title), ['A', 'A2', 'B']);
});

test('numbers are checked against the sources: trailing zeros, Thai digits, both eras, dotted versions', () => {
  assert.deepEqual(numbersIn('ROCm 6.4.1 ออกปี 2025 ราคา 1,234.50 บาท ใช้ 8 GB [2][3].'), ['6.4.1', '2025', '1234.50']);
  for (const [n, text] of [['12', 'ราคา 12.0'], ['12.0', 'ราคา 12'], ['1234.50', '1,234.5 บาท'], ['2569', 'in 2026'], ['2026', 'ปี ๒๕๖๙'], ['6.4.1', 'ROCm 6.4.1 out'], ['24.04', 'Ubuntu 24.04 LTS']])
    assert.ok(numberIn(n, text), `${n} in ${text}`);
  for (const [n, text] of [['6.4', 'ROCm 6.4.1'], ['12', '123'], ['3.5', '3.55 GB'], ['999', 'ไม่มีเลขนี้'], ['10.1', 'ROCm 10.1.5'], ['6.4.1', 'ROCm 6.4.10']])
    assert.ok(!numberIn(n, text), `${n} not in ${text}`);
  // claude-20261024 (real run): a version with ".0" parts at the end is the same version; a date's "05" is 5
  for (const [n, text] of [['10.1', 'ROCm Core SDK 10.1.0 release notes'], ['10.1.0', 'ROCm 10.1'], ['10.0.0', 'ROCm 10 is out'], ['05', 'published 2026-10-05'], ['05', '5 ตุลาคม']])
    assert.ok(numberIn(n, text), `${n} in ${text}`);
});

test('only lines that pass the check are kept; anything outside the note format is dropped', () => {
  const note = cleanNote('ok here is the note\n# ROCm 10\n**สรุป:**\nROCm 10 ออกแล้ว\n1. รองรับ Ubuntu 24.04 [1]\n2. ขนาด 3 GB [2]\n## เพิ่มเติม\nย่อหน้าอิสระ\n- ไม่มีแหล่ง 2024\nยังไม่แน่ชัด: วันออก 2027 [2]');
  assert.match(note, /^# ROCm 10\nสรุป: ROCm 10 ออกแล้ว\n- รองรับ Ubuntu 24\.04 \[1\]\n- ขนาด 3 GB \[2\]/);
  const sources = [{ title: 'notes', url: 'https://a', text: 'ROCm 10 supports Ubuntu 24.04' }, { title: 'b', url: 'https://b', text: 'a 3 GB download, out in 2026' }];
  const rows = checkNote(note, sources);
  assert.deepEqual(rows.filter((r) => r.problems.length).map((r) => r.line), ['## เพิ่มเติม', 'ย่อหน้าอิสระ', '- ไม่มีแหล่ง 2024', 'ยังไม่แน่ชัด: วันออก 2027 [2]']);
  const kept = keepChecked(note, rows);
  assert.equal(kept.text, '# ROCm 10\nสรุป: ROCm 10 ออกแล้ว\n- รองรับ Ubuntu 24.04 [1]\n- ขนาด 3 GB [2]');
  assert.equal(kept.facts, 2);
  assert.equal(kept.removed.length, 4);
  // A number checked against the source the line cites, not any source.
  assert.deepEqual(checkNote('- ออกปี 2026 [1]', sources)[0].problems, ['ตัวเลข 2026 ไม่มีในแหล่ง [1]']);
  // The source's date is part of what the model was shown, so it counts.
  assert.deepEqual(checkNote('- เผยแพร่ 2026-10-05 [1]', [{ ...sources[0], publishedAt: '2026-10-05T00:00:00Z' }])[0].problems, []);
});

// A small web (sources come out numbered 1 amd, 2 installer, 3 rdna2, 4 ข่าว, 5 os, 6 notes); the note's numbers are in
// these texts except "999".
const WEB = {
  'ROCm 10': [['AMD ROCm 10 announced', 'https://amd.example/rocm10', 'AMD released ROCm 10 in 2026 with new features for developers and HPC users.'],
    ['ROCm 10 OS support', 'https://docs.example/os', 'ROCm 10 supports Ubuntu 24.04 and RHEL 9.4 as host operating systems for GPUs.']],
  'ROCm 10 release notes': [['ROCm 10 installer', 'https://docs.example/install', 'The ROCm 10 installer is a 3.5 GB download that includes the HIP SDK and libraries.'],
    ['ROCm 10 notes', 'https://docs.example/notes', 'ROCm 10 release notes list performance improvements for PyTorch 2.9 on Linux.']],
  'ROCm 10 RDNA2': [['RDNA2 cards', 'https://forum.example/rdna2', 'Consumer cards such as the RX 6600 (RDNA2, gfx1032) are supported by ROCm 10 builds.']],
  'ROCm 10 ข่าวล่าสุด': [['ข่าว ROCm', 'https://news.example/th', 'ข่าว ROCm 10 ล่าสุด: AMD ปล่อยอัปเดตแก้บั๊กหลายรายการสำหรับการ์ด RDNA3 และ RDNA4 แล้ว']],
};
const webSearch = async (q) => (WEB[q] ?? []).map(([title, url, snippet], i) => ({ id: String(i + 1), title, url, snippet, publishedAt: '2026-10-20T00:00:00Z' }));
const PLAN = 'ROCm 10 release notes\nROCm 10 RDNA2\nROCm 10 ข่าวล่าสุด';
const NOTE = '# ROCm 10 ของ AMD\nสรุป: ROCm 10 ออกในปี 2026 และรองรับการ์ด RDNA2\n- ROCm 10 ออกในปี 2026 [1]\n- รองรับ Ubuntu 24.04 [5]\n- ตัวติดตั้งขนาด 3.5 GB [2]\n- รองรับ RX 6600 [3]\n- มีผู้ใช้ 999 ล้านคน [2]';
const FIXED = NOTE.replace('- มีผู้ใช้ 999 ล้านคน [2]', '- AMD ปล่อยอัปเดตแก้บั๊กสำหรับ RDNA3 และ RDNA4 [4]');
/** The model, by prompt: plan → queries, note → NOTE (one bad line), revise → FIXED. */
const modelFor = (messages) => messages[0].content.startsWith('You plan web searches') ? PLAN
  : messages[1].content.startsWith('โน้ตนี้มีบรรทัด') ? FIXED : NOTE;

test('a research job: plan, search, write, check, revise the failing line once, save', async () => {
  const asks = [], steps = [], saved = [];
  const r = await runResearch({ topic: 'ROCm 10', today: '24 ตุลาคม 2569', search: webSearch,
    ask: async (messages, params) => { asks.push({ messages, params }); return modelFor(messages); },
    save: async (note) => { saved.push(note); return { file: 'learned/2026-10/2026-10-24-ROCm-10-ของ-AMD.md' }; },
    onStep: (s) => steps.push(s.stage) });
  assert.equal(r.status, 'saved');
  assert.deepEqual(r.queries, ['ROCm 10', 'ROCm 10 release notes', 'ROCm 10 RDNA2', 'ROCm 10 ข่าวล่าสุด']);
  assert.equal(r.sources.length, 6);
  assert.equal(r.facts, 5);
  assert.equal(r.revised, true);
  assert.deepEqual(steps, ['plan', 'search', 'search', 'search', 'search', 'write', 'check', 'save']);
  assert.match(asks[1].messages[1].content, /\[3\] RDNA2 cards — https:\/\/forum\.example\/rdna2/);
  assert.match(asks[2].messages[1].content, /"- มีผู้ใช้ 999 ล้านคน \[2\]": ตัวเลข 999 ไม่มีในแหล่ง \[2\]/);
  assert.equal(saved[0].title, 'ROCm 10 ของ AMD');
  assert.ok(!saved[0].body.includes('999') && saved[0].body.includes('RDNA4 [4]'));
  assert.equal(saved[0].sources.length, 6);
});

test('a line that still fails after the one revision is dropped; too few checked facts or sources saves nothing', async () => {
  const save = async () => assert.fail('nothing should be saved');
  const stubborn = await runResearch({ topic: 'ROCm 10', search: webSearch, save: async (n) => ({ file: 'x.md', n }),
    ask: async (m) => m[0].content.startsWith('You plan') ? PLAN : NOTE });
  assert.equal(stubborn.status, 'saved');
  assert.equal(stubborn.facts, 4);
  assert.deepEqual(stubborn.removed.map((x) => x.line), ['- มีผู้ใช้ 999 ล้านคน [2]']);
  const thin = await runResearch({ topic: 'ไม่มีใครรู้จัก', search: async () => [], save, ask: async () => 'q1 x' });
  assert.equal(thin.status, 'not-enough');
  const made = await runResearch({ topic: 'ROCm 10', search: webSearch, save,
    ask: async (m) => m[0].content.startsWith('You plan') ? PLAN : '# t\n- ตัวเลขมั่ว 777 [1]\n- ไม่มีแหล่ง' });
  assert.equal(made.status, 'not-enough');
  assert.match(made.reason, /ตรวจผ่านมีแค่ 0 ข้อ/);
});

test('a failed plan step still searches the topic itself; cancelling stops the job', async () => {
  const searched = [];
  await runResearch({ topic: 'ROCm 10', search: async (q) => { searched.push(q); return webSearch(q); }, save: async () => ({ file: 'x.md' }),
    ask: async (m) => { if (m[0].content.startsWith('You plan')) throw new Error('model down'); return NOTE; } });
  assert.deepEqual(searched, ['ROCm 10']);
  const controller = new AbortController();
  await assert.rejects(runResearch({ topic: 'ROCm 10', signal: controller.signal, save: async () => ({ file: 'x.md' }), ask: async () => PLAN,
    search: async (q) => { controller.abort(new Error('ผู้ใช้ยกเลิก')); return webSearch(q); } }), /ผู้ใช้ยกเลิก/);
});

test('the library keeps the note with its [n] marks and a numbered source list', async (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lumicos-note-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  let synced = 0;
  const lib = { folder: dir, workspaceId: 'default', sync: async () => { synced++; }, sources: { getByUri: () => ({ status: 'indexed' }) } };
  const note = { title: 'ROCm 10 ของ AMD', topic: 'ROCm 10', body: 'สรุป: ROCm 10 ออกปี 2026\n- ROCm 10 ออกในปี 2026 [1]\n- รองรับ Ubuntu 24.04 [2]',
    sources: [{ title: 'AMD ROCm 10 announced', url: 'https://amd.example/rocm10', publishedAt: '2026-10-20T00:00:00Z' }, { title: 'OS', url: 'https://docs.example/os' }] };
  const a = await KnowledgeLibrary.prototype.saveNote.call(lib, note);
  const b = await KnowledgeLibrary.prototype.saveNote.call(lib, note);
  assert.match(a.file, /^learned\/\d{4}-\d{2}\/\d{4}-\d{2}-\d{2}-ROCm-10-ของ-AMD\.md$/);
  assert.equal(b.file, a.file.replace(/\.md$/, '-2.md'));
  assert.equal(a.status, 'indexed');
  assert.equal(synced, 2);
  const md = fs.readFileSync(path.join(dir, a.file), 'utf8');
  assert.match(md, /^# ROCm 10 ของ AMD\n\nบันทึกเมื่อ \d{4}-\d{2}-\d{2} · ที่มา: Lumicos ค้นเว็บเองแล้วสรุป \(งานค้นคว้า เรื่อง "ROCm 10"\) · ตรวจตัวเลขในแต่ละข้อกับแหล่งแล้ว\n/);
  assert.ok(md.includes('- รองรับ Ubuntu 24.04 [2]'));
  assert.ok(md.includes('## แหล่งที่มา\n1. AMD ROCm 10 announced — https://amd.example/rocm10 (2026-10-20)\n2. OS — https://docs.example/os\n'));
  await assert.rejects(KnowledgeLibrary.prototype.saveNote.call(lib, { title: 'x', body: 'สั้น' }), /ไม่มีข้อมูลพอ/);
});

/** The server chat path with a fake model and web: ChatService + AgentService as service.mjs wires them. */
async function world(t, { holdAgent = false, webReady = true } = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lumicos-agent-'));
  const store = new ConversationStore(path.join(dir, 'conversations.json'));
  const calls = [], shown = [], saved = [];
  store.on('change', (e) => { if (e.type === 'message') shown.push({ id: e.message.id, text: e.message.parts?.map((p) => p.text).join('') ?? '' }); });
  const models = { turns: new Map(), enqueueChat: ModelService.prototype.enqueueChat, enqueueBackground: ModelService.prototype.enqueueBackground,
    async begin(required, mode) { if (this.turns.size) throw new Error('โมเดลกำลังเปลี่ยนหรือมีงานตอบอยู่'); const id = randomUUID(); this.turns.set(id, { mode }); return { id, profile: { ctx: 8192, capabilities: { tools: false }, generation: { maxTokens: 100 } } }; },
    touch() {}, async end(id) { this.turns.delete(id); } };
  const config = { port: 0, allowedOrigins: [], internalToken: randomUUID(), dataDir: dir };
  const chats = new ChatService({ store, models, config, tools: { definitions: () => [] } });
  const service = { memory: { retrieve: async () => [], candidates: async () => [], dedupe: async (c) => c }, tools: { list: async () => [] } };
  // holdAgent: every agent model step waits (like a long generation) until it is aborted or releaseAgent() is called.
  let holding = holdAgent; const releases = new Set();
  const releaseAgent = () => { holding = false; for (const r of releases) r(); releases.clear(); };
  chats.runtime = async () => ({ ...runtime, createServiceClient: () => service, LlamaCppProvider: class {
    async streamChat(request, cb, signal) {
      const call = { purpose: request.purpose, aborted: false, turns: models.turns.size }; calls.push(call);
      if (request.purpose !== 'agent') { cb.onToken('ok'); cb.onDone({ stopped: false }); return; }
      if (holding) {
        const outcome = await new Promise((resolve) => { releases.add(() => resolve('released')); signal.addEventListener('abort', () => resolve('aborted'), { once: true }); });
        if (outcome === 'aborted') { call.aborted = true; cb.onDone({ stopped: true }); return; }
      }
      cb.onToken(modelFor(request.messages)); cb.onDone({ stopped: false });
    } } });
  const library = { saveNote: async (note) => { saved.push(note); return { file: 'learned/2026-10/2026-10-24-ROCm-10.md', status: 'indexed' }; } };
  const call = { starting: false };
  const agent = new AgentService({ store, models, config, library, runtime: () => chats.runtime(), callBusy: () => call.starting,
    webGateway: { search: async (input) => ({ results: await webSearch(input.query) }) }, webStatus: async () => ({ ready: webReady }) });
  agent.pollMs = 5; agent.retryMs = 5;
  chats.agent = agent; models.yieldBackground = () => agent.yieldNow();
  t.after(async () => { chats.close(); await agent.tail; await models.chatTail; await store.close(); fs.rmSync(dir, { recursive: true, force: true }); });
  async function send(text, { conv: { private: isPrivate, ...conv } = {}, settings = {} } = {}) {
    const id = randomUUID();
    await store.transaction({ revision: store.state.revision, upsert: [{ id, title: 't', characterId: runtime.DEFAULT_CHARACTER.id, messages: [], ...conv }] });
    if (isPrivate) store.state.conversations.find((c) => c.id === id).private = true; // private chats normally never reach the server
    const job = await chats.submit({ requestId: randomUUID(), conversationId: id, user: { id: randomUUID(), role: 'user', parts: [{ type: 'text', text }] }, settings });
    await until(() => !['queued', 'running'].includes(store.state.jobs.find((j) => j.id === job.id).status), `the chat job for "${text}"`);
    const reply = () => store.conversation(id).messages.find((m) => m.id === job.replyId);
    return { job, reply, text: () => reply().parts.map((p) => p.text).join(''), shown: () => shown.filter((s) => s.id === job.replyId).map((s) => s.text) };
  }
  const log = () => fs.readFileSync(path.join(dir, 'logs', 'tool-decisions.jsonl'), 'utf8').trim().split('\n').map((l) => JSON.parse(l));
  return { store, models, agent, chats, calls, saved, send, dir, log, call, releaseAgent };
}

test('a research message is answered at once; the job runs in the background and reports in that same message', async (t) => {
  const w = await world(t);
  const r = await w.send('ค้นเรื่อง ROCm 10 แล้วเก็บเข้าคลัง');
  assert.match(r.shown()[0], /^รับงานค้นคว้าแล้ว: “ROCm 10”\n.*ระหว่างนี้คุยเรื่องอื่นได้/s);
  assert.equal(r.reply().status, 'done');
  await w.agent.tail;
  assert.ok(r.shown().some((s) => s.includes('• วางคำค้น\n• ค้นเว็บ 1/4: ROCm 10')), 'progress is shown while it works');
  assert.match(r.text(), /^บันทึกเข้าคลังความรู้แล้ว: ROCm 10 ของ AMD\nไฟล์: knowledge\/learned\/2026-10\/2026-10-24-ROCm-10\.md\nสรุป: ROCm 10 ออกในปี 2026/);
  assert.match(r.text(), /ข้อเท็จจริงที่ตรวจตัวเลขกับแหล่งแล้ว 5 ข้อ จาก 6 แหล่ง\nถามต่อได้ เช่น "ในคลังความรู้เขียนเรื่อง ROCm 10 ไว้ว่ายังไง"$/);
  assert.deepEqual(r.reply().citations.map((c) => [c.id, c.kind, c.url]).slice(0, 2), [['E1', 'web', 'https://amd.example/rocm10'], ['E2', 'web', 'https://docs.example/install']]);
  assert.deepEqual(w.calls.map((c) => c.purpose), ['agent', 'agent', 'agent'], 'plan, note, one revision; no chat model turn for the request itself');
  assert.equal(w.saved[0].title, 'ROCm 10 ของ AMD');
  const entry = w.log().find((e) => e.jobId === r.job.id);
  assert.equal(entry.route, 'AGENT');
  assert.equal(entry.reason, 'research');
  const tasks = JSON.parse(fs.readFileSync(path.join(w.dir, 'agent-tasks.json'), 'utf8'));
  assert.equal(tasks[0].status, 'saved');
  assert.equal(tasks[0].result.file, 'learned/2026-10/2026-10-24-ROCm-10.md');
  assert.equal(tasks[0].controller, undefined);
  assert.deepEqual(tasks[0].result.removedLines, [], 'the revision fixed the bad line');
  const status = await w.send('งานค้นคว้าถึงไหนแล้ว');
  assert.equal(status.text(), 'ตอนนี้ไม่มีงานค้างอยู่\n\nงานล่าสุด:\n• ค้นคว้า “ROCm 10” → คลังความรู้ — บันทึกแล้ว (knowledge/learned/2026-10/2026-10-24-ROCm-10.md)');
});

test('a chat sent during a model step gets the model first; the step is redone after the chat', async (t) => {
  const w = await world(t, { holdAgent: true });
  await w.send('ค้นเรื่อง ROCm 10 แล้วเก็บเข้าคลัง');
  await until(() => w.calls.length === 1, 'the agent plan step to start');
  const chat = await w.send('สวัสดี');
  assert.equal(chat.reply().status, 'done', chat.reply().error);
  await until(() => w.calls.length === 3, 'the plan step to be redone');
  w.releaseAgent();
  await w.agent.tail;
  assert.deepEqual(w.calls.map((c) => [c.purpose, c.aborted]), [['agent', true], ['chat-reply', false], ['agent', false], ['agent', false], ['agent', false]]);
  assert.ok(w.calls.every((c) => c.turns === 1), 'never two model turns at once');
  assert.equal(w.agent.list()[0].status, 'saved');
});

test('starting a call makes a running agent step give the model back and wait until the call is up', async (t) => {
  const w = await world(t, { holdAgent: true });
  await w.send('ค้นเรื่อง ROCm 10 แล้วเก็บเข้าคลัง');
  await until(() => w.calls.length === 1 && w.models.turns.size === 1, 'the agent step to hold the model');
  w.call.starting = true; // VoiceService.startCall sets callStarting before it asks the agent to yield
  await w.agent.yieldNow();
  assert.equal(w.models.turns.size, 0);
  assert.equal(w.calls[0].aborted, true);
  await wait(40);
  assert.equal(w.models.turns.size, 0, 'the agent does not take the model back while the call is starting');
  assert.equal(w.calls.length, 1);
  w.call.starting = false;
  await until(() => w.calls.length === 2, 'the plan step to be redone after the call');
  w.releaseAgent();
  await w.agent.tail;
  assert.equal(w.agent.list()[0].status, 'saved');
  // VoiceService: callStarting is already on when the agent is asked to yield, and off again when the start ends.
  const seen = [];
  const voice = { call: null, callStarting: false, callEnding: false, whisperWorkerFactory: () => ({ stop: async () => {} }), endCall: VoiceService.prototype.endCall,
    models: { pendingChats: 0, store: {}, get ready() { return Promise.reject(new Error('stop here')); }, yieldBackground: async () => { seen.push(voice.callStarting); } } };
  await assert.rejects(VoiceService.prototype.startCall.call(voice, new AbortController().signal), /stop here/);
  assert.deepEqual(seen, [true]);
  assert.equal(voice.callStarting, false);
  // A chat still waiting refuses the call before any of that, as before.
  voice.models.pendingChats = 1;
  await assert.rejects(VoiceService.prototype.startCall.call(voice, new AbortController().signal), (e) => e.status === 409);
  assert.deepEqual(seen, [true]);
});

test('private chats, web search turned off or not ready, and a full queue get a plain answer instead of a job', async (t) => {
  const w = await world(t, { holdAgent: true });
  assert.match((await w.send('ค้นเรื่อง ROCm 10 แล้วเก็บเข้าคลัง', { conv: { private: true } })).text(), /^แชตส่วนตัวจะไม่บันทึกอะไรลงคลัง/);
  assert.match((await w.send('ค้นเรื่อง ROCm 10 แล้วเก็บเข้าคลัง', { settings: { knowledge: { searchMode: 'OFF' } } })).text(), /^ตอนนี้ตั้งค่าปิดการค้นเว็บอยู่/);
  assert.equal(w.agent.list().length, 0);
  for (const topic of ['A1', 'B2', 'C3']) await w.send(`ค้นเรื่อง ${topic} แล้วเก็บเข้าคลัง`);
  assert.match((await w.send('ค้นเรื่อง D4 แล้วเก็บเข้าคลัง')).text(), /^คิวงานเต็มแล้ว \(“A1”, “B2”, “C3”\)/);
  assert.equal(MAX_ACTIVE, 3);
  const cancel = await w.send('ยกเลิกงานค้นคว้า');
  assert.equal(cancel.text(), 'ยกเลิกงานค้นคว้า “A1”, “B2”, “C3” แล้ว');
  await w.agent.tail;
  assert.deepEqual(w.agent.list().map((x) => x.status), ['cancelled', 'cancelled', 'cancelled']);
  assert.equal(w.saved.length, 0);
  // Nothing left to cancel: "ยกเลิก…/หยุดค้น…" is an ordinary chat message again.
  const plain = await w.send('หยุดค้นเว็บได้แล้ว ตอบจากที่รู้');
  assert.equal(plain.text(), 'ok');
  const t2 = { after: t.after.bind(t) };
  const offline = await world(t2, { webReady: false });
  assert.match((await offline.send('ค้นเรื่อง ROCm 10 แล้วเก็บเข้าคลัง')).text(), /^ตอนนี้ระบบค้นเว็บยังไม่พร้อม/);
});

test('roleplay chats are never turned into a research job', async (t) => {
  const w = await world(t);
  const r = await w.send('ค้นเรื่อง ROCm 10 แล้วเก็บเข้าคลัง', { conv: { mode: 'roleplay' } });
  assert.equal(r.reply().status, 'done', r.reply().error);
  assert.equal(w.agent.list().length, 0);
  assert.ok(w.calls.length >= 1 && w.calls.every((c) => c.purpose !== 'agent'));
});

test('a job cut off by a shutdown says so in its message, and again after a restart if it never got the chance', async (t) => {
  const w = await world(t, { holdAgent: true });
  const r = await w.send('ค้นเรื่อง ROCm 10 แล้วเก็บเข้าคลัง');
  await until(() => w.calls.length === 1, 'the agent step to start');
  w.agent.close();
  assert.equal(r.text(), 'งานค้นคว้า “ROCm 10” หยุดไปเพราะ Lumicos ปิดก่อนทำเสร็จ สั่งใหม่ได้เลย');
  await w.agent.tail;
  assert.equal(w.agent.list()[0].status, 'interrupted');
  assert.equal(r.text(), 'งานค้นคว้า “ROCm 10” หยุดไปเพราะ Lumicos ปิดก่อนทำเสร็จ สั่งใหม่ได้เลย');
  // The file still says "running" (the process died first): the next start marks it and tells the chat.
  const file = path.join(w.dir, 'agent-tasks.json');
  const task = JSON.parse(fs.readFileSync(file, 'utf8'))[0];
  fs.writeFileSync(file, JSON.stringify([{ ...task, status: 'running' }]));
  w.store.message(task.conversationId, task.replyId, (m) => ({ ...m, parts: [{ type: 'text', text: 'งานค้นคว้า: “ROCm 10”\n• วางคำค้น' }] }));
  const again = new AgentService({ store: w.store, models: w.models, config: { dataDir: w.dir } });
  assert.equal(again.list()[0].status, 'interrupted');
  assert.equal(r.text(), 'งานค้นคว้า “ROCm 10” หยุดไปเพราะ Lumicos ปิดก่อนทำเสร็จ สั่งใหม่ได้เลย');
  assert.equal(JSON.parse(fs.readFileSync(file, 'utf8'))[0].status, 'interrupted');
});

test('library text reaches the chat model without the note\'s [n] marks', () => {
  const { evidence } = citationEvidence({ local: [{ sourceId: 's', displayName: 'ROCm.md', sourceUri: 'C:/k/ROCm.md', ordinal: 0,
    content: '- ออกในปี 2026 [1]\n- เร็วขึ้น 3.3 เท่า[3][4]\n- โค้ด array[0] และ x[1][2] อยู่ครบ' }] });
  assert.match(evidence, /\n- ออกในปี 2026\n- เร็วขึ้น 3\.3 เท่า\n- โค้ด array\[0\] และ x\[1\]\[2\] อยู่ครบ$/);
  assert.equal(withoutSourceMarks('ข้อ [12] ท้าย'), 'ข้อ ท้าย');
});

test('the report for a job that found too little says why and saves nothing', () => {
  assert.equal(researchReport('X', { status: 'not-enough', reason: 'เจอแหล่งที่ใช้ได้แค่ 1 แหล่ง' }),
    'ค้นเรื่อง “X” แล้ว แต่ยังไม่บันทึกเข้าคลัง: เจอแหล่งที่ใช้ได้แค่ 1 แหล่ง\nลองระบุหัวข้อให้ชัดขึ้น หรือใช้ชื่อภาษาอังกฤษของเรื่องนั้นแล้วสั่งใหม่ได้');
});
