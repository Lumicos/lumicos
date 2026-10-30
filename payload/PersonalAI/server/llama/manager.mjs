// Starts, watches and stops ONE llama-server process that PersonalAI owns.
//
//   - Never stops a llama-server it did not start (e.g. one from start-llama-server.bat):
//     that one is reported as "external" and simply used.
//   - Never touches other programs on the port: if the port is busy with something
//     else, it says so and does nothing.
//   - Started with an argument array (no shell), from the configured llama.cpp folder.
//   - Output goes to a log buffer (shown in Settings → AI Models) and data/logs/llama-server.log.
//   - If the vision projector fails to load, it can retry once without it (text only)
//     and says clearly that vision is off.
import { spawn, execFile } from 'node:child_process';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import net from 'node:net';
import path from 'node:path';
import { deflateSync } from 'node:zlib';
import { checkLlamaDir } from './modelConfig.mjs';
import { rocm10Environment } from '../voice/rocmVoiceBackends.mjs';

const MAX_LOG_LINES = 1500;
const READY_TIMEOUT_MS = 5 * 60 * 1000;

const PATTERNS = {
  mmproj: /failed to load (?:the )?(?:mmproj|multimodal|vision)|clip_(?:model_)?(?:init|load).*(?:fail|error)|mtmd.*(?:fail|error)|error.*mmproj/i,
  oom: /out of (?:device )?memory|ErrorOutOfDeviceMemory|failed to allocate|unable to allocate|vk::.*OutOfDeviceMemory|cudaMalloc failed/i,
  template: /outdated gemma4 chat template|chat template.*(?:outdated|compatibility workarounds)/i,
  badArg: /error: (?:unknown|invalid) argument|unrecognized option/i,
  portBusy: /couldn't bind|address already in use|failed to listen/i,
  modelLoad: /failed to load model|error loading model|llama_model_load.*error/i,
};

const err = (message, status = 400, code = 'LLAMA') => Object.assign(new Error(message), { status, code });

/** Is something listening on 127.0.0.1:port? */
export function portInUse(port) {
  return new Promise((resolve) => {
    const srv = net.createServer();
    srv.once('error', (e) => resolve(e.code === 'EADDRINUSE' || e.code === 'EACCES'));
    srv.once('listening', () => srv.close(() => resolve(false)));
    srv.listen(port, '127.0.0.1');
  });
}

async function getJson(url, ms = 2000) {
  const res = await fetch(url, { signal: AbortSignal.timeout(ms) });
  let body = null;
  try {
    body = await res.json();
  } catch {
    /* not JSON */
  }
  return { status: res.status, body };
}

/** What answers on the port: 'free' | 'llama' (ready) | 'llama-loading' | 'other'. */
export async function probePort(port) {
  if (!(await portInUse(port))) return { kind: 'free' };
  try {
    const h = await getJson(`http://127.0.0.1:${port}/health`);
    if (h.status === 200 && h.body && (h.body.status === 'ok' || 'slots_idle' in h.body)) {
      const props = await getJson(`http://127.0.0.1:${port}/props`).catch(() => null);
      return { kind: 'llama', props: props?.body ?? null };
    }
    if (h.status === 503 && h.body?.error) return { kind: 'llama-loading' };
  } catch {
    /* not HTTP, or slow */
  }
  return { kind: 'other' };
}

/** Process name for a PID (to confirm a PID from an earlier session is really llama-server). */
function processName(pid) {
  return new Promise((resolve) => {
    if (process.platform === 'win32') {
      execFile('tasklist', ['/FI', `PID eq ${pid}`, '/FO', 'CSV', '/NH'], { windowsHide: true }, (e, out) => {
        resolve(e ? null : (/^"([^"]+)"/.exec(String(out).trim())?.[1] ?? null));
      });
    } else {
      fsp.readFile(`/proc/${pid}/cmdline`, 'utf8').then(
        (s) => resolve(path.basename(s.split('\0')[0] || '') || null),
        () => resolve(null),
      );
    }
  });
}

/* ---------------- a tiny PNG for the vision test (no image library) ---------------- */
const CRC = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
const crc32 = (buf) => {
  let c = 0xffffffff;
  for (const b of buf) c = CRC[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
};
function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type, 'latin1'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
}
/** 128×64 PNG: left half red, right half blue. */
export function testPng(w = 128, h = 64) {
  const raw = Buffer.alloc((w * 3 + 1) * h);
  for (let y = 0; y < h; y++) {
    const row = y * (w * 3 + 1);
    raw[row] = 0;
    for (let x = 0; x < w; x++) {
      const o = row + 1 + x * 3;
      if (x < w / 2) raw.set([220, 30, 30], o);
      else raw.set([30, 60, 220], o);
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8;
  ihdr[9] = 2;
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
}

export class LlamaManager {
  /**
   * @param {{ store: import('./modelConfig.mjs').ModelConfigStore, logDir: string, pidFile: string }} opts
   */
  constructor({ store, logDir, pidFile }) {
    this.store = store;
    this.logDir = logDir;
    this.pidFile = pidFile;
    this.child = null;
    this.lines = [];
    this.seq = 0;
    this.state = { phase: 'stopped' };
    this.logStream = null;
    this.flags = {};
  }

  log(line, source = 'llama') {
    if(source==='llama' && this.state.phase!=='starting' && !/prompt eval time|eval time\s*=|total time\s*=/.test(String(line)))return;
    const text = String(line).slice(0, 2000);
    this.seq++;
    this.lines.push({ n: this.seq, t: new Date().toISOString(), source, text });
    if (this.lines.length > MAX_LOG_LINES) this.lines.splice(0, this.lines.length - MAX_LOG_LINES);
    this.logStream?.write(`${new Date().toISOString()} [${source}] ${text}\n`);
    for (const [k, re] of Object.entries(PATTERNS)) if (re.test(text)) this.flags[k] = text;
  }

  logs(since = 0) {
    return { lines: this.lines.filter((l) => l.n > since), last: this.seq };
  }

  /** Current status, including what is on the port right now. */
  async status() {
    const cfg = this.store.get();
    const port = cfg.port;
    const owned = !!this.child && this.child.exitCode === null && this.child.signalCode === null;
    let probe = null;
    if (!owned || this.state.phase === 'running') probe = await probePort(port);
    let phase = this.state.phase;
    if (!owned && (phase !== 'failed' || probe?.kind === 'llama')) {
      phase = probe?.kind === 'llama' ? 'external' : probe?.kind === 'llama-loading' ? 'external-loading' : probe?.kind === 'other' ? 'port-busy' : 'stopped';
    }
    const model = this.state.model ?? null;
    return {
      phase,
      owned,
      pid: owned ? this.child.pid : this.state.previousPid ?? null,
      port,
      url: `http://127.0.0.1:${port}`,
      model: model ? { id: model.id, name: model.name, path: model.path, mmproj: model.mmproj, ctx: model.ctx, ngl: model.ngl } : null,
      visionRequested: !!this.state.visionRequested,
      visionLoaded: owned ? !!this.state.visionLoaded : probe?.props?.modalities?.vision ?? null,
      startedAt: this.state.startedAt ?? null,
      readyAt: this.state.readyAt ?? null,
      error: this.state.error ?? null,
      hint: this.state.hint ?? null,
      warnings: this.state.warnings ?? [],
      previousSession: !!this.state.previousPid && !owned,
      externalModel: !owned ? (probe?.props?.model_path ?? null) : null,
      autoStart: cfg.autoStart,
      selectedId: cfg.selectedId,
    };
  }

  /** On service start: notice a llama-server we started in an EARLIER session (pid file). */
  async recoverPreviousSession() {
    const prev = await fsp.readFile(this.pidFile, 'utf8').then(JSON.parse, () => null);
    if (!prev?.pid) return;
    const name = await processName(prev.pid);
    const probe = await probePort(prev.port ?? this.store.get().port);
    // Never adopt it as "ours": Windows reuses PIDs, so the number may now belong to a
    // llama-server the user started by hand. It is treated like any external server
    // (used, never stopped by PersonalAI).
    if (name && /^llama-server(\.exe)?$/i.test(name) && probe.kind.startsWith('llama')) {
      this.log(`A llama-server is running on the port (possibly left over from an earlier PersonalAI session, PID ${prev.pid}). PersonalAI will use it but not stop it; close it from Task Manager if you want PersonalAI to start its own.`, 'manager');
    }
    await fsp.rm(this.pidFile, { force: true }).catch(() => {});
  }

  /** One start at a time: a second Start (double-click, auto-start still loading) gets 409 instead of a second server. */
  async start(opts = {}) {
    if (this.starting) throw err('llama-server is already starting. Wait for it to finish.', 409, 'BUSY');
    this.starting = true;
    this.cancelStart = false;
    try {
      return await this.startLocked(opts);
    } finally {
      this.starting = false;
    }
  }

  async startLocked({ withVision = true, reason = 'manual' } = {}) {
    if (this.child && this.child.exitCode === null && this.child.signalCode === null) throw err('llama-server (started by PersonalAI) is already running. Use Restart to apply changes.', 409, 'ALREADY_RUNNING');
    const cfg = this.store.get();
    const model = this.store.selected();
    if (!model) throw err('No model selected. Add a model in Settings → AI Models.', 400, 'NO_MODEL');
    const { dir, exe } = await checkLlamaDir(cfg.llamaDir);
    // Re-check the files right before starting (they may have been moved).
    await this.store.checkGguf(model.path, 'Model file', { projector: false });
    if (withVision && model.mmproj) await this.store.checkGguf(model.mmproj, 'Projector (mmproj) file', { projector: true });

    const probe = await probePort(cfg.port);
    if (probe.kind === 'llama' || probe.kind === 'llama-loading') {
      throw err(
        `A llama-server that PersonalAI did not start is already running on port ${cfg.port}. PersonalAI is using it and will not stop it. To let PersonalAI manage the server, close that window (e.g. start-llama-server.bat) first.`,
        409,
        'EXTERNAL_RUNNING',
      );
    }
    if (probe.kind === 'other') {
      throw err(`Port ${cfg.port} is used by another program (not llama-server). Nothing was stopped. Choose another port in Settings → AI Models.`, 409, 'PORT_BUSY');
    }

    const args = this.store.buildArgs(model, { withVision });
    await fsp.mkdir(this.logDir, { recursive: true });
    if (this.cancelStart) throw err('Start was cancelled.', 409, 'CANCELLED');
    this.logStream?.end();
    const logFile = path.join(this.logDir, 'llama-server.log');
    // Keep the log from growing forever: over 5 MB it becomes llama-server.log.1.
    const size = await fsp.stat(logFile).then((st) => st.size, () => 0);
    if (size > 5 * 1024 * 1024) await fsp.rename(logFile, `${logFile}.1`).catch(() => {});
    this.logStream = fs.createWriteStream(logFile, { flags: 'a' });
    this.flags = {};
    this.log(`Starting (${reason}): ${exe} ${args.map((a) => (/\s/.test(a) ? `"${a}"` : a)).join(' ')}`, 'manager');

    const child = spawn(exe, args, { cwd: dir, shell: false, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'], env: rocm10Environment() });
    this.child = child;
    this.state = {
      phase: 'starting',
      model,
      visionRequested: withVision && !!model.mmproj,
      visionLoaded: false,
      startedAt: new Date().toISOString(),
      warnings: withVision || !model.mmproj ? [] : ['Vision is OFF for this run: the projector (mmproj) is not loaded.'],
    };
    // Lines can be split across chunks; keep the unfinished tail so error patterns still match.
    const lineReader = () => {
      let tail = '';
      const onData = (buf) => {
        const parts = (tail + buf.toString('utf8')).split(/\r?\n/);
        tail = parts.pop() ?? '';
        for (const l of parts) if (l.trim()) this.log(l);
      };
      onData.flush = () => {
        if (tail.trim()) this.log(tail);
        tail = '';
      };
      return onData;
    };
    const outReader = lineReader();
    const errReader = lineReader();
    child.stdout.on('data', outReader);
    child.stderr.on('data', errReader);
    child.once('close', () => {
      outReader.flush();
      errReader.flush();
    });
    await fsp.writeFile(this.pidFile, JSON.stringify({ pid: child.pid, port: cfg.port, startedAt: this.state.startedAt })).catch(() => {});

    const exited = new Promise((resolve) => {
      child.once('error', (e) => {
        this.log(`Could not start: ${e.message}`, 'manager');
        resolve({ code: -1, error: e });
      });
      child.once('exit', (code, signal) => resolve({ code, signal }));
    });
    exited.then(({ code, signal }) => {
      if (this.child !== child) return;
      fsp.rm(this.pidFile, { force: true }).catch(() => {});
      if (this.state.phase === 'stopping' || this.state.phase === 'stopped') {
        this.state = { phase: 'stopped' };
        this.log(`llama-server stopped (${signal ?? code}).`, 'manager');
        return;
      }
      this.state = { ...this.state, phase: 'failed', ...this.explain(code, signal) };
      this.log(`llama-server exited unexpectedly (${signal ?? code}). ${this.state.error}`, 'manager');
    });

    const ready = await this.waitReady(cfg.port, exited);
    if (ready.ok) {
      const props = await getJson(`http://127.0.0.1:${cfg.port}/props`).catch(() => null);
      const vision = props?.body?.modalities?.vision;
      const warnings = [...this.state.warnings];
      if (this.flags.template) warnings.push('llama.cpp reports an outdated Gemma 4 chat template in the GGUF and applies its own compatibility fixes. This is only a warning; tool calls still go through PersonalAI\'s parser. Optional: set an updated .jinja template for this model.');
      this.state = {
        ...this.state,
        phase: 'running',
        readyAt: new Date().toISOString(),
        visionLoaded: typeof vision === 'boolean' ? vision : this.state.visionRequested,
        warnings,
      };
      this.log(`Ready on http://127.0.0.1:${cfg.port}${this.state.visionLoaded ? ' (vision on)' : ''}.`, 'manager');
      return this.status();
    }

    // Failed. If the projector was the problem, retry once without it.
    if (withVision && model.mmproj && this.flags.mmproj && !this.flags.oom && cfg.retryWithoutVision) {
      this.log('The vision projector failed to load; retrying once WITHOUT vision (text only).', 'manager');
      const firstError = this.flags.mmproj;
      await this.stopChild();
      const st = await this.startLocked({ withVision: false, reason: 'retry without vision' });
      this.state.warnings = [`Vision is OFF: the projector failed to load (${firstError.slice(0, 200)}). Text chat works. Check that the mmproj file belongs to this model.`];
      return { ...st, warnings: this.state.warnings };
    }
    if (!ready.exited) await this.stopChild();
    throw err(this.state.error ?? 'llama-server did not become ready.', 500, 'START_FAILED');
  }

  explain(code, signal) {
    const f = this.flags ?? {};
    if (f.oom) return { error: 'Not enough GPU memory (VRAM).', hint: 'Try the "Low VRAM" preset (context 4096), turn vision off, or lower GPU layers ("Safe fallback").' };
    if (f.mmproj) return { error: `The vision projector (mmproj) failed to load: ${f.mmproj.slice(0, 200)}`, hint: 'Check that the mmproj file matches the model, or start without vision.' };
    if (f.portBusy) return { error: 'llama-server could not use the port.', hint: 'Another program is using it. Choose another port.' };
    if (f.badArg) return { error: `llama-server rejected an option: ${f.badArg.slice(0, 200)}`, hint: 'Your llama.cpp build may be older; check its --help. Remove the chat template file if you set one.' };
    if (f.modelLoad) return { error: `The model failed to load: ${f.modelLoad.slice(0, 200)}`, hint: 'The file may be damaged or need a newer llama.cpp build.' };
    return { error: `llama-server stopped with ${signal ?? `exit code ${code}`}.`, hint: 'See the log below for details.' };
  }

  async waitReady(port, exited) {
    const until = Date.now() + READY_TIMEOUT_MS;
    let done = null;
    exited.then((r) => (done = r));
    while (Date.now() < until) {
      if (done) return { ok: false, exited: true };
      try {
        const h = await getJson(`http://127.0.0.1:${port}/health`, 1500);
        if (h.status === 200) return { ok: true };
      } catch {
        /* not listening yet */
      }
      await new Promise((r) => setTimeout(r, 700));
    }
    this.state = { ...this.state, error: 'llama-server did not become ready within 5 minutes.', hint: 'See the log. A very large model may need longer.' };
    return { ok: false, exited: false };
  }

  async stopChild() {
    const child = this.child;
    if (!child || child.exitCode !== null || child.signalCode !== null) return;
    const gone = new Promise((r) => child.once('exit', r));
    child.kill();
    const t = setTimeout(() => child.exitCode === null && child.signalCode === null && child.kill('SIGKILL'), 5000);
    await gone;
    clearTimeout(t);
  }

  /** Stops ONLY a process PersonalAI started (this session, or a verified earlier one). */
  async stop() {
    if (this.child && this.child.exitCode === null && this.child.signalCode === null) {
      this.state = { ...this.state, phase: 'stopping' };
      await this.stopChild();
      this.state = { phase: 'stopped' };
      return this.status();
    }
    if (this.starting) {
      // Stop pressed while a start is still checking files: cancel it before it spawns.
      this.cancelStart = true;
      this.state = { phase: 'stopped' };
      return this.status();
    }
    const probe = await probePort(this.store.get().port);
    if (probe.kind.startsWith('llama')) throw err('This llama-server was not started by PersonalAI, so PersonalAI will not stop it. Close its own window instead.', 409, 'NOT_OWNED');
    this.state = { phase: 'stopped' };
    return this.status();
  }

  async restart() {
    if (this.starting) throw err('llama-server is already starting. Wait for it to finish.', 409, 'BUSY');
    if (this.child && this.child.exitCode === null && this.child.signalCode === null) await this.stop();
    return this.start({ reason: 'restart' });
  }

  /** Synchronous last-chance cleanup when the service exits. */
  killOwnedSync() {
    if (this.child && this.child.exitCode === null && this.child.signalCode === null) {
      try {
        this.child.kill();
      } catch {
        /* already gone */
      }
      try {
        fs.rmSync(this.pidFile, { force: true });
      } catch {
        /* ignore */
      }
    }
  }

  /**
   * Real capability test against whatever llama-server is on the port.
   * Thinking is turned off for the test so the reply budget goes to the answer.
   */
  async test(kind) {
    const port = this.store.get().port;
    const probe = await probePort(port);
    if (probe.kind !== 'llama') throw err(`No ready llama-server on port ${port}.`, 409, 'NOT_RUNNING');
    const content =
      kind === 'vision'
        ? [
            { type: 'text', text: 'What two colours fill this image (left half and right half)? Answer with just the two colour names in English.' },
            { type: 'image_url', image_url: { url: `data:image/png;base64,${testPng().toString('base64')}` } },
          ]
        : 'Reply with exactly one word: ready';
    const started = Date.now();
    const res = await fetch(`http://127.0.0.1:${port}/v1/chat/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      signal: AbortSignal.timeout(120_000),
      body: JSON.stringify({ messages: [{ role: 'user', content }], max_tokens: 512, temperature: 0, stream: false, chat_template_kwargs: { enable_thinking: false } }),
    });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) {
      const msg = body?.error?.message ?? `HTTP ${res.status}`;
      return { kind, pass: false, answer: '', detail: /image|mmproj|multimodal/i.test(msg) ? `This server cannot read images: ${msg}` : msg, ms: Date.now() - started };
    }
    const choice = body.choices?.[0];
    const answer = String(choice?.message?.content ?? '').trim();
    const reasoning = String(choice?.message?.reasoning_content ?? '');
    let pass;
    let detail;
    if (!answer) {
      pass = false;
      detail = choice?.finish_reason === 'length' ? `No answer: the reply budget was used up${reasoning ? ' by thinking' : ''}.` : 'The model returned an empty answer.';
    } else if (kind === 'vision') {
      const a = answer.toLowerCase();
      pass = /red|แดง/.test(a) && /blue|น้ำเงิน|ฟ้า/.test(a);
      detail = pass ? 'The model saw the test image correctly.' : 'The model answered, but not with red and blue — vision may not be working.';
    } else {
      pass = true;
      detail = 'Text generation works.';
    }
    return { kind, pass, answer: answer.slice(0, 300), detail, ms: Date.now() - started, tokensPerSecond: body.timings?.predicted_per_second ?? null };
  }
}
