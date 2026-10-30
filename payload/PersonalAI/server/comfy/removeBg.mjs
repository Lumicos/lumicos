import { fork } from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';

/** ISNet background removal on CPU (no GPU contention with ComfyUI). Model: data/models/rembg/isnet-general-use.onnx */
export function createBackgroundRemover({ dataDir, timeoutMs = 180000 } = {}) {
  const modelFile = path.join(dataDir, 'models', 'rembg', 'isnet-general-use.onnx');
  let child; const pending = new Map();
  const start = () => {
    if (child) return child;
    child = fork(fileURLToPath(new URL('./removeBgChild.mjs', import.meta.url)), [], { silent: true, windowsHide: true, env: { ...process.env, LUMICOS_REMBG_MODEL: modelFile } });
    child.on('message', m => { const p = pending.get(m.id); if (!p) return; clearTimeout(p.timer); pending.delete(m.id); m.ok ? p.resolve() : p.reject(new Error(m.error)); });
    child.on('exit', code => { for (const p of pending.values()) { clearTimeout(p.timer); p.reject(new Error(`Background remover exited (${code}).`)); } pending.clear(); child = undefined; });
    return child;
  };
  return {
    async available() { try { await fs.access(modelFile); return true; } catch { return false; } },
    async remove(bytes) {
      if (!(await this.available())) throw Object.assign(new Error('ยังไม่มีโมเดลลบพื้นหลัง (isnet-general-use.onnx)'), { status: 503 });
      const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'lumicos-rembg-')), input = path.join(dir, 'in'), output = path.join(dir, 'out.png'), id = randomUUID();
      try {
        await fs.writeFile(input, bytes);
        await new Promise((resolve, reject) => { const timer = setTimeout(() => { pending.delete(id); reject(new Error('ลบพื้นหลังนานเกินไป')); }, timeoutMs); pending.set(id, { resolve, reject, timer }); start().send({ id, input, output }); });
        return await fs.readFile(output);
      } finally { await fs.rm(dir, { recursive: true, force: true }).catch(() => {}); }
    },
    stop() { child?.kill(); },
  };
}
