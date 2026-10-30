// claude-20261022: the self check uses no AI model — rule-based health report + automated code checks.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { recentSourceFiles, readSource, recentErrors, buildHealthDigest, collectHealth, formatReport, runHealthCheck,
  runSelfCheck, relatedTests, runProcess, METHOD_HEALTH, METHOD_CODE } from '../selfcheck/selfcheck.mjs';

async function tmp() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'sc-'));
  await fs.mkdir(path.join(root, 'server'), { recursive: true });
  await fs.mkdir(path.join(root, 'node_modules'), { recursive: true });
  await fs.writeFile(path.join(root, 'server', 'a.mjs'), 'export const a = 1;');
  await fs.writeFile(path.join(root, 'server', 'a.test.mjs'), 'x');
  await fs.writeFile(path.join(root, 'node_modules', 'b.js'), 'x');
  return root;
}
const jl = (rows) => rows.map((r) => JSON.stringify(r)).join('\n') + '\n';

test('only recent, non-test, non-vendor source files are picked', async () => {
  const root = await tmp();
  assert.deepEqual((await recentSourceFiles(root)).map((x) => x.file), ['server/a.mjs']);
  assert.equal((await recentSourceFiles(root, { now: Date.now() + 10 * 24 * 3600 * 1000 })).length, 0);
});

test('readSource refuses paths outside the project and non-source files', async () => {
  const root = await tmp();
  await assert.rejects(readSource(root, '../etc/passwd'));
  await assert.rejects(readSource(root, 'node_modules/b.js'));
  assert.match(await readSource(root, 'server/a.mjs'), /export const a/);
});

test('recentErrors keeps only error-like lines', async () => {
  const root = await tmp();
  await fs.writeFile(path.join(root, 'x.log'), 'ok line\nboom Error: bad\nfine\n');
  const e = await recentErrors(root);
  assert.match(e, /Error: bad/);
  assert.doesNotMatch(e, /ok line/);
});

test('health digest still counts the raw facts', async () => {
  const root = await tmp();
  const now = Date.now(), at = new Date(now - 1000).toISOString();
  await fs.writeFile(path.join(root, 'image-jobs.jsonl'), jl([{ at, correlationId: 'a', stage: 'request_received' }, { at, correlationId: 'a', stage: 'delivered' }, { at, correlationId: 'b', stage: 'request_received' }]));
  await fs.writeFile(path.join(root, 'llm-cache.jsonl'), jl([{ at, purpose: 'chat', elapsedMs: 30000, cache_n: 5 }]));
  const digest = await buildHealthDigest(root, now);
  assert.match(digest, /Image jobs in last 24h: 2; delivered: 1; not delivered: 1/);
  assert.match(digest, /LLM calls in last 24h: 1 \(chat:1\); slower than 20s: 1; with prompt-cache hit: 1/);
});

test('rule-based health: judges each area and ignores problems older than 24 h', async () => {
  const data = await fs.mkdtemp(path.join(os.tmpdir(), 'health-')), logs = path.join(data, 'logs');
  await fs.mkdir(logs);
  const now = Date.now(), at = new Date(now - 60000).toISOString(), old = new Date(now - 3 * 24 * 3600e3).toISOString();
  const turns = Array.from({ length: 10 }, (_, i) => ({ at, replyId: `r${i}`, status: i === 0 ? 'failed' : 'done' }));
  await fs.writeFile(path.join(logs, 'tool-decisions.jsonl'), jl([...turns, { at: old, status: 'failed', error: 'old failure' }]));
  await fs.writeFile(path.join(logs, 'llm-cache.jsonl'), jl(Array.from({ length: 5 }, () => ({ at, purpose: 'chat-reply', elapsedMs: 3000 }))));
  await fs.writeFile(path.join(logs, 'image-jobs.jsonl'), jl([{ at, correlationId: 'a', stage: 'delivered' }, { at, correlationId: 'b', stage: 'error', error: 'hipErrorLaunchFailure' },
    ...Array.from({ length: 4 }, (_, i) => ({ at, correlationId: `c${i}`, stage: 'delivered' }))]));
  await fs.writeFile(path.join(logs, 'web-search.jsonl'), jl([{ at, status: 'ok' }, { at, status: 'no_evidence', query: 'ราคาน้ำมัน' }, { at, status: 'no_evidence', query: 'ราคาน้ำมัน' }, { at, status: 'error', error: 'timeout' }]));
  await fs.writeFile(path.join(logs, 'voice-lifecycle.jsonl'), jl([{ at, event: 'ready' }, { at, event: 'health_fail' }]));
  await fs.mkdir(path.join(data, 'test-runs'));
  await fs.writeFile(path.join(data, 'test-runs', '20261022-1500.md'), '# ผล\n\nผ่าน 12 · เตือน 1 · ไม่ผ่าน 2 · ข้าม 0\n');
  const items = await collectHealth(logs, now, data);
  const find = (re) => items.find((i) => re.test(i.text));
  assert.equal(find(/^แชตใน 24 ชม\./).level, 'warn');
  assert.match(find(/^แชตใน 24 ชม\./).text, /10 เทิร์น · ไม่สำเร็จ 1/);
  assert.equal(find(/^ความเร็วตอบ/).level, 'ok');
  assert.equal(find(/^งานภาพ/).level, 'warn');
  assert.match(find(/^งานภาพ/).details[0], /hipErrorLaunchFailure/);
  assert.equal(find(/^ค้นเว็บ/).level, 'bad');
  assert.ok(find(/^ค้นเว็บ/).details.some((d) => /no_evidence — "ราคาน้ำมัน" \(×2\)/.test(d)));
  assert.equal(find(/^เสียง/).level, 'warn');
  assert.equal(find(/^สำรองข้อมูล/).level, 'warn');
  assert.equal(find(/^ทดสอบบทสนทนาจริง/).level, 'warn');
  assert.ok(!JSON.stringify(items).includes('old failure'), 'problems older than 24 h are ignored');
  const report = formatReport(items);
  assert.equal(report.status, 'bad');
  assert.match(report.text, /^สถานะ: มีปัญหา ❌/);
  const r = await runHealthCheck({ logsDir: logs, dataDir: data, now });
  assert.equal(r.model, METHOD_HEALTH);
  assert.match(r.report, /❌ ค้นเว็บใน 24 ชม\.: 4 ครั้ง · ไม่ได้ผล 3/);
  assert.match(r.digest, /Chat turns in last 24h: 10/);
});

test('an empty, healthy system reports green apart from the missing snapshot', async () => {
  const data = await fs.mkdtemp(path.join(os.tmpdir(), 'health-')), logs = path.join(data, 'logs');
  await fs.mkdir(logs);
  await fs.mkdir(path.join(data, 'snapshots', '20261022-090000'), { recursive: true });
  await fs.writeFile(path.join(data, 'snapshots', '20261022-090000', 'manifest.json'), JSON.stringify({ createdAt: new Date().toISOString(), invalidJson: [] }));
  const { status, text } = formatReport(await collectHealth(logs, Date.now(), data));
  assert.equal(status, 'ok', text);
  assert.match(text, /✅ ไม่มีข้อความ error ใน log วันนี้/);
});

test('relatedTests finds tests that name a changed file', async () => {
  const root = await tmp();
  await fs.mkdir(path.join(root, 'server', 'test'), { recursive: true });
  await fs.writeFile(path.join(root, 'server', 'test', 'imageEdit.test.mjs'), "import '../comfy/imageEdit.mjs'");
  await fs.writeFile(path.join(root, 'server', 'test', 'other.test.mjs'), "import '../x.mjs'");
  assert.deepEqual(relatedTests(root, ['server/comfy/imageEdit.mjs']), ['server/test/imageEdit.test.mjs']);
  assert.deepEqual(relatedTests(root, ['src/a.css']), []);
});

test('code check runs syntax, TypeScript, lint and the related tests, and reports what failed', async () => {
  const root = await tmp();
  await fs.mkdir(path.join(root, 'server', 'test'), { recursive: true });
  await fs.writeFile(path.join(root, 'server', 'test', 'widget.test.mjs'), "import '../widget.mjs'");
  await fs.mkdir(path.join(root, 'node_modules', 'typescript', 'bin'), { recursive: true });
  await fs.writeFile(path.join(root, 'node_modules', 'typescript', 'bin', 'tsc'), '');
  await fs.mkdir(path.join(root, 'node_modules', 'oxlint', 'bin'), { recursive: true });
  await fs.writeFile(path.join(root, 'node_modules', 'oxlint', 'bin', 'oxlint'), '');
  const calls = [];
  const run = async (_cmd, args) => {
    calls.push(args.join(' '));
    if (args[0] === '--check') return args[1] === 'server/broken.mjs' ? { code: 1, out: 'SyntaxError: Unexpected token' } : { code: 0, out: '' };
    if (/tsc$/.test(args[0])) return { code: 0, out: '' };
    if (/oxlint$/.test(args[0])) return { code: 0, out: JSON.stringify({ diagnostics: [{ severity: 'warning', filename: 'src/x.tsx', message: 'unused' }] }) };
    if (args[0] === 'scripts/build-chat-runtime.mjs') return { code: 0, out: 'built' };
    if (args[0] === 'scripts/run-tests.mjs') return { code: 1, out: 'FAIL       server/test/widget.test.mjs  pass=3 fail=1 cancelled=0\n' };
    return { code: 0, out: '' };
  };
  const r = await runSelfCheck({ root, files: ['server/widget.mjs', 'server/broken.mjs', 'src/x.tsx'], run, now: Date.now() + 10 * 24 * 3600e3 });
  assert.equal(r.model, METHOD_CODE);
  assert.match(r.report, /^สถานะ: มีปัญหา ❌/);
  assert.match(r.report, /❌ ไวยากรณ์ JavaScript: พัง 1 จาก 2 ไฟล์/);
  assert.match(r.report, /server\/broken\.mjs: SyntaxError/);
  assert.match(r.report, /✅ TypeScript \(หน้าเว็บ\): ไม่มี error/);
  assert.match(r.report, /✅ Lint: ไม่มี error \(คำเตือน 1\)/);
  assert.match(r.report, /❌ เทสต์อัตโนมัติ: ไม่ผ่าน 1 จาก 1 ไฟล์/);
  assert.deepEqual(r.tests, ['server/test/widget.test.mjs']);
  assert.ok(calls.some((c) => c.startsWith('scripts/run-tests.mjs --no-build server/test/widget.test.mjs')));
});

test('code check with nothing changed says so; runProcess reports exit codes and timeouts', async () => {
  const root = await tmp();
  const r = await runSelfCheck({ root, now: Date.now() + 10 * 24 * 3600e3, run: async () => { throw new Error('should not run'); } });
  assert.match(r.report, /ไม่มีไฟล์โค้ดที่แก้/);
  const ok = await runProcess(process.execPath, ['-e', "console.log('hello')"]);
  assert.equal(ok.code, 0); assert.match(ok.out, /hello/);
  const slow = await runProcess(process.execPath, ['-e', 'setTimeout(()=>{},5000)'], { timeoutMs: 300 });
  assert.equal(slow.code, 124); assert.match(slow.out, /หมดเวลา/);
});
