// "แจ้งบั๊ก" button: saves everything about one chat turn into ONE file, data/bug-reports/<time>-<id>.md (+ .json),
// so the owner can just say "look at the latest bug report" instead of re-explaining and digging through many logs.
// The timeline comes from scripts/trace-turn.mjs (conversations.json + every log in data/logs joined by reply id).
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { buildTrace, formatTrace } from '../../scripts/trace-turn.mjs';

const NAME_RE = /^\d{8}-\d{6}-[A-Za-z0-9_-]{1,12}\.md$/;
const pad = (n) => String(n).padStart(2, '0');
const stamp = (d) => `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`;
const clip = (s, n) => { s = String(s ?? ''); return s.length > n ? `${s.slice(0, n)}… (ตัดเหลือ ${n} ตัวอักษร)` : s; };
const textOf = (m) => (m?.parts ?? []).filter((p) => p.type === 'text').map((p) => p.text).join('\n').trim();
const when = (ms) => (Number.isFinite(ms) ? new Date(ms).toLocaleString('sv-SE', { timeZone: 'Asia/Bangkok', hour12: false }) : '?');

function findReply(dataDir, replyId) {
  let stored;
  try { stored = JSON.parse(fs.readFileSync(path.join(dataDir, 'conversations.json'), 'utf8')); } catch { return {}; }
  for (const conv of stored.conversations ?? []) {
    const i = (conv.messages ?? []).findIndex((m) => m.id === replyId);
    if (i >= 0) return { conv, index: i, character: (stored.characters ?? []).find((c) => c.id === conv.characterId) };
  }
  return {};
}

/**
 * input: { replyId, note?, replyText? (used when the chat is private / not stored) }
 * extra: { build } from the service.
 */
export async function saveBugReport({ dataDir, replyId, note = '', replyText = '', build = {}, now = new Date() }) {
  if (typeof replyId !== 'string' || !/^[A-Za-z0-9_-]{4,80}$/.test(replyId)) throw Object.assign(Error('replyId is required'), { status: 400 });
  note = clip(String(note).trim(), 2000);
  const { conv, index, character } = findReply(dataDir, replyId);
  const reply = conv?.messages?.[index];
  const excerpt = conv ? conv.messages.slice(Math.max(0, index - 7), index + 1) : [];
  const trace = conv ? buildTrace({ dataDir, replyId, conversationId: conv.id }) : { error: 'แชตนี้ไม่ได้บันทึกไว้ (private) จึงไม่มีไทม์ไลน์จาก log' };
  const dir = path.join(dataDir, 'bug-reports');
  await fsp.mkdir(dir, { recursive: true });
  const base = `${stamp(now)}-${replyId.replace(/[^A-Za-z0-9_-]/g, '').slice(0, 12)}`;

  const lines = [];
  lines.push(`# แจ้งบั๊ก ${when(now.getTime())} (เวลาไทย)`, '');
  lines.push(`**ผู้ใช้บอกว่า:** ${note || '(ไม่ได้เขียนอธิบาย)'}`, '');
  lines.push(`- ข้อความตอบ: \`${replyId}\`${reply ? ` · สถานะ ${reply.status ?? '?'}` : ''}`);
  if (conv) lines.push(`- แชต: \`${conv.id}\` · โหมด ${conv.mode ?? 'assistant'} · ตัวละคร ${character?.name ?? conv.characterId ?? '?'}`);
  lines.push(`- Lumicos: version ${build.version ?? '?'} · src ${build.src ?? '?'} · service เริ่ม ${build.startedAt ?? '?'}`);
  if (reply?.error) lines.push(`- error: ${clip(reply.error, 500)}`);
  lines.push('', `## บทสนทนา${conv ? ` (ล่าสุด ${excerpt.length} ข้อความ จนถึงข้อความที่แจ้ง)` : ''}`);
  if (conv) {
    for (const m of excerpt) {
      const who = m.role === 'user' ? 'ผู้ใช้' : character?.name ?? 'AI';
      const mark = m.id === replyId ? ' ← ข้อความที่แจ้ง' : '';
      lines.push('', `**${who}** (${when(m.createdAt)})${mark}`, '', clip(textOf(m) || '(ไม่มีข้อความ เช่น ภาพอย่างเดียว)', 4000));
    }
  } else {
    lines.push('', '(แชตนี้ไม่ได้บันทึกไว้ในเครื่อง ข้อความที่แจ้งมาจากหน้าจอ)', '', clip(replyText || '(ไม่มี)', 4000));
  }
  const runs = reply?.toolRuns ?? [];
  if (runs.length) {
    lines.push('', '## เครื่องมือที่ใช้ในเทิร์นนี้');
    for (const r of runs) {
      lines.push(`- ${r.tool ?? r.name ?? '?'} [${r.status ?? '?'}]${r.summary ? ` — ${clip(r.summary, 300)}` : ''}${r.args ? ` · args ${clip(JSON.stringify(r.args), 300)}` : ''}${r.error ? ` · error ${clip(r.error, 300)}` : ''}`);
      if (r.resultForModel) lines.push(`  - ผลที่โมเดลได้รับ: ${clip(String(r.resultForModel).replace(/\s+/g, ' '), 600)}`);
    }
  }
  if (reply?.citations?.length) {
    lines.push('', '## แหล่งที่อ้าง');
    for (const c of reply.citations.slice(0, 12)) lines.push(`- ${c.title ?? c.file ?? c.kind ?? '?'}${c.url ? ` — ${c.url}` : ''}`);
  }
  lines.push('', '## ไทม์ไลน์ของเทิร์นนี้', '', '```text', formatTrace(trace), '```', '');
  const md = lines.join('\n');
  const json = { createdAt: now.toISOString(), note, replyId, conversationId: conv?.id ?? null, build, excerpt: excerpt.map((m) => ({ id: m.id, role: m.role, createdAt: m.createdAt, text: textOf(m) })), toolRuns: runs, trace };
  await fsp.writeFile(path.join(dir, `${base}.md`), md);
  await fsp.writeFile(path.join(dir, `${base}.json`), JSON.stringify(json, null, 1));
  return { name: `${base}.md`, file: path.join(dir, `${base}.md`), traced: !trace.error };
}

export function listBugReports(dataDir, limit = 20) {
  const dir = path.join(dataDir, 'bug-reports');
  let names = [];
  try { names = fs.readdirSync(dir).filter((n) => NAME_RE.test(n)); } catch { return []; }
  return names.sort().reverse().slice(0, limit).map((name) => {
    let note = '';
    try { note = JSON.parse(fs.readFileSync(path.join(dir, name.replace(/\.md$/, '.json')), 'utf8')).note ?? ''; } catch {}
    return { name, note };
  });
}
