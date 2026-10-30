// claude-20261023: thai-baht-text printed "สี่พันเจ็ดร้อยห้าบาทยี่สิบห้าสตางค์" but Gemma answered "…ห้าสิบสองบาท…".
// For "output: exact" skills the printed lines must reach the user unchanged.
import test from 'node:test';
import assert from 'node:assert/strict';
import { printedBySkill, keepExactOutput } from '../../.runtime/chat.mjs';

const SCRIPT = 'skills/thai-baht-text/script.py';
const code = (amount) => `exec(open("${SCRIPT}", encoding="utf-8").read())\nprint(thai_baht_text(${amount}))`;
const run = (extra) => ({ id: 'r', tool: 'run_python', status: 'done', callText: '', args: { code: code(4705.25) }, ...extra });

test('printed lines come from successful runs of that script only', () => {
  const runs = [
    run({ data: { exitCode: 0, stdout: 'สี่พันเจ็ดร้อยห้าบาทยี่สิบห้าสตางค์\n' } }),
    run({ data: { exitCode: 1, stdout: 'ไม่ควรนับ\n' } }),
    run({ args: { code: 'print(1)' }, data: { exitCode: 0, stdout: '1\n' } }),
    { ...run({ data: { exitCode: 0, stdout: 'x' } }), tool: 'web_search' },
    run({ resultForModel: 'exit_code: 0 · 0.3s\n\nstdout:\nหนึ่งร้อยบาทถ้วน\n\ncreated: a.txt' }),
  ];
  assert.deepEqual(printedBySkill(runs, SCRIPT), ['สี่พันเจ็ดร้อยห้าบาทยี่สิบห้าสตางค์', 'หนึ่งร้อยบาทถ้วน']);
  assert.deepEqual(printedBySkill(undefined, SCRIPT), []);
});

test('a reply that kept the printed text stays; a retyped one is replaced by the printed text', () => {
  const printed = ['สี่พันเจ็ดร้อยห้าบาทยี่สิบห้าสตางค์'];
  assert.equal(keepExactOutput('สี่พันเจ็ดร้อยห้าบาทยี่สิบห้าสตางค์ค่ะ 😊', printed), 'สี่พันเจ็ดร้อยห้าบาทยี่สิบห้าสตางค์ค่ะ 😊');
  assert.equal(keepExactOutput('สี่พันเจ็ดร้อยห้าสิบสองบาทยี่สิบห้าสตางค์ค่ะ 😊', printed), 'สี่พันเจ็ดร้อยห้าบาทยี่สิบห้าสตางค์');
  assert.equal(keepExactOutput('', printed), 'สี่พันเจ็ดร้อยห้าบาทยี่สิบห้าสตางค์');
  assert.equal(keepExactOutput('สี่พันเจ็ดร้อยห้า บาท ยี่สิบห้าสตางค์', printed), 'สี่พันเจ็ดร้อยห้า บาท ยี่สิบห้าสตางค์', 'spacing differences are fine');
  const two = ['หนึ่งพันบาทถ้วน', 'สองพันบาทถ้วน'];
  assert.equal(keepExactOutput('1,000 = หนึ่งพันบาทถ้วน', two), 'หนึ่งพันบาทถ้วน\nสองพันบาทถ้วน', 'every printed line must be there');
  assert.equal(keepExactOutput('อะไรก็ได้', []), 'อะไรก็ได้', 'nothing printed: leave the reply');
});
