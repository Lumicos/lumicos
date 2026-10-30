// MemoryRetriever: picks the few memories relevant to the current message.
// KeywordMemoryRetriever is the first implementation (BM25 over content + tags,
// with Thai word segmentation). An EmbeddingMemoryRetriever can implement the
// same `retrieve()` later; nothing else needs to change.
import { bm25Scores, tokenize } from './text.mjs';

const MIN_RAW_SCORE = 0.55;

/**
 * @typedef {{ memory: import('./memoryStore.mjs').Memory, score: number, reason: 'match' | 'pinned' }} RetrievedMemory
 */
export class KeywordMemoryRetriever {
  /** @param {import('./memoryStore.mjs').JsonMemoryStore} store */
  constructor(store) {
    this.store = store;
  }

  /**
   * @param {{ query: string, characterId?: string|null, limit?: number, maxPinned?: number }} opts
   * @returns {Promise<RetrievedMemory[]>}
   */
  async retrieve({ query, characterId = null, limit = 6, maxPinned = 3 }) {
    const all = (await this.store.list()).filter((m) => !m.characterId || m.characterId === characterId);
    if (!all.length) return [];

    // Search only user-authored memory content/tags. Type-label expansion made
    // every preference match a query containing the generic word "ชอบ", etc.
    const docs = all.map((m) => `${m.content} ${m.tags.join(' ')}`);
    const raw = bm25Scores(query ?? '', docs);
    const queryTokens = new Set(tokenize(query ?? ''));

    const scored = all.map((m, i) => {
      const documentTokens = new Set(tokenize(docs[i]));
      // Bare numbers ("5", "32", "3600") appear in every calculation and are
      // not evidence on their own: "หาร 3600 ด้วย 5" must not recall a PC spec
      // that happens to contain "Ryzen 5 3600". Model ids like "rx6600" stay.
      const overlap = [...queryTokens].filter((token) => documentTokens.has(token) && !/^[\d.,%]+$/.test(token));
      // A single shared word in a normal sentence is usually incidental
      // (for example "คอม" in a question about working at a computer). Short
      // queries may be one precise keyword; longer queries need two matching
      // concepts, unless the shared token is a distinctive model/id/number.
      const distinctive = overlap.some((token) => /[a-z]/i.test(token) && /\d/.test(token) || /^[a-z][a-z0-9._-]{4,}$/i.test(token));
      const enoughEvidence = queryTokens.size <= 2 ? overlap.length >= 1 : overlap.length >= 2 || distinctive;
      // An absolute transform preserves evidence strength. Normalising by the
      // best result made a single weak overlap score 1.0 in every query.
      const relevance = enoughEvidence && raw[i] >= MIN_RAW_SCORE ? 1 - Math.exp(-raw[i]) : 0;
      // Importance and recency only break ties after relevance is established;
      // neither can make an unrelated memory eligible.
      const ageDays = Math.max(0, (Date.now() - Date.parse(m.updatedAt || m.createdAt || 0)) / 86_400_000);
      const recency = Number.isFinite(ageDays) ? Math.exp(-ageDays / 365) : 0;
      const score = relevance > 0 ? relevance * (0.88 + m.importance * 0.02 + recency * 0.02) : 0;
      return { memory: m, score, reason: 'match' };
    });

    const pinned = scored
      .filter((s) => s.memory.pinned && s.score > 0)
      .sort((a, b) => b.score - a.score || b.memory.importance - a.memory.importance)
      .slice(0, maxPinned)
      .map((s) => ({ ...s, reason: 'pinned' }));

    const matched = scored
      .filter((s) => !s.memory.pinned && s.score > 0)
      .sort((a, b) => b.score - a.score);

    return [...pinned, ...matched].slice(0, Math.max(limit, pinned.length));
  }
}
