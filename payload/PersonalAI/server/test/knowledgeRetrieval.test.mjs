import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { FakeEmbedder } from '../knowledge/embedding/embedder.mjs';
import { EmbeddingQueue } from '../knowledge/embedding/queue.mjs';
import { encodeVector, normalized } from '../knowledge/embedding/vectorCodec.mjs';
import { HybridRetriever, reciprocalRankFusion } from '../knowledge/retrieval/hybridRetriever.mjs';
import { KnowledgeSourceRepository } from '../knowledge/storage/sourceRepository.mjs';
import { SqliteKnowledgeStore } from '../knowledge/storage/sqliteStore.mjs';
import { VectorRepository } from '../knowledge/storage/vectorRepository.mjs';

function fixture() {
  const store = new SqliteKnowledgeStore(':memory:'); store.migrate();
  const sources = new KnowledgeSourceRepository(store);
  const vectors = new VectorRepository(store);
  const embedder = new FakeEmbedder({ dimension: 8 });
  vectors.upsertProfile(embedder.profile);
  return { store, sources, vectors, embedder };
}

function addSource(f, id, text) {
  f.sources.register({ id, sourceUri: `${id}.txt`, displayName: `${id}.txt` });
  f.sources.replaceDocument(id, { contentHash: `${id}-hash`, chunks: [
    { id: `${id}-chunk`, ordinal: 0, content: text, contentHash: `${id}-chunk-hash` },
  ] });
}

describe('embedding storage and validation', () => {
  test('migration v3 is idempotent and cascade deletion removes vectors and jobs', async () => {
    const f = fixture();
    try {
      assert.equal(f.store.schemaVersion(), 3);
      addSource(f, 'thai', 'แมวไทยชอบอาหารปลา');
      const queue = new EmbeddingQueue(f.vectors, f.embedder);
      const job = queue.enqueue('thai'); await job.done;
      assert.equal(f.vectors.candidates(f.embedder.profile.id).length, 1);
      f.sources.remove('thai');
      assert.equal(f.vectors.candidates(f.embedder.profile.id).length, 0);
      assert.equal(f.vectors.job(job.id), undefined);
    } finally { f.store.close(); }
  });

  test('rejects dimensions and non-finite values', () => {
    assert.throws(() => encodeVector([1, 2], 3), /dimension/);
    assert.throws(() => encodeVector([1, Number.NaN], 2), /NaN or Infinity/);
  });

  test('incremental embedding skips matching chunk hash and re-embeds changed content', async () => {
    const f = fixture();
    try {
      addSource(f, 'inc', 'original passage');
      const queue = new EmbeddingQueue(f.vectors, f.embedder);
      assert.equal((await queue.enqueue('inc').done).completed, 1);
      assert.equal((await queue.enqueue('inc').done).completed, 0);
      f.sources.replaceDocument('inc', { contentHash: 'changed', chunks: [
        { id: 'inc-new', ordinal: 0, content: 'changed passage', contentHash: 'changed-chunk' },
      ] });
      assert.equal((await queue.enqueue('inc').done).completed, 1);
    } finally { f.store.close(); }
  });

  test('recovers interrupted jobs and supports pause, resume and cancellation', async () => {
    const f = fixture();
    try {
      addSource(f, 'queue', 'queue passage');
      const queue = new EmbeddingQueue(f.vectors, f.embedder); queue.pause();
      const job = queue.enqueue('queue');
      assert.equal(f.vectors.job(job.id).status, 'pending');
      queue.cancel(job.id); queue.resume();
      assert.equal((await job.done).cancelled, true);
      const recoveryId = f.vectors.createJob('queue', f.embedder.profile.id);
      f.vectors.setJob(recoveryId, 'running');
      assert.equal(f.vectors.recoverInterrupted(), 1);
      assert.equal(f.vectors.job(recoveryId).status, 'pending');
    } finally { f.store.close(); }
  });
});

describe('local hybrid retrieval', () => {
  test('searches Thai and English through vectors plus BM25 and fuses ranks', async () => {
    const f = fixture();
    try {
      addSource(f, 'th', 'คู่มือการดูแลแมวไทยและอาหารปลา');
      addSource(f, 'en', 'Local retrieval architecture for Lumicos');
      const queue = new EmbeddingQueue(f.vectors, f.embedder);
      await queue.enqueue('th').done; await queue.enqueue('en').done;
      const retriever = new HybridRetriever({ sources: f.sources, vectors: f.vectors, embedder: f.embedder });
      const thai = await retriever.search('อาหารแมวไทย');
      assert.equal(thai[0].sourceId, 'th');
      const english = await retriever.search('retrieval architecture');
      assert.ok(english.some((row) => row.sourceId === 'en'));
      assert.ok(thai.every((row) => Number.isFinite(row.rrfScore)));
    } finally { f.store.close(); }
  });

  test('RRF rewards a result present in both rank lists', () => {
    const result = reciprocalRankFusion([[{ id: 'a' }, { id: 'b' }], [{ id: 'b' }, { id: 'c' }]]);
    assert.equal(result[0].id, 'b');
  });

  test('fake vectors are finite and normalized', async () => {
    const vector = await new FakeEmbedder({ dimension: 8 }).embedQuery('ข้อความทดสอบ');
    assert.equal(vector.length, 8); assert.equal(normalized(vector), true);
  });
});
