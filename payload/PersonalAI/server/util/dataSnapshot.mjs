// Daily snapshots of Lumicos's own data, so a bug that garbles chats or memory can be undone.
//
// What is copied (small, a few MB): data/conversations.json (chats, characters, preferences),
// memory.json, roleplay/, settings JSON files, knowledge.db (consistent copy via VACUUM INTO),
// and workspace skills/notes/knowledge/documents/spreadsheets.
// Not copied: generated images, image inputs, attachments, models, logs (large or rebuildable).
//
// Snapshots live in data/snapshots/<YYYYMMDD-HHMMSS>/ with a manifest.json; the newest `keep` are kept.
// Restore with "Restore Snapshot.bat" while Lumicos is stopped: current files are MOVED to
// data/snapshots/replaced-<time>/ (never deleted), then the snapshot is copied back.
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';

export const DATA_FILES = ['conversations.json', 'memory.json', 'models.json', 'voice-engines.json', 'owner-auth.json'];
export const DATA_DIRS = ['roleplay'];
export const WORKSPACE_DIRS = ['skills', 'notes', 'knowledge', 'documents', 'spreadsheets'];
/** Restored by default: the user's chats, characters, memory and roleplay stories. */
export const RESTORE_DEFAULT = ['data/conversations.json', 'data/memory.json', 'data/roleplay'];
const NAME_RE = /^\d{8}-\d{6}(-\d+)?$/;
const MAX_WORKSPACE_FILE = 20 * 1024 * 1024;

const pad = (n) => String(n).padStart(2, '0');
export const stamp = (d) => `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`;
export const snapshotRoot = (dataDir) => path.join(dataDir, 'snapshots');

async function retry(fn, tries = 4) {
  for (let i = 0; ; i++) {
    try { return await fn(); } catch (e) {
      if (!['EBUSY', 'EPERM', 'EACCES', 'EAGAIN'].includes(e.code) || i >= tries - 1) throw e;
      await new Promise((r) => setTimeout(r, 100 * 2 ** i));
    }
  }
}

async function copyTree(src, dest, files, rel, { maxFile = Infinity } = {}) {
  const st = await fsp.stat(src);
  if (st.isDirectory()) {
    await fsp.mkdir(dest, { recursive: true });
    for (const name of await fsp.readdir(src)) await copyTree(path.join(src, name), path.join(dest, name), files, `${rel}/${name}`, { maxFile });
    return;
  }
  if (!st.isFile() || st.size > maxFile) return;
  await retry(() => fsp.copyFile(src, dest));
  files.push({ path: rel, bytes: st.size });
}

export function listSnapshots(dataDir) {
  const root = snapshotRoot(dataDir);
  let names = [];
  try { names = fs.readdirSync(root).filter((n) => NAME_RE.test(n)); } catch { return []; }
  return names.sort().map((name) => {
    const dir = path.join(root, name);
    let manifest = null;
    try { manifest = JSON.parse(fs.readFileSync(path.join(dir, 'manifest.json'), 'utf8')); } catch {}
    const at = manifest?.createdAt ? new Date(manifest.createdAt) : fs.statSync(dir).mtime;
    return { name, dir, at, manifest };
  });
}

export function shouldSnapshot(dataDir, now = new Date(), minHours = 20) {
  const last = listSnapshots(dataDir).at(-1);
  return !last || now - last.at >= minHours * 3600_000;
}

export async function takeSnapshot({ dataDir, workspaceDir, keep = 14, now = new Date(), reason = 'daily' }) {
  const root = snapshotRoot(dataDir);
  await fsp.mkdir(root, { recursive: true });
  let name = stamp(now);
  for (let i = 2; fs.existsSync(path.join(root, name)); i++) name = `${stamp(now)}-${i}`;
  const tmp = path.join(root, `${name}.partial`), final = path.join(root, name);
  const files = [], invalid = [];
  await fsp.rm(tmp, { recursive: true, force: true });
  await fsp.mkdir(path.join(tmp, 'data'), { recursive: true });
  for (const f of DATA_FILES) {
    const src = path.join(dataDir, f);
    if (!fs.existsSync(src)) continue;
    await copyTree(src, path.join(tmp, 'data', f), files, `data/${f}`);
    if (f.endsWith('.json')) {
      const text = await fsp.readFile(path.join(tmp, 'data', f), 'utf8');
      if (text.trim()) { try { JSON.parse(text); } catch { invalid.push(`data/${f}`); } }
    }
  }
  for (const d of DATA_DIRS) {
    const src = path.join(dataDir, d);
    if (fs.existsSync(src)) await copyTree(src, path.join(tmp, 'data', d), files, `data/${d}`);
  }
  const kdb = path.join(dataDir, 'knowledge.db');
  if (fs.existsSync(kdb)) {
    const dest = path.join(tmp, 'data', 'knowledge.db');
    const db = new DatabaseSync(kdb);
    try { db.exec('PRAGMA busy_timeout = 5000'); db.prepare('VACUUM INTO ?').run(dest); } finally { db.close(); }
    files.push({ path: 'data/knowledge.db', bytes: fs.statSync(dest).size });
  }
  if (workspaceDir) {
    for (const d of WORKSPACE_DIRS) {
      const src = path.join(workspaceDir, d);
      if (fs.existsSync(src)) await copyTree(src, path.join(tmp, 'workspace', d), files, `workspace/${d}`, { maxFile: MAX_WORKSPACE_FILE });
    }
  }
  const totalBytes = files.reduce((s, f) => s + f.bytes, 0);
  const manifest = { name, reason, createdAt: now.toISOString(), totalBytes, invalidJson: invalid, files };
  await fsp.writeFile(path.join(tmp, 'manifest.json'), JSON.stringify(manifest, null, 1));
  await retry(() => fsp.rename(tmp, final));
  const pruned = await pruneSnapshots(dataDir, keep);
  return { ...manifest, dir: final, pruned };
}

/** Removes the oldest automatic snapshots beyond `keep` (only folders this module created). */
export async function pruneSnapshots(dataDir, keep) {
  const all = listSnapshots(dataDir), extra = all.slice(0, Math.max(0, all.length - keep));
  for (const s of extra) await fsp.rm(s.dir, { recursive: true, force: true });
  return extra.map((s) => s.name);
}

/**
 * Restores a snapshot. Lumicos must be stopped. Every current file or folder that will be replaced is
 * first MOVED to data/snapshots/replaced-<time>/ (nothing is deleted).
 * parts: paths inside the snapshot ('data/conversations.json', 'data/roleplay', 'workspace/notes', ...).
 */
export async function restoreSnapshot({ dataDir, workspaceDir, name, parts = RESTORE_DEFAULT, now = new Date() }) {
  const snap = listSnapshots(dataDir).find((s) => s.name === name);
  if (!snap) throw new Error(`no snapshot named ${name}`);
  const parked = path.join(snapshotRoot(dataDir), `replaced-${stamp(now)}`);
  const target = (p) => (p.startsWith('workspace/') ? path.join(workspaceDir, p.slice(10)) : path.join(dataDir, p.slice(5)));
  const done = [];
  for (const p of parts) {
    const from = path.join(snap.dir, p);
    if (!fs.existsSync(from)) continue;
    const to = target(p);
    const related = p === 'data/knowledge.db' ? ['', '-wal', '-shm'] : [''];
    for (const suffix of related) {
      const cur = to + suffix;
      if (!fs.existsSync(cur)) continue;
      const keepAt = path.join(parked, p + suffix);
      await fsp.mkdir(path.dirname(keepAt), { recursive: true });
      await retry(() => fsp.rename(cur, keepAt));
    }
    await copyTree(from, to, [], p);
    done.push(p);
  }
  return { restored: done, parked };
}

/** Starts the background schedule: first check after `firstDelayMs`, then every `checkEveryMs`; snapshots when the last is >= 20 h old. */
export function startDataSnapshots({ dataDir, workspaceDir, keep = 14, log = console, firstDelayMs = 90_000, checkEveryMs = 3 * 3600_000 }) {
  let running = false;
  const tick = async () => {
    if (running || !shouldSnapshot(dataDir)) return null;
    running = true;
    try {
      const s = await takeSnapshot({ dataDir, workspaceDir, keep });
      log.log(`[snapshot] saved ${s.name} (${(s.totalBytes / 1048576).toFixed(1)} MB${s.invalidJson.length ? `, BROKEN JSON: ${s.invalidJson.join(', ')}` : ''})`);
      return s;
    } catch (e) {
      log.warn('[snapshot] failed:', e.message);
      return null;
    } finally { running = false; }
  };
  const first = setTimeout(tick, firstDelayMs); first.unref?.();
  const every = setInterval(tick, checkEveryMs); every.unref?.();
  return { tick, stop() { clearTimeout(first); clearInterval(every); } };
}
