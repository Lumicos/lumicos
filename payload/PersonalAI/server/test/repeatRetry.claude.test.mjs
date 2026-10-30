// claude-20261023: a draft that copies an earlier reply of the chat word for word is answered once more with a note.
import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { runChatReply, DEFAULT_CHARACTER, DEFAULT_SETTINGS } from '../../.runtime/chat.mjs';

const message = (role, text) => ({ id: randomUUID(), role, parts: [{ type: 'text', text }], createdAt: Date.now(), status: 'done' });
const OLD = 'ทองคำเป็นโลหะมีค่าที่มนุษย์ใช้มาหลายพันปี มีสัญลักษณ์ทางเคมีว่า Au มาจากภาษาละติน aurum ทนต่อการกัดกร่อน นำไฟฟ้าได้ดี และนิยมใช้ทำเครื่องประดับกับเป็นทุนสำรองของประเทศ';
const NEW = 'เงินมีสัญลักษณ์ทางเคมีว่า Ag มาจากภาษาละติน argentum เป็นโลหะที่นำไฟฟ้าได้ดีที่สุดในบรรดาโลหะทั้งหมด ใช้ทำขั้วไฟฟ้า กระจกเงา และเครื่องประดับ ราคาถูกกว่าทองคำมาก';

async function run(answers, userText) {
  const conv = { id: 'rep', title: 't', messages: [], createdAt: 1, updatedAt: 1, characterId: DEFAULT_CHARACTER.id };
  const sent = [];
  const runtime = {
    provider: { async streamChat(request, cb) { sent.push(JSON.stringify(request.messages)); const a = answers[Math.min(sent.length - 1, answers.length - 1)]; cb?.onToken?.(a); cb?.onDone?.({ stopped: false }); } },
    settings: { ...DEFAULT_SETTINGS, memory: { ...DEFAULT_SETTINGS.memory, enabled: false, autoCandidates: false } },
    resolveCharacter: () => DEFAULT_CHARACTER, service: { online: true, tools: [] }, localService: {},
    patchConversation: (id, fn) => Object.assign(conv, fn(conv)), patchMessage: (id, mid, fn) => { const i = conv.messages.findIndex((m) => m.id === mid); conv.messages[i] = fn(conv.messages[i]); },
    setGeneratingId() {}, setLastStats() {}, abortRef: { current: null }, imageJobRef: { current: null }, approvals: { current: new Map() }, chatEvents: { emit() {} }, knowledgeContext: null,
  };
  const history = [message('user', 'ทองคำคืออะไร'), message('assistant', OLD), message('user', userText)];
  conv.messages = [...history];
  await runChatReply(runtime, conv, history, { id: 'profile', ctx: 8192, capabilities: { tools: true }, generation: DEFAULT_SETTINGS.generation });
  const reply = conv.messages.filter((m) => m.role === 'assistant').at(-1);
  return { sent, text: reply.parts.filter((p) => p.type === 'text').map((p) => p.text).join('') };
}

test('a copied earlier reply is answered again once, with the note', async () => {
  const r = await run([OLD, NEW], 'แล้วเงินล่ะ สัญลักษณ์อะไร');
  assert.equal(r.sent.length, 2);
  assert.match(r.sent[1], /ร่างคำตอบก่อนหน้านี้ซ้ำกับคำตอบเก่า/);
  assert.doesNotMatch(r.sent[0], /ร่างคำตอบก่อนหน้านี้ซ้ำกับคำตอบเก่า/);
  assert.equal(r.text.trim(), NEW);
});

test('only one more try, and none when the user asks for it again', async () => {
  const stubborn = await run([OLD, OLD, OLD], 'แล้วเงินล่ะ สัญลักษณ์อะไร');
  assert.equal(stubborn.sent.length, 2, 'never loops');
  const again = await run([OLD], 'พูดอีกทีได้ไหม');
  assert.equal(again.sent.length, 1);
});
