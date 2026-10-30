// Reads the metadata header of a GGUF file (llama.cpp's model format) without
// loading the model: architecture, name, context length, embedding size, and for
// projector files (mmproj) the projection size. An explicit manual capability
// inspection may additionally scan tokenizer metadata for an embedded chat template.
// Read-only; the file is never changed.
//
// Layout: "GGUF" | version u32 | tensor_count u64 | kv_count u64 | kv pairs…
// kv: key (u64 len + utf8) | type u32 | value. Arrays: elem type u32 | count u64 | items.
import fsp from 'node:fs/promises';

const T = { UINT8: 0, INT8: 1, UINT16: 2, INT16: 3, UINT32: 4, INT32: 5, FLOAT32: 6, BOOL: 7, STRING: 8, ARRAY: 9, UINT64: 10, INT64: 11, FLOAT64: 12 };
const SIZE = { 0: 1, 1: 1, 2: 2, 3: 2, 4: 4, 5: 4, 6: 4, 7: 1, 10: 8, 11: 8, 12: 8 };

/** Keys we need; reading stops once the tokenizer section starts (it is huge and comes after). */
const WANTED = /^(general\.(architecture|name|basename|size_label|file_type|quantization_version)|[\w.]+\.(context_length|embedding_length|block_count)|clip\.(has_vision_encoder|has_audio_encoder|projector_type|vision\.projection_dim|vision\.image_size)|clip\.vision\.projection_dim|tokenizer\.chat_template)$/;

class Reader {
  constructor(fh, size) {
    this.fh = fh;
    this.size = size;
    this.pos = 0;
    this.buf = Buffer.alloc(0);
    this.bufStart = 0;
  }
  async need(n) {
    const off = this.pos - this.bufStart;
    if (off + n <= this.buf.length) return;
    const want = Math.max(n, 1 << 20);
    const b = Buffer.alloc(want);
    const { bytesRead } = await this.fh.read(b, 0, want, this.pos);
    if (bytesRead < n) throw new Error('Unexpected end of file (not a complete GGUF file).');
    this.buf = b.subarray(0, bytesRead);
    this.bufStart = this.pos;
  }
  async u32() {
    await this.need(4);
    const v = this.buf.readUInt32LE(this.pos - this.bufStart);
    this.pos += 4;
    return v;
  }
  async u64() {
    await this.need(8);
    const v = this.buf.readBigUInt64LE(this.pos - this.bufStart);
    this.pos += 8;
    return v;
  }
  async str() {
    const len = Number(await this.u64());
    if (len > 1 << 24) throw new Error('Corrupt GGUF string length.');
    await this.need(len);
    const s = this.buf.toString('utf8', this.pos - this.bufStart, this.pos - this.bufStart + len);
    this.pos += len;
    return s;
  }
  async scalar(type) {
    const n = SIZE[type];
    await this.need(n);
    const o = this.pos - this.bufStart;
    const b = this.buf;
    this.pos += n;
    switch (type) {
      case T.UINT8: return b.readUInt8(o);
      case T.INT8: return b.readInt8(o);
      case T.UINT16: return b.readUInt16LE(o);
      case T.INT16: return b.readInt16LE(o);
      case T.UINT32: return b.readUInt32LE(o);
      case T.INT32: return b.readInt32LE(o);
      case T.FLOAT32: return b.readFloatLE(o);
      case T.BOOL: return b.readUInt8(o) !== 0;
      case T.UINT64: return Number(b.readBigUInt64LE(o));
      case T.INT64: return Number(b.readBigInt64LE(o));
      case T.FLOAT64: return b.readDoubleLE(o);
    }
    throw new Error(`Unknown GGUF value type ${type}.`);
  }
  async skipArray() {
    const type = await this.u32();
    const count = Number(await this.u64());
    // A damaged file can claim billions of items; real ones (e.g. a 262k-token vocabulary) stay far below this.
    if (count > 50_000_000) throw new Error('Corrupt GGUF array length.');
    if (type === T.STRING) {
      for (let i = 0; i < count; i++) {
        const len = Number(await this.u64());
        this.pos += len;
        if (this.pos > this.size) throw new Error('Unexpected end of file (not a complete GGUF file).');
      }
    } else if (SIZE[type]) this.pos += SIZE[type] * count;
    else throw new Error('Nested GGUF arrays are not supported here.');
    if (this.pos > this.size) throw new Error('Unexpected end of file (not a complete GGUF file).');
  }
}

/**
 * @returns {Promise<{ version: number, architecture?: string, name?: string, contextLength?: number,
 *   embeddingLength?: number, isProjector: boolean, projectionDim?: number, projectorType?: string, hasVision?: boolean, kv: Record<string, unknown> }>}
 */
export async function readGgufInfo(file, { includeChatTemplate = false } = {}) {
  const fh = await fsp.open(file, 'r');
  try {
    const { size } = await fh.stat();
    const r = new Reader(fh, size);
    await r.need(4);
    if (r.buf.toString('latin1', 0, 4) !== 'GGUF') throw Object.assign(new Error('Not a GGUF file (wrong magic bytes).'), { code: 'NOT_GGUF' });
    r.pos = 4;
    const version = await r.u32();
    if (version < 2 || version > 3) throw Object.assign(new Error(`Unsupported GGUF version ${version}.`), { code: 'NOT_GGUF' });
    await r.u64(); // tensor count
    const kvCount = Number(await r.u64());
    const kv = {};
    for (let i = 0; i < kvCount && i < 10000; i++) {
      const key = await r.str();
      if (key.startsWith('tokenizer.') && !includeChatTemplate) break;
      const type = await r.u32();
      if (type === T.ARRAY) {
        await r.skipArray();
        continue;
      }
      const value = type === T.STRING ? await r.str() : await r.scalar(type);
      if (WANTED.test(key)) kv[key] = value;
      if (r.pos > 64 * 1024 * 1024) break;
    }
    const arch = kv['general.architecture'];
    const isProjector = arch === 'clip' || 'clip.projector_type' in kv || 'clip.has_vision_encoder' in kv;
    return {
      version,
      architecture: arch,
      name: kv['general.name'] ?? kv['general.basename'],
      contextLength: arch ? kv[`${arch}.context_length`] : undefined,
      embeddingLength: arch ? kv[`${arch}.embedding_length`] : undefined,
      isProjector,
      projectionDim: kv['clip.vision.projection_dim'],
      projectorType: kv['clip.projector_type'],
      hasVision: isProjector ? kv['clip.has_vision_encoder'] !== false : undefined,
      chatTemplate: kv['tokenizer.chat_template'],
      kv,
    };
  } finally {
    await fh.close();
  }
}

/**
 * Whether a projector fits a text model. Only a DEFINITE mismatch returns ok:false;
 * missing metadata returns ok:null ("unknown"), never a false promise.
 */
export function projectorMatches(model, projector) {
  if (!projector.isProjector) return { ok: false, reason: 'This file is not a vision projector (mmproj).' };
  if (projector.hasVision === false) return { ok: false, reason: 'This projector has no vision encoder (audio only).' };
  if (model.embeddingLength && projector.projectionDim) {
    return model.embeddingLength === projector.projectionDim
      ? { ok: true, reason: `Sizes match (${model.embeddingLength}).` }
      : { ok: false, reason: `Size mismatch: the model uses ${model.embeddingLength}, the projector outputs ${projector.projectionDim}. They are not a pair.` };
  }
  return { ok: null, reason: 'Could not confirm from the file headers; use "Test vision" after starting.' };
}

/** Writes a tiny valid GGUF header (used by the tests). */
export function makeGguf(kv) {
  const parts = [];
  const u32 = (v) => { const b = Buffer.alloc(4); b.writeUInt32LE(v); parts.push(b); };
  const u64 = (v) => { const b = Buffer.alloc(8); b.writeBigUInt64LE(BigInt(v)); parts.push(b); };
  const str = (s) => { const b = Buffer.from(s, 'utf8'); u64(b.length); parts.push(b); };
  parts.push(Buffer.from('GGUF'));
  u32(3);
  u64(0);
  u64(Object.keys(kv).length);
  for (const [k, v] of Object.entries(kv)) {
    str(k);
    if (typeof v === 'string') { u32(T.STRING); str(v); }
    else if (typeof v === 'boolean') { u32(T.BOOL); parts.push(Buffer.from([v ? 1 : 0])); }
    else if (Array.isArray(v)) { u32(T.ARRAY); u32(T.STRING); u64(v.length); for (const s of v) str(s); }
    else { u32(T.UINT32); u32(v); }
  }
  return Buffer.concat(parts);
}
