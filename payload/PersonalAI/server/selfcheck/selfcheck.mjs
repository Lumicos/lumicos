// Read-only self check without any AI model (2026-10-22: the Gemma 12B reviewer was removed).
//   health: counts facts from data/logs and judges them with fixed rules (green / yellow / red), in a second.
//   code:   for files changed in the last 36 h runs syntax checks, TypeScript, lint and the automated tests
//           that cover them (scripts/run-tests.mjs knows the tolerated failures). It never edits anything.
import fs from 'node:fs/promises';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';

const SOURCE_DIRS = ['server', 'src', 'scripts'];
const SOURCE_EXT = /\.(mjs|ts|tsx|js|css)$/;
const SKIP = /(^|[\\/])(node_modules|dist|\.runtime|test|_claude_diag|_to_delete)([\\/]|$)|\.test\.|\.d\.m?ts$/;
const ERROR_RE = /(error|fail|exception|abort|timeout|timed out|unhandled|ECONN|ENOENT)/i;
const BENIGN_RE = /common_fit_params: failed to fit params.*n_gpu_layers already set/i;
export const LIMITS = { files: 3, fileChars: 4500, logLines: 25, logChars: 3000 };

export async function recentSourceFiles(root, { sinceMs = 36 * 3600 * 1000, max = LIMITS.files, now = Date.now() } = {}) {
  const found = [];
  async function walk(dir) {
    let entries;
    try { entries = await fs.readdir(dir, { withFileTypes: true }); } catch { return; }
    for (const e of entries) {
      const full = path.join(dir, e.name);
      if (SKIP.test(path.relative(root, full))) continue;
      if (e.isDirectory()) await walk(full);
      else if (SOURCE_EXT.test(e.name)) {
        const st = await fs.stat(full).catch(() => null);
        if (st && now - st.mtimeMs <= sinceMs) found.push({ file: path.relative(root, full).replace(/\\/g, '/'), mtime: st.mtimeMs });
      }
    }
  }
  for (const d of SOURCE_DIRS) await walk(path.join(root, d));
  return found.sort((a, b) => b.mtime - a.mtime).slice(0, max);
}

export async function readSource(root, rel) {
  const full = path.resolve(root, rel);
  if (!full.startsWith(path.resolve(root) + path.sep) || SKIP.test(rel) || !SOURCE_EXT.test(rel)) throw Object.assign(new Error('That file cannot be checked'), { status: 400 });
  const text = await fs.readFile(full, 'utf8');
  return text.length > LIMITS.fileChars ? text.slice(0, LIMITS.fileChars) + '\n/* …truncated… */' : text;
}

export async function recentErrors(logsDir, { lines = LIMITS.logLines, chars = LIMITS.logChars } = {}) {
  const out = [];
  let names = [];
  try { names = (await fs.readdir(logsDir)).filter(n => /\.(log|jsonl)$/.test(n)); } catch { return ''; }
  for (const n of names) {
    let text = '';
    try { text = await fs.readFile(path.join(logsDir, n), 'utf8'); } catch { continue; }
    const hits = text.split('\n').slice(-400).filter(l => ERROR_RE.test(l) && !BENIGN_RE.test(l)).slice(-6);
    for (const h of hits) out.push(`[${n}] ${h.slice(0, 300)}`);
  }
  return out.slice(-lines).join('\n').slice(-chars);
}

// ---------------- raw facts (shown under "ข้อมูลที่ใช้ตรวจ") ----------------
async function readLines(file, max = 600) {
  try { return (await fs.readFile(file, 'utf8')).split('\n').filter(Boolean).slice(-max); } catch { return []; }
}
const parse = l => { try { return JSON.parse(l); } catch { return null; } };

/** Deterministic numbers straight from the logs (the rule-based report below judges them). */
export async function buildHealthDigest(logsDir, now = Date.now()) {
  const lines = [];
  const day = 24 * 3600 * 1000;
  const recent = r => r && r.at && now - Date.parse(r.at) <= day;

  const llm = (await readLines(path.join(logsDir, 'llm-cache.jsonl'))).map(parse).filter(recent);
  if (llm.length) {
    const by = {};
    for (const r of llm) (by[r.purpose ?? '?'] ??= []).push(r);
    const slow = llm.filter(r => r.elapsedMs > 20000).length;
    const hit = llm.filter(r => r.cache_n > 0).length;
    lines.push(`LLM calls in last 24h: ${llm.length} (${Object.entries(by).map(([k, v]) => `${k}:${v.length}`).join(', ')}); slower than 20s: ${slow}; with prompt-cache hit: ${hit}`);
  } else lines.push('LLM calls in last 24h: none logged');

  const img = (await readLines(path.join(logsDir, 'image-jobs.jsonl'), 3000)).map(parse).filter(recent);
  const jobs = new Map();
  for (const r of img) { const j = jobs.get(r.correlationId) ?? new Set(); j.add(r.stage); jobs.set(r.correlationId, j); }
  const unfinished = [...jobs.values()].filter(st => !st.has('delivered')).length;
  const errStages = img.filter(r => /error|fail|timeout|cancel/i.test(r.stage ?? '')).length;
  lines.push(`Image jobs in last 24h: ${jobs.size}; delivered: ${jobs.size - unfinished}; not delivered: ${unfinished}; error-like stages: ${errStages}`);

  const vram = (await readLines(path.join(logsDir, 'vram.jsonl'), 200)).map(parse).filter(Boolean);
  const lastV = vram.at(-1);
  if (lastV) lines.push(`Last VRAM sample (${lastV.at}${Date.now() - Date.parse(lastV.at) > 3600e3 ? ', STALE - older than 1h, ignore for current state' : ''}): free ${lastV.vram_free_gib} of ${lastV.vram_total_gib} GiB`);

  const tool = (await readLines(path.join(logsDir, 'tool-decisions.jsonl'))).map(parse).filter(recent);
  if (tool.length) lines.push(`Chat turns in last 24h: ${tool.length}; not finished with status done: ${tool.filter(r => r.status && r.status !== 'done').length}`);

  const errs = await recentErrors(logsDir, { lines: 12, chars: 1800 });
  lines.push('Recent error-like log lines:\n' + (errs || '(none)'));
  return lines.join('\n');
}


// ---------------- shared ----------------
export const METHOD_HEALTH = 'ไม่ใช้โมเดล (นับจาก log ด้วยกฎตายตัว)';
export const METHOD_CODE = 'ไม่ใช้โมเดล (ไวยากรณ์ + TypeScript + lint + เทสต์อัตโนมัติ)';
const MARK = { ok: '✅', warn: '⚠️', bad: '❌', info: 'ℹ️' };
const item = (level, text, details = []) => ({ level, text, details: details.filter(Boolean) });
export function formatReport(items) {
  const worst = items.some((i) => i.level === 'bad') ? 'bad' : items.some((i) => i.level === 'warn') ? 'warn' : 'ok';
  const head = { ok: 'สถานะ: ปกติ ✅', warn: 'สถานะ: มีเรื่องควรดู ⚠️', bad: 'สถานะ: มีปัญหา ❌' }[worst];
  const lines = [head, ''];
  for (const i of items) {
    lines.push(`${MARK[i.level]} ${i.text}`);
    for (const d of i.details.slice(0, 8)) lines.push(`     • ${d}`);
  }
  return { status: worst, text: lines.join('\n') };
}
const pct = (a, b) => (b ? Math.round((a / b) * 100) : 0);

// ---------------- health mode ----------------
const DAY = 24 * 3600 * 1000;
async function jsonl(logsDir, name, now, max = 3000) {
  return (await readLines(path.join(logsDir, name), max)).map(parse).filter((r) => r && r.at && now - Date.parse(r.at) <= DAY);
}

/** Error-like events from the last 24 h only (JSONL rows by their own time, .log files only if written today). */
async function recentProblems(logsDir, now) {
  const out = [];
  let names = [];
  try { names = (await fs.readdir(logsDir)).filter((n) => /\.(log|jsonl)$/.test(n)); } catch { return out; }
  for (const n of names) {
    const file = path.join(logsDir, n);
    if (n.endsWith('.jsonl')) {
      for (const r of await jsonl(logsDir, n, now, 2000)) {
        const bad = r.error || /error|fail|timeout/i.test(String(r.status ?? '')) || /error|fail|timeout/i.test(String(r.stage ?? '')) || r.event === 'health_fail';
        if (bad) out.push(`[${n}] ${String(r.error ?? r.status ?? r.stage ?? r.event).slice(0, 160)}`);
      }
    } else {
      let st; try { st = statSync(file); } catch { continue; }
      if (now - st.mtimeMs > DAY) continue;
      for (const l of (await readLines(file, 300))) if (ERROR_RE.test(l) && !BENIGN_RE.test(l)) out.push(`[${n}] ${l.trim().slice(0, 160)}`);
    }
  }
  return out;
}
const dedupe = (lines) => {
  const m = new Map();
  for (const l of lines) { const k = l.replace(/\d+/g, '#').slice(0, 110); const e = m.get(k); if (e) e.n++; else m.set(k, { l, n: 1 }); }
  return [...m.values()].sort((a, b) => b.n - a.n).map((e) => (e.n > 1 ? `${e.l} (×${e.n})` : e.l));
};

export async function collectHealth(logsDir, now = Date.now(), dataDir = path.dirname(logsDir)) {
  const items = [];
  // Chat turns
  const turns = await jsonl(logsDir, 'tool-decisions.jsonl', now);
  const notDone = turns.filter((t) => t.status && t.status !== 'done');
  const over = turns.filter((t) => t.turn?.context?.overBudget);
  if (!turns.length) items.push(item('info', 'แชตใน 24 ชม.: ยังไม่มี'));
  else {
    const lvl = !notDone.length ? 'ok' : notDone.length <= 2 && pct(notDone.length, turns.length) <= 10 ? 'warn' : 'bad';
    items.push(item(lvl, `แชตใน 24 ชม.: ${turns.length} เทิร์น · ไม่สำเร็จ ${notDone.length}${over.length ? ` · ข้อความยาวเกิน context ${over.length}` : ''}`,
      notDone.slice(-5).map((t) => `${t.status}${t.turn?.error ? `: ${t.turn.error}` : ''} (${new Date(t.at).toLocaleTimeString('th-TH')})`)));
  }
  // Reply speed (chat replies only)
  const llm = await jsonl(logsDir, 'llm-cache.jsonl', now);
  const replies = llm.filter((r) => /chat/.test(r.purpose ?? ''));
  if (replies.length >= 3) {
    const slow = replies.filter((r) => r.elapsedMs > 20000).length, p = pct(slow, replies.length);
    items.push(item(p <= 10 ? 'ok' : p <= 30 ? 'warn' : 'bad', `ความเร็วตอบ: ช้าเกิน 20 วินาที ${slow} จาก ${replies.length} ครั้ง (${p}%)`));
  }
  // Images
  const img = await jsonl(logsDir, 'image-jobs.jsonl', now);
  const jobs = new Map();
  for (const r of img) { const j = jobs.get(r.correlationId) ?? []; j.push(r); jobs.set(r.correlationId, j); }
  if (jobs.size) {
    const list = [...jobs.values()];
    const failed = list.filter((j) => j.some((r) => /error|fail|timeout/i.test(`${r.stage ?? ''} ${r.status ?? ''}`)));
    const delivered = list.filter((j) => j.some((r) => r.stage === 'delivered')).length;
    const lvl = !failed.length ? 'ok' : failed.length === 1 && pct(1, list.length) < 25 ? 'warn' : 'bad';
    items.push(item(lvl, `งานภาพใน 24 ชม.: ${list.length} งาน · ส่งภาพแล้ว ${delivered} · ล้ม ${failed.length}`,
      failed.slice(-4).map((j) => { const e = j.find((r) => /error|fail|timeout/i.test(`${r.stage ?? ''} ${r.status ?? ''}`)); return `${e.stage}${e.error ? `: ${String(e.error).slice(0, 120)}` : ''}`; })));
  }
  // Web search
  const web = await jsonl(logsDir, 'web-search.jsonl', now);
  if (web.length) {
    const bad = web.filter((r) => r.status !== 'ok'), p = pct(bad.length, web.length);
    items.push(item(web.length < 3 || p <= 20 ? 'ok' : p <= 50 ? 'warn' : 'bad', `ค้นเว็บใน 24 ชม.: ${web.length} ครั้ง · ไม่ได้ผล ${bad.length}`,
      dedupe(bad.map((r) => `${r.status}${r.error ? `: ${r.error}` : ''}${r.query ? ` — "${String(r.query).slice(0, 60)}"` : ''}`)).slice(0, 4)));
  }
  // Voice
  const voice = await jsonl(logsDir, 'voice-lifecycle.jsonl', now);
  const vfail = voice.filter((r) => r.event === 'health_fail').length;
  if (voice.length) items.push(item(vfail ? 'warn' : 'ok', `เสียง (OmniVoice): ${vfail ? `health check ล้ม ${vfail} ครั้ง` : 'ไม่มีปัญหา'}`));
  // VRAM (only meaningful when the sample is fresh)
  const lastV = (await readLines(path.join(logsDir, 'vram.jsonl'), 50)).map(parse).filter(Boolean).at(-1);
  if (lastV && now - Date.parse(lastV.at) <= 3600e3 && Number(lastV.vram_free_gib) < 0.5) items.push(item('warn', `VRAM เหลือน้อย: ${lastV.vram_free_gib} จาก ${lastV.vram_total_gib} GiB`));
  // Error lines
  const problems = dedupe(await recentProblems(logsDir, now));
  items.push(problems.length ? item('warn', `ข้อความ error ใน log วันนี้: ${problems.length} แบบ`, problems.slice(0, 6)) : item('ok', 'ไม่มีข้อความ error ใน log วันนี้'));
  // Daily snapshot
  let snaps = [];
  try { snaps = readdirSync(path.join(dataDir, 'snapshots')).filter((n) => /^\d{8}-\d{6}(-\d+)?$/.test(n)).sort(); } catch {}
  if (!snaps.length) items.push(item('warn', 'สำรองข้อมูล: ยังไม่มี (Lumicos จะสำรองให้ราว 90 วินาทีหลังเปิด)'));
  else {
    let m = null; try { m = JSON.parse(readFileSync(path.join(dataDir, 'snapshots', snaps.at(-1), 'manifest.json'), 'utf8')); } catch {}
    const ageH = m?.createdAt ? (now - Date.parse(m.createdAt)) / 3600e3 : 0;
    if (m?.invalidJson?.length) items.push(item('bad', `สำรองข้อมูลล่าสุดเจอไฟล์เสีย: ${m.invalidJson.join(', ')}`));
    else items.push(item(ageH > 48 ? 'warn' : 'ok', `สำรองข้อมูลล่าสุด: ${Math.round(ageH)} ชั่วโมงก่อน (${snaps.length} ชุด)`));
  }
  // Latest real chat check
  let runs = [];
  try { runs = readdirSync(path.join(dataDir, 'test-runs')).filter((n) => n.endsWith('.md')).sort(); } catch {}
  if (runs.length) {
    const text = readFileSync(path.join(dataDir, 'test-runs', runs.at(-1)), 'utf8');
    const m = text.match(/ผ่าน (\d+) · เตือน (\d+) · ไม่ผ่าน (\d+)/);
    if (m) items.push(item(Number(m[3]) ? 'warn' : 'ok', `ทดสอบบทสนทนาจริงล่าสุด (${runs.at(-1).replace('.md', '')}): ผ่าน ${m[1]} · เตือน ${m[2]} · ไม่ผ่าน ${m[3]}`));
  }
  // Bug reports waiting
  let bugs = [];
  try { bugs = readdirSync(path.join(dataDir, 'bug-reports')).filter((n) => n.endsWith('.md')).filter((n) => now - statSync(path.join(dataDir, 'bug-reports', n)).mtimeMs <= 7 * DAY); } catch {}
  if (bugs.length) items.push(item('info', `แจ้งบั๊กไว้ใน 7 วัน: ${bugs.length} รายการ (ให้ Claude อ่านที่ data/bug-reports)`));
  return items;
}

export async function runHealthCheck({ logsDir, dataDir, now = Date.now() }) {
  const t0 = Date.now();
  const items = await collectHealth(logsDir, now, dataDir ?? path.dirname(logsDir));
  const { text } = formatReport(items);
  return { mode: 'health', model: METHOD_HEALTH, ms: Date.now() - t0, digest: await buildHealthDigest(logsDir, now), report: text };
}

// ---------------- code mode ----------------
/** Runs a command without blocking the service; resolves with its exit code and the end of its output. */
export function runProcess(command, args, { cwd, timeoutMs = 120000 } = {}) {
  return new Promise((resolve) => {
    let out = '', finished = false;
    const child = spawn(command, args, { cwd, windowsHide: true, env: { ...process.env, FORCE_COLOR: '0', NO_COLOR: '1' } });
    const add = (d) => { out += d; if (out.length > 400000) out = out.slice(-200000); };
    const finish = (code, extra = '') => { if (finished) return; finished = true; clearTimeout(timer); resolve({ code, out: out + extra }); };
    const timer = setTimeout(() => { child.kill(); finish(124, `\n[หมดเวลา ${Math.round(timeoutMs / 1000)} วินาที]`); }, timeoutMs);
    child.stdout?.on('data', add); child.stderr?.on('data', add);
    child.on('error', (e) => finish(127, `\n${e.message}`));
    child.on('close', (code) => finish(code ?? 1));
  });
}

export function testFiles(root) {
  const out = [];
  const walk = (dir) => {
    let entries = []; try { entries = readdirSync(path.join(root, dir), { withFileTypes: true }); } catch { return; }
    for (const e of entries) {
      if (e.name === 'node_modules' || e.name.startsWith('.')) continue;
      const rel = `${dir}/${e.name}`;
      if (e.isDirectory()) walk(rel); else if (/\.test\.mjs$/.test(e.name)) out.push(rel);
    }
  };
  for (const d of ['server', 'src', 'scripts']) walk(d);
  return out.sort();
}

/** Tests that name a changed file (or its stem); best matches first. */
export function relatedTests(root, changed, all = testFiles(root), max = 10) {
  const stems = [...new Set(changed.map((f) => path.basename(f).replace(/\.(mjs|ts|tsx|js|css)$/, '')).filter((s) => s.length >= 4))];
  if (!stems.length) return [];
  return all.map((t) => {
    let text = ''; try { text = readFileSync(path.join(root, t), 'utf8'); } catch {}
    return { t, hits: stems.filter((s) => text.includes(s) || path.basename(t).startsWith(`${s}.`)).length };
  }).filter((x) => x.hits).sort((a, b) => b.hits - a.hits || a.t.localeCompare(b.t)).slice(0, max).map((x) => x.t);
}

const firstLines = (text, n) => text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean).slice(0, n).join(' / ').slice(0, 300);

export async function runSelfCheck({ root, files: requested, now = Date.now(), run = runProcess, node = process.execPath, maxTests = 15 }) {
  const t0 = Date.now();
  const changed = requested?.length ? requested : (await recentSourceFiles(root, { max: 25, now })).map((f) => f.file);
  const recentTests = testFiles(root).filter((t) => { try { return now - statSync(path.join(root, t)).mtimeMs <= 36 * 3600 * 1000; } catch { return false; } });
  if (!changed.length && !recentTests.length) return { model: METHOD_CODE, ms: 0, files: [], report: 'ไม่มีไฟล์โค้ดที่แก้ในช่วง 36 ชั่วโมงที่ผ่านมา' };
  const items = [], raw = [];
  // 1) JavaScript syntax
  const js = changed.filter((f) => /\.(mjs|js)$/.test(f));
  if (js.length) {
    const broken = [];
    for (const f of js) { const r = await run(node, ['--check', f], { cwd: root, timeoutMs: 20000 }); if (r.code !== 0) broken.push(`${f}: ${firstLines(r.out, 3)}`); }
    items.push(broken.length ? item('bad', `ไวยากรณ์ JavaScript: พัง ${broken.length} จาก ${js.length} ไฟล์`, broken) : item('ok', `ไวยากรณ์ JavaScript: ผ่าน ${js.length} ไฟล์`));
  }
  // 2) TypeScript of the web UI, when src/ changed
  const srcChanged = changed.some((f) => f.startsWith('src/'));
  const tsc = path.join(root, 'node_modules', 'typescript', 'bin', 'tsc');
  if (srcChanged && existsSync(tsc)) {
    const r = await run(node, [tsc, '-p', 'tsconfig.app.json', '--noEmit'], { cwd: root, timeoutMs: 180000 });
    const errs = r.out.split(/\r?\n/).filter((l) => /error TS\d+/.test(l)).map((l) => l.trim());
    raw.push(`--- tsc (exit ${r.code})\n${r.out.slice(-3000)}`);
    items.push(r.code === 0 ? item('ok', 'TypeScript (หน้าเว็บ): ไม่มี error') : item('bad', `TypeScript (หน้าเว็บ): error ${errs.length || '(ดูรายละเอียด)'}`, errs));
  }
  // 3) Lint on the changed files
  const lintable = changed.filter((f) => /\.(mjs|js|ts|tsx)$/.test(f));
  const oxlint = path.join(root, 'node_modules', 'oxlint', 'bin', 'oxlint');
  if (lintable.length && existsSync(oxlint)) {
    const r = await run(node, [oxlint, '--format', 'json', ...lintable], { cwd: root, timeoutMs: 60000 });
    let diags = null; try { diags = JSON.parse(r.out.slice(r.out.indexOf('{'))).diagnostics; } catch {}
    if (!Array.isArray(diags)) items.push(item('info', 'Lint: อ่านผลไม่ได้ (ข้าม)'));
    else {
      const errors = diags.filter((d) => d.severity === 'error');
      items.push(errors.length ? item('bad', `Lint: error ${errors.length}`, errors.map((d) => `${d.filename}: ${d.message}`)) : item('ok', `Lint: ไม่มี error${diags.length ? ` (คำเตือน ${diags.length})` : ''}`));
    }
  }
  // 4) Automated tests that cover the changed files
  const tests = [...new Set([...recentTests, ...relatedTests(root, changed)])].slice(0, maxTests);
  if (!tests.length) items.push(item('warn', 'ไม่มีเทสต์ที่ครอบไฟล์ที่แก้ — ควรเพิ่มเทสต์'));
  else {
    const b = await run(node, ['scripts/build-chat-runtime.mjs'], { cwd: root, timeoutMs: 120000 });
    if (b.code !== 0) items.push(item('bad', 'สร้าง chat runtime ไม่สำเร็จ (เทสต์ฝั่งแชตจะล้ม)', [firstLines(b.out, 4)]));
    const r = await run(node, ['scripts/run-tests.mjs', '--no-build', ...tests], { cwd: root, timeoutMs: 240000 });
    raw.push(`--- run-tests (exit ${r.code})\n${r.out.slice(-6000)}`);
    const rows = [...r.out.matchAll(/^(PASS|FAIL|KNOWN|NOW-PASSES)\s+(\S+)\s+pass=(\d+) fail=(\d+)/gm)].map((m) => ({ state: m[1], file: m[2], pass: Number(m[3]), fail: Number(m[4]) }));
    const failed = rows.filter((x) => x.state === 'FAIL'), known = rows.filter((x) => x.state === 'KNOWN').length;
    const passed = rows.reduce((n, x) => n + x.pass, 0);
    if (!rows.length) items.push(item('bad', 'เทสต์อัตโนมัติ: รันไม่สำเร็จ', [firstLines(r.out, 4)]));
    else items.push(failed.length
      ? item('bad', `เทสต์อัตโนมัติ: ไม่ผ่าน ${failed.length} จาก ${rows.length} ไฟล์`, failed.map((x) => `${x.file} (ไม่ผ่าน ${x.fail} ข้อ)`))
      : item('ok', `เทสต์อัตโนมัติ: ผ่าน ${rows.length} ไฟล์ (${passed} ข้อ)${known ? ` · ล้มแบบที่รู้อยู่แล้ว ${known} ไฟล์` : ''}`));
    if (r.code === 124) items.push(item('warn', 'เทสต์บางส่วนหมดเวลา'));
  }
  const { text } = formatReport(items);
  return { model: METHOD_CODE, ms: Date.now() - t0, files: changed, tests, report: text, digest: raw.join('\n\n') };
}
