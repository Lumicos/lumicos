import { citationEvidence } from './citations.mjs';
import { extractSearchConstraints, validateWebResults, evidenceScopeNote } from '../web/queryRewrite.mjs';

const clean = (value, max = 4000) => String(value ?? '').replaceAll('\0', '').replace(/\r\n/g, '\n').trim().slice(0, max);

function abortPromise(signal) {
  return new Promise((_, reject) => {
    if (signal.aborted) reject(signal.reason);
    else signal.addEventListener('abort', () => reject(signal.reason), { once: true });
  });
}

const FACT_QUESTION = /(ใคร|อะไร|เท่าไ[รห]|กี่|เมื่อไ[รห]|ที่ไหน|ยังไง|อย่างไร|ไหม|มั้ย|\?|who|what|when|where|which|how many|how much)/iu;
const RECENT = /(20[2-3]\d|25[6-7]\d|ปีนี้|ปีที่แล้ว|ปีล่าสุด|ล่าสุด|ปัจจุบัน|this year|last year|latest|current)/iu;
const EXPLICIT_WEB_REQUEST = /((?:ค้น|หา|เช็ก|เช็ค|ดู|เสิร์ช)\S{0,8}?(?:ใน|จาก|บน|ทาง)?\s*(?:เว็บ|เน็ต(?!ฟลิกซ์|ฟลิก)|อินเทอร์เน็ต|อินเตอร์เน็ต|ออนไลน์|กูเกิล|google)|เว็บ\s*เสิร์ช|เสิร์ช(?:เว็บ|หา|ดู|ให้)|ใช้\s*(?:web_search|เว็บ)|web\s*search|search\s+(?:the\s+)?(?:web|internet|online)|look\s+(?:it\s+)?up\s+online|google\s+it|browse\s+(?:the\s+)?web)/iu;

// "ดูในคลัง มีอะไรบ้าง": the user wants the contents of the library, not a keyword match inside it.
const LIST_REQUEST = /(อะไรบ้าง|มีอะไร|เรื่องอะไร|เรื่องไหน|รายการ|ทั้งหมด|\blist\b|what (?:notes|files|documents|do you have))/iu;
/** Short, grouped list of what the library holds (folder → titles without date prefix/extension), bounded for the prompt. */
export function libraryListing(library, max = 1800) {
  const docs = (library?.status?.()?.documents ?? []).filter((d) => d.status === 'ready');
  if (!docs.length) return '';
  const groups = new Map();
  for (const d of docs) {
    const parts = String(d.name).split(/[\\/]/), file = parts.pop() ?? '', folder = parts[0] || '(root)';
    const title = file.replace(/\.[a-z0-9]+$/i, '').replace(/^\d{4}-\d{2}-\d{2}-/, '');
    (groups.get(folder) ?? groups.set(folder, []).get(folder)).push(title);
  }
  let out = `[Library contents: the user asked what is in the library. It holds ${docs.length} documents. Answer from this list (group or summarize it, do not read it out line by line); do not say it is empty and do not search the web.\n`;
  for (const [folder, titles] of groups) out += `- ${folder} (${titles.length}): ${titles.join('; ')}\n`;
  return (out.length > max ? out.slice(0, max) + '…' : out) + ']';
}

export class KnowledgeChatIntegration {
  constructor({ router, executor, compatibility, library = null, timeoutMs = 6000, maxEvidenceChars = 12000 } = {}) {
    Object.assign(this, { router, executor, compatibility, library, timeoutMs, maxEvidenceChars });
  }

  async prepare(input = {}) {
    const config = input.settings?.knowledge;
    if (!config || !input.query?.trim()) return null;
    const searchMode = config.webEnabled === false ? 'OFF' : ['AUTO', 'ON', 'OFF'].includes(config.searchMode)
      ? config.searchMode
      : (config.webEnabled === true ? 'AUTO' : 'OFF');
    // Files in workspace/knowledge switch local knowledge on by themselves (empty folder = off).
    const libraryOn = this.library?.hasDocuments?.() === true;
    const localOn = config.enabled === true || libraryOn;
    // An explicit instruction in this turn is a one-shot override of a stale OFF setting.
    // Privacy mode and an explicit "do not search" instruction are still enforced by the router.
    const explicitWebRequest = EXPLICIT_WEB_REQUEST.test(input.query);
    if (!localOn && searchMode === 'OFF' && !explicitWebRequest) return null;
    const started = performance.now();
    let decision = this.router.route({ query: input.query, override: config.route ?? 'AUTO',
      private: input.private === true, anonymous: input.anonymous === true, context: input.routeContext });
    if (libraryOn && config.route !== 'DIRECT' && !decision.blocked) {
      // Ordinary questions quietly check the notes; the library only returns clearly matching chunks.
      if (decision.route === 'DIRECT' && decision.reason === 'no-knowledge-signal') decision = { ...decision, route: 'LOCAL', reason: 'auto-knowledge' };
      // A web turn stays web-only: mixing old library notes into current-events answers is what produced wrong facts.
    }
    if (!localOn && ['LOCAL', 'MEMORY'].includes(decision.route)) {
      decision = { ...decision, route: 'DIRECT', reason: 'knowledge-disabled' };
    } else if (!localOn && decision.route === 'HYBRID') {
      decision = { ...decision, route: 'WEB', reason: 'knowledge-disabled-web-only' };
    }
    if (searchMode === 'ON' && decision.route === 'DIRECT' &&
        !['direct-pattern', 'roleplay-no-search', 'explicit-no-web', 'privacy-mode', 'text-task-no-search', 'unit-conversion', 'clock', 'date-time', 'attached-file'].includes(decision.reason)) {
      decision = { ...decision, route: 'WEB', reason: 'search-mode-on' };
    }
    if (decision.route === 'DIRECT' || decision.blocked) return { decision, evidence: '', citations: [],
      compatibility: null, diagnostics: { route: 'DIRECT', elapsedMs: Math.round(performance.now() - started), evidenceCount: 0 } };
    const explicitWebDecision = explicitWebRequest && ['explicit-web-request', 'explicit-url-fetch'].includes(decision.reason);
    if (searchMode === 'OFF' && decision.route === 'WEB' && !explicitWebDecision) {
      decision = { ...decision, route: 'DIRECT', reason: 'web-disabled' };
      return { decision, evidence: '', citations: [], compatibility: null,
        diagnostics: { route: 'DIRECT', reason: 'web-disabled', elapsedMs: Math.round(performance.now() - started), evidenceCount: 0 } };
    }
    if (searchMode === 'OFF' && decision.route === 'HYBRID' && !explicitWebRequest) {
      decision = { ...decision, route: 'LOCAL', reason: 'web-disabled-local-fallback' };
    }

    const capability = await this.compatibility.forKnowledge(input.modelId ?? '', { preferTools: false, preferStructured: true });
    const requestedTimeoutMs = config.timeoutMs ?? this.timeoutMs;
    // Explicit searches deserve enough time for Search v6's multi-page research even when
    // an older browser has the former 10-second value persisted in its settings.
    const effectiveTimeoutMs = ['explicit-web-request', 'explicit-url-fetch'].includes(decision.reason)
      ? Math.max(25000, requestedTimeoutMs)
      : ['WEB', 'HYBRID'].includes(decision.route)
        ? Math.max(18000, requestedTimeoutMs) // an old 6 s setting cut Search v6 off before it finished
        : requestedTimeoutMs;
    const deadline = AbortSignal.any([...(input.signal ? [input.signal] : []), AbortSignal.timeout(effectiveTimeoutMs)]);
    try {
      if (['WEB', 'HYBRID'].includes(decision.route)) input.onStatus?.('searching');
      const execContext = { signal: deadline,
        timeoutMs: effectiveTimeoutMs, private: input.private, anonymous: input.anonymous,
        workspaceId: input.workspaceId ?? 'default', characterId: input.characterId ?? null,
        localContext: input.previousUserText && input.query.trim().length < 80 ? String(input.previousUserText).slice(-300) : '',
        limit: config.limit ?? 6, containsMemory: false, containsLocalContent: false };
      let result = await Promise.race([this.executor.execute(decision, execContext), abortPromise(deadline)]);
      // Nothing in the notes for a question that needs facts ("ค้นใน RAG…", "…ปี 2026"): look it up on the web instead.
      if (decision.route === 'LOCAL' && !(result.local?.length) && searchMode !== 'OFF' && !input.private && !input.anonymous
          && decision.reason !== 'explicit-local-request'
          && (decision.reason === 'local-reference' || (FACT_QUESTION.test(input.query) && RECENT.test(input.query)))) {
        decision = { ...decision, route: 'WEB', reason: 'knowledge-miss-web' };
        input.onStatus?.('searching');
        // The web step gets its own web-sized budget; the LOCAL deadline (often 6 s) cut Search v6 off.
        const webDeadline = AbortSignal.any([...(input.signal ? [input.signal] : []), AbortSignal.timeout(18000)]);
        result = await Promise.race([this.executor.execute(decision, { ...execContext, signal: webDeadline, timeoutMs: 18000 }), abortPromise(webDeadline)]);
      }
      // Check each web result against the market/period/type the USER asked for (resolvedQuery already carries
      // inherited follow-up context with explicit corrections applied). Contradicting results are dropped;
      // results that do not say are kept as unverified leads. A URL the user gave is not second-guessed.
      let validation = null;
      if (result.web?.results?.length && decision.reason !== 'explicit-url-fetch') {
        const checked = validateWebResults(result.web.results, extractSearchConstraints(decision.resolvedQuery, { now: this.now?.() ?? Date.now() }), { now: this.now?.() ?? Date.now() });
        validation = checked.validation;
        if (validation) result = { ...result, web: { ...result.web, results: checked.results } };
      }
      const prepared = citationEvidence(result);
      const scope = validation && prepared.citations.some((c) => c.kind === 'web') ? evidenceScopeNote(validation, { now: this.now?.() ?? Date.now() }) : '';
      // "ดูในคลัง" found nothing: say so instead of letting the model fill the gap from memory or the web.
      const libraryMissing = decision.reason === 'explicit-local-request' && !(result.local?.length);
      const listing = libraryMissing && LIST_REQUEST.test(input.query) ? libraryListing(this.library) : '';
      const libraryMiss = listing || (libraryMissing
        ? `[Library search: no matching document was found for "${clean(input.query, 120)}". Tell the user it is not in the library. Quote only this request, never an earlier topic. Do not invent library content and do not search the web unless the user asks.]` : '');
      const evidence = ((libraryMiss ? libraryMiss + '\n\n' : '') + (scope ? scope + '\n\n' : '') + prepared.evidence).slice(0, config.maxEvidenceChars ?? this.maxEvidenceChars);
      const includedIds = new Set([...evidence.matchAll(/\[(E\d+)\s/g)].map((match) => match[1]));
      const citations = prepared.citations.filter((citation) => includedIds.has(citation.id));
      const evidenceCount = (result.local?.length ?? 0) + (result.memory?.length ?? 0) + (result.web?.results?.length ?? 0);
      return { decision, evidence, citations, compatibility: { validity: capability.validity,
        outputMode: capability.outputMode, toolTransport: capability.toolTransport },
        diagnostics: { ...result.diagnostics, ...(validation ? { validation: { status: validation.status, counts: validation.counts, periodOpen: validation.periodOpen, items: validation.items } } : {}),
          elapsedMs: Math.round(performance.now() - started), evidenceCount,
          citationCount: citations.length, citationCoverage: evidenceCount ? citations.length / evidenceCount : 0 } };
    } catch (error) {
      return { decision, evidence: '', citations: [], compatibility: { validity: capability.validity,
        outputMode: capability.outputMode, toolTransport: capability.toolTransport },
        diagnostics: { route: decision.route, fallback: 'DIRECT', status: input.signal?.aborted ? 'cancelled' : deadline.aborted ? 'timeout' : 'error',
          elapsedMs: Math.round(performance.now() - started), evidenceCount: 0, error: clean(error?.message, 240) } };
    }
  }
}

