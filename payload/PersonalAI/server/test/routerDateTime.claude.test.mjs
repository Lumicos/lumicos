// claude-20261023: the prompt now carries today's date and the time (src/prompt/dateTime.ts), so plain date/time questions
// stay offline ("วันนี้วันอะไร" used to search the web). Holidays, lunar days, event dates and live topics keep their old route.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DeterministicKnowledgeRouter } from '../knowledge/router/router.mjs';
import { KnowledgeChatIntegration } from '../knowledge/chat/integration.mjs';
import { DEFAULT_SETTINGS } from '../../.runtime/chat.mjs';

const r = new DeterministicKnowledgeRouter();
const OFFLINE = ['วันนี้วันอะไร', 'วันนี้วันที่เท่าไหร่', 'วันนี้วันที่เท่าไร', 'วันนี้วันอะไรคะ', 'วันนี้ วันที่ เท่าไหร่ครับ', 'วันนี้วันที่', 'พรุ่งนี้วันอะไร',
  'เมื่อวานวันที่เท่าไหร่', 'มะรืนนี้วันอะไร', 'ตอนนี้กี่โมง', 'กี่โมงแล้ว', 'ตอนนี้เวลาเท่าไหร่', 'เวลาเท่าไหร่แล้ว', 'ปีนี้ปีอะไร', 'ปีนี้ พ.ศ. อะไร',
  'ตอนนี้ปี ค.ศ. เท่าไหร่', 'เดือนนี้เดือนอะไร', 'อีกกี่วันจะถึงปีใหม่', 'อีกกี่วันจะสิ้นเดือน', '1 ธันวาคมปีนี้ตรงกับวันอะไร', 'what day is it today',
  'what time is it', "what's the date today", 'ไม่ต้องค้นเว็บ วันนี้วันอะไร'];
const STILL_WEB = ['วันนี้วันพระไหม', 'วันนี้วันหยุดไหม', 'วันนี้ธนาคารหยุดไหม', 'ราคาทองวันนี้', 'ข่าววันนี้มีอะไรบ้าง', 'แมนยูแข่งกี่โมง', 'ร้านเปิดกี่โมงวันนี้',
  'หนังเข้าวันไหน', 'วันนี้วันอะไร ราคาทองเท่าไหร่', 'พระอาทิตย์ตกกี่โมงวันนี้', 'อัลบั้มใหม่ออกวันไหน', 'วันนี้วันสำคัญอะไร', 'วันนี้หวยออกอะไร',
  'วันนี้ฝนจะตกไหม', 'ตอนนี้เงินเยนเท่าไหร่', 'ค้นเว็บว่าวันนี้วันอะไร'];
const NOT_DATE = ['ลอยกระทงปีนี้ตรงกับวันอะไร', 'อีกกี่วันจะถึงตรุษจีน', 'สอบวันที่เท่าไหร่', 'เงินเฟ้อปีที่แล้วเท่าไหร่', 'ขอเวลาตอนนี้หน่อย'];
const show = (q, d) => `${d.route} (${d.reason}): ${q}`;

test('date and time questions are answered from the clock, not the web', () => {
  const bad = OFFLINE.map((q) => [q, r.route({ query: q })]).filter(([, d]) => d.route !== 'DIRECT').map(([q, d]) => show(q, d));
  assert.deepEqual(bad, []);
});

test('holidays, lunar days, events and live topics keep their old route', () => {
  const bad = STILL_WEB.map((q) => [q, r.route({ query: q })]).filter(([, d]) => d.route !== 'WEB' && d.route !== 'HYBRID').map(([q, d]) => show(q, d));
  assert.deepEqual(bad, []);
  for (const q of NOT_DATE) assert.notEqual(r.route({ query: q }).reason, 'date-time', q);
});

test('a follow-up about another day stays offline; a follow-up about a live topic still searches', () => {
  const follow = (prev, previousRoute, q) => r.route({ query: q, context: { previousQuery: prev, previousRoute } }).route;
  assert.equal(follow('วันนี้วันอะไร', 'DIRECT', 'แล้วพรุ่งนี้ล่ะ'), 'DIRECT');
  assert.equal(follow('ตอนนี้กี่โมงแล้ว', 'DIRECT', 'แล้วพรุ่งนี้วันอะไร'), 'DIRECT');
  assert.equal(follow('วันนี้วันอะไร', 'DIRECT', 'แล้วราคาทองล่ะ'), 'WEB');
  assert.equal(follow('ราคาทองวันนี้', 'WEB', 'แล้วเมื่อวานล่ะ'), 'WEB');
});

test('search mode ON still answers date/time from the clock', async () => {
  let calls = 0;
  const integration = new KnowledgeChatIntegration({ router: r, compatibility: { forKnowledge: async () => ({ validity: 'missing', outputMode: 'plain-text-citations', toolTransport: 'plain-text' }) },
    executor: { async execute() { calls++; return { local: [], memory: [], web: { provider: 'mock', results: [], diagnostics: { status: 'ok' } }, diagnostics: {} }; } } });
  const settings = { ...DEFAULT_SETTINGS, knowledge: { ...DEFAULT_SETTINGS.knowledge, enabled: false, webEnabled: true, searchMode: 'ON' } };
  for (const q of ['วันนี้วันอะไร', 'ตอนนี้ที่ญี่ปุ่นกี่โมง']) assert.equal((await integration.prepare({ query: q, settings })).decision.route, 'DIRECT', q);
  assert.equal(calls, 0);
});
