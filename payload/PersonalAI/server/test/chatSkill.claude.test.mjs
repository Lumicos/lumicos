// claude-20261022: a saved skill whose trigger word is in the message rides along that turn (server chat path).
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { ConversationStore } from '../chat/conversationStore.mjs';
import { ChatService } from '../chat/chatService.mjs';
import { ModelService } from '../llama/modelService.mjs';
import { SkillStore } from '../tools/sandboxTools.mjs';
import * as runtime from '../../.runtime/chat.mjs';

async function fixture(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lumicos-skill-'));
  const store = new ConversationStore(path.join(dir, 'conversations.json'));
  const skills = new SkillStore(path.join(dir, 'workspace'));
  skills.save({ name: 'vat-and-discount', description: 'VAT', instructions: '1. STEP-VAT-MARKER', triggers: 'vat, ภาษีมูลค่าเพิ่ม', files: { 'script.py': 'def vat_calc(a):\n    return a\n' } });
  const requests = [], required = [], options = [];
  const models = { turns: new Map(), enqueueChat: ModelService.prototype.enqueueChat,
    async begin(req) { required.push(req); const id = randomUUID(); this.turns.set(id, {}); return { id, profile: { ctx: 8192, capabilities: { tools: false }, generation: { maxTokens: 100 } } }; },
    touch() {}, async end(id) { this.turns.delete(id); } };
  const config = { port: 0, allowedOrigins: [], internalToken: randomUUID(), dataDir: dir };
  const chats = new ChatService({ store, models, config, tools: { definitions: () => [] }, skills });
  const service = { memory: { retrieve: async () => [], candidates: async () => [], dedupe: async (c) => c }, tools: { list: async () => [] } };
  chats.runtime = async () => ({ ...runtime, runChatReply: (o, ...rest) => { options.push(o); return runtime.runChatReply(o, ...rest); }, createServiceClient: () => service, LlamaCppProvider: class {
    async streamChat(request, cb) { requests.push(JSON.stringify(request)); cb.onToken('ok'); cb.onDone({ stopped: false }); } } });
  t.after(async () => { chats.close(); await models.chatTail; await store.close(); fs.rmSync(dir, { recursive: true, force: true }); });
  async function chat(text, extra = {}) {
    const id = randomUUID();
    await store.transaction({ revision: store.state.revision, upsert: [{ id, title: 't', characterId: runtime.DEFAULT_CHARACTER.id, messages: [], ...extra }] });
    const job = await chats.submit({ requestId: randomUUID(), conversationId: id, user: { id: randomUUID(), role: 'user', parts: [{ type: 'text', text }] }, settings: {} });
    for (let i = 0; i < 200 && ['queued', 'running'].includes(store.state.jobs.find((j) => j.id === job.id).status); i++) await new Promise((r) => setTimeout(r, 10));
    const log = fs.readFileSync(path.join(dir, 'logs', 'tool-decisions.jsonl'), 'utf8').trim().split('\n').map((l) => JSON.parse(l)).find((e) => e.jobId === job.id);
    return { request: requests.at(-1) ?? '', required: required.at(-1), log, options: options.at(-1) };
  }
  return { chat, dir, skills };
}

test('a trigger word attaches the skill steps to the turn, turns tools on and is logged', async (t) => {
  const { chat } = await fixture(t);
  const r = await chat('ช่วยคิด VAT ของ 1,500 บาทหน่อย');
  assert.match(r.request, /Skill For This Task/);
  assert.match(r.request, /STEP-VAT-MARKER/);
  assert.match(r.request, /skills\/vat-and-discount\/script\.py/);
  assert.ok(r.required.includes('tools'), `required ${JSON.stringify(r.required)}`);
  assert.deepEqual(r.log.skills, ['vat-and-discount']);
});

test('no trigger word, roleplay and private chats get no skill', async (t) => {
  const { chat } = await fixture(t);
  const plain = await chat('สวัสดีตอนเช้า');
  assert.ok(!plain.request.includes('STEP-VAT-MARKER'));
  assert.equal(plain.log.skills, undefined);
  const rp = await chat('คิด VAT ให้หน่อย', { mode: 'roleplay' });
  assert.ok(!rp.request.includes('STEP-VAT-MARKER'));
});

test('an "output: exact" skill hands its script to the reply so the printed text reaches the user unchanged', async (t) => {
  const { chat, dir } = await fixture(t);
  const folder = path.join(dir, 'workspace', 'skills', 'thai-baht-text');
  fs.mkdirSync(folder, { recursive: true });
  fs.writeFileSync(path.join(folder, 'SKILL.md'), '---\nname: thai-baht-text\ndescription: คำอ่าน\ntriggers: เป็นตัวหนังสือ\noutput: exact\n---\n\n1. รัน\n');
  fs.writeFileSync(path.join(folder, 'script.py'), 'def thai_baht_text(a):\n    return a\n');
  const exact = await chat('4,705.25 บาท เขียนเป็นตัวหนังสือให้หน่อย');
  assert.equal(exact.options.skillExactOutput, 'skills/thai-baht-text/script.py');
  const plain = await chat('ช่วยคิด VAT ของ 1,500 บาทหน่อย');
  assert.equal(plain.options.skillExactOutput, undefined, 'ordinary skills keep the model\'s wording');
});
