import test from 'node:test';
import assert from 'node:assert/strict';
import { classifyReplyLength as c, REPLY_TOKEN_CAP, replyLengthRule, buildMessages, DEFAULT_CHARACTER } from '../../.runtime/chat.mjs';

test('acknowledgements are ack', () => {
  for (const t of ['ขอบคุณครับ', 'ไม่แย่ ๆ', 'โอเค', 'สวัสดี', 'ok', 'พอแล้วนะ', '555']) assert.equal(c(t), 'ack', t);
});
test('long by nature or detail', () => {
  for (const t of ['เขียนอีเมลลาป่วยให้หน่อย', 'อธิบายละเอียดเรื่อง RAG', 'write a python script']) assert.equal(c(t), 'long', t);
});
test('explain vs short', () => {
  assert.equal(c('ทำไมฟ้าถึงเป็นสีฟ้า'), 'explain');
  assert.equal(c('วันนี้กินอะไรดี'), 'short');
  assert.equal(c('อธิบายสั้น ๆ ว่า RAG คืออะไร'), 'short');
});
test('attachments and empty are left alone; caps and rules', () => {
  assert.equal(c('ดูรูปนี้หน่อย', { hasAttachment: true }), undefined);
  assert.equal(c('   '), undefined);
  assert.equal(REPLY_TOKEN_CAP.long, undefined);
  assert.ok(replyLengthRule('ack').length > 0 && replyLengthRule('long') === '');
});

test('reply-length rule reaches the prompt as a volatile section', () => {
  const { messages } = buildMessages({ character: DEFAULT_CHARACTER, history: [{ id: 'u1', role: 'user', parts: [{ type: 'text', text: 'ขอบคุณ' }], createdAt: 1, status: 'done' }], replyLength: 'ack' });
  assert.match(JSON.stringify(messages), /one short line/);
  const none = buildMessages({ character: DEFAULT_CHARACTER, history: [{ id: 'u1', role: 'user', parts: [{ type: 'text', text: 'x' }], createdAt: 1, status: 'done' }] });
  assert.doesNotMatch(JSON.stringify(none.messages), /Reply length/);
});
