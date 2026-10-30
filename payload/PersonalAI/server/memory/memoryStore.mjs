// Long-term memory persistence.
// MemoryStore is the interface; JsonMemoryStore keeps everything in one JSON file
// (data/memory.json) with atomic writes. A SqliteMemoryStore can replace it later
// without touching the retriever, the API or the UI.
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';

export const MEMORY_TYPES = ['user_fact', 'preference', 'project', 'decision', 'instruction', 'relationship', 'general'];

export class MemoryError extends Error {
  constructor(message, status = 400) {
    super(message);
    this.status = status;
    this.code = 'MEMORY_ERROR';
  }
}

/**
 * @typedef {Object} Memory
 * @property {string} id
 * @property {string} type            one of MEMORY_TYPES
 * @property {string} content
 * @property {string[]} tags
 * @property {number} importance      1 (low) – 5 (high)
 * @property {boolean} pinned         always considered for the prompt
 * @property {string} createdAt       ISO date
 * @property {string} updatedAt
 * @property {string|null} sourceConversationId
 * @property {string|null} sourceConversationTitle
 * @property {string|null} characterId   null = shared by all characters
 * @property {number} useCount
 * @property {string|null} lastUsedAt
 */

function clean(input, existing) {
  const now = new Date().toISOString();
  const content = String(input.content ?? existing?.content ?? '').trim();
  if (!content) throw new MemoryError('Memory content is required.');
  if (content.length > 1000) throw new MemoryError('Memory content is too long (max 1000 characters).');
  const type = input.type ?? existing?.type ?? 'general';
  if (!MEMORY_TYPES.includes(type)) throw new MemoryError(`Unknown memory type "${type}". Use: ${MEMORY_TYPES.join(', ')}.`);
  const importance = Math.round(Number(input.importance ?? existing?.importance ?? 3));
  const tags = (Array.isArray(input.tags) ? input.tags : existing?.tags ?? [])
    .map((t) => String(t).trim().toLowerCase())
    .filter(Boolean)
    .slice(0, 12);
  return {
    id: existing?.id ?? randomUUID(),
    type,
    content,
    tags: [...new Set(tags)],
    importance: Math.min(5, Math.max(1, Number.isFinite(importance) ? importance : 3)),
    pinned: Boolean(input.pinned ?? existing?.pinned ?? false),
    createdAt: existing?.createdAt ?? now,
    updatedAt: now,
    sourceConversationId: input.sourceConversationId ?? existing?.sourceConversationId ?? null,
    sourceConversationTitle: input.sourceConversationTitle ?? existing?.sourceConversationTitle ?? null,
    characterId: input.characterId === undefined ? (existing?.characterId ?? null) : input.characterId || null,
    useCount: existing?.useCount ?? 0,
    lastUsedAt: existing?.lastUsedAt ?? null,
  };
}

export class JsonMemoryStore {
  /** @param {string} file absolute path to memory.json */
  constructor(file) {
    this.file = file;
    this.queue = Promise.resolve();
    /** @type {Memory[]} */
    this.items = [];
    this.#load();
  }

  #load() {
    if (!fs.existsSync(this.file)) return;
    try {
      const data = JSON.parse(fs.readFileSync(this.file, 'utf8'));
      const list = Array.isArray(data) ? data : data.memories;
      this.items = (list ?? []).flatMap((m) => {
        try {
          return [{ ...clean(m, m), updatedAt: m.updatedAt ?? m.createdAt }];
        } catch {
          return [];
        }
      });
    } catch (e) {
      // Never lose data silently: keep the unreadable file aside.
      const aside = `${this.file}.corrupt-${Date.now()}`;
      fs.copyFileSync(this.file, aside);
      console.error(`[memory] Could not read ${this.file} (${e.message}). A copy was saved as ${aside}.`);
    }
  }

  /** Serialised, atomic write (temp file + rename). */
  #persist() {
    this.queue = this.queue.then(async () => {
      await fsp.mkdir(path.dirname(this.file), { recursive: true });
      const tmp = `${this.file}.tmp`;
      await fsp.writeFile(tmp, JSON.stringify({ version: 1, memories: this.items }, null, 2));
      await fsp.rename(tmp, this.file);
    });
    return this.queue;
  }

  async list() {
    return [...this.items];
  }

  /** One-time agent split: memories that belong to nobody (shared) are handed to one agent. Returns how many moved. */
  async assignUnscoped(characterId) {
    let moved = 0;
    this.items = this.items.map((m) => (m.characterId ? m : (moved++, { ...m, characterId })));
    if (moved) await this.#persist();
    return moved;
  }

  async get(id) {
    const m = this.items.find((x) => x.id === id);
    if (!m) throw new MemoryError('Memory not found.', 404);
    return m;
  }

  async create(input) {
    const m = clean(input);
    this.items.push(m);
    await this.#persist();
    return m;
  }

  async update(id, patch) {
    const idx = this.items.findIndex((x) => x.id === id);
    if (idx < 0) throw new MemoryError('Memory not found.', 404);
    const m = clean({ ...patch, id }, this.items[idx]);
    this.items[idx] = m;
    await this.#persist();
    return m;
  }

  async remove(id) {
    const before = this.items.length;
    this.items = this.items.filter((x) => x.id !== id);
    if (this.items.length === before) throw new MemoryError('Memory not found.', 404);
    await this.#persist();
    return { id };
  }

  /** Records that memories were injected into a prompt (for sorting / debugging). */
  async markUsed(ids) {
    const now = new Date().toISOString();
    let changed = false;
    for (const m of this.items) {
      if (ids.includes(m.id)) {
        m.useCount = (m.useCount ?? 0) + 1;
        m.lastUsedAt = now;
        changed = true;
      }
    }
    if (changed) await this.#persist();
  }

  /** Waits for pending writes (tests / shutdown). */
  flush() {
    return this.queue;
  }
}
