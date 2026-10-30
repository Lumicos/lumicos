// Chat attachments: files the user attaches to a message.
// They go to data/attachments/<id>/ (a cache, NOT the workspace) so the model
// can read them. They only enter the workspace when the user (or an approved
// tool call) imports them. The cache can be cleared from Settings.
import fs from 'node:fs/promises';
import fssync from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { toSegments } from '../files/paths.mjs';
import { contextFor, extractText, SUPPORTED_EXTS } from '../files/fileContext.mjs';
import { renderPdfPage } from '../files/formats/pdf.mjs';

const MAX_ATTACHMENT = 20 * 1024 * 1024;

export class AttachmentService {
  constructor(dir) {
    this.dir = dir;
  }

  async add(name, buf) {
    // oxlint-disable-next-line no-control-regex -- rejecting control characters is the point
    const safe = path.basename(String(name ?? 'file')).replace(/[<>:"/\\|?*\x00-\x1f]/g, '_').slice(0, 150) || 'file';
    toSegments(safe);
    const ext = path.extname(safe).toLowerCase();
    if (!SUPPORTED_EXTS.includes(ext)) throw Object.assign(new Error(`Unsupported file type "${ext || safe}". Supported: ${SUPPORTED_EXTS.join(', ')}`), { status: 415 });
    if (buf.length > MAX_ATTACHMENT) throw Object.assign(new Error('Attachment is larger than 20 MB.'), { status: 413 });

    const extracted = await extractText(safe, buf);
    const id = randomUUID();
    const folder = path.join(this.dir, id);
    await fs.mkdir(folder, { recursive: true });
    await fs.writeFile(path.join(folder, safe), buf);
    const ctx = contextFor(extracted.text, { maxChars: 5000 });
    const info = { id, name: safe, size: buf.length, kind: extracted.kind, meta: extracted.meta, totalChunks: ctx.totalChunks, addedAt: new Date().toISOString() };
    await fs.writeFile(path.join(folder, 'info.json'), JSON.stringify(info));
    return { ...info, context: ctx.content, complete: ctx.complete };
  }

  async get(id) {
    if (!/^[0-9a-f-]{36}$/.test(id)) throw Object.assign(new Error('Bad attachment id.'), { status: 400 });
    const folder = path.join(this.dir, id);
    if (!fssync.existsSync(path.join(folder, 'info.json'))) throw Object.assign(new Error('Attachment not found (the cache may have been cleared).'), { status: 404 });
    const info = JSON.parse(await fs.readFile(path.join(folder, 'info.json'), 'utf8'));
    return { info, file: path.join(folder, info.name) };
  }

  async read(id, { part, query } = {}) {
    const { info, file } = await this.get(id);
    const extracted = await extractText(info.name, await fs.readFile(file));
    return { info, ...contextFor(extracted.text, { chunk: part != null ? part - 1 : undefined, query }) };
  }

  async renderPdfPage(id, pageNumber) {
    const { info, file } = await this.get(id);

    if (info.kind !== 'pdf') {
      throw Object.assign(
        new Error('This attachment is not a PDF.'),
        { status: 415 }
      );
    }

    if (!Number.isInteger(pageNumber) || pageNumber < 1) {
      throw Object.assign(
        new Error('Invalid PDF page number.'),
        { status: 400 }
      );
    }

    return renderPdfPage(await fs.readFile(file), pageNumber);
  }

  async clear() {
    if (!fssync.existsSync(this.dir)) return { removed: 0 };
    const entries = await fs.readdir(this.dir);
    await fs.rm(this.dir, { recursive: true, force: true });
    return { removed: entries.length };
  }

  async usage() {
    if (!fssync.existsSync(this.dir)) return { count: 0, bytes: 0 };
    let bytes = 0;
    const ids = await fs.readdir(this.dir);
    for (const id of ids) {
      for (const f of await fs.readdir(path.join(this.dir, id)).catch(() => [])) {
        bytes += (await fs.stat(path.join(this.dir, id, f)).catch(() => ({ size: 0 }))).size;
      }
    }
    return { count: ids.length, bytes };
  }
}
