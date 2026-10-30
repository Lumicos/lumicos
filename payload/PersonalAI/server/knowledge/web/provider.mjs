export const WEB_RESULT_CONTRACT_VERSION = 1;

export class KnowledgeWebProvider {
  get id() { throw new Error('KnowledgeWebProvider.id is not implemented.'); }
  async status() { throw new Error('KnowledgeWebProvider.status() is not implemented.'); }
  async search(_request, _context) { throw new Error('KnowledgeWebProvider.search() is not implemented.'); }
  async close() {}
}

export function validateWebSearchRequest(input) {
  if (!input || typeof input !== 'object') throw new TypeError('Web search request must be an object.');
  const query = String(input.query ?? '').replace(/\s+/gu, ' ').trim();
  if (!query || query.length > 500) throw new RangeError('Web search query must contain 1-500 characters.');
  const limit = Number(input.limit ?? 5);
  if (!Number.isInteger(limit) || limit < 1 || limit > 10) throw new RangeError('Web search limit must be 1-10.');
  return Object.freeze({
    query,
    limit,
    workspaceId: String(input.workspaceId ?? 'default'),
    locale: input.locale == null ? null : String(input.locale),
  });
}

export function validateWebSearchResponse(input) {
  if (!input || typeof input !== 'object' || !Array.isArray(input.results)) {
    throw new TypeError('Web search response must contain a results array.');
  }
  return {
    contractVersion: WEB_RESULT_CONTRACT_VERSION,
    provider: String(input.provider ?? '').trim(),
    query: String(input.query ?? '').trim(),
    searchedAt: String(input.searchedAt ?? ''),
    cacheHit: input.cacheHit === true,
    providerDiagnostics: input.providerDiagnostics && typeof input.providerDiagnostics === 'object' ? input.providerDiagnostics : undefined,
    results: input.results.map((result, index) => {
      const url = assertSafeWebUrl(String(result.url ?? ''));
      if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) {
        throw new TypeError(`Web result ${index} has an unsafe URL.`);
      }
      return {
        id: String(result.id ?? `${index + 1}`),
        title: String(result.title ?? '').slice(0, 240),
        url: url.href,
        snippet: String(result.snippet ?? '').slice(0, 4000),
        publishedAt: result.publishedAt == null ? null : String(result.publishedAt),
        metadata: result.metadata && typeof result.metadata === 'object' ? result.metadata : {},
      };
    }).filter((result, index, results) => results.findIndex(candidate => candidate.url === result.url) === index),
  };
}

import { assertSafeWebUrl } from './urlGuard.mjs';

