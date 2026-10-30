// claude-20261024 (Real Chat Check round 11): "แล้วข้าชื่ออะไร บอกมาสิ" was answered "ข้า... มิร่า" — the character's own
// name — although the general rule says "ข้า" in a player line is the player. A turn-only note now names the case.
import test from 'node:test';
import assert from 'node:assert/strict';
import { SELF_ASK, buildMessages, DEFAULT_ASSISTANT } from '../../.runtime/chat.mjs';

const msg = (i, role, text) => ({ id: `m${i}`, role, parts: [{ type: 'text', text }], createdAt: i, status: 'done' });

test('questions about the player\'s own character are recognised; other "ข้า" lines are not', () => {
  for (const q of ['แล้วข้าชื่ออะไร บอกมาสิ', 'ข้ามาจากที่ไหนนะ', '*ยกถ้วยขึ้นจิบ* เมื่อกี้ข้าสั่งอะไรมากินนะ เจ้าจำได้ไหม', 'ข้าเป็นใครกันแน่', 'ฉันชื่ออะไรนะ'])
    assert.equal(SELF_ASK.test(q), true, q);
  for (const q of ['ข้าชื่อต้น เป็นพ่อค้า', 'สามเหรียญเงินพอไหม ข้ามีไม่มากนัก', 'ข้าจะออกเดินทางตอนรุ่งสาง เจ้าจะไปด้วยไหม',
    'ถ้าข้าจ้างเจ้าคุ้มกันไปถึงหมู่บ้านถัดไป จะคิดค่าจ้างเท่าไหร่', 'ข้างนอกมีอะไร', 'ข้าวอะไรอร่อย', 'เราเคยเจอกันที่ไหน', 'เจ้าชื่ออะไร'])
    assert.equal(SELF_ASK.test(q), false, q);
});

test('the note is added to that turn only, after the general pronoun rule', () => {
  const base = { globalPrompt: '', character: DEFAULT_ASSISTANT, userName: 'U', greetingMode: 'none', history: [msg(1, 'user', 'แล้วข้าชื่ออะไร บอกมาสิ')] };
  const rp = { characterName: 'มิร่า', card: 'มิร่า นักดาบ', playerChars: 22 };
  const asked = buildMessages({ ...base, roleplay: { ...rp, selfAsk: true } }).messages;
  assert.match(asked.at(-1).content, /ข้อความล่าสุดผู้เล่นถามเรื่องของตัวผู้เล่นเอง ไม่ใช่เรื่องของมิร่า/);
  assert.ok(!asked[0].content.includes('ถามเรื่องของตัวผู้เล่นเอง'), 'not in the cached system prompt');
  const plain = buildMessages({ ...base, roleplay: rp }).messages;
  assert.ok(!plain.at(-1).content.includes('ถามเรื่องของตัวผู้เล่นเอง'));
  assert.match(plain.at(-1).content, /"ข้า" "ฉัน" "ผม" "เรา" ในข้อความของผู้เล่นหมายถึงตัวผู้เล่นเอง/, 'the general rule stays');
});
