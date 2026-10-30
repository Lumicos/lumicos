// One command for the whole test suite:  npm run test:all [-- <filter> ...] [--no-build]
// Runs every *.test.mjs in its own `node --test` process (a hanging file cannot hide the others) and
// labels failures that already existed before 2026-10-15 using scripts/known-test-status.json.
// Exit code 1 only for a NEW failure (not listed as known, or worse than the listed baseline).
import { spawnSync } from 'node:child_process';
import { readdirSync, readFileSync, existsSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = join(fileURLToPath(new URL('.', import.meta.url)), '..');
const args = process.argv.slice(2);
const noBuild = args.includes('--no-build');
const filters = args.filter((a) => !a.startsWith('--'));

function walk(dir, out = []) {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    if (e.name === 'node_modules' || e.name.startsWith('.')) continue;
    const p = join(dir, e.name);
    if (e.isDirectory()) walk(p, out);
    else if (/\.test\.(mjs|js)$/.test(e.name)) out.push(relative(root, p).split(sep).join('/'));
  }
  return out;
}
const files = ['src', 'server', 'scripts'].flatMap((d) => walk(join(root, d))).sort()
  .filter((f) => !filters.length || filters.some((x) => f.includes(x)));

const keepAlive = pathToFileURL(join(root, 'scripts', 'test-keepalive.mjs')).href;
const knownPath = join(root, 'scripts', 'known-test-status.json');
const known = existsSync(knownPath) ? JSON.parse(readFileSync(knownPath, 'utf8')) : {};

if (!noBuild) {
  // The chat tests import .runtime/chat.mjs; build it from the current sources first.
  const b = spawnSync(process.execPath, ['scripts/build-chat-runtime.mjs'], { cwd: root, encoding: 'utf8' });
  if (b.status !== 0) { console.error('build-chat-runtime failed\n' + (b.stdout || '') + (b.stderr || '')); process.exit(2); }
}

const num = (out, key) => Number((out.match(new RegExp(`^# ${key} (\\d+)`, 'm')) || [])[1] ?? NaN);
const rows = [];
for (const f of files) {
  const r = spawnSync(process.execPath, ['--import', keepAlive, '--test', '--test-force-exit', f], { cwd: root, encoding: 'utf8', timeout: 120000, maxBuffer: 64 * 1024 * 1024 });
  const out = (r.stdout || '') + (r.stderr || '');
  const res = { file: f, pass: num(out, 'pass'), fail: num(out, 'fail'), cancelled: num(out, 'cancelled'), exit: r.status, timedOut: r.error?.code === 'ETIMEDOUT' };
  const bad = res.timedOut || res.exit !== 0 || !(res.fail === 0) || !(res.cancelled === 0);
  const k = known[f];
  if (!bad) res.status = k ? 'NOW-PASSES' : 'PASS';
  else if (k && !res.timedOut && (res.fail || 0) <= (k.maxFail ?? 0) && (res.cancelled || 0) <= (k.maxCancelled ?? 0) && Number.isFinite(res.pass)) res.status = 'KNOWN';
  else res.status = 'FAIL';
  res.note = k?.reason;
  rows.push(res);
  console.log(`${res.status.padEnd(10)} ${f}  pass=${res.pass} fail=${res.fail} cancelled=${res.cancelled}${res.timedOut ? ' TIMEOUT' : ''}`);
}
const count = (s) => rows.filter((r) => r.status === s).length;
console.log(`\n${rows.length} files: ${count('PASS')} PASS, ${count('KNOWN')} KNOWN (failed before 2026-10-15), ${count('NOW-PASSES')} NOW-PASSES (remove from known list), ${count('FAIL')} FAIL`);
for (const r of rows.filter((x) => x.status === 'KNOWN')) console.log(`  KNOWN ${r.file}: ${r.note}`);
for (const r of rows.filter((x) => x.status === 'NOW-PASSES')) console.log(`  NOW-PASSES ${r.file}: remove from scripts/known-test-status.json`);
process.exit(count('FAIL') ? 1 : 0);
