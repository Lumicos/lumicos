CREATE TABLE IF NOT EXISTS knowledge_sources (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL DEFAULT 'default',
  source_type TEXT NOT NULL,
  source_uri TEXT NOT NULL,
  display_name TEXT NOT NULL,
  content_hash TEXT,
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'indexing', 'ready', 'error', 'deleted')),
  error_message TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE (workspace_id, source_uri)
);

CREATE TABLE IF NOT EXISTS knowledge_chunks (
  id TEXT PRIMARY KEY,
  source_id TEXT NOT NULL REFERENCES knowledge_sources(id) ON DELETE CASCADE,
  ordinal INTEGER NOT NULL CHECK (ordinal >= 0),
  content TEXT NOT NULL,
  keyword_text TEXT NOT NULL DEFAULT '',
  page_number INTEGER,
  heading_path TEXT,
  char_start INTEGER,
  char_end INTEGER,
  metadata_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL,
  UNIQUE (source_id, ordinal)
);

CREATE VIRTUAL TABLE IF NOT EXISTS knowledge_chunks_fts USING fts5(
  content,
  keyword_text,
  content='knowledge_chunks',
  content_rowid='rowid',
  tokenize='unicode61'
);

CREATE TRIGGER IF NOT EXISTS knowledge_chunks_ai AFTER INSERT ON knowledge_chunks BEGIN
  INSERT INTO knowledge_chunks_fts(rowid, content, keyword_text)
  VALUES (new.rowid, new.content, new.keyword_text);
END;

CREATE TRIGGER IF NOT EXISTS knowledge_chunks_ad AFTER DELETE ON knowledge_chunks BEGIN
  INSERT INTO knowledge_chunks_fts(knowledge_chunks_fts, rowid, content, keyword_text)
  VALUES ('delete', old.rowid, old.content, old.keyword_text);
END;

CREATE TRIGGER IF NOT EXISTS knowledge_chunks_au AFTER UPDATE ON knowledge_chunks BEGIN
  INSERT INTO knowledge_chunks_fts(knowledge_chunks_fts, rowid, content, keyword_text)
  VALUES ('delete', old.rowid, old.content, old.keyword_text);
  INSERT INTO knowledge_chunks_fts(rowid, content, keyword_text)
  VALUES (new.rowid, new.content, new.keyword_text);
END;

CREATE INDEX IF NOT EXISTS knowledge_sources_status_idx
  ON knowledge_sources(workspace_id, status);
CREATE INDEX IF NOT EXISTS knowledge_chunks_source_idx
  ON knowledge_chunks(source_id, ordinal);

