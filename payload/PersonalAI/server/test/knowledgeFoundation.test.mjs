import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { resolveKnowledgeConfig } from '../knowledge/config.mjs';
import { SqliteKnowledgeStore } from '../knowledge/storage/sqliteStore.mjs';
import { keywordText, tokenizeKnowledgeText } from '../knowledge/text/tokens.mjs';
import { normalizeKnowledgeText } from '../knowledge/text/normalize.mjs';
import { validateWebSearchRequest, validateWebSearchResponse } from '../knowledge/web/provider.mjs';

describe('knowledge configuration', () => {
  test('is disabled by default and does not enable indexing or web', () => {
    const config = resolveKnowledgeConfig({}, { dataDir: 'C:/AI/PersonalAI/data' });
    assert.equal(config.enabled, false);
    assert.equal(config.indexing.enabled, false);
    assert.equal(config.web.enabled, false);
    assert.match(config.databasePath, /knowledge\.db$/);
  });

  test('rejects paths outside dataDir and multiple workers in Gate 1', () => {
    assert.throws(() => resolveKnowledgeConfig({ databaseFile: '../outside.db' }), /file name/);
    assert.throws(() => resolveKnowledgeConfig({ indexing: { maxWorkers: 2 } }), /must be 1/);
  });
});

describe('knowledge text utilities', () => {
  test('normalizes Unicode, zero-width characters, Sara Am, whitespace and newlines', () => {
    assert.equal(normalizeKnowledgeText('  กําลัง\u200B\r\n  ทดสอบ   ระบบ  '), 'กำลัง\nทดสอบ ระบบ');
  });

  test('segments Thai and English into reusable keyword text', () => {
    const tokens = tokenizeKnowledgeText('Lumicos อ่านเอกสารภาษาไทย 2026');
    assert.ok(tokens.includes('lumicos'));
    assert.ok(tokens.includes('2026'));
    assert.ok(keywordText('ค้นหาเอกสาร').length > 0);
  });
});

describe('knowledge SQLite migrations', () => {
  test('apply once, are idempotent, enable foreign keys and keep FTS in sync', () => {
    const store = new SqliteKnowledgeStore(':memory:');
    try {
      assert.equal(store.schemaVersion(), 0);
      assert.equal(store.migrate(), 3);
      assert.equal(store.migrate(), 3);
      assert.equal(store.database.prepare('PRAGMA foreign_keys').get().foreign_keys, 1);
      const now = new Date().toISOString();
      store.database.prepare(`INSERT INTO knowledge_sources
        (id, source_type, source_uri, display_name, status, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?)`).run('source-1', 'file', 'notes/a.md', 'a.md', 'ready', now, now);
      store.database.prepare(`INSERT INTO knowledge_chunks
        (id, source_id, ordinal, content, keyword_text, created_at)
        VALUES (?, ?, ?, ?, ?, ?)`).run('chunk-1', 'source-1', 0, 'Lumicos knowledge', 'lumicos knowledge', now);
      assert.equal(store.database.prepare(
        "SELECT COUNT(*) AS count FROM knowledge_chunks_fts WHERE knowledge_chunks_fts MATCH 'lumicos'",
      ).get().count, 1);
      store.database.prepare('DELETE FROM knowledge_sources WHERE id = ?').run('source-1');
      assert.equal(store.database.prepare('SELECT COUNT(*) AS count FROM knowledge_chunks').get().count, 0);
      assert.equal(store.database.prepare(
        "SELECT COUNT(*) AS count FROM knowledge_chunks_fts WHERE knowledge_chunks_fts MATCH 'lumicos'",
      ).get().count, 0);
    } finally {
      store.close();
    }
  });

  test('rolls back failed transactions', () => {
    const store = new SqliteKnowledgeStore(':memory:');
    try {
      store.migrate();
      assert.throws(() => store.transaction((db) => {
        db.prepare('INSERT INTO schema_migrations(version, name, applied_at) VALUES (99, ?, ?)')
          .run('rollback-test', new Date().toISOString());
        throw new Error('stop');
      }), /stop/);
      assert.equal(store.database.prepare('SELECT COUNT(*) AS count FROM schema_migrations WHERE version=99').get().count, 0);
    } finally {
      store.close();
    }
  });
});

describe('web provider contract', () => {
  test('normalizes adapter requests and validates safe result URLs', () => {
    assert.deepEqual(validateWebSearchRequest({ query: ' latest Gemma ', limit: 3 }), {
      query: 'latest Gemma', limit: 3, workspaceId: 'default', locale: null,
    });
    const response = validateWebSearchResponse({
      provider: 'future-mcp', query: 'latest Gemma', searchedAt: '2026-10-08T00:00:00.000Z',
      results: [{ title: 'Result', url: 'https://example.com/a', snippet: 'Evidence' }],
    });
    assert.equal(response.results[0].url, 'https://example.com/a');
    assert.throws(() => validateWebSearchResponse({ results: [{ url: 'file:///secret' }] }), /unsafe URL/);
  });
});

