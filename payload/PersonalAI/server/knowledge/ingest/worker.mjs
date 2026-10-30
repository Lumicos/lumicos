import fs from 'node:fs/promises';
import path from 'node:path';
import { extractDocument } from './extractor.mjs';

export class DocumentIngestionWorker {
  constructor(repository, { extractor = extractDocument } = {}) {
    this.repository = repository;
    this.extractor = extractor;
    this.queue = [];
    this.running = false;
    this.paused = false;
    this.waiters = [];
    this.active = 0;
  }

  enqueue(job) {
    if (!job || typeof job !== 'object' || (!job.buffer && !job.filePath)) {
      throw new TypeError('Ingestion job requires buffer or filePath.');
    }
    return new Promise((resolve, reject) => {
      this.queue.push({ job, resolve, reject });
      this.drain();
    });
  }

  pause() { this.paused = true; }
  resume() { this.paused = false; this.drain(); }
  status() { return { paused: this.paused, active: this.active, queued: this.queue.length }; }

  async drain() {
    if (this.running || this.paused) return;
    this.running = true;
    try {
      while (!this.paused && this.queue.length) {
        const item = this.queue.shift();
        this.active = 1;
        try { item.resolve(await this.ingest(item.job)); }
        catch (error) { item.reject(error); }
        finally { this.active = 0; }
      }
    } finally {
      this.running = false;
      if (!this.queue.length && !this.active) this.waiters.splice(0).forEach((resolve) => resolve());
      if (!this.paused && this.queue.length) this.drain();
    }
  }

  idle() {
    return !this.queue.length && !this.active ? Promise.resolve() : new Promise((resolve) => this.waiters.push(resolve));
  }

  async ingest(job) {
    const buffer = job.buffer ?? await fs.readFile(job.filePath);
    const displayName = job.displayName ?? path.basename(job.filePath ?? job.sourceUri);
    const sourceUri = job.sourceUri ?? job.filePath;
    const source = this.repository.register({ workspaceId: job.workspaceId, sourceUri, displayName,
      sourceType: 'file', fileSize: buffer.length, modifiedAt: job.modifiedAt, metadata: job.sourceMetadata });
    try {
      const extracted = await this.extractor(displayName, buffer, job.options);
      if (!this.repository.needsIndex(source.id, extracted.contentHash)) {
        return { changed: false, source: this.repository.get(source.id), chunks: this.repository.chunkCount(source.id) };
      }
      this.repository.setStatus(source.id, 'indexing');
      return this.repository.replaceDocument(source.id, { contentHash: extracted.contentHash,
        chunks: extracted.chunks, metadata: { kind: extracted.kind, ...extracted.metadata },
        fileSize: buffer.length, modifiedAt: job.modifiedAt ?? null });
    } catch (error) {
      this.repository.setStatus(source.id, 'error', String(error?.message ?? error).slice(0, 1000));
      throw error;
    }
  }
}

