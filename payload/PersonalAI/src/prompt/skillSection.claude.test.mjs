// claude-20261022: a skill matched by the server rides along the latest user turn (never the cached system prompt).
import test from 'node:test';
import assert from 'node:assert/strict';
import { buildMessages, DEFAULT_ASSISTANT } from '../../.runtime/chat.mjs';

const user = (text) => ({ id: 'u1', role: 'user', parts: [{ type: 'text', text }], createdAt: 1, status: 'done' });
const base = { globalPrompt: 'Follow the request.', character: DEFAULT_ASSISTANT, userName: 'User', greetingMode: 'none', history: [user('คิด VAT ของ 1,500')] };
const GUIDE = 'Saved skill "vat-and-discount" matches this message. STEP-MARKER-123';

test('the skill guide goes into the latest user turn, not the system prompt', () => {
  const { messages } = buildMessages({ ...base, skillGuide: GUIDE });
  assert.ok(!messages[0].content.includes('STEP-MARKER-123'), 'system prompt stays byte-identical for the cache');
  const last = messages.at(-1);
  assert.equal(last.role, 'user');
  assert.match(last.content, /Skill For This Task/);
  assert.match(last.content, /STEP-MARKER-123/);
  assert.ok(last.content.startsWith('คิด VAT ของ 1,500'), "the user's own words come first");
});

test('no guide, roleplay or private chats: no skill section', () => {
  assert.ok(!buildMessages(base).messages.at(-1).content.includes('Skill For This Task'));
  const rp = { characterName: 'มิร่า', card: 'card', story: '', recall: '' };
  assert.ok(!buildMessages({ ...base, roleplay: rp, skillGuide: GUIDE }).messages.at(-1).content.includes('STEP-MARKER-123'));
  assert.ok(!buildMessages({ ...base, anonymous: true, skillGuide: GUIDE }).messages.at(-1).content.includes('STEP-MARKER-123'));
});

test('when the window is tight the skill guide can be dropped, never the user message', () => {
  const big = 'ข'.repeat(3000);
  const { messages, info } = buildMessages({ ...base, skillGuide: `${GUIDE}\n${big}`, budget: { contextTokens: 2000, replyTokens: 600 } });
  assert.ok(messages.at(-1).content.startsWith('คิด VAT ของ 1,500'));
  assert.deepEqual(info.droppedContext, ['skill'], JSON.stringify(info));
  assert.ok(!messages.at(-1).content.includes(big));
});
