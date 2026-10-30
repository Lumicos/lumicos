// Deterministic tests for the local service. Run: npm run test:service
import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { after, before, describe, test } from 'node:test';
import { loadConfig } from '../config.mjs';
import { createServices } from '../service.mjs';
import { toSegments } from '../files/paths.mjs';
import { readDocx, docxBlocksToMarkdown } from '../files/formats/docx.mjs';
import { readXlsx } from '../files/formats/xlsx.mjs';
import { extractCandidates } from '../memory/candidates.mjs';
import { JsonMemoryStore } from '../memory/memoryStore.mjs';
import { contextFor } from '../files/fileContext.mjs';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'personalai-test-'));
const config = loadConfig({ workspaceDir: path.join(tmp, 'workspace'), dataDir: path.join(tmp, 'data'), port: 0 });
const svc = createServices(config);
const { files, tools, memory, retriever, ws } = svc;

/** Runs a tool the way the UI does: validate -> (confirm) -> execute. */
async function runTool(name, args, { confirm = true } = {}) {
  const v = await tools.validate(name, args);
  return tools.execute(name, args, confirm ? v.approvalId : undefined);
}

after(() => fs.rmSync(tmp, { recursive: true, force: true }));

/* ================================================================== */
describe('path security', () => {
  const bad = [
    '../secret.txt',
    '..\\..\\Windows',
    'notes/../../etc/passwd',
    'C:\\Windows\\System32',
    'c:/Users/someone',
    '\\\\server\\share\\x',
    '~/file',
    '.hidden',
    'notes/.git/config',
    'CON',
    'notes/nul.txt',
    'bad|name.txt',
    'a\u0000b',
  ];
  for (const p of bad) {
    test(`rejects ${JSON.stringify(p)}`, async () => {
      assert.throws(() => ws.resolve(p), /not allowed|reserved|Invalid|escapes|Hidden/i);
      await assert.rejects(runTool('read_file', { path: p }));
    });
  }

  test('accepts normal relative paths and normalises separators', () => {
    assert.deepEqual(toSegments('notes\\sub/file.md'), ['notes', 'sub', 'file.md']);
    assert.equal(ws.resolve('/notes/a.md').rel, 'notes/a.md');
    assert.ok(ws.resolve('notes/a.md').abs.startsWith(ws.root));
  });

  test('symlink pointing outside the workspace is refused', async (t) => {
    const outside = path.join(tmp, 'outside');
    fs.mkdirSync(outside, { recursive: true });
    fs.writeFileSync(path.join(outside, 'secret.txt'), 'nope');
    try {
      fs.symlinkSync(outside, path.join(ws.root, 'link'), 'junction');
    } catch {
      t.skip('symlinks not permitted here');
      return;
    }
    assert.throws(() => ws.resolve('link/secret.txt'), /outside the workspace/);
    const listed = await files.list('');
    assert.ok(!listed.entries.some((e) => e.name === 'link'), 'links are hidden from listings');
    fs.rmSync(path.join(ws.root, 'link'));
  });

  test('default folders exist and hidden files are not listed', async () => {
    fs.writeFileSync(path.join(ws.root, '.secret'), 'x');
    fs.writeFileSync(path.join(ws.root, 'desktop.ini'), 'x');
    const names = (await files.list('')).entries.map((e) => e.name);
    for (const f of ['documents', 'spreadsheets', 'notes', 'exports']) assert.ok(names.includes(f));
    assert.ok(!names.includes('.secret') && !names.includes('desktop.ini'));
  });
});

/* ================================================================== */
describe('text files', () => {
  test('create, read, append', async () => {
    const r = await runTool('create_file', { path: 'notes/project.md', content: '# Project\n\nUses Gemma via llama.cpp.' });
    assert.equal(r.data.path, 'notes/project.md');
    const read = await runTool('read_file', { path: 'notes/project.md' });
    assert.match(read.content, /Uses Gemma via llama\.cpp/);
    await runTool('write_file', { path: 'notes/project.md', content: '- new line', mode: 'append' });
    assert.match(await files.readText('notes/project.md'), /llama\.cpp\.\n- new line$/);
  });

  test('duplicate file names get a numbered name, never overwrite', async () => {
    const a = await runTool('create_file', { path: 'notes/dup.txt', content: 'first' });
    const b = await runTool('create_file', { path: 'notes/dup.txt', content: 'second' });
    const c = await runTool('create_file', { path: 'notes/dup.txt', content: 'third' });
    assert.deepEqual([a.data.path, b.data.path, c.data.path], ['notes/dup.txt', 'notes/dup (2).txt', 'notes/dup (3).txt']);
    assert.equal(await files.readText('notes/dup.txt'), 'first');
    const copy = await runTool('copy_file', { path: 'notes/dup.txt', to: 'notes' });
    assert.equal(copy.data.path, 'notes/dup (4).txt');
  });

  test('rename / move refuse to overwrite', async () => {
    await assert.rejects(runTool('rename_file', { path: 'notes/dup (2).txt', new_name: 'dup.txt' }), /already exists/);
    await assert.rejects(runTool('rename_file', { path: 'notes/dup (2).txt', new_name: '../x.txt' }), /plain name|not allowed/);
    const m = await runTool('move_file', { path: 'notes/dup (3).txt', to: 'exports' });
    assert.match(m.summary, /exports\/dup \(3\)\.txt/);
  });

  test('search finds content and names (Thai + English)', async () => {
    await runTool('create_file', { path: 'notes/thai.md', content: 'บันทึก: การ์ดจอ RX6600 ใช้กับ Gemma ได้ดี' });
    const r = await runTool('search_files', { query: 'Gemma' });
    assert.match(r.content, /notes\/project\.md/);
    assert.match(r.content, /notes\/thai\.md/);
    const th = await runTool('search_files', { query: 'การ์ดจอ' });
    assert.match(th.content, /thai\.md/);
  });

  test('large files are chunked, not dumped', async () => {
    const big = Array.from({ length: 60 }, (_, i) => `Paragraph ${i}. ${'lorem ipsum '.repeat(30)}${i === 42 ? 'The secret keyword is BANANA.' : ''}`).join('\n\n');
    await runTool('create_file', { path: 'notes/big.txt', content: big });
    const first = await runTool('read_file', { path: 'notes/big.txt' });
    assert.ok(first.content.length < 7000);
    assert.match(first.content, /Showing part/);
    const q = await runTool('read_file', { path: 'notes/big.txt', query: 'secret keyword banana' });
    assert.match(q.content, /BANANA/);
    const ctx = contextFor(big, { maxChars: 6000 });
    await assert.rejects(runTool('read_file', { path: 'notes/big.txt', part: ctx.totalChunks + 5 }), /does not exist/);
  });

  test('confirmed web knowledge uses a dedicated RAG file and is deduplicated', async () => {
    const args = {
      heading: 'ตัวอย่างเหตุการณ์ที่ตรวจสอบแล้ว',
      facts: ['วันที่ 14 ตุลาคม 2026 หน่วยงาน Example Agency ประกาศข้อมูลตัวอย่างอย่างเป็นทางการ'],
      sources: ['https://example.com/official-announcement'],
    };
    const first = await runTool('save_web_knowledge', args);
    assert.equal(first.data.added, true);
    assert.equal(first.data.path, 'knowledge/lumicos-verified-web.md');
    const content = await files.readText('knowledge/lumicos-verified-web.md');
    assert.match(content, /## ตัวอย่างเหตุการณ์ที่ตรวจสอบแล้ว/);
    assert.match(content, /https:\/\/example\.com\/official-announcement/);
    const duplicate = await runTool('save_web_knowledge', args);
    assert.equal(duplicate.data.added, false);
    assert.equal(duplicate.data.duplicate, true);
  });
});

/* ================================================================== */
describe('permissions & confirmation', () => {
  test('read tools run without approval', async () => {
    const v = await tools.validate('list_files', {});
    assert.equal(v.permission, 'read');
    assert.equal(v.approvalId, null);
    await tools.execute('list_files', {});
  });

  test('write tools need an approval', async () => {
    await assert.rejects(tools.execute('create_file', { path: 'notes/x.txt', content: 'x' }), (e) => e.code === 'APPROVAL_REQUIRED');
    assert.equal(await files.exists('notes/x.txt'), false);
  });

  test('delete ALWAYS needs confirmation; approval is single-use and bound to the args', async () => {
    await runTool('create_file', { path: 'notes/delete-me.txt', content: 'bye' });
    await runTool('create_file', { path: 'notes/keep-me.txt', content: 'stay' });
    const v = await tools.validate('delete_file', { path: 'notes/delete-me.txt' });
    assert.equal(v.permission, 'destructive');
    assert.equal(v.preview.action, 'DELETE');
    await assert.rejects(tools.execute('delete_file', { path: 'notes/delete-me.txt' }), (e) => e.code === 'APPROVAL_REQUIRED');
    await assert.rejects(tools.execute('delete_file', { path: 'notes/keep-me.txt' }, v.approvalId), (e) => e.code === 'APPROVAL_MISMATCH');
    const r = await tools.execute('delete_file', { path: 'notes/delete-me.txt' }, v.approvalId);
    assert.match(r.data.backup, /backups/);
    assert.equal(await files.exists('notes/delete-me.txt'), false);
    assert.equal(await files.exists('notes/keep-me.txt'), true);
    await assert.rejects(tools.execute('delete_file', { path: 'notes/delete-me.txt' }, v.approvalId), (e) => e.code === 'APPROVAL_REQUIRED');
  });

  test('overwriting an existing file escalates to destructive', async () => {
    const v = await tools.validate('write_file', { path: 'notes/keep-me.txt', content: 'new', mode: 'overwrite' });
    assert.equal(v.permission, 'destructive');
    assert.match(v.preview.warning, /replaced/);
    const r = await tools.execute('write_file', { path: 'notes/keep-me.txt', content: 'new', mode: 'overwrite' }, v.approvalId);
    assert.ok(r.data.backup, 'backup made before overwrite');
    assert.equal(await files.readText('notes/keep-me.txt'), 'new');
  });

  test('permission escalation after approval is caught', async () => {
    const args = { path: 'notes/later.txt', content: 'x', mode: 'overwrite' };
    const v = await tools.validate('write_file', args); // file does not exist yet -> write
    assert.equal(v.permission, 'write');
    await files.write('notes/later.txt', 'someone created it', { mode: 'create' });
    await assert.rejects(tools.execute('write_file', args, v.approvalId), (e) => e.code === 'APPROVAL_ESCALATED');
  });

  test('invalid arguments are rejected before anything runs', async () => {
    await assert.rejects(tools.validate('create_file', { path: 'a.md' }), /Missing required content/);
    await assert.rejects(tools.validate('write_file', { path: 'a.md', content: 'x', mode: 'explode' }), /one of/);
    await assert.rejects(tools.validate('no_such_tool', {}), /Unknown tool/);
  });
});

/* ================================================================== */
describe('DOCX', () => {
  test('create and read back structure', async () => {
    const r = await runTool('create_docx', {
      path: 'documents/report.docx',
      title: 'รายงาน PersonalAI',
      blocks: [
        { type: 'heading', level: 1, text: 'Introduction' },
        { type: 'paragraph', text: 'PersonalAI runs **locally**.' },
        { type: 'bullets', items: ['Gemma', 'llama.cpp'] },
        { type: 'numbered', items: ['Install', 'Run'] },
        { type: 'table', rows: [['Part', 'Status'], ['Memory', 'Done']] },
        { type: 'heading', level: 1, text: 'Conclusion' },
        { type: 'paragraph', text: 'Works.' },
      ],
    });
    assert.equal(r.data.path, 'documents/report.docx');
    const { blocks } = await readDocx(await files.readBytes('documents/report.docx'));
    assert.deepEqual(blocks.map((b) => b.type), ['title', 'heading', 'paragraph', 'bullets', 'numbered', 'table', 'heading', 'paragraph']);
    assert.deepEqual(blocks[3].items, ['Gemma', 'llama.cpp']);
    assert.deepEqual(blocks[5].rows, [['Part', 'Status'], ['Memory', 'Done']]);
    const read = await runTool('read_file', { path: 'documents/report.docx' });
    assert.match(read.content, /## Introduction/);
    assert.match(read.content, /\| Memory \| Done \|/);
  });

  test('edit saves to -edited copy by default and keeps content', async () => {
    const v = await tools.validate('edit_docx', {
      path: 'documents/report.docx',
      operations: [
        { op: 'rename_heading', from: 'Introduction', to: 'Background' },
        { op: 'append', blocks: [{ type: 'heading', level: 1, text: 'Summary' }, { type: 'paragraph', text: 'All good.' }] },
      ],
    });
    assert.equal(v.permission, 'write');
    assert.match(v.preview.details, /report-edited\.docx/);
    const r = await tools.execute('edit_docx', {
      path: 'documents/report.docx',
      operations: [
        { op: 'rename_heading', from: 'Introduction', to: 'Background' },
        { op: 'append', blocks: [{ type: 'heading', level: 1, text: 'Summary' }, { type: 'paragraph', text: 'All good.' }] },
      ],
    }, v.approvalId);
    assert.equal(r.data.path, 'documents/report-edited.docx');
    const original = docxBlocksToMarkdown((await readDocx(await files.readBytes('documents/report.docx'))).blocks);
    const edited = docxBlocksToMarkdown((await readDocx(await files.readBytes('documents/report-edited.docx'))).blocks);
    assert.match(original, /Introduction/, 'original untouched');
    assert.match(edited, /## Background/);
    assert.match(edited, /## Summary\n\nAll good\./);
    assert.match(edited, /\| Memory \| Done \|/, 'table preserved');
  });

  test('replacing the original is destructive', async () => {
    const v = await tools.validate('edit_docx', { path: 'documents/report.docx', output: 'documents/report.docx', operations: [{ op: 'replace_text', find: 'Works.', replace: 'Works well.' }] });
    assert.equal(v.permission, 'destructive');
  });
});

/* ================================================================== */
describe('XLSX', () => {
  test('create, read, formulas', async () => {
    await runTool('create_xlsx', {
      path: 'spreadsheets/expenses.xlsx',
      sheets: [{ name: 'Expenses', rows: [['Date', 'Item', 'Amount'], ['2026-09-24', 'Bus', 30], ['2026-09-25', 'Coffee', 65], ['Total', '', '=SUM(C2:C3)']] }],
    });
    const wb = await readXlsx(await files.readBytes('spreadsheets/expenses.xlsx'));
    assert.equal(wb.sheets[0].name, 'Expenses');
    assert.deepEqual(wb.sheets[0].rows[1].map((c) => c.v), ['2026-09-24', 'Bus', 30]);
    assert.equal(wb.sheets[0].rows[3][2].f, '=SUM(C2:C3)');
  });

  test('edit: add row above total (formula range extended), update cell, add & rename sheet', async () => {
    const r = await runTool('edit_xlsx', {
      path: 'spreadsheets/expenses.xlsx',
      operations: [
        { op: 'add_rows', sheet: 'Expenses', rows: [['2026-09-25', 'Food', 120]] },
        { op: 'update_cells', sheet: 'Expenses', cells: { B2: 'Bus ticket' } },
        { op: 'add_sheet', name: 'Summary', rows: [['Month', 'Total'], ['2026-09', '=Expenses!C5']] },
        { op: 'rename_sheet', from: 'Summary', to: 'สรุป' },
      ],
    });
    assert.ok(r.data.backup, 'backup before in-place edit');
    const wb = await readXlsx(await files.readBytes('spreadsheets/expenses.xlsx'));
    const rows = wb.sheets[0].rows.map((row) => row.map((c) => c.f ?? c.v));
    assert.deepEqual(rows[3], ['2026-09-25', 'Food', 120]);
    assert.deepEqual(rows[4], ['Total', '', '=SUM(C2:C4)']);
    assert.equal(rows[1][1], 'Bus ticket');
    assert.deepEqual(wb.sheets.map((s) => s.name), ['Expenses', 'สรุป']);
  });

  test('bad operations fail cleanly', async () => {
    await assert.rejects(runTool('edit_xlsx', { path: 'spreadsheets/expenses.xlsx', operations: [{ op: 'update_cells', sheet: 'Nope', cells: { A1: 1 } }] }), /not found/);
    await assert.rejects(runTool('edit_xlsx', { path: 'spreadsheets/expenses.xlsx', operations: [{ op: 'update_cells', cells: { 'ZZZZ0': 1 } }] }), /invalid cell/);
  });
});

/* ================================================================== */
describe('memory', () => {
  test('CRUD', async () => {
    const m = await memory.create({ type: 'user_fact', content: "User's main GPU is AMD RX6600 8GB.", tags: ['Hardware'] });
    assert.equal(m.importance, 3);
    assert.deepEqual(m.tags, ['hardware']);
    const u = await memory.update(m.id, { importance: 5, pinned: true });
    assert.equal(u.importance, 5);
    assert.equal(u.pinned, true);
    assert.equal(u.createdAt, m.createdAt);
    await assert.rejects(memory.create({ type: 'nonsense', content: 'x' }), /Unknown memory type/);
    await assert.rejects(memory.create({ content: '   ' }), /required/);
    const tmpM = await memory.create({ content: 'temporary' });
    await memory.remove(tmpM.id);
    await assert.rejects(memory.get(tmpM.id), /not found/);
  });

  test('persists across restarts (new store instance)', async () => {
    await memory.create({ type: 'preference', content: 'User prefers concise conversational Thai.' });
    await memory.create({ type: 'project', content: 'PersonalAI uses Gemma through llama.cpp Vulkan.', characterId: 'default-mina' });
    await memory.create({ type: 'decision', content: 'Use ComfyUI ZLUDA as the primary image backend.' });
    await memory.flush();
    const reopened = new JsonMemoryStore(path.join(config.dataDir, 'memory.json'));
    const contents = (await reopened.list()).map((m) => m.content);
    assert.ok(contents.includes('User prefers concise conversational Thai.'));
    assert.ok(contents.includes("User's main GPU is AMD RX6600 8GB."));
  });

  test('retrieval returns only relevant memories, scoped by character', async () => {
    await memory.create({ type: 'general', content: 'Favourite food is khao man gai.' });
    const gpu = await retriever.retrieve({ query: 'Which GPU do I have? RX6600', characterId: 'default-mina' });
    assert.ok(gpu.some((r) => /RX6600/.test(r.memory.content)));
    assert.ok(!gpu.some((r) => /khao man gai/.test(r.memory.content)), 'unrelated memory not injected');

    const img = await retriever.retrieve({ query: 'image backend ComfyUI', characterId: 'someone-else' });
    assert.ok(img.some((r) => /ComfyUI/.test(r.memory.content)));
    const proj = await retriever.retrieve({ query: 'Gemma llama.cpp', characterId: 'someone-else' });
    assert.ok(!proj.some((r) => /PersonalAI uses Gemma/.test(r.memory.content)), 'character-specific memory hidden from other characters');
  });

  test('retrieval works with Thai text', async () => {
    await memory.create({ type: 'user_fact', content: 'ผู้ใช้มีแมวชื่อส้ม', tags: ['สัตว์เลี้ยง'] });
    const r = await retriever.retrieve({ query: 'แมวของฉันชื่ออะไรนะ' });
    assert.equal(r.find((x) => x.reason === 'match' && !x.memory.pinned)?.memory.content, 'ผู้ใช้มีแมวชื่อส้ม');
  });

  test('retrieval rejects unrelated Thai topic changes and generic type words', async () => {
    await memory.create({ type: 'preference', content: 'ผู้ใช้ชอบดื่มกาแฟ', tags: ['เครื่องดื่ม'] });
    assert.deepEqual(await retriever.retrieve({ query: 'ชอบให้ช่วยอธิบายโค้ด Python' }), []);
    assert.deepEqual(await retriever.retrieve({ query: 'เปลี่ยนเรื่องไปคุยเรื่องสภาพอากาศ' }), []);
  });

  test('one incidental overlap does not inject hardware memory into an unrelated request', async () => {
    await memory.create({ type: 'user_fact', content: 'สเปคคอมเรา Ryzen 5 3600 Ram 32 RX6600', tags: ['hardware'] });
    assert.deepEqual(await retriever.retrieve({ query: 'ช่วยคิดเมนูอาหารเย็นสำหรับกินตอนทำงานหน้าคอม' }), []);
    const relevant = await retriever.retrieve({ query: 'คอมเราสเปคอะไร ใช้ Ryzen รุ่นไหน' });
    assert.ok(relevant.some((item) => item.memory.content.includes('Ryzen 5 3600')));
  });

  test('pinned memory is prioritised only when it is relevant', async () => {
    await memory.create({ type: 'project', content: 'Project Atlas uses PostgreSQL.', tags: ['atlas'], pinned: true, importance: 5 });
    assert.deepEqual(await retriever.retrieve({ query: 'What should I cook tonight?' }), []);
    const found = await retriever.retrieve({ query: 'Which database does Atlas use?' });
    assert.equal(found[0].memory.content, 'Project Atlas uses PostgreSQL.');
    assert.equal(found[0].reason, 'pinned');
  });

  test('corrupted memory file is kept aside, not lost', async () => {
    const file = path.join(tmp, 'broken.json');
    fs.writeFileSync(file, '{not json');
    const s = new JsonMemoryStore(file);
    assert.equal((await s.list()).length, 0);
    assert.ok(fs.readdirSync(tmp).some((f) => f.startsWith('broken.json.corrupt-')));
  });

  test('candidates: facts yes, chit-chat and questions no, duplicates no', () => {
    assert.equal(extractCandidates('สวัสดี').length, 0);
    assert.equal(extractCandidates('RX6600 ดีไหม?').length, 0);
    assert.equal(extractCandidates('อธิบายว่าทำไมท้องฟ้าเป็นสีฟ้า').length, 0);
    assert.equal(extractCandidates('การ์ดจอของฉันคือ RX6600 8GB')[0].type, 'user_fact');
    assert.equal(extractCandidates('I prefer short answers')[0].type, 'preference');
    assert.equal(extractCandidates('จำไว้ว่าตอนนี้ฉันตั้งชื่อคุณว่า Mina')[0].content, 'ตอนนี้ฉันตั้งชื่อคุณว่า Mina');
    assert.equal(extractCandidates('My GPU is RX6600 8GB', { existing: [{ content: 'My GPU is RX6600 8GB' }] }).length, 0);
    assert.equal(extractCandidates('note this file thing').length, 0, 'bare "note" is not a remember request');
    assert.equal(extractCandidates('Please remember that my sister is Nam')[0].content, 'my sister is Nam');
  });
});

/* ================================================================== */
describe('attachments', () => {
  test('attach, read, import into workspace', async () => {
    const a = await svc.attachments.add('meeting.md', Buffer.from('# Meeting\n\nDecided to use Gemma.'));
    assert.match(a.context, /Decided to use Gemma/);
    const bad = svc.attachments.add('virus.exe', Buffer.from('MZ'));
    await assert.rejects(bad, /Unsupported/);
    const r = await runTool('import_attachment', { attachment_id: a.id });
    assert.equal(r.data.path, 'notes/meeting.md');
    assert.match(await files.readText('notes/meeting.md'), /Decided/);
  });
});

/* ================================================================== */
describe('HTTP security', () => {
  let server;
  let port;
  before(async () => {
    const c = { ...config, port: 0 };
    server = http.createServer((req, res) => svc.handler(req, res));
    await new Promise((r) => server.listen(0, '127.0.0.1', r));
    port = server.address().port;
    // the app checks Host against config.port
    config.port = port;
    const again = createServices({ ...c, port });
    server.removeAllListeners('request');
    server.on('request', again.handler);
  });
  after(() => server.close());

  const call = (p, { method = 'GET', headers = {}, body } = {}) =>
    new Promise((resolve, reject) => {
      const req = http.request({ host: '127.0.0.1', port, path: p, method, headers: { host: `127.0.0.1:${port}`, ...headers } }, (res) => {
        let data = '';
        res.on('data', (c) => (data += c));
        res.on('end', () => resolve({ status: res.statusCode, body: data ? JSON.parse(data) : null }));
      });
      req.on('error', reject);
      if (body) req.write(JSON.stringify(body));
      req.end();
    });

  test('requests without the client header are refused', async () => {
    assert.equal((await call('/api/health')).status, 403);
  });
  test('foreign origins are refused', async () => {
    const r = await call('/api/files/list', { headers: { 'x-personalai': '1', origin: 'https://evil.example' } });
    assert.equal(r.status, 403);
  });
  test('wrong Host header (DNS rebinding) is refused', async () => {
    const r = await call('/api/health', { headers: { 'x-personalai': '1', host: 'evil.example:1234' } });
    assert.equal(r.status, 421);
  });
  test('allowed origin works; traversal via API is rejected', async () => {
    const ok = await call('/api/health', { headers: { 'x-personalai': '1', origin: 'http://127.0.0.1:5173' } });
    assert.equal(ok.status, 200);
    const trav = await call(`/api/files/list?path=${encodeURIComponent('..\\..\\Windows')}`, { headers: { 'x-personalai': '1' } });
    assert.equal(trav.status, 400);
  });
  test('UI delete requires explicit confirm flag', async () => {
    const r = await call('/api/files/delete', { method: 'POST', headers: { 'x-personalai': '1', 'content-type': 'application/json' }, body: { path: 'notes/project.md' } });
    assert.equal(r.status, 400);
    assert.equal(r.body.error.code, 'CONFIRM_REQUIRED');
  });
  test('tool execute over HTTP without approval is refused', async () => {
    const r = await call('/api/tools/execute', { method: 'POST', headers: { 'x-personalai': '1' }, body: { name: 'delete_file', args: { path: 'notes/project.md' } } });
    assert.equal(r.status, 403);
    assert.equal(r.body.error.code, 'APPROVAL_REQUIRED');
  });
});
