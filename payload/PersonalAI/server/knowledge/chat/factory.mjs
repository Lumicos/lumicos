import path from 'node:path';
import { SqliteKnowledgeStore } from '../storage/sqliteStore.mjs';
import { KnowledgeSourceRepository } from '../storage/sourceRepository.mjs';
import { VectorRepository } from '../storage/vectorRepository.mjs';
import { TransformersEmbedder } from '../embedding/transformersEmbedder.mjs';
import { HybridRetriever } from '../retrieval/hybridRetriever.mjs';
import { LocalRetrieverAdapter } from '../adapters/localRetrieverAdapter.mjs';
import { MemoryRetrieverAdapter } from '../adapters/memoryRetrieverAdapter.mjs';
import { DeterministicKnowledgeRouter } from '../router/router.mjs';
import { KnowledgeRouteExecutor } from '../router/executor.mjs';
import { ModelCompatibilityApi } from '../../llama/capabilities/compatibility.mjs';
import { KnowledgeChatIntegration } from './integration.mjs';

export function createKnowledgeChatIntegration({ config, memoryRetriever, webGateway, library = null }) {
  let local;
  // The knowledge library (workspace/knowledge) answers with relevance-gated chunks; the older
  // unfiltered hybrid retriever is only a fallback for callers that do not pass a library.
  const localAdapter = new LocalRetrieverAdapter({ search: async (query, options = {}) => {
    if (library) return library.search(query, { limit: Math.min(options.limit ?? 4, 4), explicit: options.explicit === true, context: options.context ?? '' });
    if (!local) {
      const store = new SqliteKnowledgeStore(path.join(config.dataDir, 'knowledge.db')); store.migrate();
      const sources = new KnowledgeSourceRepository(store); const vectors = new VectorRepository(store);
      const embedder = new TransformersEmbedder({ modelRoot: path.join(config.dataDir, 'models', 'embeddings'), timeoutMs: 6000 });
      local = { store, embedder, retriever: new HybridRetriever({ sources, vectors, embedder }) };
    }
    return local.retriever.search(query, options);
  }});
  const memory = new MemoryRetrieverAdapter(memoryRetriever);
  const executor = new KnowledgeRouteExecutor({ local: localAdapter, memory, web: webGateway });
  // Gate 5 profiles require fingerprint validation before they can be trusted. Until
  // a validated provider is wired, the compatibility API intentionally returns
  // "missing" and selects its model-agnostic plain-text fallback.
  const compatibility = new ModelCompatibilityApi(async () => ({ profile: null, validity: 'missing' }));
  const integration = new KnowledgeChatIntegration({ router: new DeterministicKnowledgeRouter(), executor, compatibility, library });
  // SearchService is shared with the server and remains owned by server/index.mjs.
  integration.close = async () => { await local?.embedder.close(); local?.store.close(); await library?.close(); };
  return integration;
}
