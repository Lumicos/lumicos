// claude-20261023 (Real Chat Check): a question about the attached file went library → miss → web search, and
// "แล้วในคลังความรู้ของเราเขียนไว้ว่ายังไง" right after a web search went to web + library and called web results "the library".
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { DeterministicKnowledgeRouter } from '../knowledge/router/router.mjs';
import { KnowledgeChatIntegration } from '../knowledge/chat/integration.mjs';
import { RoleplayStore } from '../roleplay/roleplayStore.mjs';
import { DEFAULT_SETTINGS, buildMessages, DEFAULT_ASSISTANT } from '../../.runtime/chat.mjs';

const r = new DeterministicKnowledgeRouter();
const route = (q, ctx) => r.route({ query: q, context: ctx });

test('questions about the file sent with the message stay offline', () => {
  for (const q of ['ในไฟล์ที่แนบมา รหัสโครงการคืออะไร แล้วใครเป็นผู้รับผิดชอบ', 'สรุปไฟล์นี้ให้หน่อย', 'เอกสารที่ส่งมาเขียนว่าอะไร', 'ช่วยดูรูปที่แนบให้หน่อย', 'what does the attached pdf say']) {
    assert.deepEqual([route(q).route, route(q).reason], ['DIRECT', 'attached-file'], q);
  }
  assert.equal(route('สรุปไฟล์ PDF ที่อัปโหลดไว้').route, 'LOCAL', 'files stored earlier stay library requests');
  assert.equal(route('ดูในเอกสารที่แนบไว้').route, 'LOCAL');
  assert.equal(route('ค้นเว็บเพิ่มเกี่ยวกับเรื่องในไฟล์นี้').route, 'WEB', 'an explicit web request still wins');
});

test('"ในคลังความรู้…" is a library request decided by this message, even right after a web search', () => {
  for (const q of ['ในคลังความรู้ของเราเขียนไว้ว่ายังไง', 'จากคลังความรู้ พรรคไหนได้ที่นั่งมากสุด', 'คลังความรู้ว่ายังไงบ้าง']) assert.equal(route(q).reason, 'explicit-local-request', q);
  const d = route('แล้วในคลังความรู้ของเราเขียนไว้ว่ายังไง', { previousQuery: 'ค้นเว็บ การเลือกตั้งปี 2569 พรรคไหนได้ที่นั่งมากที่สุด', previousRoute: 'WEB' });
  assert.deepEqual([d.route, d.reason], ['LOCAL', 'explicit-local-request']);
});

test('search mode ON does not send an attached-file question to the web', async () => {
  let calls = 0;
  const integration = new KnowledgeChatIntegration({ router: r, compatibility: { forKnowledge: async () => ({ validity: 'missing', outputMode: 'plain-text-citations', toolTransport: 'plain-text' }) },
    executor: { async execute() { calls++; return { local: [], memory: [], web: { provider: 'mock', results: [], diagnostics: { status: 'ok' } }, diagnostics: {} }; } } });
  const settings = { ...DEFAULT_SETTINGS, knowledge: { ...DEFAULT_SETTINGS.knowledge, enabled: false, webEnabled: true, searchMode: 'ON' } };
  assert.equal((await integration.prepare({ query: 'ในไฟล์ที่แนบมา รหัสโครงการคืออะไร', settings })).decision.route, 'DIRECT');
  assert.equal(calls, 0);
});

test('the evidence rules say how to name the source', () => {
  const m = buildMessages({ globalPrompt: '', character: DEFAULT_ASSISTANT, userName: 'U', greetingMode: 'none', history: [{ id: 'u', role: 'user', parts: [{ type: 'text', text: 'x' }], createdAt: 1, status: 'done' }] }).messages;
  assert.match(m[0].content, /kind=web is a web page[\s\S]*Never call web results "from the library\/จากคลังความรู้"/);
});

test('roleplay looks: the appearance section, else the description', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rp-looks-'));
  const store = new RoleplayStore(dir);
  fs.mkdirSync(path.join(dir, 'roleplay', 'chat1'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'roleplay', 'chat1', 'card.md'), '# การ์ดตัวละคร: มิร่า\n\n## คำอธิบาย\nนักดาบพเนจร ผมสั้นสีน้ำตาลเข้ม แผลเป็นที่คิ้วซ้าย\n\n## รูปลักษณ์ (ใช้วาดภาพ)\n\n## ฉาก\n');
  assert.match(store.looks('chat1'), /แผลเป็นที่คิ้วซ้าย/);
  fs.writeFileSync(path.join(dir, 'roleplay', 'chat1', 'card.md'), '# การ์ด\n\n## คำอธิบาย\nนักดาบ\n\n## รูปลักษณ์\nshort dark brown hair, green eyes\n');
  assert.equal(store.looks('chat1'), 'short dark brown hair, green eyes');
  fs.rmSync(dir, { recursive: true, force: true });
});
