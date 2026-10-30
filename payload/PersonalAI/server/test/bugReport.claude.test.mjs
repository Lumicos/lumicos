import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { saveBugReport, listBugReports } from '../selfcheck/bugReport.mjs';

const T0 = Date.parse('2026-10-22T08:00:00.000Z');
const iso = (ms) => new Date(T0 + ms).toISOString();

function fixture(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bug-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  fs.mkdirSync(path.join(dir, 'logs'));
  const msgs = [
    { id: 'u0', role: 'user', parts: [{ type: 'text', text: 'สวัสดี' }], createdAt: T0 - 60000 },
    { id: 'r0', replyToId: 'u0', role: 'assistant', parts: [{ type: 'text', text: 'สวัสดีค่ะ' }], createdAt: T0 - 55000, status: 'done' },
    { id: 'u1', role: 'user', parts: [{ type: 'text', text: 'ค้นเว็บ ราคาทองวันนี้' }], createdAt: T0 - 5 },
    { id: 'r1abc', replyToId: 'u1', role: 'assistant', parts: [{ type: 'text', text: 'ราคาทองวันนี้ 99 บาท' }], createdAt: T0, status: 'done',
      toolRuns: [{ id: 't1', tool: 'web_search', args: { query: 'ราคาทอง' }, status: 'done', summary: 'ค้นเว็บ 3 แหล่ง', resultForModel: 'ทองแท่ง ขายออก 65,650' }],
      citations: [{ id: '1', kind: 'web', title: 'ราคาทอง', url: 'https://example.com/gold' }],
      chatLatency: { totalResponseMs: 9000, searchMs: 3000 }, stats: { tokensGenerated: 20, tokensPerSecond: 40, durationMs: 500 } },
  ];
  fs.writeFileSync(path.join(dir, 'conversations.json'), JSON.stringify({ conversations: [{ id: 'c1', mode: 'assistant', characterId: 'default-assistant', messages: msgs }], characters: [{ id: 'default-assistant', name: 'Nova' }] }));
  fs.writeFileSync(path.join(dir, 'logs', 'web-search.jsonl'), JSON.stringify({ at: iso(1000), replyId: 'r1abc', route: 'WEB', status: 'ok', webCitations: 3, elapsedMs: 2500 }) + '\n');
  fs.writeFileSync(path.join(dir, 'logs', 'tool-decisions.jsonl'), JSON.stringify({ at: iso(200), replyId: 'r1abc', route: 'WEB', reason: 'explicit web request', evidence: { web: 3, local: 0, memory: 0 } }) + '\n');
  return dir;
}

test('a bug report holds the note, the conversation up to the reply, tools, sources and the timeline in one file', async (t) => {
  const dataDir = fixture(t);
  const r = await saveBugReport({ dataDir, replyId: 'r1abc', note: 'ราคาผิด ควรเป็น 65,650', build: { version: '0.3.0', src: 'abc123' }, now: new Date(2026, 9, 22, 15, 0, 1) });
  assert.equal(r.name, '20261022-150001-r1abc.md');
  assert.equal(r.traced, true);
  const md = fs.readFileSync(r.file, 'utf8');
  for (const want of ['ราคาผิด ควรเป็น 65,650', 'ค้นเว็บ ราคาทองวันนี้', 'ราคาทองวันนี้ 99 บาท', '← ข้อความที่แจ้ง', '**Nova**', 'web_search [done]', 'ทองแท่ง ขายออก 65,650',
    'https://example.com/gold', 'route WEB (explicit web request)', 'ค้นเว็บ WEB → ok (3 แหล่ง', 'version 0.3.0 · src abc123']) assert.ok(md.includes(want), `missing: ${want}`);
  const json = JSON.parse(fs.readFileSync(r.file.replace(/\.md$/, '.json'), 'utf8'));
  assert.equal(json.conversationId, 'c1');
  assert.equal(json.excerpt.at(-1).id, 'r1abc');
});

test('private (unsaved) chats still produce a report from the text on screen', async (t) => {
  const dataDir = fixture(t);
  const r = await saveBugReport({ dataDir, replyId: 'private-xyz', replyText: 'คำตอบในแชตส่วนตัว', now: new Date(2026, 9, 22, 15, 1, 0) });
  const md = fs.readFileSync(r.file, 'utf8');
  assert.equal(r.traced, false);
  assert.ok(md.includes('คำตอบในแชตส่วนตัว'));
  assert.ok(md.includes('private'));
  assert.ok(md.includes('(ไม่ได้เขียนอธิบาย)'));
});

test('bad ids are rejected and the list is newest first', async (t) => {
  const dataDir = fixture(t);
  await assert.rejects(saveBugReport({ dataDir, replyId: '../../etc' }), /replyId/);
  await saveBugReport({ dataDir, replyId: 'r1abc', note: 'แรก', now: new Date(2026, 9, 22, 9, 0, 0) });
  await saveBugReport({ dataDir, replyId: 'r1abc', note: 'สอง', now: new Date(2026, 9, 22, 10, 0, 0) });
  assert.deepEqual(listBugReports(dataDir).map((x) => x.note), ['สอง', 'แรก']);
});

test('HTTP: POST /api/bug-reports saves a report; a bad id is a 400; GET lists it', async (t) => {
  const http = await import('node:http');
  const { loadConfig } = await import('../config.mjs');
  const { createServices } = await import('../service.mjs');
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'bug-http-'));
  const server = http.createServer();
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const port = server.address().port;
  const svc = createServices(loadConfig({ workspaceDir: path.join(tmp, 'workspace'), dataDir: path.join(tmp, 'data'), port }));
  server.on('request', svc.handler);
  t.after(async () => { await new Promise((r) => server.close(r)); try { svc.chats?.close?.(); await svc.conversations?.close?.(); await svc.knowledge?.close?.(); await svc.web?.close?.(); svc.voice?.close?.(); } catch {}
    // Background services may still be writing into the temp folder for a moment (seen when the machine is busy): retry, and never fail the test over cleanup.
    try { fs.rmSync(tmp, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 }); } catch {} });
  const device = (await import('node:crypto')).randomUUID();
  let cookie = '';
  const call = (p, { method = 'GET', body } = {}) => new Promise((resolve, reject) => {
    const req = http.request({ host: '127.0.0.1', port, path: p, method, headers: { host: `127.0.0.1:${port}`, 'x-personalai': '1', 'x-lumicos-device': device, cookie, 'content-type': 'application/json' } }, (res) => {
      const set = res.headers['set-cookie']?.[0]; if (set) cookie = set.split(';')[0];
      let data = ''; res.on('data', (c) => (data += c)); res.on('end', () => resolve({ status: res.statusCode, body: data ? JSON.parse(data) : null }));
    });
    req.on('error', reject); if (body) req.write(JSON.stringify(body)); req.end();
  });
  assert.equal((await call('/api/session', { method: 'POST', body: {} })).status, 200);
  const ok = await call('/api/bug-reports', { method: 'POST', body: { replyId: 'private-1234', note: 'ทดสอบ', replyText: 'ข้อความบนจอ' } });
  assert.equal(ok.status, 200, JSON.stringify(ok.body));
  assert.match(ok.body.name, /^\d{8}-\d{6}-private-1234\.md$/);
  assert.ok(fs.readFileSync(ok.body.file, 'utf8').includes('ข้อความบนจอ'));
  assert.equal((await call('/api/bug-reports', { method: 'POST', body: { replyId: '../x' } })).status, 400);
  const list = await call('/api/bug-reports');
  assert.equal(list.status, 200);
  assert.equal(list.body.reports[0].note, 'ทดสอบ');
});
