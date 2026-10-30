import test from 'node:test';
import assert from 'node:assert/strict';
import { computeCloseness } from './closeness.mjs';
const u = (t, at) => ({ role: 'user', parts: [{ type: 'text', text: t }], createdAt: at });
test('closeness rises with turns and days, ignores OOC and scene button', () => {
  const D = 24 * 3600 * 1000;
  assert.equal(computeCloseness([]).level, 0);
  const few = Array.from({ length: 10 }, (_, i) => u('hi', i));
  assert.equal(computeCloseness(few).level, 0);
  const many = Array.from({ length: 20 }, (_, i) => u('hi', i));
  assert.equal(computeCloseness(many).level, 1);
  const days = [u('a', 0), u('b', D), u('c', 2 * D), u('d', 3 * D), u('e', 4 * D)];
  assert.equal(computeCloseness(days).score, 5 + 40);
  assert.equal(computeCloseness([u('(OOC: x)', 0), u('วาดภาพฉากตอนนี้', 1)]).turns, 0);
});
