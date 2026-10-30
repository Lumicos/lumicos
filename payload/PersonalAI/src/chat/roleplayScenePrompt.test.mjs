import test from 'node:test';
import assert from 'node:assert/strict';
import { SCENE_REQUEST_RE, composeScenePrompt, latestNarration, cardSection } from './roleplayScenePrompt.mjs';

const story = '# เนื้อเรื่องที่ผ่านมา\n\n<!-- x -->\n- **Where/When:** Coffee shop in Paris, evening.\n- **Items/Facts:** black coat; croissant and black coffee on the table.\n';
const card = '# การ์ด\n\n## รูปลักษณ์ (ใช้วาด)\nlong black hair\n\n## ฉาก (สถานที่)\nA quiet street cafe.\n';

test('scene request is recognised', () => {
  assert.ok(SCENE_REQUEST_RE.test('วาดภาพฉากตอนนี้: ตัวละคร สถานที่'));
  assert.ok(!SCENE_REQUEST_RE.test('ช่วยวาดภาพแมว'));
});
test('prompt is built from the story, not invented', () => {
  const p = composeScenePrompt({ appearance: 'long black hair', card, story, lastReply: '*She sits at the table, tracing the croissant wrapper.* "Hi"' });
  assert.match(p, /^long black hair\. Setting: Coffee shop in Paris/);
  assert.match(p, /black coat/);
  assert.match(p, /Moment: She sits at the table/);
  assert.doesNotMatch(p, /"Hi"/);
});
test('falls back to the card scene, and is empty with nothing to go on', () => {
  assert.match(composeScenePrompt({ appearance: 'a', card, story: '' }), /Setting: A quiet street cafe/);
  assert.equal(composeScenePrompt({}), '');
  assert.equal(cardSection(card, 'ฉาก'), 'A quiet street cafe.');
  assert.equal(latestNarration('no asterisks here'), '');
});
