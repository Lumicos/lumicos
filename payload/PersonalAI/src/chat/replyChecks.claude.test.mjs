import test from 'node:test';
import assert from 'node:assert/strict';
import { lastRunFailed, ranScript, CLAIMS_TOOL } from '../../.runtime/chat.mjs';

const run = (code, extra = {}) => ({ id: 'r', tool: 'run_python', status: 'done', callText: '', args: { code }, ...extra });

test('a failed last run_python call is noticed (exit code, error status, or the result text)', () => {
  assert.equal(lastRunFailed([run('x', { data: { exitCode: 1 } })]), true);
  assert.equal(lastRunFailed([run('x', { status: 'error' })]), true);
  assert.equal(lastRunFailed([run('x', { resultForModel: 'exit_code: 1 · 2.1s\n\nstderr:\nValueError' })]), true);
  assert.equal(lastRunFailed([run('x', { data: { exitCode: 1 } }), run('y', { data: { exitCode: 0 } })]), false, 'only the last call counts');
  assert.equal(lastRunFailed([]), false);
});

test('the skill script counts as run with ./ or backslash paths', () => {
  const s = 'skills/vat-and-discount/script.py';
  assert.equal(ranScript([run(`exec(open("${s}", encoding="utf-8").read())\nprint(vat_calc(980))`)], s), true);
  assert.equal(ranScript([run('exec(open("./skills/vat-and-discount/script.py").read())')], s), true);
  assert.equal(ranScript([run('exec(open("skills\\\\vat-and-discount\\\\script.py").read())')], s), true);
  assert.equal(ranScript([run('print(980 * 0.07)')], s), false);
});

test('claims of tool use are recognised; advice to the user is not', () => {
  for (const t of ['ฉันใช้เครื่องมือคำนวณให้แล้วนะคะ', 'ใช้สกิลคำนวณให้เรียบร้อยแล้วค่ะ', 'ดิฉันได้รันสคริปต์ตรวจแล้ว', 'I ran the script and got 42']) assert.ok(CLAIMS_TOOL.test(t), t);
  for (const t of ['คุณสามารถใช้โปรแกรม Excel ช่วยได้', 'เครื่องมือช่างควรเก็บให้ดี', 'VAT 7% ของ 980 บาท คือ 68.60 บาท']) assert.ok(!CLAIMS_TOOL.test(t), t);
});
