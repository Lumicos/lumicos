import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { SearchV6Service } from '../web/searchV6Service.mjs';

const source = (n) => ({ n, title: `ราคาทอง ${n}`, url: `https://example.com/gold-${n}`, passage: 'ทองคำแท่ง ขายออก 65,300 บาท', date: '', read: true });

test('an empty search is tried once more, and both attempts are written to the search log', async (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'search-log-')); t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const logFile = path.join(dir, 'search-v6.log');
  const svc = new SearchV6Service({ logFile });
  const calls = [];
  svc.call = async (tool, args) => { calls.push(args); return calls.length === 1 ? { sources: [], errors: ['ddgs: no usable results'] } : { sources: [source(1), source(2)] }; };
  const r = await svc.search('ราคาทองคำแท่งวันนี้', 4);
  assert.equal(calls.length, 2);
  assert.equal(r.results.length, 2);
  assert.equal(r.providerDiagnostics.fallbackCount, 1);
  const log = fs.readFileSync(logFile, 'utf8');
  assert.match(log, /research#1 .* sources=0 usable=0 .*errors=\["ddgs: no usable results"\]/);
  assert.match(log, /research#2 .* sources=2 usable=2/);
});

test('a search that finds nothing twice still fails with the usual message; a good first answer is not repeated', async () => {
  const svc = new SearchV6Service();
  let n = 0;
  svc.call = async () => { n++; return { sources: [{ ...source(1), lowRelevance: true }] }; };
  await assert.rejects(svc.search('ราคาทองคำแท่งวันนี้', 4), /ไม่พบผลค้นเว็บ/);
  assert.equal(n, 2);
  const once = new SearchV6Service();
  let m = 0;
  once.call = async () => { m++; return { sources: [source(1)] }; };
  const r = await once.search('ราคาน้ำมันวันนี้', 4);
  assert.equal(m, 1);
  assert.equal(r.providerDiagnostics.fallbackCount, 0);
});
