// claude-20261023: today's date and the time ride along the latest user turn (never the cached system prompt),
// so "วันนี้วันอะไร / กี่โมงแล้ว" are answered from this computer's clock.
import test from 'node:test';
import assert from 'node:assert/strict';
import { buildMessages, buildCallMessages, dateTimeContext, thaiClock, DEFAULT_ASSISTANT } from '../../.runtime/chat.mjs';

const user = (text) => ({ id: 'u1', role: 'user', parts: [{ type: 'text', text }], createdAt: 1, status: 'done' });
const base = { globalPrompt: 'Follow the request.', character: DEFAULT_ASSISTANT, userName: 'User', greetingMode: 'none', history: [user('วันนี้วันอะไร')] };
const FRI_0835_BKK = new Date('2026-10-23T01:35:00Z');

test('the context names the Thai date (Buddhist year), the time and the zone', () => {
  const text = dateTimeContext(FRI_0835_BKK, 'Asia/Bangkok');
  for (const part of ['วันศุกร์ที่ 23 ตุลาคม พ.ศ. 2569', 'Friday 23 October 2026, 2026-10-23', '08:35 น. (8 โมง 35 นาที)', 'Asia/Bangkok (UTC+7)', 'No web search is needed']) {
    assert.ok(text.includes(part), `missing "${part}" in:\n${text}`);
  }
});

test('the date follows the zone across midnight, half-hour offsets and summer time', () => {
  const late = new Date('2026-10-22T17:30:00Z');
  assert.ok(dateTimeContext(late, 'Asia/Bangkok').includes('วันศุกร์ที่ 23 ตุลาคม พ.ศ. 2569'));
  assert.ok(dateTimeContext(late, 'Asia/Bangkok').includes('00:30 น. (เที่ยงคืนครึ่ง)'));
  assert.ok(dateTimeContext(late, 'UTC').includes('วันพฤหัสบดีที่ 22 ตุลาคม พ.ศ. 2569'));
  assert.ok(dateTimeContext(late, 'UTC').includes('17:30 น. (5 โมงเย็นครึ่ง)'));
  assert.ok(dateTimeContext(FRI_0835_BKK, 'Asia/Kolkata').includes('07:05 น.') && dateTimeContext(FRI_0835_BKK, 'Asia/Kolkata').includes('(UTC+5:30)'));
  const ny = dateTimeContext(new Date('2026-07-01T16:00:00Z'), 'America/New_York');
  assert.ok(ny.includes('12:00 น. (เที่ยง)') && ny.includes('(UTC-4)'), ny);
  assert.ok(dateTimeContext(FRI_0835_BKK, 'Not/AZone').includes('(UTC+0)'), 'an unknown zone falls back to UTC');
});

test('Thai way of saying the time', () => {
  const cases = [[0, 0, 'เที่ยงคืน'], [3, 10, 'ตี 3 10 นาที'], [8, 0, '8 โมงเช้า'], [8, 30, '8 โมงครึ่ง'], [12, 15, 'เที่ยง 15 นาที'], [13, 30, 'บ่ายโมงครึ่ง'],
    [14, 0, 'บ่าย 2 โมง'], [16, 20, '4 โมงเย็น 20 นาที'], [18, 0, '6 โมงเย็น'], [19, 0, '1 ทุ่ม'], [20, 30, '2 ทุ่มครึ่ง'], [23, 45, '5 ทุ่ม 45 นาที']];
  for (const [h, m, want] of cases) assert.equal(thaiClock(h, m), want, `${h}:${m}`);
});

test('it goes into the latest user turn and leaves the system prompt byte-identical', () => {
  const plain = buildMessages(base).messages;
  const timed = buildMessages({ ...base, now: FRI_0835_BKK, timeZone: 'Asia/Bangkok' }).messages;
  assert.equal(timed[0].content, plain[0].content, 'system prompt unchanged, so the prompt cache survives the clock');
  assert.ok(timed.at(-1).content.includes('[Date & Time]') && timed.at(-1).content.includes('วันศุกร์ที่ 23 ตุลาคม พ.ศ. 2569'));
  assert.ok(!plain.at(-1).content.includes('[Date & Time]'), 'only when the caller passes now');
  assert.ok(buildMessages({ ...base, anonymous: true, now: FRI_0835_BKK }).messages.at(-1).content.includes('[Date & Time]'), 'private chats know the date too');
});

test('roleplay keeps the story time: no real date in the scene', () => {
  const rp = { characterName: 'Mira', card: 'Mira works in a quiet cafe.' };
  assert.ok(!buildMessages({ ...base, roleplay: rp, now: FRI_0835_BKK }).messages.at(-1).content.includes('[Date & Time]'));
});

test('voice calls get it on the latest turn only', () => {
  const plain = buildCallMessages([], 'กี่โมงแล้ว');
  const timed = buildCallMessages([], 'กี่โมงแล้ว', FRI_0835_BKK);
  assert.equal(timed[0].content, plain[0].content);
  assert.ok(timed.at(-1).content.startsWith('กี่โมงแล้ว') && timed.at(-1).content.includes('[Date & Time]') && timed.at(-1).content.includes('เวลาตอนนี้:'));
  assert.equal(plain.at(-1).content, 'กี่โมงแล้ว');
});
