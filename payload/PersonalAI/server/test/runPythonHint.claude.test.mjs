// claude-20261023: Gemma sent run_python only the exec(...) line of a skill (prints nothing) three times, then guessed
// "3 ทุ่มไทย = 22:00 โตเกียว". A silent run now names the functions the skill script defines and how to call them.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { SkillStore, sandboxTools, skillLoadHint } from '../tools/sandboxTools.mjs';

const SCRIPT = 'DEFAULT_RATE = 4.5\n\n\ndef _num(x):\n    return x\n\n\ndef appliance_cost(watts, hours_per_day, days=30,\n                   rate=DEFAULT_RATE):\n    return 1\n\n\ndef bill_rate(amount, units):\n    return 2\n';
const LOAD = 'exec(open("skills/power-cost/script.py", encoding="utf-8").read())';
const store = (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ws-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const s = new SkillStore(root);
  s.save({ name: 'power-cost', description: 'ค่าไฟ', instructions: '1. รัน', files: { 'script.py': SCRIPT } });
  return s;
};
const run = (stdout, stderr = '', exitCode = 0) => ({ exitCode, timedOut: false, memoryKilled: false, seconds: 0.2, stdout, stderr, files: { created: [], changed: [], deleted: [] } });

test('exec-only code: the hint lists the public functions with their arguments', (t) => {
  const s = store(t);
  const hint = skillLoadHint(LOAD, s.dir);
  assert.match(hint, /appliance_cost\(watts, hours_per_day, days=30, rate=DEFAULT_RATE\)/);
  assert.match(hint, /bill_rate\(amount, units\)/);
  assert.ok(!hint.includes('_num'), 'private helpers are left out');
  assert.match(hint, /print\(appliance_cost\(\.\.\.\)\)/);
  assert.equal(skillLoadHint('print(1 + 1)', s.dir), '', 'no skill script, no hint');
  assert.equal(skillLoadHint('exec(open("skills/nope/script.py").read())', s.dir), '', 'unknown skill, no hint');
});

test('run_python adds the hint only when the run printed nothing', async (t) => {
  const s = store(t);
  let next;
  const tool = sandboxTools({ runPython: async () => next }, s).find((x) => x.name === 'run_python');
  next = run('');
  assert.match((await tool.handler({ code: LOAD })).content, /Nothing was printed: exec\(\.\.\.\) only loads skills\/power-cost\/script\.py/);
  next = run('1296.0\n');
  assert.ok(!(await tool.handler({ code: `${LOAD}\nprint(appliance_cost(1200, 8))` })).content.includes('Nothing was printed'));
  next = run('', 'NameError: name x is not defined', 1);
  assert.ok(!(await tool.handler({ code: LOAD })).content.includes('Nothing was printed'), 'errors are shown as they are');
  next = run('');
  assert.match((await tool.handler({ code: 'x = 1' })).content, /no output — use print\(\)/, 'plain code keeps the short note');
});
