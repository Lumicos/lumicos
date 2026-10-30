// claude-20261016: football score shortcut for web search.
import test from 'node:test';
import assert from 'node:assert/strict';
import { sportsIntent, fetchFootballScores, formatEvent } from '../web/sportsScores.mjs';

const ev = (h, hs, a, as, state, detail) => ({ status: { type: { state, shortDetail: detail } }, competitions: [{ competitors: [{ homeAway: 'home', score: hs, team: { displayName: h } }, { homeAway: 'away', score: as, team: { displayName: a } }] }] });

test('sportsIntent only fires for football result questions', () => {
  assert.equal(sportsIntent('ค้นเว็บ ผลบอลพรีเมียร์ลีกล่าสุดคืนนี้ใครชนะบ้าง').map(l => l.slug).join(), 'eng.1');
  assert.ok(sportsIntent('ผลบอลเมื่อคืน').length > 1);
  assert.equal(sportsIntent('ช่วยอธิบายกฎล้ำหน้า'), null);
  assert.equal(sportsIntent('Rose เพลงใหม่ล่าสุด'), null);
});
test('formatEvent shows numbers and skips unplayed matches', () => {
  assert.equal(formatEvent(ev('Everton', '1', 'Chelsea', '2', 'post', 'FT')), 'Everton 1–2 Chelsea (FT)');
  assert.equal(formatEvent(ev('A', '0', 'B', '0', 'pre', '7:30 PM')), null);
  assert.match(formatEvent(ev('A', '1', 'B', '1', 'in', "67'")), /กำลังแข่ง 67'/);
});
test('fetchFootballScores groups by league and day, newest first; null when empty', async () => {
  const urls = [];
  const fetchImpl = async url => { urls.push(url); const day = url.match(/dates=(\d+)/)[1]; return { ok: true, json: async () => ({ events: day === '20261015' ? [ev('Arsenal', '3', 'Spurs', '1', 'post', 'FT')] : [] }) }; };
  const out = await fetchFootballScores([{ slug: 'eng.1', name: 'Premier League' }], { now: Date.parse('2026-10-16T12:00:00Z'), days: 2, fetchImpl });
  assert.equal(urls.length, 3);
  assert.match(out.text, /Premier League — 2026-10-15: Arsenal 3–1 Spurs \(FT\)/);
  assert.equal(await fetchFootballScores([{ slug: 'eng.1', name: 'x' }], { days: 1, fetchImpl: async () => ({ ok: false }) }), null);
});
