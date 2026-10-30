import path from 'node:path';
import { fork } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import profile from './modelProfile.json' with { type: 'json' };
import { Embedder } from './embedder.mjs';

export class TransformersEmbedder extends Embedder {
  constructor({ modelRoot, timeoutMs = 120000 } = {}) {
    super();
    this.modelRoot = path.resolve(modelRoot);
    this.timeoutMs = timeoutMs;
    this.sequence = 0;
    this.pending = new Map();
  }
  get profile() { return Object.freeze({ ...profile }); }
  start() {
    if (this.child) return;
    const childFile = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../runtime/embeddingChild.mjs');
    this.child = fork(childFile, [], { silent: true, windowsHide: true, env: { ...process.env,
      LUMICOS_EMBEDDING_MODEL_ROOT: this.modelRoot, OMP_NUM_THREADS: '4' } });
    this.child.on('message', (message) => {
      const request = this.pending.get(message.id);
      if (!request) return;
      clearTimeout(request.timer); this.pending.delete(message.id);
      if (message.ok) {
        this.lastMetrics = message.metrics; this.lastModelFile = message.modelFile;
        request.resolve(message.vectors.map((row) => Float32Array.from(row)));
      }
      else request.reject(new Error(message.error));
    });
    this.child.on('exit', (code) => {
      for (const request of this.pending.values()) request.reject(new Error(`Embedding child exited (${code}).`));
      this.pending.clear(); this.child = null;
    });
  }
  request(kind, texts) {
    this.start();
    const id = ++this.sequence;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => { this.pending.delete(id); reject(new Error('Embedding request timed out.')); }, this.timeoutMs);
      this.pending.set(id, { resolve, reject, timer });
      this.child.send({ id, kind, texts });
    });
  }
  async embedQuery(text) { return (await this.request('query', [text]))[0]; }
  embedPassages(texts) { return this.request('passage', texts); }
  async close() { if (this.child) { this.child.kill(); this.child = null; } }
}
