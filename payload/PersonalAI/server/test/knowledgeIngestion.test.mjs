import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { after, before, describe, test } from 'node:test';
import { tmpdir } from 'node:os';
import { createDocx } from '../files/formats/docx.mjs';
import { createXlsx } from '../files/formats/xlsx.mjs';
import { DocumentIngestionWorker } from '../knowledge/ingest/worker.mjs';
import { FileServiceKnowledgeLifecycleAdapter } from '../knowledge/ingest/fileLifecycleAdapter.mjs';
import { KnowledgeSourceRepository } from '../knowledge/storage/sourceRepository.mjs';
import { SqliteKnowledgeStore } from '../knowledge/storage/sqliteStore.mjs';

let root;
before(async () => { root = await fs.mkdtemp(path.join(tmpdir(), 'lumicos-knowledge-')); });
after(async () => { await fs.rm(root, { recursive: true, force: true }); });

function fixture(name = 'fixture.db') {
  const store = new SqliteKnowledgeStore(path.join(root, `${Date.now()}-${Math.random()}-${name}`));
  store.migrate();
  const repository = new KnowledgeSourceRepository(store);
  const worker = new DocumentIngestionWorker(repository);
  return { store, repository, worker };
}

function minimalPdf(text) {
  const stream = `BT /F1 18 Tf 72 720 Td (${text.replace(/[()\\]/g, '\\$&')}) Tj ET`;
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 5 0 R >> >> /Contents 4 0 R >>',
    `<< /Length ${Buffer.byteLength(stream)} >>\nstream\n${stream}\nendstream`,
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
  ];
  let body = '%PDF-1.4\n';
  const offsets = [0];
  objects.forEach((object, index) => {
    offsets.push(Buffer.byteLength(body));
    body += `${index + 1} 0 obj\n${object}\nendobj\n`;
  });
  const xref = Buffer.byteLength(body);
  body += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  body += offsets.slice(1).map((offset) => `${String(offset).padStart(10, '0')} 00000 n \n`).join('');
  body += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(body);
}

describe('document ingestion', () => {
  test('indexes Thai Markdown with heading metadata and filename', async () => {
    const f = fixture();
    try {
      const result = await f.worker.enqueue({ sourceUri: 'notes/คู่มือแมว.md', displayName: 'คู่มือแมว.md',
        buffer: Buffer.from('# การดูแลแมว\n\nแมวไทยต้องได้รับอาหารและน้ำสะอาดทุกวัน') });
      assert.equal(result.changed, true);
      const source = f.repository.getByUri('notes/คู่มือแมว.md');
      assert.equal(source.status, 'ready');
      assert.equal(f.repository.chunks(source.id)[0].heading, 'การดูแลแมว');
      assert.equal(f.repository.search('อาหารแมวไทย')[0].displayName, 'คู่มือแมว.md');
    } finally { f.store.close(); }
  });

  test('skips identical content and atomically replaces changed chunks', async () => {
    const f = fixture();
    try {
      const job = { sourceUri: 'notes/a.txt', displayName: 'a.txt', buffer: Buffer.from('alpha original text') };
      assert.equal((await f.worker.enqueue(job)).changed, true);
      assert.equal((await f.worker.enqueue(job)).changed, false);
      assert.equal((await f.worker.enqueue({ ...job, buffer: Buffer.from('beta replacement text') })).changed, true);
      const source = f.repository.getByUri(job.sourceUri);
      assert.equal(f.repository.search('alpha').length, 0);
      assert.equal(f.repository.search('beta')[0].sourceId, source.id);
      assert.equal(f.repository.chunkCount(source.id), 1);
    } finally { f.store.close(); }
  });

  test('deletes source, chunks and FTS rows in one transaction', async () => {
    const f = fixture();
    try {
      await f.worker.enqueue({ sourceUri: 'notes/delete.txt', displayName: 'delete.txt', buffer: Buffer.from('unique deletion evidence') });
      const source = f.repository.getByUri('notes/delete.txt');
      const removed = f.repository.remove(source.id);
      assert.deepEqual(removed, { removed: true, chunks: 1 });
      assert.equal(f.repository.get(source.id), null);
      assert.equal(f.repository.search('deletion').length, 0);
    } finally { f.store.close(); }
  });

  test('worker is manual, single-concurrency, pausable and resumable', async () => {
    const f = fixture();
    let active = 0; let maximum = 0;
    f.worker.extractor = async (name, buffer) => {
      active++; maximum = Math.max(maximum, active);
      await new Promise((resolve) => setTimeout(resolve, 10));
      active--;
      return { kind: 'text', metadata: {}, contentHash: name + buffer.length,
        chunks: [{ ordinal: 0, content: buffer.toString(), keywordText: buffer.toString(), contentHash: name }] };
    };
    try {
      f.worker.pause();
      const one = f.worker.enqueue({ sourceUri: 'one.txt', displayName: 'one.txt', buffer: Buffer.from('one') });
      const two = f.worker.enqueue({ sourceUri: 'two.txt', displayName: 'two.txt', buffer: Buffer.from('two') });
      assert.deepEqual(f.worker.status(), { paused: true, active: 0, queued: 2 });
      f.worker.resume();
      await Promise.all([one, two]);
      assert.equal(maximum, 1);
    } finally { f.store.close(); }
  });

  test('reuses DOCX and XLSX extractors', async () => {
    const f = fixture();
    try {
      const docx = await createDocx({ title: 'คู่มือ', blocks: [{ type: 'heading', level: 1, text: 'หัวข้อ' }, { type: 'paragraph', text: 'เนื้อหาเอกสารเวิร์ด' }] });
      const xlsx = await createXlsx({ sheets: [{ name: 'รายรับ', rows: [['รายการ', 'จำนวน'], ['อาหาร', 120]] }] });
      await f.worker.enqueue({ sourceUri: 'documents/test.docx', displayName: 'test.docx', buffer: docx });
      await f.worker.enqueue({ sourceUri: 'spreadsheets/test.xlsx', displayName: 'test.xlsx', buffer: xlsx });
      assert.equal(f.repository.search('เวิร์ด').length, 1);
      assert.equal(f.repository.search('อาหาร').length, 1);
    } finally { f.store.close(); }
  });

  test('reuses the PDF text-layer extractor and retains page metadata', async () => {
    const f = fixture();
    try {
      await f.worker.enqueue({ sourceUri: 'documents/fixture.pdf', displayName: 'fixture.pdf',
        buffer: minimalPdf('Gate two searchable PDF fixture') });
      const result = f.repository.search('searchable PDF');
      assert.equal(result.length, 1);
      assert.equal(result[0].page, 1);
    } finally { f.store.close(); }
  });

  test('lifecycle adapter remains explicit and removes indexed state', async () => {
    const f = fixture();
    const adapter = new FileServiceKnowledgeLifecycleAdapter({ worker: f.worker, repository: f.repository });
    try {
      await adapter.fileCreated({ sourceUri: 'notes/event.txt', displayName: 'event.txt', buffer: Buffer.from('explicit event') });
      assert.equal(adapter.fileDeleted('notes/event.txt').removed, true);
    } finally { f.store.close(); }
  });
});

describe('database recovery', () => {
  test('reopens an existing database, keeps data and recovers interrupted indexing', () => {
    const filename = path.join(root, 'recovery.db');
    let store = new SqliteKnowledgeStore(filename); store.migrate();
    let repository = new KnowledgeSourceRepository(store);
    const source = repository.register({ sourceUri: 'notes/recover.txt', displayName: 'recover.txt' });
    repository.setStatus(source.id, 'indexing');
    store.close();
    store = new SqliteKnowledgeStore(filename); store.migrate();
    repository = new KnowledgeSourceRepository(store);
    try {
      assert.equal(repository.recoverInterrupted(), 1);
      assert.equal(repository.get(source.id).status, 'pending');
      assert.equal(store.database.prepare('PRAGMA quick_check').get().quick_check, 'ok');
    } finally { store.close(); }
  });
});

