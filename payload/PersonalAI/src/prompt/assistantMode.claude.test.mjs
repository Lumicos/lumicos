// claude-20261016: general chat = plain assistant (tools + memory, no Lumicos identity/persona); Lumicos stays a separate agent.
import test from 'node:test';
import assert from 'node:assert/strict';
import { buildMessages, buildSections, DEFAULT_CHARACTER, DEFAULT_ASSISTANT } from '../../.runtime/chat.mjs';

const tool = (name) => ({ name, description: name + ' tool', permission: 'read', parameters: { type: 'object', properties: {} } });
const input = (character, extra = {}) => ({ globalPrompt: 'Follow the request.', character, userName: 'User', greetingMode: 'none', history: [], tools: [tool('generate_image'), tool('web_search')], ...extra });

test('assistant has no Lumicos identity or persona sections, but keeps the character card and tools', () => {
  const ids = buildSections(input(DEFAULT_ASSISTANT)).map((s) => s.id);
  assert.ok(!ids.includes('identity') && !ids.includes('persona'));
  assert.ok(ids.includes('character') && ids.includes('tools'));
  const text = buildMessages(input(DEFAULT_ASSISTANT)).messages[0].content;
  assert.ok(!/Canonical Self Identity|Lumicos Persona|FaceTime avatar|black lace camisole/.test(text));
  assert.match(text, /ผู้ช่วย/);
});

test('the selfie instruction is only given to Lumicos', () => {
  const tools = (c) => buildSections(input(c)).find((x) => x.id === 'tools').content;
  assert.ok(!/Selfies:/.test(tools(DEFAULT_ASSISTANT)));
  assert.ok(/Selfies:/.test(tools(DEFAULT_CHARACTER)));
  assert.ok(buildSections(input(DEFAULT_CHARACTER)).some((x) => x.id === 'persona'));
});
