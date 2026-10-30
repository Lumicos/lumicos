export class EmbeddingQueue {
  constructor(repository, embedder) {
    this.repository = repository; this.embedder = embedder; this.queue = [];
    this.paused = false; this.running = false; this.cancelled = new Set();
    this.resumeWaiters = [];
    this.repository.upsertProfile(embedder.profile);
  }
  enqueue(sourceId) {
    const id = this.repository.createJob(sourceId, this.embedder.profile.id);
    const done = new Promise((resolve, reject) => this.queue.push({ id, sourceId, resolve, reject }));
    this.drain(); return { id, done };
  }
  pause() { this.paused = true; }
  resume() { this.paused = false; this.resumeWaiters.splice(0).forEach((resolve) => resolve()); this.drain(); }
  cancel(id) { this.cancelled.add(id); this.repository.setJob(id, 'cancelled'); }
  async drain() {
    if (this.running || this.paused) return;
    this.running = true;
    try {
      while (!this.paused && this.queue.length) {
        const item = this.queue.shift();
        if (this.cancelled.has(item.id)) { item.resolve({ cancelled: true }); continue; }
        try {
          this.repository.setJob(item.id, 'running');
          const chunks = this.repository.pendingChunks(item.sourceId, this.embedder.profile.id);
          let completed = 0;
          for (const chunk of chunks) {
            if (this.paused) await new Promise((resolve) => this.resumeWaiters.push(resolve));
            if (this.cancelled.has(item.id)) break;
            const [vector] = await this.embedder.embedPassages([chunk.content]);
            this.repository.put(chunk.id, this.embedder.profile.id, chunk.contentHash, vector);
            this.repository.setJob(item.id, 'running', { completed: ++completed });
          }
          const cancelled = this.cancelled.has(item.id);
          this.repository.setJob(item.id, cancelled ? 'cancelled' : 'complete', { completed });
          item.resolve({ cancelled, completed });
        } catch (error) {
          this.repository.setJob(item.id, 'error', { error: String(error?.message ?? error) }); item.reject(error);
        }
      }
    } finally { this.running = false; if (!this.paused && this.queue.length) this.drain(); }
  }
}
