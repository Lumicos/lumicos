// Files the agent keeps in the knowledge library (workspace/knowledge): finding the notes of a research topic,
// moving replaced notes into knowledge/_archive (moved, never deleted; the library does not index _archive), saving a
// note summarized from a file, and storing an attached file so the library indexes its whole text (claude-20261025).
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';

const norm = (s) => String(s ?? '').toLowerCase().replace(/[\s"“”'']+/gu, '');
const rel = (folder, file) => path.relative(folder, file).replace(/\\/g, '/');
/** Bangkok date "2026-10-25". */
export const thaiDay = (now = Date.now()) => new Date(now + 7 * 3_600_000).toISOString().slice(0, 10);
const slugOf = (t) => String(t ?? '').replace(/[\\/:*?"<>|#[\]\n\r\t]+/g, ' ').replace(/\s+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60) || 'note';

async function mdFiles(dir, depth = 0) {
  const out = [];
  for (const e of await fsp.readdir(dir, { withFileTypes: true }).catch(() => [])) {
    const abs = path.join(dir, e.name);
    if (e.isDirectory()) { if (depth < 3 && e.name.toLowerCase() !== '_archive') out.push(...await mdFiles(abs, depth + 1)); }
    else if (e.isFile() && e.name.toLowerCase().endsWith('.md')) out.push(abs);
  }
  return out;
}

/** The topic a research note was saved for (its header line says งานค้นคว้า เรื่อง "…"), or null. */
export function noteTopic(head) {
  return String(head ?? '').match(/งานค้นคว้า เรื่อง "([^"\n]+)"/u)?.[1] ?? null;
}

/**
 * Research notes (knowledge/learned/**) saved for the same topic. "ROCm 10" also finds "ROCm 10 ของ AMD" (one contains
 * the other and is at least half as long) but "AI" does not find "ข่าว AI สัปดาห์นี้". Newest first, at most `max`.
 */
export async function findTopicNotes(folder, topic, { max = 3 } = {}) {
  const want = norm(topic);
  if (want.length < 2) return [];
  const hits = [];
  for (const file of await mdFiles(path.join(folder, 'learned'))) {
    const head = await fsp.readFile(file, 'utf8').then((t) => t.slice(0, 800)).catch(() => '');
    const have = norm(noteTopic(head));
    if (!have) continue;
    const [short, long] = have.length <= want.length ? [have, want] : [want, have];
    if (long.includes(short) && short.length * 2 >= long.length) hits.push({ file, mtimeMs: (await fsp.stat(file)).mtimeMs });
  }
  return hits.sort((a, b) => b.mtimeMs - a.mtimeMs).slice(0, max).map((h) => rel(folder, h.file));
}

/** Moves notes (paths relative to the knowledge folder) into knowledge/_archive/<same path>; returns the new paths. */
export async function archiveNotes(folder, files) {
  const moved = [];
  for (const f of files) {
    const from = path.join(folder, ...String(f).split('/'));
    if (!fs.existsSync(from)) continue;
    const base = path.join(folder, '_archive', ...String(f).split('/'));
    await fsp.mkdir(path.dirname(base), { recursive: true });
    let to = base;
    for (let n = 2; fs.existsSync(to); n++) to = base.replace(/\.md$/i, `-${n}.md`);
    await fsp.rename(from, to);
    moved.push(rel(folder, to));
  }
  return moved;
}

/**
 * A note summarized from a file: knowledge/learned/<yyyy-mm>/<day>-<slug>.md with where it came from and the parts
 * its [n] marks point at. Indexes it before returning {file, status}.
 */
export async function saveFileNote(library, { title, body, fileName, parts = [] }) {
  const t = String(title ?? '').replace(/\s+/g, ' ').trim().slice(0, 200) || String(fileName ?? 'ไฟล์');
  const text = String(body ?? '').replace(/\r\n/g, '\n').trim().slice(0, 8000);
  if (text.length < 20) throw Object.assign(new Error('ไม่มีข้อมูลพอจะบันทึก'), { status: 400 });
  const day = thaiDay();
  const dir = path.join(library.folder, 'learned', day.slice(0, 7));
  await fsp.mkdir(dir, { recursive: true });
  const name = String(fileName ?? '').replace(/\s+/g, ' ').slice(0, 150);
  const md = [`# ${t}`, '', `บันทึกเมื่อ ${day} · ที่มา: Lumicos สรุปจากไฟล์ "${name}" · ตรวจตัวเลขในแต่ละข้อกับเนื้อไฟล์แล้ว`, '', text, '',
    ...(parts.length ? ['## ที่มา', ...parts.map((p, i) => `${i + 1}. ไฟล์ "${name}" ${p.label}`)] : []), ''].join('\n');
  const slug = slugOf(t);
  let file = path.join(dir, `${day}-${slug}.md`);
  for (let n = 2; fs.existsSync(file); n++) file = path.join(dir, `${day}-${slug}-${n}.md`);
  await fsp.writeFile(file, md, 'utf8');
  await library.sync();
  return { file: rel(library.folder, file), status: statusOf(library, file) };
}

/** Copies an attached file into knowledge/files/ (a new name if one is taken) and indexes it: {file, status}. */
export async function storeFile(library, sourcePath, name) {
  // eslint-disable-next-line no-control-regex -- control characters are not allowed in Windows file names
  const safe = path.basename(String(name ?? path.basename(sourcePath))).replace(/[<>:"/\\|?*\u0000-\u001f]/g, '_').slice(0, 150) || 'file';
  const dir = path.join(library.folder, 'files');
  await fsp.mkdir(dir, { recursive: true });
  const ext = path.extname(safe), stem = safe.slice(0, safe.length - ext.length);
  let file = path.join(dir, safe);
  for (let n = 2; fs.existsSync(file); n++) file = path.join(dir, `${stem}-${n}${ext}`);
  await fsp.copyFile(sourcePath, file);
  await library.sync();
  return { file: rel(library.folder, file), status: statusOf(library, file) };
}

function statusOf(library, file) {
  try {
    const name = rel(library.folder, file);
    return library.status?.().documents?.find((d) => String(d.name).replace(/\\/g, '/') === name)?.status ?? 'pending';
  } catch { return 'pending'; }
}
