// Lumicos knowledge library (RAG).
// Files dropped into <workspace>/knowledge are indexed automatically (on start and when the folder
// changes): text is split into chunks, embedded with multilingual-e5-small (CPU, local) and stored in
// data/knowledge.db. Chat asks search() for evidence; only chunks that clearly match are returned, so
// unrelated questions get nothing (the same "no incidental matches" rule as memory).
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { SqliteKnowledgeStore } from './storage/sqliteStore.mjs';
import { KnowledgeSourceRepository } from './storage/sourceRepository.mjs';
import { VectorRepository } from './storage/vectorRepository.mjs';
import { TransformersEmbedder } from './embedding/transformersEmbedder.mjs';
import { EmbeddingQueue } from './embedding/queue.mjs';
import { decodeVector } from './embedding/vectorCodec.mjs';
import { extractDocument } from './ingest/extractor.mjs';
import { sha256 } from './ingest/chunker.mjs';
import { keywordText, tokenizeKnowledgeText } from './text/tokens.mjs';
import { searchTerms } from './askWords.mjs';

export const KNOWLEDGE_EXTENSIONS = new Set(['.md', '.markdown', '.txt', '.csv', '.json', '.pdf', '.docx', '.xlsx']);
const MAX_FILE_BYTES = 30 * 1024 * 1024;
// multilingual-e5 cosine scores sit in a narrow band (unrelated Thai text still scores ~0.78-0.84),
// so relevance needs a high bar. Calibrated on Thai questions about the 2026 notes vs. unrelated chat.
export const STRONG_SIMILARITY = 0.85;
export const KEYWORD_SIMILARITY = 0.835;
export const KEYWORD_SCORE = 4;
export const NEAR_SIMILARITY = 0.84;
export const EXPLICIT_SIMILARITY = 0.80;
export const FOLLOW_UP_SIMILARITY = 0.81;
// Above this, meaning is clear enough that exact compound words are not required.
export const COMPOUND_EXEMPT_SIMILARITY = 0.86;
// Question words and filler: not evidence that a chunk is about the same thing.
const FILLER = new Set(('ใคร อะไร ไหน อันไหน เท่าไหร่ เท่าไร เท่า ไหร่ กี่ เมื่อไหร่ ยังไง อย่างไร ไหม มั้ย คือ เป็น ได้ ที่ ของ และ หรือ ใน กับ ว่า นะ ค่ะ คะ ครับ จ้า หน่อย '
  + 'ช่วย ลอง ค้น ดู หา บอก rag อยาก รู้ ปี ปีนี้ ตอน ตอนนี้ ล่าสุด ปัจจุบัน บ้าง แล้ว ก็ สิ ทำไม เยอะ สุด the a an of is are was who what which when where how in on did does won '
  // claude-20261024: "…เรื่อง X ไว้…", "มีข้อมูลเกี่ยวกับ X", "สรุปจาก…" say how to ask, not what about.
  + 'เรื่อง เกี่ยวกับ เกี่ยว ไว้ มี ข้อมูล สรุป จาก').split(' '));
/** Share of the question's meaningful words that the chunk contains (Thai questions only). */
function keyCoverage(queryTokens, content, compounds, similarity = 0) {
  if (!queryTokens.length) return 1;
  const text = content.toLowerCase(); const tokens = new Set(tokenizeKnowledgeText(content));
  const share = queryTokens.filter((t) => tokens.has(t) || text.includes(t)).length / queryTokens.length;
  // Two-word questions ("ราคาทอง") must match both words.
  const base = queryTokens.length < 3 ? (share === 1 ? 1 : 0) : share;
  // Thai writes compounds without spaces ("ไทยลีก"); a chunk about "พรีเมียร์ลีก" shares "ลีก" but not the
  // compound. At least half of the compounds written in the question must appear in the chunk.
  if (compounds?.length && similarity < COMPOUND_EXEMPT_SIMILARITY) {
    const kept = compounds.filter((c) => text.includes(c)).length / compounds.length;
    if (kept < 0.5) return 0;
  }
  return base;
}
/** Adjacent meaningful words written together in the question, e.g. "ไทย"+"ลีก" -> "ไทยลีก". */
function compoundsOf(query, keys) {
  const raw = String(query).toLowerCase(); const tokens = tokenizeKnowledgeText(query);
  const out = [];
  for (let i = 0; i + 1 < tokens.length; i++) {
    const pair = tokens[i] + tokens[i + 1];
    if (keys.includes(tokens[i]) && keys.includes(tokens[i + 1]) && raw.includes(pair)) out.push(pair);
  }
  return [...new Set(out)];
}
export const NEAR_KEYWORD_SCORE = 2.5;

export class KnowledgeLibrary {
  constructor({ dataDir, folder, workspaceId = 'default', embedder, log = console } = {}) {
    this.folder = path.resolve(folder);
    this.workspaceId = workspaceId;
    this.log = log;
    this.store = new SqliteKnowledgeStore(path.join(dataDir, 'knowledge.db'));
    this.store.migrate();
    this.sources = new KnowledgeSourceRepository(this.store);
    this.vectors = new VectorRepository(this.store);
    this.sources.recoverInterrupted();
    this.vectors.recoverInterrupted?.();
    this.embedder = embedder ?? new TransformersEmbedder({ modelRoot: path.join(dataDir, 'models', 'embeddings'), timeoutMs: 60_000 });
    this.queue = new EmbeddingQueue(this.vectors, this.embedder);
    this.syncing = null; this.again = false; this.lastSync = null; this.lastError = null;
  }

  get profileId() { return this.embedder.profile.id; }

  /** Sources under the knowledge folder that are indexed and embedded. */
  readySources() {
    return this.sources.list({ workspaceId: this.workspaceId, status: 'ready' }).filter((s) => this.#inside(s.sourceUri));
  }

  hasDocuments() {
    if (this.cachedCount === undefined) this.cachedCount = this.readySources().length;
    return this.cachedCount > 0;
  }

  status() {
    const all = this.sources.list({ workspaceId: this.workspaceId }).filter((s) => this.#inside(s.sourceUri));
    return { folder: this.folder, syncing: !!this.syncing, lastSync: this.lastSync, lastError: this.lastError,
      documents: all.map((s) => ({ name: path.relative(this.folder, s.sourceUri), status: s.status,
        chunks: this.sources.chunkCount(s.id), error: s.errorMessage ?? undefined, indexedAt: s.indexedAt })) };
  }

  /** Index new/changed files, embed them, and forget files that were deleted. Safe to call often. */
  sync() {
    if (this.syncing) { this.again = true; return this.syncing; }
    this.syncing = (async () => {
      let summary;
      do { this.again = false; summary = await this.#syncOnce(); } while (this.again);
      return summary;
    })().finally(() => { this.syncing = null; this.cachedCount = undefined; });
    return this.syncing;
  }

  async #syncOnce() {
    await fsp.mkdir(this.folder, { recursive: true });
    const files = await this.#listFiles(this.folder, 0);
    const seen = new Set(files.map((f) => f.path.toLowerCase()));
    const summary = { indexed: 0, unchanged: 0, removed: 0, failed: 0 };
    for (const source of this.sources.list({ workspaceId: this.workspaceId })) {
      if (this.#inside(source.sourceUri) && !seen.has(source.sourceUri.toLowerCase())) {
        this.sources.remove(source.id); summary.removed++;
      }
    }
    for (const file of files) {
      try {
        const changed = await this.#indexFile(file);
        summary[changed ? 'indexed' : 'unchanged']++;
      } catch (error) {
        summary.failed++;
        this.log.warn?.(`[knowledge] ${path.basename(file.path)}: ${error.message}`);
      }
    }
    this.lastSync = new Date().toISOString();
    this.lastError = summary.failed ? `${summary.failed} file(s) could not be indexed` : null;
    if (summary.indexed || summary.removed) this.log.log?.(`[knowledge] indexed ${summary.indexed}, removed ${summary.removed}, unchanged ${summary.unchanged}`);
    return summary;
  }

  async #indexFile(file) {
    const modifiedAt = new Date(file.mtimeMs).toISOString();
    const displayName = path.basename(file.path);
    const existing = this.sources.getByUri(file.path, this.workspaceId);
    const embedded = existing && this.vectors.pendingChunks(existing.id, this.profileId).length === 0;
    if (existing?.status === 'ready' && existing.modifiedAt === modifiedAt && existing.fileSize === file.size && embedded) return false;
    const buffer = await fsp.readFile(file.path);
    const source = this.sources.register({ workspaceId: this.workspaceId, sourceUri: file.path, displayName,
      sourceType: 'file', fileSize: buffer.length, modifiedAt });
    try {
      const extracted = await extractDocument(displayName, buffer, { maxChars: 900 });
      // Keep the section heading with each chunk: it helps both the embedding and the reader.
      const chunks = extracted.chunks.filter((c) => c.content.trim()).map((chunk) => {
        const content = chunk.heading ? `${chunk.heading}\n${chunk.content}` : chunk.content;
        return { ...chunk, content, keywordText: keywordText(content), contentHash: sha256(content) };
      });
      if (this.sources.needsIndex(source.id, extracted.contentHash)) {
        this.sources.setStatus(source.id, 'indexing');
        this.sources.replaceDocument(source.id, { contentHash: extracted.contentHash, chunks,
          metadata: { kind: extracted.kind, ...extracted.metadata }, fileSize: buffer.length, modifiedAt });
      }
      await this.queue.enqueue(source.id).done;
      return true;
    } catch (error) {
      this.sources.setStatus(source.id, 'error', String(error?.message ?? error).slice(0, 500));
      throw error;
    }
  }

  async #listFiles(dir, depth) {
    const out = [];
    const entries = await fsp.readdir(dir, { withFileTypes: true }).catch(() => []);
    for (const entry of entries) {
      if (entry.name.startsWith('.') || entry.name.startsWith('~$')) continue;
      // Archived/quarantined knowledge must stay on disk but must never be embedded.
      if (entry.isDirectory() && entry.name.toLowerCase() === '_archive') continue;
      const abs = path.join(dir, entry.name);
      if (entry.isDirectory()) { if (depth < 4) out.push(...await this.#listFiles(abs, depth + 1)); continue; }
      if (!entry.isFile() || !KNOWLEDGE_EXTENSIONS.has(path.extname(entry.name).toLowerCase())) continue;
      const st = await fsp.stat(abs).catch(() => null);
      if (st && st.size > 0 && st.size <= MAX_FILE_BYTES) out.push({ path: abs, size: st.size, mtimeMs: Math.floor(st.mtimeMs) });
    }
    return out;
  }

  #inside(uri) {
    const rel = path.relative(this.folder, String(uri ?? ''));
    return !!rel && !rel.startsWith('..') && !path.isAbsolute(rel);
  }

  /** Re-index a few seconds after the folder changes (files are often written in several steps). */
  watch() {
    if (this.watcher) return;
    try {
      fs.mkdirSync(this.folder, { recursive: true });
      this.watcher = fs.watch(this.folder, { recursive: true }, () => {
        clearTimeout(this.timer);
        this.timer = setTimeout(() => void this.sync().catch((e) => this.log.warn?.(`[knowledge] sync failed: ${e.message}`)), 3000);
        this.timer.unref?.();
      });
      this.watcher.on('error', () => {});
    } catch (error) { this.log.warn?.(`[knowledge] cannot watch ${this.folder}: ${error.message}`); }
  }

  /**
   * Evidence for a question. A chunk qualifies when its meaning is very close (cosine >= 0.85), or
   * close (>= 0.84 / >= 0.82) and it also shares keywords (BM25 >= 2.5 / >= 4) with the question. Returns [] otherwise.
   */
  async search(query, { limit = 4, explicit = false, context = '' } = {}) {
    // "ค้นเว็บ …", "ในคลังความรู้ของเรา", "เขียนไว้ว่ายังไง" say where/how to look, not what about (askWords.mjs).
    ({ query, context } = searchTerms(query, context));
    // A short follow-up ("ของปี 2026 สิ") is searched together with the previous question, but only
    // when the follow-up itself is at least loosely about the notes; otherwise a new topic
    // ("ช่วยแต่งกลอน") would drag the old one back in.
    if (context && String(query ?? '').trim()) {
      const own = await this.#search(query, { limit, explicit, keepAll: true });
      if (own.best >= FOLLOW_UP_SIMILARITY || explicit) {
        const joined = await this.#search(`${context} ${query}`, { limit, explicit });
        if (joined.hits.length) return joined.hits;
      }
      return own.hits;
    }
    return (await this.#search(query, { limit, explicit })).hits;
  }

  async #search(query, { limit, explicit, keepAll = false }) {
    const none = { hits: [], best: 0 };
    if (!String(query ?? '').trim() || !this.hasDocuments()) return none;
    const candidates = this.vectors.candidates(this.profileId, this.workspaceId).filter((c) => this.#inside(c.sourceUri));
    if (!candidates.length) return none;
    const q = await this.embedder.embedQuery(String(query).slice(0, 2000));
    const keyword = new Map(this.sources.search(query, { workspaceId: this.workspaceId, limit: 20 }).map((r) => [r.id, r.score]));
    // Embeddings alone confuse "แชมป์ไทยลีก" with "แชมป์บอลโลก"; a Thai question must also share most of its key words.
    const thai = /[\u0E00-\u0E7F]/.test(query);
    const keys = thai ? [...new Set(tokenizeKnowledgeText(query))].filter((t) => t.length > 1 && !FILLER.has(t) && !/^[\d.,%/]+$/.test(t)) : [];
    const compounds = thai ? compoundsOf(query, keys) : [];
    const all = candidates.map((c) => {
      const v = decodeVector(c.vectorBlob, c.dimension);
      let similarity = 0;
      for (let i = 0; i < q.length; i++) similarity += q[i] * v[i];
      const keywordScore = keyword.get(c.chunkId) ?? 0;
      // The user asked to look in the notes ("ค้นใน RAG", "ในเอกสาร"): show the closest chunks even if weaker.
      const sourcesOnly = /(?:^|>\s*)(?:แหล่งที่มา|sources?|references?)\s*$/i.test(String(c.heading ?? ''));
      const covered = keyCoverage(keys, c.content, compounds, similarity) >= 0.6;
      const relevant = !sourcesOnly && covered && ((explicit && similarity >= EXPLICIT_SIMILARITY) || similarity >= STRONG_SIMILARITY || (similarity >= NEAR_SIMILARITY && keywordScore >= NEAR_KEYWORD_SCORE)
        || (similarity >= KEYWORD_SIMILARITY && keywordScore >= KEYWORD_SCORE));
      return { id: c.chunkId, chunkId: c.chunkId, sourceId: c.sourceId, ordinal: c.ordinal, content: c.content, page: c.page,
        heading: c.heading, displayName: c.displayName, sourceUri: c.sourceUri, modifiedAt: c.modifiedAt, similarity, keywordScore, relevant };
    });
    const best = all.reduce((max, c) => Math.max(max, c.similarity), 0);
    const scored = all.filter((c) => c.relevant).sort((a, b) => b.similarity - a.similarity);
    if (!scored.length) return { hits: [], best };
    // Drop weak tail results: anything far below the best match is usually a different topic.
    const top = scored[0].similarity;
    return { best, hits: scored.filter((c) => c.similarity >= top - (explicit ? 0.04 : 0.02)).slice(0, explicit ? 3 : limit) };
  }

  /**
   * Saves something Lumicos found on the web into workspace/knowledge/learned/<yyyy-mm>/ as Markdown,
   * then indexes it. Called after the user confirms ("ถูกต้อง เก็บไว้") or in auto mode.
   */
  async learn({ question, answer, sources = [], confirmed = true } = {}) {
    const q = String(question ?? '').replace(/\s+/g, ' ').trim().slice(0, 300);
    const body = String(answer ?? '').replace(/\r\n/g, '\n').replace(/\[(?:E\d+|\d+)\]/g, '').trim().slice(0, 6000);
    if (!q || body.length < 20) throw Object.assign(new Error('ไม่มีข้อมูลพอจะบันทึก'), { status: 400 });
    const links = (Array.isArray(sources) ? sources : []).map((s) => ({ title: String(s?.title ?? '').replace(/\s+/g, ' ').trim().slice(0, 200), url: String(s?.url ?? '') }))
      .filter((s) => /^https?:\/\//i.test(s.url)).slice(0, 8);
    const now = new Date();
    const day = new Date(now.getTime() + 7 * 3600_000).toISOString().slice(0, 10); // Thai date
    const dir = path.join(this.folder, 'learned', day.slice(0, 7));
    await fsp.mkdir(dir, { recursive: true });
    const slug = q.replace(/[\\/:*?"<>|#\[\]\n\r\t]+/g, ' ').replace(/\s+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60) || 'note';
    let file = path.join(dir, `${day}-${slug}.md`);
    const text = [`# ${q}`, '',
      `บันทึกเมื่อ ${day} · ที่มา: ค้นเว็บ · ${confirmed ? 'ผู้ใช้ยืนยันว่าถูกต้อง' : 'บันทึกอัตโนมัติ (ยังไม่ได้ยืนยัน)'}`,
      'ข้อมูลอาจเปลี่ยนหลังวันที่บันทึก ถ้าถามเรื่องล่าสุดควรค้นเว็บซ้ำ', '',
      `## ${q}`, body, '',
      ...(links.length ? ['## แหล่งที่มา', ...links.map((l) => `- ${l.title ? `${l.title} ` : ''}${l.url}`)] : []), ''].join('\n');
    // Same answer saved twice (double tap): reuse the existing file instead of writing a copy.
    for (let n = 2; fs.existsSync(file); n++) {
      if (await fsp.readFile(file, 'utf8').catch(() => '') === text) return { file: path.relative(this.folder, file), status: this.sources.getByUri(file, this.workspaceId)?.status ?? 'pending' };
      file = path.join(dir, `${day}-${slug}-${n}.md`);
    }
    await fsp.writeFile(file, text, 'utf8');
    await this.sync();
    return { file: path.relative(this.folder, file), status: this.sources.getByUri(file, this.workspaceId)?.status ?? 'pending' };
  }

  /**
   * Saves a note Lumicos researched herself (server/agent/research.mjs) into knowledge/learned/<yyyy-mm>/ with
   * numbered sources, so the note's [n] marks still point at a source (learn() strips them).
   */
  async saveNote({ title, body, sources = [], topic } = {}) {
    const t = String(title ?? '').replace(/\s+/g, ' ').trim().slice(0, 200);
    const text = String(body ?? '').replace(/\r\n/g, '\n').trim().slice(0, 8000);
    if (!t || text.length < 20) throw Object.assign(new Error('ไม่มีข้อมูลพอจะบันทึก'), { status: 400 });
    const links = (Array.isArray(sources) ? sources : []).slice(0, 12).map((s) => ({ title: String(s?.title ?? '').replace(/\s+/g, ' ').trim().slice(0, 200),
      url: String(s?.url ?? ''), date: /^\d{4}-\d{2}-\d{2}/.test(String(s?.publishedAt ?? '')) ? String(s.publishedAt).slice(0, 10) : '' }));
    const day = new Date(Date.now() + 7 * 3600_000).toISOString().slice(0, 10); // Thai date
    const dir = path.join(this.folder, 'learned', day.slice(0, 7));
    await fsp.mkdir(dir, { recursive: true });
    const slug = t.replace(/[\\/:*?"<>|#[\]\n\r\t]+/g, ' ').replace(/\s+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60) || 'note';
    const md = [`# ${t}`, '',
      `บันทึกเมื่อ ${day} · ที่มา: Lumicos ค้นเว็บเองแล้วสรุป (งานค้นคว้า${topic ? ` เรื่อง "${String(topic).replace(/\s+/g, ' ').slice(0, 120)}"` : ''}) · ตรวจตัวเลขในแต่ละข้อกับแหล่งแล้ว`,
      'ข้อมูลอาจเปลี่ยนหลังวันที่บันทึก ถ้าถามเรื่องล่าสุดควรค้นเว็บซ้ำ', '', text, '',
      ...(links.length ? ['## แหล่งที่มา', ...links.map((l, i) => `${i + 1}. ${l.title ? `${l.title} — ` : ''}${l.url}${l.date ? ` (${l.date})` : ''}`)] : []), ''].join('\n');
    let file = path.join(dir, `${day}-${slug}.md`);
    for (let n = 2; fs.existsSync(file); n++) file = path.join(dir, `${day}-${slug}-${n}.md`);
    await fsp.writeFile(file, md, 'utf8');
    await this.sync();
    return { file: path.relative(this.folder, file).replace(/\\/g, '/'), status: this.sources.getByUri(file, this.workspaceId)?.status ?? 'pending' };
  }

  async close() {
    clearTimeout(this.timer); this.watcher?.close();
    await this.embedder.close?.(); this.store.close();
  }
}
