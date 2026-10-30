// Path security. EVERY file operation resolves its path through here.
//
// Rules (enforced server-side, independent of the UI or the model):
//   - only relative paths inside the workspace root ("notes/a.md")
//   - no absolute paths, drive letters (C:\), UNC paths (\\server), "~"
//   - no ".." escaping the root, no hidden (dot) or Windows-reserved names
//   - symlinks / junctions may not lead outside the root (checked with realpath)
import fs from 'node:fs';
import path from 'node:path';

export class PathError extends Error {
  constructor(message, code = 'PATH_REJECTED') {
    super(message);
    this.code = code;
    this.status = 400;
  }
}

const RESERVED = /^(con|prn|aux|nul|com[0-9]|lpt[0-9])(\..*)?$/i;
const HIDDEN_SYSTEM = new Set(['desktop.ini', 'thumbs.db', '$recycle.bin', 'system volume information']);

/** Splits a user/model supplied path into safe segments, or throws. */
export function toSegments(input) {
  if (typeof input !== 'string') throw new PathError('Path must be a string.');
  if (input.includes('\0')) throw new PathError('Invalid character in path.');
  const raw = input.trim();
  if (/^[a-zA-Z]:/.test(raw)) throw new PathError('Absolute paths (like C:\\...) are not allowed. Use a path inside the workspace.');
  if (/^[\\/]{2}/.test(raw)) throw new PathError('Network paths are not allowed.');
  if (raw.startsWith('~')) throw new PathError('Home-directory paths are not allowed.');

  const segments = raw
    .replace(/\\/g, '/')
    .split('/')
    .filter((s) => s !== '' && s !== '.');

  for (const seg of segments) {
    if (seg === '..') throw new PathError('".." is not allowed; paths must stay inside the workspace.');
    if (seg.startsWith('.')) throw new PathError(`Hidden names are not allowed: "${seg}".`);
    if (RESERVED.test(seg)) throw new PathError(`"${seg}" is a reserved Windows name.`);
    // oxlint-disable-next-line no-control-regex -- rejecting control characters is the point
    if (/[<>:"|?*\x00-\x1f]/.test(seg)) throw new PathError(`Invalid characters in "${seg}".`);
    if (/[. ]$/.test(seg)) throw new PathError(`Names may not end with a dot or space: "${seg}".`);
    if (seg.length > 200) throw new PathError('Name is too long.');
  }
  return segments;
}

export function isHiddenName(name) {
  return name.startsWith('.') || HIDDEN_SYSTEM.has(name.toLowerCase());
}

export class Workspace {
  constructor(root) {
    this.root = path.resolve(root);
    fs.mkdirSync(this.root, { recursive: true });
    this.realRoot = fs.realpathSync(this.root);
  }

  /**
   * Returns { abs, rel } for a workspace-relative path.
   * `rel` is normalised with forward slashes ("" = the root itself).
   */
  resolve(input = '') {
    const segments = toSegments(input);
    const abs = path.resolve(this.root, ...segments);
    this.#assertInside(abs);
    return { abs, rel: segments.join('/') };
  }

  /** Re-checks containment, following symlinks/junctions of the deepest existing ancestor. */
  #assertInside(abs) {
    const lexical = path.relative(this.root, abs);
    if (lexical.startsWith('..') || path.isAbsolute(lexical)) throw new PathError('Path escapes the workspace.');

    let probe = abs;
    while (!fs.existsSync(probe)) {
      const parent = path.dirname(probe);
      if (parent === probe) break;
      probe = parent;
    }
    const real = fs.realpathSync(probe);
    const rel = path.relative(this.realRoot, real);
    if (rel.startsWith('..') || path.isAbsolute(rel)) throw new PathError('Path leads outside the workspace (link or junction).');
  }

  relOf(abs) {
    return path.relative(this.root, abs).split(path.sep).join('/');
  }
}
