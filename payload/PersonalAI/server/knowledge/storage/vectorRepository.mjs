import { randomUUID } from 'node:crypto';
import { encodeVector, normalized } from '../embedding/vectorCodec.mjs';

function profileRow(row) {
  return row && { id: row.id, modelId: row.model_id, modelRevision: row.model_revision,
    runtimeName: row.runtime_name, runtimeVersion: row.runtime_version, dtype: row.dtype,
    dimension: row.dimension, pooling: row.pooling, normalized: Boolean(row.normalized),
    queryPrefix: row.query_prefix, passagePrefix: row.passage_prefix };
}

export class VectorRepository {
  constructor(store, { clock = () => new Date() } = {}) { this.store = store; this.db = store.database; this.clock = clock; }
  now() { return this.clock().toISOString(); }
  upsertProfile(profile) {
    if (profile.dimension !== 384 && profile.modelId === 'Xenova/multilingual-e5-small') throw new RangeError('multilingual-e5-small dimension must be 384.');
    this.db.prepare(`INSERT INTO embedding_profiles
      (id,model_id,model_revision,runtime_name,runtime_version,dtype,dimension,pooling,normalized,query_prefix,passage_prefix,created_at)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET
      model_revision=excluded.model_revision,runtime_version=excluded.runtime_version,dimension=excluded.dimension`)
      .run(profile.id, profile.modelId, profile.modelRevision, profile.runtimeName, profile.runtimeVersion,
        profile.dtype, profile.dimension, profile.pooling, profile.normalized ? 1 : 0,
        profile.queryPrefix, profile.passagePrefix, this.now());
    return this.getProfile(profile.id);
  }
  getProfile(id) { return profileRow(this.db.prepare('SELECT * FROM embedding_profiles WHERE id=?').get(id)); }
  pendingChunks(sourceId, profileId) {
    return this.db.prepare(`SELECT c.id,c.content,c.content_hash AS contentHash FROM knowledge_chunks c
      LEFT JOIN chunk_embeddings e ON e.chunk_id=c.id AND e.profile_id=?
      WHERE c.source_id=? AND (e.chunk_id IS NULL OR e.content_hash<>c.content_hash) ORDER BY c.ordinal`).all(profileId, sourceId);
  }
  put(chunkId, profileId, contentHash, vector) {
    const profile = this.getProfile(profileId);
    if (!profile) throw new Error(`Embedding profile not found: ${profileId}`);
    if (profile.normalized && !normalized(vector)) throw new TypeError('Embedding profile requires a normalized vector.');
    const blob = encodeVector(vector, profile.dimension);
    this.db.prepare(`INSERT INTO chunk_embeddings(chunk_id,profile_id,content_hash,dimension,vector_blob,created_at)
      VALUES(?,?,?,?,?,?) ON CONFLICT(chunk_id,profile_id) DO UPDATE SET
      content_hash=excluded.content_hash,dimension=excluded.dimension,vector_blob=excluded.vector_blob,created_at=excluded.created_at`)
      .run(chunkId, profileId, contentHash, profile.dimension, blob, this.now());
  }
  candidates(profileId, workspaceId = 'default') {
    return this.db.prepare(`SELECT e.chunk_id AS chunkId,e.dimension,e.vector_blob AS vectorBlob,
      c.source_id AS sourceId,c.ordinal,c.content,c.page_number AS page,c.heading_path AS heading,
      s.display_name AS displayName,s.source_uri AS sourceUri,s.modified_at AS modifiedAt
      FROM chunk_embeddings e JOIN knowledge_chunks c ON c.id=e.chunk_id
      JOIN knowledge_sources s ON s.id=c.source_id
      WHERE e.profile_id=? AND s.workspace_id=? AND s.status='ready'`).all(profileId, workspaceId);
  }
  createJob(sourceId, profileId) {
    const id = randomUUID(); const now = this.now();
    const total = this.pendingChunks(sourceId, profileId).length;
    this.db.prepare(`INSERT INTO embedding_jobs(id,source_id,profile_id,status,total_chunks,created_at,updated_at)
      VALUES(?,?,?,'pending',?,?,?)`).run(id, sourceId, profileId, total, now, now);
    return id;
  }
  setJob(id, status, { completed, error } = {}) {
    this.db.prepare(`UPDATE embedding_jobs SET status=?,completed_chunks=COALESCE(?,completed_chunks),
      error_message=?,updated_at=? WHERE id=?`).run(status, completed ?? null, error ?? null, this.now(), id);
  }
  job(id) { return this.db.prepare('SELECT * FROM embedding_jobs WHERE id=?').get(id); }
  recoverInterrupted() {
    return this.db.prepare(`UPDATE embedding_jobs SET status='pending',error_message='Embedding interrupted',updated_at=?
      WHERE status='running'`).run(this.now()).changes;
  }
}
