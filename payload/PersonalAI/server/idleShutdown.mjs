// Idle auto-stop: when nobody has used Lumicos for a while and no work is running, stop everything
// (backend, web UI, llama-server, ComfyUI, voice) to free RAM and VRAM. Start again with "Start Lumicos.bat".
// "Used" = any request that changes something (POST/PUT/PATCH/DELETE), from the PC or the phone.
// Background polling does not count: GET requests, the page's POST /api/session heartbeat and the
// Image Lab ComfyUI keep-warm ping (POST /api/images/warm).
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const PASSIVE_PATHS = new Set(['/api/session', '/api/images/warm']);

export function countsAsUse(req) {
  const method = String(req.method ?? 'GET').toUpperCase();
  if (method === 'GET' || method === 'HEAD' || method === 'OPTIONS') return false;
  const pathname = String(req.url ?? '/').split('?')[0];
  return !PASSIVE_PATHS.has(pathname);
}

export function idleMinutesFromEnv(env = process.env) {
  const raw = env.LUMICOS_IDLE_STOP_MINUTES;
  if (raw === undefined || raw === '') return 30;
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? n : 0; // 0 or invalid = off
}

export function createIdleShutdown({ minutes, isBusy = () => false, onIdle, now = Date.now, log = console.log }) {
  let last = now();
  let timer = null;
  let fired = false;
  const limitMs = minutes * 60_000;
  const api = {
    get lastUse() { return last; },
    touch() { last = now(); },
    wrap(handler) {
      return (req, res) => { if (countsAsUse(req)) last = now(); return handler(req, res); };
    },
    /** One check; returns true when it decided to stop. Exposed for tests. */
    check() {
      if (fired || !(minutes > 0)) return false;
      let busy = false;
      try { busy = !!isBusy(); } catch { busy = true; }
      if (busy) { last = now(); return false; }
      if (now() - last < limitMs) return false;
      fired = true;
      log(`[idle] no use for ${minutes} min and nothing running - stopping Lumicos to free RAM/VRAM`);
      onIdle();
      return true;
    },
    start(intervalMs = 60_000) {
      if (!(minutes > 0) || timer) return api;
      timer = setInterval(() => api.check(), intervalMs);
      timer.unref?.();
      log(`[idle] auto-stop after ${minutes} min without use (LUMICOS_IDLE_STOP_MINUTES=0 turns it off)`);
      return api;
    },
    stop() { if (timer) clearInterval(timer); timer = null; },
  };
  return api;
}

/** Runs scripts/stop-lumicos.ps1 (Windows), which also ends this process as its last step.
 *  2026-10-22: after Lumicos was started by the login task, the script ran at the idle time but stopped nothing and
 *  Gemma/voice kept their RAM/VRAM all evening. So: the script's output now goes to logs/idle-stop.log, and if this
 *  process is still alive after waitMs, it shuts itself down (which also stops the llama-server, ComfyUI and voice
 *  it started; only the small web UI process is left). */
export function runStopScript(projectRoot, fallback, { platform = process.platform, spawnFn = spawn, waitMs = 90_000, log = console.log, logFile } = {}) {
  if (platform !== 'win32') return fallback?.();
  const script = path.join(projectRoot, 'scripts', 'stop-lumicos.ps1');
  let out = 'ignore';
  try {
    const file = logFile ?? path.join(projectRoot, 'logs', 'idle-stop.log');
    out = fs.openSync(file, 'a');
    fs.writeSync(out, `\n=== ${new Date().toISOString()} idle stop (pid ${process.pid})\n`);
  } catch { out = 'ignore'; }
  let done = false;
  const finish = (why) => { if (done) return; done = true; clearTimeout(guard); log(why); fallback?.(); };
  const guard = setTimeout(() => finish('[idle] the stop script did not stop Lumicos - shutting the backend down directly'), waitMs);
  try {
    const child = spawnFn('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', script],
      { detached: true, windowsHide: true, stdio: ['ignore', out, out] });
    child.on('error', (e) => finish(`[idle] could not start the stop script (${e?.message ?? e}) - shutting the backend down directly`));
    child.on('exit', (code) => log(`[idle] stop script exited (code ${code}); still running, so the backend stops itself in ${Math.round(waitMs / 1000)} s at the latest`));
    child.unref?.();
  } catch (e) { finish(`[idle] could not start the stop script (${e?.message ?? e}) - shutting the backend down directly`); }
}
