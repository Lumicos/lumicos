export class KnowledgeRouteExecutor {
  constructor({ local, memory, web }) { this.local = local; this.memory = memory; this.web = web; }
  async execute(decision, context = {}) {
    const request = { query: decision.resolvedQuery, workspaceId: context.workspaceId, limit: context.limit, targetUrl: decision.targetUrl ?? null };
    // Local notes are searched with the follow-up context ("ของปี 2026 สิ" after a World Cup question).
    const localRequest = { ...request, context: context.localContext || '', explicit: ['local-reference', 'explicit-local-request'].includes(decision.reason) };
    const diagnostics = { route: decision.route, reason: decision.reason, fallback: null };
    if (decision.blocked || decision.route === 'DIRECT') return { local: [], memory: [], web: null, diagnostics };
    if (decision.route === 'LOCAL') return { local: await this.local.search(localRequest, context), memory: [], web: null, diagnostics };
    if (decision.route === 'MEMORY') return { local: [], memory: await this.memory.search(request, context), web: null, diagnostics };
    if (decision.route === 'WEB') {
      const web = request.targetUrl
        ? await this.web.fetchUrl(request, context)
        : await this.web.search(request, context);
      if (web.diagnostics.status !== 'ok') diagnostics.fallback = 'DIRECT';
      return { local: [], memory: [], web, diagnostics };
    }
    const [localResult, webResult] = await Promise.allSettled([
      // Web gets a slightly shorter budget so a slow search cannot take the local evidence down with it.
      this.local.search(localRequest, context), this.web.search(request, { ...context, timeoutMs: Math.max(2000, (context.timeoutMs ?? 6000) - 1500) }),
    ]);
    const local = localResult.status === 'fulfilled' ? localResult.value : [];
    const web = webResult.status === 'fulfilled' ? webResult.value : { results: [], diagnostics: { status: 'error' } };
    if (localResult.status === 'rejected') diagnostics.localStatus = 'error';
    if (web.diagnostics.status !== 'ok') diagnostics.fallback = local.length ? 'LOCAL' : 'DIRECT';
    else if (localResult.status === 'rejected') diagnostics.fallback = 'WEB';
    return { local, memory: [], web, diagnostics };
  }
}

