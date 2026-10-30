import { randomUUID } from 'node:crypto';
import { bm25Scores } from '../../memory/text.mjs';
import { keywordText, tokenizeKnowledgeText } from '../text/tokens.mjs';

const STATUSES = new Set(['pending', 'indexing', 'ready', 'error', 'deleted']);

function json(value, fallback = {}) {
  try { return JSON.parse(value ?? '') ?? fallback; } catch { return fallback; }
}

function sourceRow(row) {
  if (!row) return null;
  return {
    id: row.id,
    workspaceId: row.workspace_id,
    sourceType: row.source_type,
    sourceUri: row.source_uri,
    displayName: row.display_name,
    contentHash: row.content_hash,
    status: row.status,
    errorMessage: row.error_message,
    fileSize: row.file_size,
    modifiedAt: row.modified_at,
    indexedAt: row.indexed_at,
    metadata: json(row.metadata_json),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function ftsQuery(query) {
  const tokens = [...new Set(tokenizeKnowledgeText(query))].slice(0, 24);
  return tokens.map((token) => `"${token.replaceAll('"', '""')}"`).join(' OR ');
}

export class KnowledgeSourceRepository {
  constructor(store, { clock = () => new Date() } = {}) {
    this.store = store;
    this.db = store.database;
    this.clock = clock;
  }

  now() { return this.clock().toISOString(); }

  register(input) {
    const workspaceId = String(input.workspaceId ?? 'default');
    const sourceUri = String(input.sourceUri ?? '').trim();
    const displayName = String(input.displayName ?? '').trim();
    const sourceType = String(input.sourceType ?? 'file');
    if (!sourceUri || !displayName) throw new TypeError('sourceUri and displayName are required.');
    const existing = this.getByUri(sourceUri, workspaceId);
    const now = this.now();
    if (existing) {
      this.db.prepare(`UPDATE knowledge_sources SET display_name=?, source_type=?, file_size=?,
        modified_at=?, metadata_json=?, updated_at=?, status=CASE WHEN status='deleted' THEN 'pending' ELSE status END
        WHERE id=?`).run(displayName, sourceType, input.fileSize ?? null, input.modifiedAt ?? null,
          JSON.stringify(input.metadata ?? {}), now, existing.id);
      return this.get(existing.id);
    }
    const id = input.id ?? randomUUID();
    this.db.prepare(`INSERT INTO knowledge_sources
      (id, workspace_id, source_type, source_uri, display_name, status, file_size, modified_at,
       metadata_json, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, 'pending', ?, ?, ?, ?, ?)`)
      .run(id, workspaceId, sourceType, sourceUri, displayName, input.fileSize ?? null,
        input.modifiedAt ?? null, JSON.stringify(input.metadata ?? {}), now, now);
    return this.get(id);
  }

  get(id) {
    return sourceRow(this.db.prepare('SELECT * FROM knowledge_sources WHERE id=?').get(id));
  }

  getByUri(sourceUri, workspaceId = 'default') {
    return sourceRow(this.db.prepare(
      'SELECT * FROM knowledge_sources WHERE workspace_id=? AND source_uri=?',
    ).get(workspaceId, sourceUri));
  }

  list({ workspaceId = 'default', status } = {}) {
    if (status && !STATUSES.has(status)) throw new TypeError(`Unknown source status: ${status}`);
    const rows = status
      ? this.db.prepare('SELECT * FROM knowledge_sources WHERE workspace_id=? AND status=? ORDER BY display_name').all(workspaceId, status)
      : this.db.prepare('SELECT * FROM knowledge_sources WHERE workspace_id=? ORDER BY display_name').all(workspaceId);
    return rows.map(sourceRow);
  }

  setStatus(id, status, errorMessage = null) {
    if (!STATUSES.has(status)) throw new TypeError(`Unknown source status: ${status}`);
    const result = this.db.prepare(
      'UPDATE knowledge_sources SET status=?, error_message=?, updated_at=? WHERE id=?',
    ).run(status, errorMessage, this.now(), id);
    if (!result.changes) throw new Error(`Knowledge source not found: ${id}`);
    return this.get(id);
  }

  needsIndex(id, contentHash) {
    const source = this.get(id);
    if (!source) throw new Error(`Knowledge source not found: ${id}`);
    return source.status !== 'ready' || source.contentHash !== contentHash;
  }

  replaceDocument(id, { contentHash, chunks, metadata = {}, fileSize = null, modifiedAt = null }) {
    if (!contentHash || !Array.isArray(chunks)) throw new TypeError('contentHash and chunks are required.');
    const source = this.get(id);
    if (!source) throw new Error(`Knowledge source not found: ${id}`);
    if (!this.needsIndex(id, contentHash)) return { changed: false, source, chunks: this.chunkCount(id) };
    const now = this.now();
    this.store.transaction((db) => {
      db.prepare('DELETE FROM knowledge_chunks WHERE source_id=?').run(id);
      const insert = db.prepare(`INSERT INTO knowledge_chunks
        (id, source_id, ordinal, content, keyword_text, page_number, heading_path,
         char_start, char_end, metadata_json, content_hash, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);
      for (const chunk of chunks) {
        insert.run(chunk.id ?? randomUUID(), id, chunk.ordinal, chunk.content,
          chunk.keywordText ?? keywordText(chunk.content), chunk.page ?? null,
          chunk.heading ?? null, chunk.charStart ?? null, chunk.charEnd ?? null,
          JSON.stringify(chunk.metadata ?? {}), chunk.contentHash ?? null, now);
      }
      db.prepare(`UPDATE knowledge_sources SET content_hash=?, status='ready', error_message=NULL,
        file_size=?, modified_at=?, indexed_at=?, metadata_json=?, updated_at=? WHERE id=?`)
        .run(contentHash, fileSize, modifiedAt, now, JSON.stringify(metadata), now, id);
    });
    return { changed: true, source: this.get(id), chunks: chunks.length };
  }

  chunkCount(id) {
    return this.db.prepare('SELECT COUNT(*) AS count FROM knowledge_chunks WHERE source_id=?').get(id).count;
  }

  chunks(id) {
    return this.db.prepare(`SELECT id, source_id AS sourceId, ordinal, content,
      page_number AS page, heading_path AS heading, char_start AS charStart,
      char_end AS charEnd, content_hash AS contentHash, metadata_json AS metadataJson
      FROM knowledge_chunks WHERE source_id=? ORDER BY ordinal`).all(id)
      .map((row) => ({ ...row, metadata: json(row.metadataJson), metadataJson: undefined }));
  }

  search(query, { workspaceId = 'default', limit = 10 } = {}) {
    const match = ftsQuery(query);
    if (!match) return [];
    const candidateLimit = Math.max(limit, Math.min(100, limit * 5));
    const rows = this.db.prepare(`SELECT c.id, c.source_id AS sourceId, c.ordinal, c.content,
      c.page_number AS page, c.heading_path AS heading, s.display_name AS displayName,
      s.source_uri AS sourceUri
      FROM knowledge_chunks_fts f
      JOIN knowledge_chunks c ON c.rowid=f.rowid
      JOIN knowledge_sources s ON s.id=c.source_id
      WHERE knowledge_chunks_fts MATCH ? AND s.workspace_id=? AND s.status='ready'
      LIMIT ?`).all(match, workspaceId, candidateLimit);
    const scores = bm25Scores(query, rows.map((row) => row.content));
    return rows.map((row, index) => ({ ...row, score: scores[index] }))
      .sort((a, b) => b.score - a.score || a.ordinal - b.ordinal)
      .slice(0, limit);
  }

  remove(id) {
    return this.store.transaction((db) => {
      const chunks = db.prepare('SELECT COUNT(*) AS count FROM knowledge_chunks WHERE source_id=?').get(id).count;
      const result = db.prepare('DELETE FROM knowledge_sources WHERE id=?').run(id);
      return { removed: result.changes === 1, chunks };
    });
  }

  recoverInterrupted() {
    return this.db.prepare(`UPDATE knowledge_sources SET status='pending',
      error_message='Indexing was interrupted before completion', updated_at=? WHERE status='indexing'`)
      .run(this.now()).changes;
  }
}

