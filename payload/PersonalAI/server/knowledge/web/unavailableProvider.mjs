import { KnowledgeWebProvider } from './provider.mjs';

// Used only when LUMICOS_WEB_SEARCH=off.
// It preserves the generic provider/gateway boundary without falling back to
// local RAG or memory and incorrectly presenting those results as web search.
export class UnavailableWebSearchProvider extends KnowledgeWebProvider {
  get id() { return 'unavailable'; }
  async status() {
    return { ready: false, provider: null, label: 'Web search is turned off', reason: 'disabled', legacyEnabled: false };
  }
  async search() { throw Object.assign(new Error('Web search is turned off'), { code: 'WEB_SEARCH_UNAVAILABLE', status: 503 }); }
  async fetchUrl() { throw Object.assign(new Error('Web search is turned off'), { code: 'WEB_SEARCH_UNAVAILABLE', status: 503 }); }
}
