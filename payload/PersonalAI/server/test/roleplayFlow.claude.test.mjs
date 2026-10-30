// claude-20261016: roleplay chats end to end with fake providers (MOCK/STATIC): no real model, web or image.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import * as runtime from '../../.runtime/chat.mjs';
import { ConversationStore } from '../chat/conversationStore.mjs';
import { ChatService } from '../chat/chatService.mjs';

const { runChatReply, DEFAULT_SETTINGS } = runtime;
const actor = { id: 'lena', name: 'ลีน่า', description: 'นักดาบพเนจร', personality: '', speakingStyle: '', firstMessage: '', systemPrompt: '', createdAt: 1, updatedAt: 1 };
const msg = (role, text, extra = {}) => ({ id: randomUUID(), role, parts: [{ type: 'text', text }], createdAt: Date.now(), status: 'done', ...extra });
const tmp = (t, prefix = 'rpflow-') => { const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix)); t.after(() => fs.rmSync(dir, { recursive: true, force: true })); return dir; };

function replyRuntime(conv, sent, extra = {}) {
  const calls = { memory: 0, candidates: 0 };
  return {
    calls,
    rt: {
      provider: { async streamChat(request, cb) { sent.push(request); cb.onToken('*ลีน่าเงยหน้า* ว่าไง'); cb.onDone({ stopped: false, stats: { tokensGenerated: 1, tokensPerSecond: 1, durationMs: 1, promptTokens: 1 } }); } },
      settings: { ...DEFAULT_SETTINGS, tools: { ...DEFAULT_SETTINGS.tools, mode: 'auto' }, memory: { ...DEFAULT_SETTINGS.memory, enabled: true, autoCandidates: true } },
      resolveCharacter: () => actor,
      service: { online: true, tools: [{ name: 'generate_image', description: 'draw', parameters: {} }, { name: 'web_search', description: 'search', parameters: {} }] },
      localService: { memory: { retrieve: async () => { calls.memory++; return []; }, candidates: async () => { calls.candidates++; return []; } } },
      patchConversation: (id, fn) => Object.assign(conv, fn(conv)), patchMessage: (id, mid, fn) => { const i = conv.messages.findIndex(m => m.id === mid); conv.messages[i] = fn(conv.messages[i]); },
      setGeneratingId() {}, setLastStats() {}, abortRef: { current: null }, imageJobRef: { current: null }, approvals: { current: new Map() }, chatEvents: { emit() {} },
      knowledgeContext: null,
      roleplay: { card: '# การ์ด\nลีน่า นักดาบพเนจร', story: '- ลีน่าเดินทางมากับปอ', appearance: 'long silver hair, green eyes', recall: () => '- ปอ: ซ่อนกุญแจทอง' },
      ...extra,
    },
  };
}
const profile = { ctx: 8192, capabilities: { tools: true }, generation: { ...DEFAULT_SETTINGS.generation, maxTokens: 2000 } };

test('roleplay turn: card/story/recall reach the model, no user memory is read or suggested, reply is not forced to a one-liner', async () => {
  const conv = { id: 'rp1', title: 't', mode: 'roleplay', messages: [], createdAt: 1, updatedAt: 1, characterId: actor.id };
  const history = [msg('user', 'โอเค')];
  conv.messages = [...history];
  const sent = []; const { rt, calls } = replyRuntime(conv, sent);
  await runChatReply(rt, conv, history, profile);
  const req = sent.filter(r => r.purpose === 'chat-reply').at(-1);
  assert.ok(req, 'chat reply sent');
  const body = req.messages.map(m => m.content).join('\n');
  assert.match(body, /You are playing ลีน่า/);
  assert.match(body, /นักดาบพเนจร/);
  assert.match(body, /ลีน่าเดินทางมากับปอ/);
  assert.match(body, /ซ่อนกุญแจทอง/);
  assert.doesNotMatch(body, /Reply length|one short line/, 'ack rule does not apply inside a scene');
  assert.doesNotMatch(body, /Lumicos Persona|Canonical Self Identity/);
  assert.equal(calls.memory, 0, 'user memories are not read');
  assert.equal(calls.candidates, 0, 'scene facts are not offered as memories');
  assert.ok(req.params.maxTokens <= 700);
  assert.match(conv.messages.at(-1).parts.map(p => p.text).join(''), /ลีน่าเงยหน้า/);
});

test('roleplay turn: only generate_image is offered', async () => {
  const conv = { id: 'rp2', title: 't', mode: 'roleplay', messages: [], createdAt: 1, updatedAt: 1, characterId: actor.id };
  const history = [msg('user', 'วาดภาพลีน่ายืนหน้าวัดให้หน่อย')];
  conv.messages = [...history];
  const sent = []; const { rt } = replyRuntime(conv, sent);
  await runChatReply(rt, conv, history, profile);
  const body = sent.filter(r => r.purpose === 'chat-reply').at(-1).messages.map(m => m.content).join('\n');
  assert.match(body, /Available tools:[\s\S]*generate_image/);
  assert.doesNotMatch(body, /web_search|run_python|workspace/, 'the long assistant tool protocol is not sent');
});

test('OOC turn: no tools, told to step out of the story, nothing recalled', async () => {
  const conv = { id: 'rp3', title: 't', mode: 'roleplay', messages: [], createdAt: 1, updatedAt: 1, characterId: actor.id };
  const history = [msg('user', '(OOC: ช่วยสรุปเรื่องถึงตอนนี้หน่อย)')];
  conv.messages = [...history];
  const sent = []; let recalled = 0;
  const { rt } = replyRuntime(conv, sent, { roleplay: { card: 'การ์ด', story: '- เนื้อเรื่อง', appearance: '', recall: () => { recalled++; return '- x'; } } });
  await runChatReply(rt, conv, history, profile);
  const body = sent.filter(r => r.purpose === 'chat-reply').at(-1).messages.map(m => m.content).join('\n');
  assert.match(body, /out of character/i);
  assert.doesNotMatch(body, /Available tools/);
  assert.equal(recalled, 0);
});

test('roleplay refuses any tool other than generate_image even if the model asks for it', async () => {
  const conv = { id: 'rp4', title: 't', mode: 'roleplay', messages: [], createdAt: 1, updatedAt: 1, characterId: actor.id };
  const history = [msg('user', 'ลีน่า ช่วยค้นข้อมูลมังกรให้หน่อย')];
  conv.messages = [...history];
  const sent = []; let calls = 0;
  const { rt } = replyRuntime(conv, sent);
  rt.settings = { ...rt.settings, tools: { ...rt.settings.tools, mode: 'always' } };
  rt.provider = { async streamChat(request, cb) {
    sent.push(request); calls++;
    cb.onToken(calls === 1 ? '```tool\n{"tool":"web_search","arguments":{"query":"มังกร"}}\n```' : '*ลีน่าส่ายหน้า* ข้าไม่รู้เรื่องนั้น');
    cb.onDone({ stopped: false, stats: { tokensGenerated: 1, tokensPerSecond: 1, durationMs: 1, promptTokens: 1 } });
  } };
  await runChatReply(rt, conv, history, profile);
  const reply = conv.messages.at(-1);
  assert.equal(reply.toolRuns?.[0]?.tool, 'web_search');
  assert.equal(reply.toolRuns?.[0]?.status, 'error');
  assert.match(reply.toolRuns[0].error, /not available in a roleplay/);
  assert.match(reply.parts.map(p => p.text ?? '').join(''), /ลีน่าส่ายหน้า/);
});

test('assistant chat is untouched: memory is read, no roleplay text', async () => {
  const conv = { id: 'a1', title: 't', messages: [], createdAt: 1, updatedAt: 1, characterId: actor.id };
  const history = [msg('user', 'สวัสดีครับ')];
  conv.messages = [...history];
  const sent = []; const { rt, calls } = replyRuntime(conv, sent);
  await runChatReply(rt, conv, history, profile);
  assert.equal(calls.memory, 1);
  assert.doesNotMatch(sent.filter(r => r.purpose === 'chat-reply').at(-1).messages.map(m => m.content).join('\n'), /You are playing/);
});

/* ---------------- server side: files + story folding ---------------- */
function service(t) {
  const dir = tmp(t);
  const store = new ConversationStore(path.join(dir, 'conversations.json'));
  const svc = new ChatService({ store, models: { pendingChats: 0 }, config: { dataDir: dir }, tools: {}, knowledge: null, web: null });
  return { dir, store, svc };
}
const storyProvider = (out, seen = []) => ({ async streamChat(request, cb) { seen.push(request); cb.onToken(out); cb.onDone({ stopped: false, stats: { tokensGenerated: 1, tokensPerSecond: 1, durationMs: 1, promptTokens: 1 } }); } });

function seed(store, count) {
  const messages = [];
  let reply;
  for (let i = 0; i < count; i++) {
    const u = msg('user', `ปอพูดข้อ ${i}`), a = msg('assistant', `ลีน่าตอบข้อ ${i}`, { replyToId: u.id });
    messages.push(u, a); reply = a;
  }
  store.state.conversations.push({ id: 'rp9', title: 't', mode: 'roleplay', characterId: actor.id, messages, createdAt: 1, updatedAt: 1 });
  return reply;
}

test('after a reply: log.md is written; story.md is folded only once 6 messages are pending, then the marker moves', async t => {
  const { dir, store, svc } = service(t);
  svc.roleplay.ensure('rp9', actor, 'ปอ');
  // 2 exchanges (4 messages): log yes, story no
  let reply = seed(store, 2);
  const seen = [];
  const rt = { ...runtime, foldStory: (p, prev, block, names, signal, id) => runtime.foldStory(p, prev, block, names, signal, id) };
  await svc.afterRoleplayReply(rt, { conversationId: 'rp9', replyId: reply.id }, storyProvider('- ลีน่าพบปอ', seen), actor, 'ปอ');
  assert.match(fs.readFileSync(path.join(dir, 'roleplay', 'rp9', 'log.md'), 'utf8'), /ลีน่าตอบข้อ 1/);
  assert.equal(seen.length, 0, 'no story call yet');
  assert.equal(store.conversation('rp9').roleplayStoryUpTo, undefined);
  // 4 exchanges (8 messages): story folded
  store.state.conversations.length = 0;
  reply = seed(store, 4);
  await svc.afterRoleplayReply(rt, { conversationId: 'rp9', replyId: reply.id }, storyProvider('- ลีน่าพบปอที่หน้าวัด\n- ปอฝากกุญแจทอง', seen), actor, 'ปอ');
  assert.equal(seen.length, 1);
  assert.match(seen[0].messages.at(-1).content, /ปอพูดข้อ 0/);
  assert.equal(svc.roleplay.story('rp9'), '- ลีน่าพบปอที่หน้าวัด\n- ปอฝากกุญแจทอง');
  const conv = store.conversation('rp9');
  assert.equal(conv.roleplayStoryUpTo, conv.messages[7].id, 'marker = last folded message (8 pending → all)');
});

test('a failed or non-bullet story reply keeps the old story.md and does not move the marker', async t => {
  const { store, svc } = service(t);
  svc.roleplay.ensure('rp9', actor, 'ปอ');
  svc.roleplay.writeStory('rp9', '- เก่า');
  const reply = seed(store, 4);
  await svc.afterRoleplayReply(runtime, { conversationId: 'rp9', replyId: reply.id }, storyProvider('ขอโทษ ทำไม่ได้'), actor, 'ปอ');
  assert.equal(svc.roleplay.story('rp9'), '- เก่า');
  assert.equal(store.conversation('rp9').roleplayStoryUpTo, undefined);
});

test('an image turn does not wake the model for the story', async t => {
  const { store, svc } = service(t);
  svc.roleplay.ensure('rp9', actor, 'ปอ');
  const reply = seed(store, 4);
  reply.toolRuns = [{ id: 'x', tool: 'generate_image', status: 'done' }];
  const seen = [];
  await svc.afterRoleplayReply(runtime, { conversationId: 'rp9', replyId: reply.id }, storyProvider('- x', seen), actor, 'ปอ');
  assert.equal(seen.length, 0);
});

test('private roleplay chats write no files', async t => {
  const { dir, store, svc } = service(t);
  const reply = seed(store, 4);
  store.conversation('rp9').private = true;
  await svc.afterRoleplayReply(runtime, { conversationId: 'rp9', replyId: reply.id }, storyProvider('- x'), actor, 'ปอ');
  assert.equal(fs.existsSync(path.join(dir, 'roleplay')), false);
});
