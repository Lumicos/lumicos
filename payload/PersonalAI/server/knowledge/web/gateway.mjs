import { TtlSearchCache } from './cache.mjs';
import { freshnessPolicy } from './freshness.mjs';
import { assertPublicWebQuery } from './privacy.mjs';
import { validateWebSearchRequest, validateWebSearchResponse } from './provider.mjs';

function deadlineSignal(signal, timeoutMs) {
  return AbortSignal.any([...(signal ? [signal] : []), AbortSignal.timeout(timeoutMs)]);
}

function abortPromise(signal) {
  return new Promise((_, reject) => {
    if (signal.aborted) reject(signal.reason);
    else signal.addEventListener('abort', () => reject(signal.reason), { once: true });
  });
}

function rankResults(results, query) {
  const terms = [...new Set(String(query).toLocaleLowerCase().match(/[\p{L}\p{N}]{2,}/gu) ?? [])];
  const scored = results.map((result, index) => {
    const haystack = `${result.title} ${result.snippet}`.toLocaleLowerCase();
    const relevance = terms.reduce((score, term) => score + (haystack.includes(term) ? 1 : 0), 0);
    const published = Date.parse(result.publishedAt ?? '');
    let host='';let modelPage=false;try{const url=new URL(result.url);host=url.hostname.toLowerCase();modelPage=host==='huggingface.co'&&url.pathname.split('/').filter(Boolean).length===2}catch{}
    const official = modelPage ? 180 : host==='huggingface.co' ? 100 : host==='github.com' ? 35 : 0;
    return { result, index, official, score: relevance * 100 + official + (Number.isFinite(published) ? Math.max(0, 30 - (Date.now() - published) / 86_400_000) : 0) };
  });
  const ranked=scored.sort((a, b) => b.score - a.score || a.index - b.index);
  return {results:ranked.map(item => item.result),outcome:{inputCount:results.length,outputCount:ranked.length,officialCount:ranked.filter(item=>item.official>0).length,topOfficial:(ranked[0]?.official??0)>0,reordered:ranked.some((item,index)=>item.index!==index)}};
}

export class KnowledgeWebGateway {
  constructor(provider, { cache = new TtlSearchCache(), timeoutMs = 10_000, clock = () => Date.now() } = {}) {
    this.provider = provider; this.cache = cache; this.timeoutMs = timeoutMs; this.clock = clock;
  }
  async fetchUrl(input, context = {}) {
    const request = validateWebSearchRequest(input);
    assertPublicWebQuery(request.query, context);

    const targetUrl = String(input.targetUrl ?? '');
    const parsed = new URL(targetUrl);

    if (!['http:', 'https:'].includes(parsed.protocol) ||
        parsed.username || parsed.password) {
      throw new TypeError('Invalid URL for direct fetch');
    }

    const started = performance.now();
    const signal = deadlineSignal(
      context.signal,
      context.timeoutMs ?? this.timeoutMs
    );

    try {
      const response = validateWebSearchResponse(
        await Promise.race([
          this.provider.fetchUrl({
            ...request,
            targetUrl: parsed.href
          }, { ...context, signal }),
          abortPromise(signal)
        ])
      );

      return {
        ...response,
        cacheHit: false,
        diagnostics: {
          status: 'ok',
          provider: this.provider.id,
          retrievalMethod: 'direct-fetch',
          elapsedMs: Math.round(performance.now() - started)
        }
      };
    } catch (error) {
      return {
        contractVersion: 1,
        provider: this.provider.id,
        query: request.query,
        searchedAt: new Date().toISOString(),
        results: [],
        cacheHit: false,
        diagnostics: {
          status: context.signal?.aborted ? 'cancelled' :
            signal.aborted ? 'timeout' : 'offline',
          retrievalMethod: 'direct-fetch',
          error: String(error?.message ?? error)
        }
      };
    }
  }

  async search(input, context = {}) {
    const started = performance.now(); const request = validateWebSearchRequest(input);
    assertPublicWebQuery(request.query, context);
    const policy = freshnessPolicy(request.query, { now: this.clock() });
    const cached = this.cache.get(this.provider.id, request);
    if (cached) return { ...cached, cacheHit: true, diagnostics: { status: 'ok', provider: this.provider.id,
      cache: 'hit', freshnessClass: policy.class, elapsedMs: Math.round(performance.now() - started),
      engine: cached.providerDiagnostics?.engine ?? 'unknown', providerLatencyMs: 0,
      fallbackCount: cached.providerDiagnostics?.fallbackCount ?? null, providerCacheHit: true,
      queryRewritten: cached.providerDiagnostics?.rewritten === true, ranking: cached.rankingOutcome } };
    const signal = deadlineSignal(context.signal, context.timeoutMs ?? this.timeoutMs);
    try {
      const response = validateWebSearchResponse(await Promise.race([
        this.provider.search(request, { ...context, signal }), abortPromise(signal),
      ]));
      const ranked = rankResults(response.results, request.query);
      const value = { ...response, results: ranked.results, rankingOutcome: ranked.outcome, cacheHit: false };
      if (!ranked.results.length) return { ...value, diagnostics: { status: 'no_results', provider: this.provider.id,
        cache: 'miss', freshnessClass: policy.class, elapsedMs: Math.round(performance.now() - started),
        engine: response.providerDiagnostics?.engine ?? 'unknown', providerLatencyMs: response.providerDiagnostics?.providerLatencyMs ?? null,
        fallbackCount: response.providerDiagnostics?.fallbackCount ?? null, providerCacheHit: response.providerDiagnostics?.providerCacheHit ?? false,
        queryRewritten: response.providerDiagnostics?.rewritten === true, ranking: ranked.outcome } };
      this.cache.set(this.provider.id, request, value, policy.ttlMs);
      return { ...value, diagnostics: { status: 'ok', provider: this.provider.id, cache: 'miss',
        freshnessClass: policy.class, elapsedMs: Math.round(performance.now() - started),
        engine: response.providerDiagnostics?.engine ?? 'unknown', providerLatencyMs: response.providerDiagnostics?.providerLatencyMs ?? null,
        fallbackCount: response.providerDiagnostics?.fallbackCount ?? null, providerCacheHit: response.providerDiagnostics?.providerCacheHit ?? false,
        queryRewritten: response.providerDiagnostics?.rewritten === true, ranking: ranked.outcome } };
    } catch (error) {
      const cancelled = context.signal?.aborted;
      const timeout = signal.aborted && !cancelled;
      return { contractVersion: 1, provider: this.provider.id, query: request.query,
        searchedAt: new Date(this.clock()).toISOString(), cacheHit: false, results: [],
        diagnostics: { status: cancelled ? 'cancelled' : timeout ? 'timeout' : 'offline',
          provider: this.provider.id, cache: 'miss', freshnessClass: policy.class,
          elapsedMs: Math.round(performance.now() - started), error: String(error?.message ?? error) } };
    }
  }
}

