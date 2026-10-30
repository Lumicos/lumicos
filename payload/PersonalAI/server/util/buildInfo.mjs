// Build identity shared by the backend (/api/health) and the web page (vite define), so a page that runs
// different front-end code from what the backend started with can be flagged. Hash = content of src/** (the
// front-end and the chat runtime are built from it); tests and backup files are ignored.
import { createHash } from 'node:crypto';
import { readdirSync, readFileSync } from 'node:fs';
import { join, relative, sep } from 'node:path';

const SOURCE = /\.(ts|tsx|css|mjs|js|json|svg)$/;
const SKIP = /(\.test\.|\.bak)/;

export function sourceBuildId(root) {
  const files = [];
  const walk = (dir) => {
    for (const e of readdirSync(dir, { withFileTypes: true })) {
      const p = join(dir, e.name);
      if (e.isDirectory()) walk(p);
      else if (SOURCE.test(e.name) && !SKIP.test(e.name)) files.push(p);
    }
  };
  try { walk(join(root, 'src')); } catch { return 'unknown'; }
  files.sort();
  const h = createHash('sha1');
  for (const f of files) { h.update(relative(root, f).split(sep).join('/')); h.update('\0'); h.update(readFileSync(f)); h.update('\0'); }
  return h.digest('hex').slice(0, 8);
}
