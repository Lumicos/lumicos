// claude-20261016 step 3a: one tool decider — explicit commands win, web turns stay web-only, library notes are dated.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { DeterministicKnowledgeRouter } from '../knowledge/router/router.mjs';
import { KnowledgeChatIntegration } from '../knowledge/chat/integration.mjs';
import { citationEvidence } from '../knowledge/chat/citations.mjs';
import { ChatService } from '../chat/chatService.mjs';

const router = new DeterministicKnowledgeRouter();
const route = (query, context) => router.route({ query, context });

test('"ค้นเว็บ" is web only even when the sentence mentions documents/notes words', () => {
  for (const q of ['ค้นเว็บหาเอกสารเกี่ยวกับฝนบนดาวอังคาร', 'ช่วยค้นเว็บ ไฟล์ข่าวหนังทำเงินญี่ปุ่นเดือนตุลาคม 2026', 'search the web for documents about mars rain']) {
    const d = route(q);
    assert.equal(d.route, 'WEB', q);
    assert.equal(d.reason, 'explicit-web-request', q);
  }
});

test('"ดูในคลัง" / "ค้นใน RAG" is library only, even with a current-events topic word', () => {
  for (const q of ['ดูในคลังว่ามีเรื่องฝนบนดาวอังคารไหม', 'ค้นใน RAG เรื่องราคาทอง', 'ลองหาจากฐานความรู้หน่อย ข่าวล่าสุด', 'search my knowledge base for mars']) {
    const d = route(q);
    assert.equal(d.route, 'LOCAL', q);
    assert.equal(d.reason, 'explicit-local-request', q);
  }
});

test('naming both places uses both; plain current-events questions are web; small talk stays direct', () => {
  assert.equal(route('ค้นเว็บและดูในคลังเรื่องฝนบนดาวอังคาร').route, 'HYBRID');
  assert.equal(route('ข่าวหนังใหม่วันนี้มีอะไรบ้าง').route, 'WEB');
  assert.equal(route('วันนี้เหนื่อยจัง').route, 'DIRECT');
  assert.equal(route('ห้ามค้นเว็บ').route, 'DIRECT'); // an explicit "do not search the web" is respected
  assert.equal(route('ห้ามค้นเว็บ ดูในคลังก็ได้').route, 'LOCAL'); // ...and does not cancel a library request
});

function integration({ hasDocs = true, local = [], calls = [] } = {}) {
  const executor = { async execute(decision) { calls.push(decision.route); return { local: decision.route === 'LOCAL' || decision.route === 'HYBRID' ? local : [], memory: [], web: ['WEB', 'HYBRID'].includes(decision.route) ? { results: [], provider: 't', diagnostics: { status: 'ok' } } : null, diagnostics: { route: decision.route, reason: decision.reason } }; } };
  const compatibility = { async forKnowledge() { return { validity: 'ok', outputMode: 'text', toolTransport: 'none' }; } };
  return new KnowledgeChatIntegration({ router, executor, compatibility, library: { hasDocuments: () => hasDocs } });
}
const settings = { knowledge: { enabled: true, searchMode: 'AUTO', route: 'AUTO', webEnabled: true } };

test('with a non-empty library a current-events question stays WEB (no silent HYBRID with old notes)', async () => {
  const calls = [];
  const r = await integration({ calls }).prepare({ query: 'ข่าวหนังใหม่วันนี้มีอะไรบ้าง', settings });
  assert.equal(r.decision.route, 'WEB');
  assert.equal(r.decision.reason, 'freshness-required');
  assert.deepEqual(calls, ['WEB']);
});

test('"ดูในคลัง" with nothing found: no web fallback, and the model is told it is not in the library', async () => {
  const calls = [];
  const r = await integration({ calls, local: [] }).prepare({ query: 'ดูในคลังว่ามีเรื่องหนังทำเงินปี 2026 ไหม', settings });
  assert.equal(r.decision.route, 'LOCAL');
  assert.deepEqual(calls, ['LOCAL']);
  assert.match(r.evidence, /Library search: no matching document/);
});

test('local evidence carries the file date; web evidence is unchanged', () => {
  const { evidence, citations } = citationEvidence({ local: [{ sourceId: 's1', displayName: 'note.md', sourceUri: 'note.md', content: 'ฝนบนดาวอังคาร', modifiedAt: '2026-09-30T01:02:03.000Z' }] });
  assert.match(evidence, /updatedAt=2026-09-30/);
  assert.equal(citations[0].updatedAt, '2026-09-30');
  const none = citationEvidence({ local: [{ sourceId: 's2', displayName: 'n.md', sourceUri: 'n.md', content: 'x' }] });
  assert.doesNotMatch(none.evidence, /updatedAt/);
});

test('tool-decisions.jsonl: one bounded line per turn with route, reason, tool order and fit; no query text for private chats', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lumicos-td-'));
  const conv = (priv) => ({ id: 'c1', private: priv, messages: [{ id: 'r1', toolRuns: [{ tool: 'run_python', status: 'done', args: { code: 'print(1)' } }, { tool: 'web_search', status: 'done', args: { query: 'หนังทำเงินญี่ปุ่น ต.ค. 2026' } }] }] });
  const log = (priv) => ChatService.prototype.logToolTurn.call({ config: { dataDir: dir }, store: { conversation: () => conv(priv) } },
    { id: 'j1', conversationId: 'c1', replyId: 'r1', status: 'done' }, 'ค้นเว็บ หนังทำเงิน',
    { decision: { route: 'WEB', reason: 'explicit-web-request', resolvedQuery: 'ค้นเว็บ หนังทำเงิน ญี่ปุ่น' }, citations: [{ kind: 'web' }, { kind: 'web' }],
      diagnostics: { evidenceCount: 2, elapsedMs: 900, validation: { status: 'ok', counts: { match: 1, unverified: 1, mismatch: 0 } } } });
  log(false); log(true);
  const lines = fs.readFileSync(path.join(dir, 'logs', 'tool-decisions.jsonl'), 'utf8').trim().split('\n').map((l) => JSON.parse(l));
  assert.equal(lines.length, 2);
  assert.equal(lines[0].route, 'WEB');
  assert.equal(lines[0].reason, 'explicit-web-request');
  assert.deepEqual(lines[0].tools.map((t) => t.tool), ['run_python', 'web_search']);
  assert.equal(lines[0].tools[1].query, 'หนังทำเงินญี่ปุ่น ต.ค. 2026');
  assert.equal(lines[0].evidence.web, 2);
  assert.deepEqual(lines[0].evidence.fit, { match: 1, unverified: 1, mismatch: 0 });
  assert.equal(lines[1].private, true);
  assert.equal(lines[1].query, undefined);
  assert.equal(lines[1].tools[1].query, undefined);
});

test('"ดูในคลัง มีอะไรบ้าง" lists what the library holds instead of reporting a miss', async () => {
  const docs = [{ name: 'grok-2026\\2026-กฎหมาย.md', status: 'ready' }, { name: 'learned\\2026-10\\2026-10-15-หาเนื้อเพลง-Click.md', status: 'ready' }, { name: 'x.md', status: 'error' }];
  const calls = [];
  const executor = { async execute(d) { calls.push(d.route); return { local: [], memory: [], web: null }; } };
  const compatibility = { async forKnowledge() { return { validity: 'ok', outputMode: 'text', toolTransport: 'none' }; } };
  const lib = { hasDocuments: () => true, status: () => ({ documents: docs }) };
  const r = await new KnowledgeChatIntegration({ router, executor, compatibility, library: lib }).prepare({ query: 'ดูในคลังความรู้ มีบันทึกเรื่องอะไรบ้าง', settings });
  assert.deepEqual(calls, ['LOCAL']);
  assert.match(r.evidence, /Library contents/);
  assert.match(r.evidence, /2 documents/);
  assert.match(r.evidence, /grok-2026 \(1\): 2026-กฎหมาย/);
  assert.match(r.evidence, /learned \(1\): หาเนื้อเพลง-Click/);
  assert.doesNotMatch(r.evidence, /x\.md|Library search: no matching/);
  // a real keyword request that finds nothing still reports a miss, and quotes the current request
  const miss = await new KnowledgeChatIntegration({ router, executor, compatibility, library: lib }).prepare({ query: 'ดูในคลังว่ามีเรื่องฝนบนดาวอังคารไหม', settings });
  assert.match(miss.evidence, /no matching document was found for "ดูในคลังว่ามีเรื่องฝนบนดาวอังคารไหม"/);
});
