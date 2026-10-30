import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { buildTrace, formatTrace, accountFor } from '../../scripts/trace-turn.mjs';
import { ChatService } from '../chat/chatService.mjs';

const T0 = Date.parse('2026-10-16T01:00:00.000Z');
const iso = ms => new Date(T0 + ms).toISOString();
const jl = rows => rows.map(r => JSON.stringify(r)).join('\n') + '\n';

function fixture(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'trace-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  fs.mkdirSync(path.join(dir, 'logs'));
  const user = { id: 'u1', role: 'user', parts: [{ type: 'text', text: 'ค้นเว็บ หนังทำเงินญี่ปุ่น' }], createdAt: T0 - 5, status: 'done' };
  const reply = { id: 'r1', replyToId: 'u1', role: 'assistant', parts: [{ type: 'text', text: 'ได้เลย' }], createdAt: T0, status: 'done',
    contextInfo: { sentMessages: 5, droppedMessages: 2, droppedContext: ['context-summary'], estimatedTokens: 3000 },
    stats: { tokensGenerated: 100, tokensPerSecond: 43, durationMs: 2300, promptProcessingMs: 3500, wakeMs: 40 },
    chatLatency: { totalResponseMs: 22000, contextPreparationMs: 6, searchMs: 130, toolExecutionMs: 0, gpuWaitMs: 4000 } };
  const other = { id: 'r0', replyToId: 'u0', role: 'assistant', parts: [{ type: 'text', text: 'เก่า' }], createdAt: T0 - 600000, status: 'done' };
  fs.writeFileSync(path.join(dir, 'conversations.json'), JSON.stringify({ conversations: [{ id: 'c1', messages: [other, user, reply] }] }));
  fs.writeFileSync(path.join(dir, 'logs', 'llm-cache.jsonl'), jl([
    { at: iso(9000), purpose: 'chat-reply', correlationId: 'r1', slot: 0, cache_n: 0, prompt_n: 3200, elapsedMs: 6000, sleepingBefore: false },
    { at: iso(12000), purpose: 'other', correlationId: null, slot: 1, elapsedMs: 1500 },
    { at: iso(-900000), purpose: 'chat-reply', correlationId: 'r0', slot: 0, elapsedMs: 100 },
  ]));
  fs.writeFileSync(path.join(dir, 'logs', 'web-search.jsonl'), jl([{ at: iso(3000), replyId: 'r1', route: 'WEB', status: 'ok', webCitations: 4, elapsedMs: 2500 }, { at: iso(3500), replyId: 'zzz', route: 'WEB', status: 'ok', webCitations: 9, elapsedMs: 1 }]));
  fs.writeFileSync(path.join(dir, 'logs', 'tool-decisions.jsonl'), jl([{ at: iso(22000), replyId: 'r1', jobId: 'j1', conversationId: 'c1', route: 'WEB', reason: 'explicit-web-request', evidence: { web: 4, local: 0, memory: 0 }, tools: [{ tool: 'web_search', status: 'done' }] }]));
  fs.writeFileSync(path.join(dir, 'logs', 'image-jobs.jsonl'), '');
  fs.writeFileSync(path.join(dir, 'logs', 'voice-lifecycle.jsonl'), jl([{ at: iso(500), event: 'onload', onGpu: true }, { at: iso(5000000), event: 'exit' }]));
  return dir;
}

test('accounting: known spans are summed, the rest is reported as unexplained', () => {
  const a = accountFor({ stats: { durationMs: 2300, promptProcessingMs: 3500, wakeMs: 40 }, chatLatency: { totalResponseMs: 22000, contextPreparationMs: 6, searchMs: 130, gpuWaitMs: 4000 } });
  assert.equal(a.total, 22000);
  assert.equal(Math.round(a.unexplained), 22000 - 6 - 130 - 40 - 3500 - 2300 - 4000);
  assert.ok(a.parts.some(([k]) => k === 'gpuWaitMs'), 'extra spans are counted, not hidden');
  assert.equal(accountFor({}).unexplained, 0);
});

test('trace joins the message with every log by id; unlabeled rows are marked as nearby; other turns are left out', t => {
  const dir = fixture(t);
  const tr = buildTrace({ dataDir: dir, replyId: 'last' });
  assert.equal(tr.replyId, 'r1');
  const text = JSON.stringify(tr.events);
  assert.match(text, /chat-reply slot 0/);
  assert.doesNotMatch(text, /"r0"|slot 0 · 0\.10s/, 'the previous turn’s LLM row is not included');
  const web = tr.events.filter(e => e.source === 'web');
  assert.equal(web.length, 1, 'a web-search row of another reply is excluded');
  const aux = tr.events.find(e => e.label.startsWith('other'));
  assert.equal(aux.nearby, true);
  assert.equal(tr.events.find(e => e.label.startsWith('chat-reply')).nearby, undefined);
  assert.ok(tr.events.some(e => e.source === 'voice' && /onload/.test(e.label)));
  assert.ok(!tr.events.some(e => /exit/.test(e.label)), 'voice events outside the window are excluded');
  assert.ok(tr.events.some(e => e.source === 'tools' && /explicit-web-request/.test(e.label)));
  assert.deepEqual(tr.events.map(e => e.offsetMs), [...tr.events.map(e => e.offsetMs)].sort((a, b) => a - b));
});

test('text output names the unexplained gap and the dropped context; unknown ids give an error', t => {
  const dir = fixture(t);
  const out = formatTrace(buildTrace({ dataDir: dir, replyId: 'r1' }));
  assert.match(out, /รวม 22\.0s/);
  assert.match(out, /ไม่มีคำอธิบาย/);
  assert.match(out, /ตัด context-summary/);
  assert.match(out, /\[tools\] route WEB/);
  assert.match(formatTrace(buildTrace({ dataDir: dir, replyId: 'nope' })), /ไม่พบข้อความตอบ nope/);
  assert.match(formatTrace(buildTrace({ dataDir: fs.mkdtempSync(path.join(os.tmpdir(), 'empty-')), replyId: 'last' })), /ยังไม่มีแชต/);
});

test('CLI prints the last turn and exits 0; --json is parseable', t => {
  const dir = fixture(t);
  const run = args => spawnSync(process.execPath, ['scripts/trace-turn.mjs', ...args, '--data', dir], { encoding: 'utf8', cwd: path.join(import.meta.dirname, '..', '..') });
  const a = run([]);
  assert.equal(a.status, 0);
  assert.match(a.stdout, /ข้อความตอบ r1/);
  assert.equal(JSON.parse(run(['r1', '--json']).stdout).conversationId, 'c1');
  assert.equal(run(['missing']).status, 1);
});

test('tool-decisions.jsonl rows now carry replyId, mode and the turn summary so they can be joined', t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lumicos-tdj-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const reply = { id: 'r1', status: 'done', toolRuns: [], contextInfo: { sentMessages: 4, droppedMessages: 1, estimatedTokens: 900 },
    stats: { tokensGenerated: 10, tokensPerSecond: 40.26, durationMs: 250, promptTokens: 800, promptProcessingMs: 120, firstTokenMs: 150, wakeMs: 0 },
    chatLatency: { effective: 'FAST', reason: 'fast-default', totalResponseMs: 900.4, contextPreparationMs: 5, gpuWaitMs: 300, someFlag: true } };
  ChatService.prototype.logToolTurn.call({ config: { dataDir: dir }, store: { conversation: () => ({ id: 'c1', mode: 'roleplay', messages: [reply] }) } },
    { id: 'j1', conversationId: 'c1', replyId: 'r1', status: 'done' }, 'hi', null);
  const row = JSON.parse(fs.readFileSync(path.join(dir, 'logs', 'tool-decisions.jsonl'), 'utf8').trim());
  assert.equal(row.replyId, 'r1');
  assert.equal(row.mode, 'roleplay');
  assert.deepEqual(row.turn.context, { sentMessages: 4, droppedMessages: 1, estimatedTokens: 900 });
  assert.equal(row.turn.stats.tokensPerSecond, 40.3);
  assert.equal(row.turn.latency.gpuWaitMs, 300);
  assert.equal(row.turn.latency.someFlag, undefined, 'only numbers are copied from latency');
  assert.equal(row.turn.latency.effective, 'FAST');
});

test('a large unexplained gap that unlabeled LLM calls could account for gets a hint (and only then)', t => {
  const dir = fixture(t);
  assert.equal(buildTrace({ dataDir: dir, replyId: 'r1' }).accounting.hint, undefined);
  fs.appendFileSync(path.join(dir, 'logs', 'llm-cache.jsonl'), jl([{ at: iso(8000), purpose: 'other', correlationId: null, slot: 1, elapsedMs: 11000 }]));
  const tr = buildTrace({ dataDir: dir, replyId: 'r1' });
  assert.equal(tr.accounting.hint.calls, 2);
  assert.match(formatTrace(tr), /คำขอ LLM อื่นที่ไม่ได้ระบุเจ้าของ 2 รายการ/);
});

test('another turn’s own calls (llm correlationId / tool-decisions replyId) are never shown as “nearby” in this turn', t => {
  const dir = fixture(t);
  fs.appendFileSync(path.join(dir, 'logs', 'llm-cache.jsonl'), jl([{ at: iso(-400), purpose: 'chat-reply', correlationId: 'r0', slot: 0, elapsedMs: 15500 }]));
  fs.appendFileSync(path.join(dir, 'logs', 'tool-decisions.jsonl'), jl([{ at: iso(-300), replyId: 'r0', jobId: 'j0', conversationId: 'c1', route: 'LOCAL', reason: 'explicit-local-request', evidence: {}, tools: [] }]));
  const text = JSON.stringify(buildTrace({ dataDir: dir, replyId: 'r1' }).events);
  assert.doesNotMatch(text, /15\.5s/);
  assert.doesNotMatch(text, /explicit-local-request/);
  assert.match(text, /explicit-web-request/, 'this turn’s own decision is still there');
});
