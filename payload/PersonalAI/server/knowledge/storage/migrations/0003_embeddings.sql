CREATE TABLE embedding_profiles (
  id TEXT PRIMARY KEY,
  model_id TEXT NOT NULL,
  model_revision TEXT NOT NULL,
  runtime_name TEXT NOT NULL,
  runtime_version TEXT NOT NULL,
  dtype TEXT NOT NULL CHECK (dtype = 'int8'),
  dimension INTEGER NOT NULL CHECK (dimension > 0),
  pooling TEXT NOT NULL CHECK (pooling = 'mean'),
  normalized INTEGER NOT NULL CHECK (normalized IN (0, 1)),
  query_prefix TEXT NOT NULL,
  passage_prefix TEXT NOT NULL,
  created_at TEXT NOT NULL,
  UNIQUE(model_id, model_revision, runtime_version, dtype)
);

CREATE TABLE chunk_embeddings (
  chunk_id TEXT NOT NULL REFERENCES knowledge_chunks(id) ON DELETE CASCADE,
  profile_id TEXT NOT NULL REFERENCES embedding_profiles(id) ON DELETE CASCADE,
  content_hash TEXT NOT NULL,
  dimension INTEGER NOT NULL CHECK (dimension > 0),
  vector_blob BLOB NOT NULL,
  created_at TEXT NOT NULL,
  PRIMARY KEY(chunk_id, profile_id)
);

CREATE TABLE embedding_jobs (
  id TEXT PRIMARY KEY,
  source_id TEXT NOT NULL REFERENCES knowledge_sources(id) ON DELETE CASCADE,
  profile_id TEXT NOT NULL REFERENCES embedding_profiles(id) ON DELETE CASCADE,
  status TEXT NOT NULL CHECK (status IN ('pending', 'running', 'paused', 'cancelled', 'complete', 'error')),
  completed_chunks INTEGER NOT NULL DEFAULT 0 CHECK (completed_chunks >= 0),
  total_chunks INTEGER NOT NULL DEFAULT 0 CHECK (total_chunks >= 0),
  error_message TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX chunk_embeddings_profile_idx ON chunk_embeddings(profile_id, chunk_id);
CREATE INDEX embedding_jobs_status_idx ON embedding_jobs(status, created_at);
