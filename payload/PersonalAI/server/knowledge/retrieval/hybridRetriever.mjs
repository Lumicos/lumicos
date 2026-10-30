import { vectorSearchOffThread } from './vectorSearch.mjs';

export function reciprocalRankFusion(lists, { k = 60, limit = 10 } = {}) {
  const combined = new Map();
  for (const list of lists) list.forEach((item, index) => {
    const current = combined.get(item.id ?? item.chunkId) ?? { ...item, rrfScore: 0 };
    current.rrfScore += 1 / (k + index + 1);
    combined.set(item.id ?? item.chunkId, current);
  });
  return [...combined.values()].sort((a, b) => b.rrfScore - a.rrfScore).slice(0, limit);
}

export class HybridRetriever {
  constructor({ sources, vectors, embedder }) { this.sources = sources; this.vectors = vectors; this.embedder = embedder; }
  async search(query, { workspaceId = 'default', limit = 10, candidateLimit = 50, rrfK = 60 } = {}) {
    const keyword = this.sources.search(query, { workspaceId, limit: candidateLimit }).map((row) => ({ ...row, id: row.id ?? row.chunkId }));
    const queryVector = await this.embedder.embedQuery(query);
    const profile = this.embedder.profile;
    const vector = await vectorSearchOffThread(queryVector, this.vectors.candidates(profile.id, workspaceId),
      { dimension: profile.dimension, limit: candidateLimit });
    return reciprocalRankFusion([keyword, vector], { k: rrfK, limit });
  }
}
