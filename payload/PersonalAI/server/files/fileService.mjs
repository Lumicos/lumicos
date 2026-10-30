// FileService: every filesystem operation on the workspace.
// Callers pass workspace-relative paths; Workspace.resolve() enforces confinement.
import fs from 'node:fs/promises';
import fssync from 'node:fs';
import path from 'node:path';
import { isHiddenName, PathError, toSegments } from './paths.mjs';

export class FileError extends Error {
  constructor(message, code = 'FILE_ERROR', status = 400) {
    super(message);
    this.code = code;
    this.status = status;
  }
}

const MAX_READ_BYTES = 25 * 1024 * 1024;
const MAX_WRITE_BYTES = 25 * 1024 * 1024;

export const TEXT_EXTS = new Set(['.txt', '.md', '.markdown', '.csv', '.json', '.log']);

export function typeOf(name, isDir) {
  if (isDir) return 'folder';
  const ext = path.extname(name).toLowerCase();
  if (ext === '.md' || ext === '.markdown') return 'markdown';
  if (ext === '.txt' || ext === '.log') return 'text';
  if (ext === '.csv') return 'csv';
  if (ext === '.json') return 'json';
  if (ext === '.docx') return 'docx';
  if (ext === '.xlsx') return 'xlsx';
  if (['.png', '.jpg', '.jpeg', '.gif', '.webp'].includes(ext)) return 'image';
  if (ext === '.pdf') return 'pdf';
  return 'file';
}

const stamp = () => new Date().toISOString().replace(/[-:]/g, '').replace('T', '-').slice(0, 15);

export class FileService {
  /** @param {import('./paths.mjs').Workspace} workspace @param {string} backupDir */
  constructor(workspace, backupDir) {
    this.ws = workspace;
    this.backupDir = backupDir;
  }

  /* ---------------- queries ---------------- */

  async exists(rel) {
    const { abs } = this.ws.resolve(rel);
    return fssync.existsSync(abs);
  }

  async stat(rel) {
    const { abs, rel: clean } = this.ws.resolve(rel);
    const st = await fs.stat(abs).catch(() => {
      throw new FileError(`Not found: ${clean || '/'}`, 'NOT_FOUND', 404);
    });
    const name = clean ? path.basename(abs) : '';
    return {
      name,
      path: clean,
      type: typeOf(name, st.isDirectory()),
      ext: st.isDirectory() ? '' : path.extname(name).toLowerCase(),
      size: st.isDirectory() ? 0 : st.size,
      modified: st.mtime.toISOString(),
      created: st.birthtime.toISOString(),
    };
  }

  async list(rel = '', { recursive = false, maxEntries = 500 } = {}) {
    const { abs, rel: base } = this.ws.resolve(rel);
    const st = await fs.stat(abs).catch(() => null);
    if (!st) throw new FileError(`Folder not found: ${base || '/'}`, 'NOT_FOUND', 404);
    if (!st.isDirectory()) throw new FileError(`Not a folder: ${base}`, 'NOT_A_FOLDER');

    const out = [];
    const walk = async (dirAbs, dirRel, depth) => {
      const entries = await fs.readdir(dirAbs, { withFileTypes: true });
      for (const e of entries) {
        if (out.length >= maxEntries) return;
        if (isHiddenName(e.name) || e.isSymbolicLink()) continue;
        const childRel = dirRel ? `${dirRel}/${e.name}` : e.name;
        const childAbs = path.join(dirAbs, e.name);
        const s = await fs.stat(childAbs).catch(() => null);
        if (!s) continue;
        out.push({
          name: e.name,
          path: childRel,
          type: typeOf(e.name, s.isDirectory()),
          ext: s.isDirectory() ? '' : path.extname(e.name).toLowerCase(),
          size: s.isDirectory() ? 0 : s.size,
          modified: s.mtime.toISOString(),
        });
        if (recursive && s.isDirectory() && depth < 8) await walk(childAbs, childRel, depth + 1);
      }
    };
    await walk(abs, base, 0);
    out.sort((a, b) => (a.type === 'folder') === (b.type === 'folder') ? a.path.localeCompare(b.path) : a.type === 'folder' ? -1 : 1);
    return { path: base, entries: out, truncated: out.length >= maxEntries };
  }

  async readBytes(rel) {
    const { abs, rel: clean } = this.ws.resolve(rel);
    const st = await fs.stat(abs).catch(() => null);
    if (!st) throw new FileError(`File not found: ${clean}`, 'NOT_FOUND', 404);
    if (st.isDirectory()) throw new FileError(`"${clean}" is a folder.`, 'IS_A_FOLDER');
    if (st.size > MAX_READ_BYTES) throw new FileError(`File is too large to read (${Math.round(st.size / 1e6)} MB).`, 'TOO_LARGE');
    return fs.readFile(abs);
  }

  async readText(rel) {
    return (await this.readBytes(rel)).toString('utf8').replace(/^﻿/, '');
  }

  /** "notes/a.md" -> "notes/a (2).md" if taken. */
  async uniquePath(rel) {
    const { abs, rel: clean } = this.ws.resolve(rel);
    if (!fssync.existsSync(abs)) return clean;
    const dir = path.posix.dirname(clean);
    const ext = path.posix.extname(clean);
    const stem = path.posix.basename(clean, ext).replace(/ \(\d+\)$/, '');
    for (let i = 2; i < 1000; i++) {
      const candidate = `${dir === '.' ? '' : dir + '/'}${stem} (${i})${ext}`;
      if (!fssync.existsSync(this.ws.resolve(candidate).abs)) return candidate;
    }
    throw new FileError('Could not find a free file name.');
  }

  /* ---------------- mutations ---------------- */

  /** Copies a file into data/backups/<timestamp>/<path> before it is changed. */
  async backup(rel) {
    const { abs, rel: clean } = this.ws.resolve(rel);
    if (!fssync.existsSync(abs) || fssync.statSync(abs).isDirectory()) return null;
    const dest = path.join(this.backupDir, stamp(), ...clean.split('/'));
    await fs.mkdir(path.dirname(dest), { recursive: true });
    await fs.copyFile(abs, dest);
    return path.relative(path.dirname(this.backupDir), dest).split(path.sep).join('/');
  }

  /**
   * mode: 'create'    -> new file; if taken, a unique name is used (never overwrites)
   *       'overwrite' -> replace (a backup is made first)
   *       'append'    -> add to the end (text only; backup first)
   */
  async write(rel, data, { mode = 'create' } = {}) {
    const buf = Buffer.isBuffer(data) ? data : Buffer.from(String(data), 'utf8');
    if (buf.length > MAX_WRITE_BYTES) throw new FileError('Content is too large.', 'TOO_LARGE');
    let target = this.ws.resolve(rel).rel;
    if (!target) throw new FileError('A file name is required.');
    const { abs: absTarget } = this.ws.resolve(target);
    if (fssync.existsSync(absTarget) && fssync.statSync(absTarget).isDirectory()) {
      throw new FileError(`"${target}" is a folder.`, 'IS_A_FOLDER');
    }

    let backup = null;
    let renamed = false;
    if (mode === 'create') {
      const unique = await this.uniquePath(target);
      renamed = unique !== target;
      target = unique;
    } else if (fssync.existsSync(absTarget)) {
      backup = await this.backup(target);
    }

    const { abs } = this.ws.resolve(target);
    await fs.mkdir(path.dirname(abs), { recursive: true });
    if (mode === 'append' && fssync.existsSync(abs)) {
      const existing = await fs.readFile(abs, 'utf8');
      const sep = existing.length && !existing.endsWith('\n') ? '\n' : '';
      await fs.appendFile(abs, sep + buf.toString('utf8'));
    } else {
      await fs.writeFile(abs, buf);
    }
    return { path: target, renamed, backup, bytes: buf.length };
  }

  async mkdir(rel) {
    const { abs, rel: clean } = this.ws.resolve(rel);
    if (!clean) throw new FileError('Folder name is required.');
    if (fssync.existsSync(abs) && !fssync.statSync(abs).isDirectory()) throw new FileError(`A file named "${clean}" already exists.`, 'EXISTS');
    await fs.mkdir(abs, { recursive: true });
    return { path: clean };
  }

  async rename(rel, newName) {
    if (typeof newName !== 'string' || /[\\/]/.test(newName)) throw new PathError('New name must be a plain name without slashes.');
    toSegments(newName);
    const { abs, rel: clean } = this.ws.resolve(rel);
    if (!clean) throw new FileError('Cannot rename the workspace root.');
    if (!fssync.existsSync(abs)) throw new FileError(`Not found: ${clean}`, 'NOT_FOUND', 404);
    const parent = path.posix.dirname(clean);
    const target = parent === '.' ? newName : `${parent}/${newName}`;
    const { abs: absTarget } = this.ws.resolve(target);
    if (fssync.existsSync(absTarget) && absTarget.toLowerCase() !== abs.toLowerCase()) {
      throw new FileError(`"${target}" already exists.`, 'EXISTS', 409);
    }
    await fs.rename(abs, absTarget);
    return { from: clean, path: target };
  }

  /** Moves into a folder (if `to` is an existing folder) or to the exact path `to`. Never overwrites. */
  async move(from, to) {
    const src = this.ws.resolve(from);
    if (!src.rel) throw new FileError('Cannot move the workspace root.');
    if (!fssync.existsSync(src.abs)) throw new FileError(`Not found: ${src.rel}`, 'NOT_FOUND', 404);
    let dest = this.ws.resolve(to);
    if (fssync.existsSync(dest.abs) && fssync.statSync(dest.abs).isDirectory()) {
      dest = this.ws.resolve(dest.rel ? `${dest.rel}/${path.basename(src.abs)}` : path.basename(src.abs));
    }
    if (fssync.existsSync(dest.abs)) throw new FileError(`"${dest.rel}" already exists.`, 'EXISTS', 409);
    if ((dest.abs + path.sep).startsWith(src.abs + path.sep)) throw new FileError('Cannot move a folder into itself.');
    await fs.mkdir(path.dirname(dest.abs), { recursive: true });
    await fs.rename(src.abs, dest.abs);
    return { from: src.rel, path: dest.rel };
  }

  /** Copies; if the destination exists, a unique name is used. */
  async copy(from, to) {
    const src = this.ws.resolve(from);
    if (!fssync.existsSync(src.abs)) throw new FileError(`Not found: ${src.rel}`, 'NOT_FOUND', 404);
    let destRel = this.ws.resolve(to).rel;
    const destAbs0 = this.ws.resolve(destRel).abs;
    if (fssync.existsSync(destAbs0) && fssync.statSync(destAbs0).isDirectory()) {
      destRel = destRel ? `${destRel}/${path.basename(src.abs)}` : path.basename(src.abs);
    }
    destRel = await this.uniquePath(destRel);
    const dest = this.ws.resolve(destRel);
    if ((dest.abs + path.sep).startsWith(src.abs + path.sep)) throw new FileError('Cannot copy a folder into itself.');
    await fs.mkdir(path.dirname(dest.abs), { recursive: true });
    await fs.cp(src.abs, dest.abs, { recursive: true, errorOnExist: true, force: false });
    return { from: src.rel, path: dest.rel };
  }

  /** Deletes a file or folder. A copy goes to data/backups first (files only). */
  async remove(rel) {
    const { abs, rel: clean } = this.ws.resolve(rel);
    if (!clean) throw new FileError('Cannot delete the workspace root.');
    if (!fssync.existsSync(abs)) throw new FileError(`Not found: ${clean}`, 'NOT_FOUND', 404);
    const isDir = fssync.statSync(abs).isDirectory();
    let backup = null;
    if (isDir) {
      const dest = path.join(this.backupDir, stamp(), ...clean.split('/'));
      await fs.mkdir(path.dirname(dest), { recursive: true });
      await fs.cp(abs, dest, { recursive: true });
      backup = path.relative(path.dirname(this.backupDir), dest).split(path.sep).join('/');
    } else {
      backup = await this.backup(clean);
    }
    await fs.rm(abs, { recursive: true, force: false });
    return { path: clean, wasFolder: isDir, backup };
  }
}
