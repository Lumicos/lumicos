import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline';
import { Transport } from './transport.mjs';

const STDERR_RING = 100;

function killTree(child) {
  if (!child || !child.pid) return;
  const pid = child.pid;
  try {
    if (process.platform === 'win32') {
      try { child.kill(); } catch {}
      spawn('taskkill', ['/PID', String(pid), '/T', '/F'], { stdio: 'ignore', windowsHide: true });
    } else {
      try { process.kill(-pid, 'SIGTERM'); } catch { child.kill('SIGTERM'); }
      const t = setTimeout(() => {
        try { process.kill(-pid, 'SIGKILL'); } catch { try { child.kill('SIGKILL'); } catch {} }
      }, 1500);
      t.unref?.();
    }
  } catch {
    try { child.kill('SIGKILL'); } catch {}
  }
}

/** If LightCraft left a stale catalog.lock.owner from a crashed process, clear it before spawning. */
function cleanStaleLightcraftLock(command, args) {
  if (!/lightcraft-cli/i.test(String(command))) return;
  const idx = Array.isArray(args) ? args.indexOf('--library') : -1;
  const libDir = idx >= 0 ? args[idx + 1] : null;
  if (!libDir) return;
  try {
    fs.mkdirSync(libDir, { recursive: true });
    const ownerFile = path.join(libDir, 'catalog.lock.owner');
    if (!fs.existsSync(ownerFile)) return;
    const owner = JSON.parse(fs.readFileSync(ownerFile, 'utf8'));
    if (owner?.pid) {
      try {
        process.kill(owner.pid, 0);
        return; // process is genuinely alive
      } catch (e) {
        if (e.code === 'EPERM') return; // alive in another session
      }
    }
    fs.unlinkSync(ownerFile);
  } catch {}
}

export class StdioTransport extends Transport {
  constructor(opts) {
    super();
    this.command = opts.command;
    this.args = opts.args || [];
    this.env = opts.env || {};
    this.cwd = opts.cwd;
    this.child = null;
    this.rl = null;
    this.stderrLines = [];
    this._closed = false;
  }

  async start() {
    if (this.child) return;
    cleanStaleLightcraftLock(this.command, this.args);
    const env = { ...process.env, ...this.env };
    this.child = spawn(this.command, this.args, {
      stdio: ['pipe', 'pipe', 'pipe'],
      env,
      cwd: this.cwd || undefined,
      shell: false,
      windowsHide: true,
    });

    this.rl = createInterface({ input: this.child.stdout, crlfDelay: Infinity });
    this.rl.on('line', (line) => {
      const trimmed = line.trim();
      if (!trimmed) return;
      try {
        const msg = JSON.parse(trimmed);
        this._emit(msg);
      } catch (e) {
        this._emit({ _parseError: true, raw: trimmed, error: e.message });
      }
    });

    this.child.stderr.setEncoding('utf8');
    this.child.stderr.on('data', (chunk) => {
      const lines = String(chunk).split(/\r?\n/).filter(Boolean);
      this.stderrLines.push(...lines);
      if (this.stderrLines.length > STDERR_RING) {
        this.stderrLines.splice(0, this.stderrLines.length - STDERR_RING);
      }
    });

    return new Promise((resolve, reject) => {
      const onError = (err) => {
        this._closed = true;
        reject(err);
      };
      this.child.once('error', onError);
      this.child.once('spawn', () => {
        this.child.removeListener('error', onError);
        resolve();
      });
    });
  }

  async send(message) {
    if (!this.child || this._closed || !this.child.stdin.writable) {
      throw new Error('Transport not open');
    }
    const line = JSON.stringify(message) + '\n';
    return new Promise((resolve, reject) => {
      this.child.stdin.write(line, (err) => (err ? reject(err) : resolve()));
    });
  }

  async close() {
    if (this._closed) return;
    this._closed = true;
    if (this.rl) {
      try { this.rl.close(); } catch {}
    }
    const child = this.child;
    this.child = null;
    if (child) {
      const exited = child.exitCode !== null || child.signalCode !== null
        ? Promise.resolve()
        : new Promise((resolve) => {
            const timer = setTimeout(() => {
              killTree(child);
              resolve();
            }, 250);
            timer.unref?.();
            child.once('exit', () => {
              clearTimeout(timer);
              resolve();
            });
          });
      try { child.stdin.end(); } catch { killTree(child); }
      await exited;
      try { child.stdout?.destroy(); child.stderr?.destroy(); } catch {}
    }
  }

  getDiagnostics() {
    return {
      pid: this.child?.pid,
      stderr: this.stderrLines.slice(-20),
      closed: this._closed,
    };
  }
}
