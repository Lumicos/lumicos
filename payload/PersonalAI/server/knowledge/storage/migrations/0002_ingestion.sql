ALTER TABLE knowledge_sources ADD COLUMN file_size INTEGER;
ALTER TABLE knowledge_sources ADD COLUMN modified_at TEXT;
ALTER TABLE knowledge_sources ADD COLUMN indexed_at TEXT;
ALTER TABLE knowledge_sources ADD COLUMN metadata_json TEXT NOT NULL DEFAULT '{}';

ALTER TABLE knowledge_chunks ADD COLUMN content_hash TEXT;

CREATE INDEX IF NOT EXISTS knowledge_sources_hash_idx
  ON knowledge_sources(workspace_id, content_hash);
CREATE INDEX IF NOT EXISTS knowledge_chunks_hash_idx
  ON knowledge_chunks(source_id, content_hash);

