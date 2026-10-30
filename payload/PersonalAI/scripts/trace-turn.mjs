// One turn, one timeline: joins data/conversations.json with every log in data/logs/ so you can see what happened
// in a chat turn without reading code.   node scripts/trace-turn.mjs [last|<replyId>] [--conv <id>] [--data <dir>] [--json]
// Read-only. Private chats are not stored, so they cannot be traced (tool-decisions.jsonl still has their timings).
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const readJsonl = file => {
  try { return fs.readFileSync(file, 'utf8').split('\n').filter(Boolean).map(l => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean); } catch { return []; }
};
const textOf = m => (m?.parts ?? []).filter(p => p.type === 'text').map(p => p.text).join(' ').replace(/\s+/g, ' ').trim();
const num = v => (typeof v === 'number' && Number.isFinite(v) ? v : 0);
const sec = msv => `${(msv / 1000).toFixed(msv >= 10000 ? 1 : 2)}s`;
const clip = (s, n) => (s.length > n ? `${s.slice(0, n)}…` : s);

/** Spans the message itself recorded, and how much of the total they leave unexplained. */
export function accountFor(reply) {
  const l = reply?.chatLatency ?? {}, s = reply?.stats ?? {};
  const total = num(l.totalResponseMs) || num(l.totalMs);
  const parts = [
    ['เตรียมบริบท', num(l.contextPreparationMs)], ['ค้น/ความรู้', num(l.searchMs) || num(l.knowledgeMs)], ['ปลุกโมเดล', num(s.wakeMs) || num(l.wakeMs)],
    ['ประมวลผล prompt', num(s.promptProcessingMs) || num(l.promptProcessingMs)], ['สร้างคำตอบ', num(s.durationMs)], ['เครื่องมือ', num(l.toolExecutionMs)],
  ].filter(([, v]) => v > 0);
  const known = parts.reduce((a, [, v]) => a + v, 0);
  // Any other span the runtime records (GPU wait, summary, persistence…) is counted too instead of being called "unexplained".
  const extra = Object.entries(l).filter(([k, v]) => typeof v === 'number' && /Ms$/.test(k)
    && !['totalMs', 'totalResponseMs', 'routingMs', 'contextPreparationMs', 'searchMs', 'knowledgeMs', 'wakeMs', 'promptProcessingMs', 'toolExecutionMs', 'firstTokenMs', 'firstTextMs'].includes(k) && v > 0);
  const extraSum = extra.reduce((a, [, v]) => a + v, 0);
  const unexplained = total > 0 ? Math.max(0, total - known - extraSum) : 0;
  return { total, parts: [...parts, ...extra.map(([k, v]) => [k, v])], unexplained, share: total > 0 ? unexplained / total : 0 };
}

export function buildTrace({ dataDir, replyId = 'last', conversationId }) {
  const stored = (() => { try { return JSON.parse(fs.readFileSync(path.join(dataDir, 'conversations.json'), 'utf8')); } catch { return { conversations: [] }; } })();
  const convs = (stored.conversations ?? []).filter(c => !conversationId || c.id === conversationId);
  let conv, reply;
  if (replyId === 'last') {
    for (const c of convs) for (const m of c.messages ?? []) if (m.role === 'assistant' && !m.isGreeting && (!reply || m.createdAt > reply.createdAt)) { conv = c; reply = m; }
  } else {
    for (const c of convs) { const m = (c.messages ?? []).find(x => x.id === replyId); if (m) { conv = c; reply = m; } }
  }
  if (!reply) return { error: `ไม่พบข้อความตอบ ${replyId === 'last' ? '(ยังไม่มีแชตที่บันทึกไว้)' : replyId}` };

  const logs = path.join(dataDir, 'logs');
  const user = (conv.messages ?? []).find(m => m.id === reply.replyToId);
  const acct = accountFor(reply);
  const start = reply.createdAt;
  const jobIds = new Set((reply.toolRuns ?? []).map(r => r.data?.jobId).filter(Boolean).concat(reply.imageJob?.jobId ? [reply.imageJob.jobId] : []));
  const image = readJsonl(path.join(logs, 'image-jobs.jsonl')).filter(r => r.messageId === reply.id || r.requestCorrelationId === reply.id || jobIds.has(r.correlationId));
  let end = start + Math.max(acct.total, num(reply.stats?.durationMs)) + 3000;
  for (const r of image) end = Math.max(end, Date.parse(r.at) + 1000);
  const inWindow = at => { const t = Date.parse(at); return t >= start - 1000 && t <= end; };

  const otherReplyIds = new Set((conv.messages ?? []).map(m => m.id).filter(id => id !== reply.id));
  const events = [];
  const add = (at, source, label, detail, exact = true) => events.push({ t: typeof at === 'number' ? at : Date.parse(at), source, label, ...(detail ? { detail } : {}), ...(exact ? {} : { nearby: true }) });
  add(start, 'chat', `ผู้ใช้ส่ง${user ? `: "${clip(textOf(user), 90)}"` : ''}`);

  for (const r of readJsonl(path.join(logs, 'tool-decisions.jsonl')).filter(r => r.replyId === reply.id || (!r.replyId && r.jobId && r.conversationId === conv.id && inWindow(r.at)))) {
    add(r.at, 'tools', `route ${r.route}${r.reason ? ` (${r.reason})` : ''}${r.isFollowUp ? ' · follow-up' : ''}${r.skills?.length ? ` · skill ${r.skills.join(', ')}` : ''}`,
      `หลักฐาน เว็บ ${r.evidence?.web ?? 0} / คลัง ${r.evidence?.local ?? 0} / ความจำ ${r.evidence?.memory ?? 0}${r.evidence?.fitStatus ? ` · fit ${r.evidence.fitStatus}` : ''}${r.tools?.length ? ` · เครื่องมือ: ${r.tools.map(t => `${t.tool}[${t.status}]`).join(' → ')}` : ''}`);
  }
  for (const r of readJsonl(path.join(logs, 'llm-cache.jsonl'))) {
    const mine = r.correlationId === reply.id;
    if (!mine && (!inWindow(r.at) || otherReplyIds.has(r.correlationId))) continue; // another turn's own call is not "nearby", it is not ours

    const cache = r.cache_n !== undefined ? ` · cache ${r.cache_n}/${num(r.cache_n) + num(r.prompt_n)}` : '';
    add(r.at, 'llm', `${r.purpose ?? 'other'} slot ${r.slot ?? '?'} · ${sec(num(r.elapsedMs))}${cache}${r.sleepingBefore ? ` · ปลุก ${sec(num(r.wakeMs))}` : ''}`,
      r.firstChange && r.firstChange !== 'none' ? `cache เปลี่ยนที่ ${r.firstChange}` : undefined, mine);
  }
  for (const r of readJsonl(path.join(logs, 'web-search.jsonl'))) {
    const mine = r.replyId === reply.id;
    if (!mine && !(inWindow(r.at) && (!r.replyId))) continue;
    add(r.at, 'web', `ค้นเว็บ ${r.route} → ${r.status} (${r.webCitations ?? 0} แหล่ง, ${sec(num(r.elapsedMs))})`, r.validation ? `ตรงเงื่อนไข ${JSON.stringify(r.validation.counts)}` : undefined, mine);
  }
  for (const r of image) add(r.at, 'image', `ภาพ ${r.stage}${r.status && r.status !== 'running' ? ` [${r.status}]` : ''}`,
    [r.checkpoint, r.resolution && r.resolution.join('×'), r.generationMs && `generate ${sec(r.generationMs)}`, r.upscaleMs && `upscale ${sec(r.upscaleMs)}`, r.warning && `warning ${r.warning}`].filter(Boolean).join(' · ') || undefined);
  for (const r of readJsonl(path.join(logs, 'voice-lifecycle.jsonl'))) if (inWindow(r.at)) add(r.at, 'voice', `OmniVoice ${r.event}${r.onGpu !== undefined ? ` (onGpu=${r.onGpu})` : ''}`, undefined, false);
  // Unexplained time that nearby (unlabeled) LLM calls could account for: say so, but only as a hint.
  const nearbyLlm = events.filter(e => e.source === 'llm' && e.nearby);
  const nearbyMs = (() => { let sum = 0; for (const r of readJsonl(path.join(logs, 'llm-cache.jsonl'))) if (r.correlationId !== reply.id && inWindow(r.at)) sum += num(r.elapsedMs); return sum; })();
  acct.hint = acct.unexplained > 1000 && nearbyLlm.length && nearbyMs >= acct.unexplained * 0.6
    ? { calls: nearbyLlm.length, ms: nearbyMs } : undefined;
  add(start + (acct.total || num(reply.stats?.durationMs)), 'chat', `ตอบเสร็จ [${reply.status}]${reply.error ? ` — ${clip(String(reply.error), 120)}` : ''}${reply.stats ? ` · ${reply.stats.tokensGenerated ?? '?'} tok @ ${Math.round(num(reply.stats.tokensPerSecond))} tok/s` : ''}`);

  events.sort((a, b) => a.t - b.t);
  return {
    replyId: reply.id, conversationId: conv.id, mode: conv.mode ?? 'assistant', startedAt: new Date(start).toISOString(),
    context: reply.contextInfo, accounting: acct,
    events: events.map(e => ({ ...e, offsetMs: e.t - start, at: new Date(e.t).toISOString() })),
  };
}

const local = t => new Date(t).toLocaleString('sv-SE', { timeZone: 'Asia/Bangkok', hour12: false }) + '.' + String(t % 1000).padStart(3, '0');
export function formatTrace(trace) {
  if (trace.error) return trace.error;
  const a = trace.accounting, lines = [];
  lines.push(`ข้อความตอบ ${trace.replyId} · แชต ${trace.conversationId} · โหมด ${trace.mode} · เริ่ม ${local(Date.parse(trace.startedAt))} (เวลาไทย)`);
  if (a.total) {
    lines.push(`รวม ${sec(a.total)}: ${a.parts.map(([k, v]) => `${k} ${sec(v)}`).join(' · ') || '(ไม่มีรายละเอียด)'}`);
    lines.push(a.unexplained > 1000 ? `⚠ ไม่มีคำอธิบาย ${sec(a.unexplained)} (${Math.round(a.share * 100)}% ของเวลารวม) — ยังไม่มี span ใน log สำหรับช่วงนี้` : 'เวลาอธิบายได้ครบ');
    if (a.hint) lines.push(`  ↳ ในช่วงนี้มีคำขอ LLM อื่นที่ไม่ได้ระบุเจ้าของ ${a.hint.calls} รายการ รวม ${sec(a.hint.ms)} (ดู "~" ในเส้นเวลา) — น่าจะเป็นเวลาที่หายไป แต่ log ยืนยัน id ไม่ได้`);
  }
  if (trace.context) lines.push(`บริบท: ส่ง ${trace.context.sentMessages} ข้อความ, ตัดทิ้ง ${trace.context.droppedMessages}${trace.context.droppedContext ? ` (ตัด ${trace.context.droppedContext.join(', ')})` : ''}, ~${trace.context.estimatedTokens} token${trace.context.overBudget ? ' · เกินงบ' : ''}`);
  lines.push('', 'เส้นเวลา ("~" = เกิดในช่วงเวลาเดียวกัน แต่ log ไม่มี id ยืนยันว่าเป็นของเทิร์นนี้):');
  for (const e of trace.events) lines.push(`  ${e.offsetMs >= 0 ? '+' : ''}${(e.offsetMs / 1000).toFixed(2).padStart(7)}s  ${e.nearby ? '~' : ' '}[${e.source}] ${e.label}${e.detail ? `\n${' '.repeat(16)}${e.detail}` : ''}`);
  return lines.join('\n');
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  const flag = name => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : undefined; };
  const dataDir = path.resolve(flag('--data') ?? process.env.PERSONALAI_DATA ?? path.join(ROOT, 'data'));
  const replyId = args.find((a, i) => !a.startsWith('--') && !['--conv', '--data'].includes(args[i - 1])) ?? 'last';
  const trace = buildTrace({ dataDir, replyId, conversationId: flag('--conv') });
  console.log(args.includes('--json') ? JSON.stringify(trace, null, 2) : formatTrace(trace));
  process.exit(trace.error ? 1 : 0);
}
