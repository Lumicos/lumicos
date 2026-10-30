// claude-20261024 (Real Chat Check round 11): "แล้วเมื่อวานล่ะ" after "ค้นเว็บ ราคาทองคำแท่งวันนี้" searched
// "ราคาทองคำแท่งวันนี้ แล้วเมื่อวานล่ะ" and the answer said yesterday's price fell 250 baht (that was today).
import test from 'node:test';
import assert from 'node:assert/strict';
import { DeterministicKnowledgeRouter } from '../knowledge/router/router.mjs';
import { joinFollowUp } from '../knowledge/router/followUp.mjs';
import { rewriteSearchQuery } from '../knowledge/web/queryRewrite.mjs';

test('a follow-up that names its own day drops the previous question\'s day words', () => {
  assert.equal(joinFollowUp('ราคาทองคำแท่งวันนี้', 'แล้วเมื่อวานล่ะ'), 'ราคาทองคำแท่ง แล้วเมื่อวานล่ะ');
  assert.equal(joinFollowUp('ข่าวล่าสุดเรื่องน้ำท่วม', 'แล้วสัปดาห์ที่แล้วล่ะ'), 'ข่าวเรื่องน้ำท่วม แล้วสัปดาห์ที่แล้วล่ะ');
  assert.equal(joinFollowUp('ราคาทองคำแท่งวันนี้', 'แล้วทองรูปพรรณล่ะ'), 'ราคาทองคำแท่งวันนี้ แล้วทองรูปพรรณล่ะ', 'no day named: kept');
  const r = new DeterministicKnowledgeRouter().route({ query: 'แล้วเมื่อวานล่ะ', context: { previousQuery: 'ค้นเว็บ ราคาทองคำแท่งวันนี้', previousRoute: 'WEB' } });
  assert.ok(r.resolvedQuery.includes('เมื่อวาน') && !r.resolvedQuery.includes('วันนี้'), r.resolvedQuery);
});

test('the web query gets the actual Thai date for เมื่อวาน / พรุ่งนี้ (Bangkok time)', () => {
  const now = Date.parse('2026-10-24T03:00:00Z'); // 10:00 in Bangkok
  assert.match(rewriteSearchQuery('ราคาทองคำแท่ง แล้วเมื่อวานล่ะ', { now }).providerQuery, /23 ตุลาคม 2569/);
  assert.match(rewriteSearchQuery('พยากรณ์อากาศกรุงเทพพรุ่งนี้', { now }).providerQuery, /25 ตุลาคม 2569/);
  assert.match(rewriteSearchQuery('ราคาทองเมื่อวาน', { now: Date.parse('2026-10-31T18:30:00Z') }).providerQuery, /31 ตุลาคม 2569/, 'after 17:00 UTC it is already the next day in Bangkok');
  assert.equal(rewriteSearchQuery('ราคาทองคำแท่งวันนี้', { now }).providerQuery, 'ราคาทองคำแท่งวันนี้', 'no relative day: unchanged');
});
