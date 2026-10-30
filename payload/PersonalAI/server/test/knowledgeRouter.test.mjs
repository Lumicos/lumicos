import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { MemoryRetrieverAdapter } from '../knowledge/adapters/memoryRetrieverAdapter.mjs';
import { KnowledgeRouteExecutor } from '../knowledge/router/executor.mjs';
import { DeterministicKnowledgeRouter } from '../knowledge/router/router.mjs';
import { ExistingWebSearchProvider } from '../knowledge/web/existingProvider.mjs';
import { KnowledgeWebGateway } from '../knowledge/web/gateway.mjs';
import { QueryPrivacyError } from '../knowledge/web/privacy.mjs';
import { assertSafeWebUrl, validateRedirectChain, validateResolvedAddresses } from '../knowledge/web/urlGuard.mjs';

class MockProvider {
  constructor(handler = async (request) => ({ provider: 'mock', query: request.query,
    searchedAt: '2026-10-08T00:00:00.000Z', results: [{ title: 'Result', url: 'https://example.com/', snippet: 'Evidence' }] })) {
    this.handler = handler; this.calls = [];
  }
  get id() { return 'mock'; }
  async search(request, context) { this.calls.push(request); return this.handler(request, context); }
}

describe('deterministic knowledge router', () => {
  const router = new DeterministicKnowledgeRouter();
  const cases = [
    ['สวัสดี วันนี้เป็นยังไง', 'DIRECT'],
    ['12 * (4 + 2)', 'DIRECT'],
    ['สรุปเอกสาร PDF ที่อัปโหลด', 'LOCAL'],
    ['ข่าว AI ล่าสุดวันนี้', 'WEB'],
    ['เปรียบเทียบเอกสารในเครื่องกับข่าวล่าสุด', 'HYBRID'],
    ['จำได้ไหมว่าฉันชอบอะไร', 'MEMORY'],
    ['Please summarize the uploaded document', 'LOCAL'],
    ['What is the latest weather news?', 'WEB'],
    ['ราคา 1,250 บาท วันที่ 15 ต.ค. 2569 เวลา 07:30 เธออ่านคำนี้ให้ฟังหน่อย', 'DIRECT'],
    ['แปลประโยคนี้ ราคาเท่าไหร่', 'DIRECT'],
    ['วันนี้ไปซื้อของ ราคาแพงมากเลย ร้านค้าแถวบ้านขึ้นราคาหมดแล้ว', 'DIRECT'],
    ['อ่านข่าววันนี้ให้ฟังหน่อย', 'WEB'],
    ['ช่วยหาราคาทองล่าสุดให้หน่อย', 'WEB'],
    ['ลองหาในเน็ตดูใหม่นะ', 'WEB'],
    ['เธอลองใช้ เว็บเสิร์ชหาดู', 'WEB'],
    ['หาเนื้อเพลง Click ของ Jisoo ให้หน่อย', 'WEB'],
    ['เช็กในกูเกิลให้หน่อย', 'WEB'],
    ['เมื่อคืนดูเน็ตฟลิกซ์ทั้งคืนเลย', 'DIRECT'],
  ];
  const afterWeb = { previousQuery: 'ราคาทองวันนี้เท่าไหร่', previousRoute: 'WEB' };
  test('a bare search command searches the previous topic', () => {
    const lyric = { previousQuery: 'หาเนื้อเพลง Click ของ Jisoo ให้หน่อย', previousRoute: 'WEB' };
    for (const q of ['เธอลองใช้ เว็บเสิร์ชหาดู', 'เหมือนเนื้อเพลงจะผิดอยู่นะ ลองหาในเน็ตดูใหม่นะ']) {
      const r = router.route({ query: q, context: lyric });
      assert.equal(r.route, 'WEB'); assert.match(r.resolvedQuery, /Jisoo/);
    }
    // A search command with its own subject keeps its own query when the previous turn was not a web turn.
    const r = router.route({ query: 'ค้นเว็บเรื่องราคาทองวันนี้ให้หน่อย', context: { previousQuery: 'เล่าเรื่องตลกหน่อย', previousRoute: 'DIRECT' } });
    assert.doesNotMatch(r.resolvedQuery, /ตลก/);
  });
  for (const [query, route] of [['โอเค ขอบคุณนะ', 'DIRECT'], ['555 จริงด้วย', 'DIRECT'], ['แล้วเงินล่ะ', 'WEB']])
    test(`after a web turn: ${query} -> ${route}`, () => assert.equal(router.route({ query, context: afterWeb }).route, route));
  for (const [query, route] of cases) test(`${query} -> ${route}`, () => assert.equal(router.route({ query }).route, route));

  test('manual override wins and AUTO remains deterministic', () => {
    assert.equal(router.route({ query: 'hello', override: 'LOCAL' }).route, 'LOCAL');
    assert.equal(router.route({ query: 'ข่าวล่าสุด', override: 'AUTO' }).route, 'WEB');
  });
  test('follow-up resolves query and sticks to previous route', () => {
    const result = router.route({ query: 'แล้วเรื่องนั้นล่ะ', context: { previousQuery: 'สรุปเอกสารโครงการ', previousRoute: 'LOCAL' } });
    assert.equal(result.route, 'LOCAL'); assert.equal(result.isFollowUp, true); assert.match(result.resolvedQuery, /เอกสารโครงการ/);
  });
  test('roleplay does not browse without a real freshness request', () => {
    assert.equal(router.route({ query: 'สวมบทบาทเป็นนักบินอวกาศ' }).route, 'DIRECT');
  });
  test('explicit Thai and English web requests route once, while explicit opt-out stays DIRECT', () => {
    assert.equal(router.route({ query: 'ค้นเว็บเรื่อง local AI' }).route, 'WEB');
    assert.equal(router.route({ query: 'search the web for local AI' }).route, 'WEB');
    assert.equal(router.route({ query: 'ตอบจากความรู้เดิม ไม่ต้องค้นเว็บ' }).route, 'DIRECT');
    assert.equal(router.route({ query: 'roleplay as an astronaut' }).route, 'DIRECT');
  });
  test('private and anonymous modes always block all knowledge routes', () => {
    for (const key of ['private', 'anonymous']) {
      const result = router.route({ query: 'ค้นข่าวล่าสุดและความจำของฉัน', [key]: true });
      assert.equal(result.route, 'DIRECT'); assert.equal(result.blocked, true);
    }
  });
});

describe('web integration foundation', () => {
  test('existing MCP adapter preserves the Knowledge provider contract', async () => {
    const service = { status: async () => ({ ready: true }), close: async () => {},
      search: async (query, limit) => ({ query, searchedAt: '2026-10-08T00:00:00.000Z', cacheHit: false,
        results: [{ title: 'Existing', url: 'https://example.org/info', snippet: String(limit) }] }) };
    const provider = new ExistingWebSearchProvider(service);
    const result = await provider.search({ query: 'latest', limit: 8 });
    assert.equal(result.provider, 'existing-web-search-mcp'); assert.equal(result.results[0].snippet, '5');
  });

  test('TTL cache avoids duplicate provider calls', async () => {
    const provider = new MockProvider(); const gateway = new KnowledgeWebGateway(provider);
    const first = await gateway.search({ query: 'current release', limit: 2 });
    const second = await gateway.search({ query: 'current release', limit: 2 });
    assert.equal(provider.calls.length, 1); assert.equal(first.cacheHit, false); assert.equal(second.cacheHit, true);
  });

  test('normalizes queries, removes duplicate URLs and ranks relevant results first', async () => {
    const provider = new MockProvider(async request => ({ provider: 'mock', query: request.query, searchedAt: '2026-10-08T00:00:00Z', results: [
      { title: 'Other', url: 'https://example.com/other', snippet: 'unrelated' },
      { title: 'Local AI release', url: 'https://example.com/release', snippet: 'new local AI model' },
      { title: 'Duplicate', url: 'https://example.com/release', snippet: 'duplicate' },
    ] }));
    const result = await new KnowledgeWebGateway(provider).search({ query: '  local   AI release  ', limit: 5 });
    assert.equal(provider.calls[0].query, 'local AI release');
    assert.equal(result.results.length, 2);
    assert.equal(result.results[0].url, 'https://example.com/release');
  });

  test('official Hugging Face model pages outrank generic model mentions and expose ranking telemetry', async () => {
    const provider = new MockProvider(async request => ({ provider: 'mock', query: request.query, searchedAt: '2026-10-08T00:00:00Z', results: [
      { title: 'Local AI model commentary', url: 'https://example.com/model', snippet: 'local AI model release' },
      { title: 'LiquidAI d1-3B', url: 'https://huggingface.co/LiquidAI/d1-3B', snippet: 'official model page' },
    ] }));
    const result = await new KnowledgeWebGateway(provider).search({ query: 'local AI model', limit: 5 });
    assert.equal(result.results[0].url, 'https://huggingface.co/LiquidAI/d1-3B');
    assert.equal(result.diagnostics.ranking.topOfficial, true);assert.equal(result.diagnostics.ranking.reordered, true);
  });

  test('privacy blocks secrets, personal identifiers, memory and local content before provider call', async () => {
    const provider = new MockProvider(); const gateway = new KnowledgeWebGateway(provider);
    const blocked = [
      [{ query: 'api_key=supersecretvalue', limit: 2 }, {}],
      [{ query: 'find person test@example.com', limit: 2 }, {}],
      [{ query: 'search this memory', limit: 2 }, { containsMemory: true }],
      [{ query: 'search C:\\private\\notes.txt', limit: 2 }, {}],
      [{ query: 'latest news', limit: 2 }, { private: true }],
    ];
    for (const [request, context] of blocked) await assert.rejects(gateway.search(request, context), QueryPrivacyError);
    assert.equal(provider.calls.length, 0);
  });

  test('offline, timeout and cancellation are explicit and do not hang', async () => {
    const offline = new KnowledgeWebGateway(new MockProvider(async () => { throw new Error('offline'); }));
    assert.equal((await offline.search({ query: 'latest news' })).diagnostics.status, 'offline');
    const stuck = new KnowledgeWebGateway(new MockProvider(async () => new Promise(() => {})), { timeoutMs: 15 });
    assert.equal((await stuck.search({ query: 'latest news' })).diagnostics.status, 'timeout');
    const controller = new AbortController(); controller.abort();
    assert.equal((await stuck.search({ query: 'another current topic' }, { signal: controller.signal })).diagnostics.status, 'cancelled');
  });

  test('URL and redirect guard rejects credential, local, private and excess redirects', () => {
    assert.equal(assertSafeWebUrl('https://example.com/a').hostname, 'example.com');
    for (const url of ['http://127.0.0.1/', 'http://192.168.1.4/', 'http://[::1]/', 'https://user:pass@example.com/']) {
      assert.throws(() => assertSafeWebUrl(url));
    }
    assert.throws(() => validateRedirectChain(Array(7).fill('https://example.com/')));
    assert.equal(validateResolvedAddresses(['93.184.216.34']), true);
    assert.throws(() => validateResolvedAddresses([{ address: '10.0.0.2', family: 4 }]));
  });
});

describe('adapters and fallback diagnostics', () => {
  test('memory adapter reuses existing retrieve contract and respects private mode', async () => {
    let calls = 0; const adapter = new MemoryRetrieverAdapter({ retrieve: async () => { calls++; return [{ memory: { id: '1' } }]; } });
    assert.equal((await adapter.search({ query: 'remember' })).length, 1);
    assert.deepEqual(await adapter.search({ query: 'remember' }, { private: true }), []); assert.equal(calls, 1);
  });
  test('hybrid web failure falls back to local with diagnostics', async () => {
    const executor = new KnowledgeRouteExecutor({ local: { search: async () => [{ id: 'local' }] },
      memory: { search: async () => [] }, web: { search: async () => ({ results: [], diagnostics: { status: 'offline' } }) } });
    const result = await executor.execute({ route: 'HYBRID', resolvedQuery: 'q', reason: 'test' });
    assert.equal(result.diagnostics.fallback, 'LOCAL'); assert.equal(result.local[0].id, 'local');
  });
});
