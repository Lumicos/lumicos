// Lumicos Sandbox: runs model-written Python inside a Windows AppContainer + Job Object.
//
// Safety comes from the box, not from per-script approval (same idea as Claude's sandbox):
//   - AppContainer: can only touch folders granted to its SID (Lumicos workspace,
//     sandbox home/runs/user-packages). Everything else on the PC is denied.
//   - Network: internet only (internetClient). localhost, LAN and Tailnet stay blocked,
//     so code cannot reach llama-server, ComfyUI or the Lumicos API.
//   - Job Object: memory / CPU / process / time limits; everything is killed at the end.
// Setup (ACLs, LumicosSandbox.exe, sandbox.json) is done under <installRoot>/Lumicos-Sandbox (installer sandbox.ps1).
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';

/** Parent of PersonalAI: …/PersonalAI/server/sandbox → install root (or payload/ in the repo). */
export const INSTALL_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const LEGACY_SANDBOX = 'C:\\AI\\Lumicos-Sandbox';
function readInstallEnv(installRoot = INSTALL_ROOT) {
  try {
    const file = path.join(installRoot, 'environment.json');
    if (!fs.existsSync(file)) return {};
    const data = JSON.parse(fs.readFileSync(file, 'utf8').replace(/^\uFEFF/, ''));
    return data && typeof data === 'object' ? data : {};
  } catch { return {}; }
}
export function resolveSandboxRoot(env = process.env, installRoot = INSTALL_ROOT) {
  const fromEnv = env.LUMICOS_SANDBOX_ROOT || readInstallEnv(installRoot).LUMICOS_SANDBOX_ROOT;
  if (typeof fromEnv === 'string' && fromEnv.trim()) return fromEnv.trim();
  const sibling = path.join(installRoot, 'Lumicos-Sandbox');
  // Installed layout has python.exe / LumicosSandbox.exe; the shipped payload has setup sources before those steps run.
  if (
    fs.existsSync(path.join(sibling, 'bin', 'LumicosSandbox.exe'))
    || fs.existsSync(path.join(sibling, 'python', 'python.exe'))
    || fs.existsSync(path.join(sibling, 'setup', 'LumicosSandbox.cs'))
  ) return sibling;
  return LEGACY_SANDBOX;
}
export const SANDBOX_ROOT = resolveSandboxRoot();
const OUTPUT_LIMIT = 6000;   // characters of stdout+stderr returned to the model
const KEEP_RUNS = 40;        // finished run folders kept for debugging
const SCAN_LIMIT = 5000;     // max workspace files compared before/after a run

const fail = (message, code = 'SANDBOX_ERROR', status = 400) => Object.assign(new Error(message), { code, status });

function clip(text, limit) {
  if (text.length <= limit) return text;
  const head = Math.floor(limit * 0.4), tail = limit - head;
  return `${text.slice(0, head)}\n…[ตัดออก ${text.length - limit} ตัวอักษร]…\n${text.slice(-tail)}`;
}

function scan(root) {
  const seen = new Map();
  const walk = (dir) => {
    let entries;
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
    for (const e of entries) {
      if (seen.size >= SCAN_LIMIT) return;
      if (e.name.startsWith('.') || e.name === '__pycache__') continue;
      const abs = path.join(dir, e.name);
      if (e.isDirectory()) walk(abs);
      else if (e.isFile()) { try { const s = fs.statSync(abs); seen.set(abs, `${s.size}:${s.mtimeMs}`); } catch { /* raced */ } }
    }
  };
  walk(root);
  return seen;
}

export class SandboxService {
  constructor({ workspaceRoot, root = SANDBOX_ROOT } = {}) {
    this.root = root;
    this.workspaceRoot = workspaceRoot;
    this.queue = Promise.resolve();
  }

  config() {
    const file = path.join(this.root, 'sandbox.json');
    let cfg;
    try { cfg = JSON.parse(fs.readFileSync(file, 'utf8').replace(/^\uFEFF/, '')); }
    catch { throw fail('Sandbox ยังไม่ได้ติดตั้ง (ไม่พบ sandbox.json) ให้รัน setup-sandbox.ps1 ก่อน', 'SANDBOX_NOT_INSTALLED', 503); }
    return {
      timeoutSeconds: 120, maxTimeoutSeconds: 270, memoryMb: 4096, cpuPercent: 75, processes: 32, internet: true,
      ...cfg,
    };
  }

  status() {
    try {
      const cfg = this.config();
      const exe = path.join(this.root, 'bin', 'LumicosSandbox.exe');
      return { ready: process.platform === 'win32' && fs.existsSync(exe), ...cfg, exe };
    } catch (e) { return { ready: false, reason: e.message }; }
  }

  /** Runs one at a time so two runs never fight over the workspace or CPU. */
  runPython(args, signal) {
    const next = this.queue.then(() => this.#run(args, signal));
    this.queue = next.catch(() => {});
    return next;
  }

  async #run({ code, timeoutSeconds }, signal) {
    if (process.platform !== 'win32') throw fail('Sandbox ใช้ได้บน Windows เท่านั้น', 'SANDBOX_UNAVAILABLE', 503);
    if (typeof code !== 'string' || !code.trim()) throw fail('ต้องมีโค้ด Python', 'INVALID_ARGS');
    if (code.length > 200_000) throw fail('โค้ดยาวเกิน 200,000 ตัวอักษร', 'INVALID_ARGS');
    const cfg = this.config();
    const exe = path.join(this.root, 'bin', 'LumicosSandbox.exe');
    if (!fs.existsSync(exe)) throw fail('ไม่พบ LumicosSandbox.exe ให้รัน setup-sandbox.ps1 ก่อน', 'SANDBOX_NOT_INSTALLED', 503);
    const timeout = Math.min(cfg.maxTimeoutSeconds, Math.max(1, Math.round(timeoutSeconds ?? cfg.timeoutSeconds)));

    const id = `${new Date().toISOString().replace(/[:.]/g, '-')}-${randomUUID().slice(0, 8)}`;
    const runDir = path.join(this.root, 'runs', id);
    const tmpDir = path.join(runDir, 'tmp');
    fs.mkdirSync(tmpDir, { recursive: true });
    fs.writeFileSync(path.join(runDir, 'code.py'), code, 'utf8');
    const home = path.join(this.root, 'home');

    const before = scan(this.workspaceRoot);
    const argv = [
      '--sid', cfg.sid, '--exe', path.join(this.root, 'python', 'python.exe'), '--cwd', this.workspaceRoot,
      '--timeout-ms', String(timeout * 1000), '--memory-mb', String(cfg.memoryMb),
      '--cpu-percent', String(cfg.cpuPercent), '--procs', String(cfg.processes), '--net', cfg.internet ? '1' : '0',
      '--env', `TEMP=${tmpDir}`, '--env', `TMP=${tmpDir}`, '--env', `HOME=${home}`, '--env', `USERPROFILE=${home}`,
      '--env', `APPDATA=${path.join(home, 'AppData', 'Roaming')}`, '--env', `LOCALAPPDATA=${path.join(home, 'AppData', 'Local')}`,
      '--env', `MPLCONFIGDIR=${path.join(home, 'matplotlib')}`, '--env', `PYTHAINLP_DATA_DIR=${path.join(home, 'pythainlp-data')}`,
      '--env', `PIP_CACHE_DIR=${path.join(home, 'pip-cache')}`, '--env', 'PYTHONUTF8=1', '--env', 'PYTHONIOENCODING=utf-8',
      '--env', 'PYTHONDONTWRITEBYTECODE=1', '--env', 'MPLBACKEND=Agg', '--env', `LUMICOS_WORKSPACE=${this.workspaceRoot}`,
      '--', '-X', 'utf8', path.join(this.root, 'runner', 'run.py'), runDir,
    ];

    const started = Date.now();
    const supervisor = await new Promise((resolve, reject) => {
      const child = spawn(exe, argv, { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
      let out = '', err = '';
      child.stdout.on('data', d => { out += d; });
      child.stderr.on('data', d => { err += d; });
      // Killing the supervisor closes the Job handle -> KILL_ON_JOB_CLOSE ends the whole tree.
      const abort = () => child.kill();
      signal?.addEventListener('abort', abort, { once: true });
      child.on('error', reject);
      child.on('close', () => {
        signal?.removeEventListener('abort', abort);
        try { resolve(JSON.parse(out)); }
        catch { reject(fail(`Sandbox supervisor failed: ${(err || out).slice(0, 400)}`, 'SANDBOX_SUPERVISOR')); }
      });
    });
    signal?.throwIfAborted();
    if (!supervisor.started || supervisor.error) throw fail(`เริ่ม sandbox ไม่สำเร็จ: ${supervisor.error ?? 'unknown'}`, 'SANDBOX_START_FAILED', 500);

    const read = (name) => { try { return fs.readFileSync(path.join(runDir, name), 'utf8'); } catch { return ''; } };
    const stdout = read('stdout.txt'), stderr = read('stderr.txt');
    const after = scan(this.workspaceRoot);
    const rel = abs => path.relative(this.workspaceRoot, abs).replaceAll('\\', '/');
    const created = [], changed = [], deleted = [];
    for (const [abs, sig] of after) { if (!before.has(abs)) created.push(rel(abs)); else if (before.get(abs) !== sig) changed.push(rel(abs)); }
    for (const abs of before.keys()) if (!after.has(abs)) deleted.push(rel(abs));
    this.#prune();

    const exitCode = supervisor.exitCode >>> 0;
    const memoryKilled = exitCode === 0xC0000017 || /MemoryError/.test(stderr);
    return {
      exitCode, timedOut: supervisor.timedOut, memoryKilled, seconds: +((Date.now() - started) / 1000).toFixed(1),
      peakMemoryMb: Math.round((supervisor.peakMemoryBytes ?? 0) / 1048576),
      stdout: clip(stdout, OUTPUT_LIMIT), stderr: clip(stderr, Math.max(1500, OUTPUT_LIMIT - Math.min(stdout.length, OUTPUT_LIMIT))),
      files: { created: created.slice(0, 50), changed: changed.slice(0, 50), deleted: deleted.slice(0, 50) },
      runId: id, timeoutSeconds: timeout,
    };
  }

  #prune() {
    const runs = path.join(this.root, 'runs');
    try {
      const all = fs.readdirSync(runs).sort();
      for (const old of all.slice(0, Math.max(0, all.length - KEEP_RUNS))) fs.rmSync(path.join(runs, old), { recursive: true, force: true });
    } catch { /* best effort */ }
  }
}
