import { KnowledgeWebProvider, validateWebSearchRequest, validateWebSearchResponse } from './provider.mjs';

export class ExistingWebSearchProvider extends KnowledgeWebProvider {
  constructor(searchService) { super(); this.service = searchService; }
  get id() { return 'existing-web-search-mcp'; }
  status() { return this.service.status(); }
  async search(input, context = {}) {
    const request = validateWebSearchRequest(input);
    const result = await this.service.search(request.query, Math.min(request.limit, 5), context.signal);
    return validateWebSearchResponse({ ...result, provider: this.id });
  }
  async fetchUrl(input, context = {}) {
    const url = String(input.targetUrl ?? '');
    const page = await this.service.fetchUrl(url, context.signal);

    return validateWebSearchResponse({
      provider: this.id,
      query: input.query,
      searchedAt: page.fetchedAt,
      results: [{
        id: `direct:${page.url}`,
        title: page.title,
        url: page.url,
        snippet: page.content,
        metadata: { retrievalMethod: 'direct-fetch' }
      }]
    });
  }
  close() { return this.service.close(); }
}

