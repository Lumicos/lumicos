import type { ImageJob } from '../services/localService';
import type { ChatMessage, MessagePart } from '../types';

export function imageJobParts(job: ImageJob): MessagePart[] {
  const displayed = job.images.some(i => i.variant === 'upscaled')
    ? job.images.filter(i => i.variant === 'upscaled') : job.images;
  const generation = job.generationMs;
  const upscale = job.upscaleMs;
  const timings: string[] = [];
  for (const [ms, label] of [[generation, 'สร้างภาพ'], [upscale, 'อัปสเกล']] as const) {
    if (typeof ms === 'number' && Number.isFinite(ms) && ms >= 0)
      timings.push(label + ' ' + (ms / 1000).toFixed(1) + ' วินาที');
  }
  if (typeof generation === 'number' && typeof upscale === 'number' &&
      Number.isFinite(generation) && Number.isFinite(upscale) && generation >= 0 && upscale >= 0)
    timings.push('รวมสร้างและอัปสเกล ' + ((generation + upscale) / 1000).toFixed(1) + ' วินาที');
  const completion = ['สร้างภาพแล้ว', ...timings].join(' · ') + (job.warning ? ' — ' + job.warning : '');
  return [{ type: 'text', text: job.status === 'cancelled' ? 'ยกเลิกการสร้างภาพแล้ว' : completion },
    ...displayed.map(i => ({type:'image' as const, source:'generated' as const, url:i.url, alt:i.alt,
      meta:{jobId:job.id,seed:job.seed,workflow:job.workflow,width:i.width,height:i.height,
        upscaled:i.variant==='upscaled',upscaleMs:job.upscaleMs,
        originalUrl:i.variant==='upscaled'?job.images.find(o=>o.variant==='original')?.url:undefined}}))];
}

/* ------------------------------------------------------------------ */
/* Reconciling image placeholders after a reload                       */
/* Message tracking state (can we follow the job?) is kept apart from  */
/* server job state (what the job did). Only a confirmed server state  */
/* ends a placeholder; reconciliation never creates or submits a job.  */
/* ------------------------------------------------------------------ */

const TERMINAL = ['done', 'failed', 'cancelled'];
/** No job id yet may just mean another tab is still translating/queuing; only older placeholders are legacy. */
export const LEGACY_IMAGE_PLACEHOLDER_MS = 5 * 60_000;
export const UNTRACKABLE_IMAGE_TEXT = 'ติดตามงานภาพนี้ต่อไม่ได้หลังโหลดหน้าใหม่ เพราะข้อความนี้ไม่มีรหัสงานภาพ — ระบบจึงไม่ทราบว่างานบนเซิร์ฟเวอร์เสร็จหรือหยุดแล้ว';
export const MISSING_IMAGE_JOB_TEXT = 'ตรวจสอบงานภาพนี้ไม่ได้ เพราะเซิร์ฟเวอร์ไม่พบรหัสงานนี้ — ไม่ได้แปลว่างานล้มเหลวหรือถูกยกเลิก';

export function trackedImageJobId(m: ChatMessage): string | undefined {
  const fromRun = (m.toolRuns?.find((r) => r.tool === 'generate_image')?.data as { jobId?: unknown } | undefined)?.jobId;
  const id = m.imageJob?.jobId ?? fromRun;
  return typeof id === 'string' && id ? id : undefined;
}

/** What reconciliation may do with one message; `previous` is the message before it (the user's request). */
export function imageReconcilePlan(m: ChatMessage, previous: ChatMessage | undefined, now = Date.now()):
  { kind: 'poll'; jobId: string } | { kind: 'untrackable' } | null {
  if (m.role !== 'assistant' || m.status !== 'streaming') return null;
  const jobId = trackedImageJobId(m);
  if (jobId) return { kind: 'poll', jobId };
  const imageReply = !!m.imageJob || !!m.toolRuns?.some((r) => r.tool === 'generate_image') || !!previous?.imageRequest;
  if (!imageReply) return null; // ordinary chat replies are not touched
  return now - (m.createdAt ?? now) > LEGACY_IMAGE_PLACEHOLDER_MS ? { kind: 'untrackable' } : null;
}

/** Applies a confirmed server job state. Returns undefined when it must not write (stale, other job, not terminal). */
export function applyImageJobState(m: ChatMessage, jobId: string, job: ImageJob): ChatMessage | undefined {
  if (m.status !== 'streaming' || trackedImageJobId(m) !== jobId || job?.id !== jobId) return undefined;
  if (job.status === 'done') return { ...m, parts: imageJobParts(job), status: 'done', error: undefined };
  if (job.status === 'cancelled') return { ...m, parts: imageJobParts(job), status: 'stopped', error: undefined };
  if (job.status === 'failed') return { ...m, status: 'error', error: job.error ?? 'สร้างภาพไม่สำเร็จ' };
  return undefined; // queued / preparing / running: keep following
}

/** Ends the spinner of a placeholder that cannot be followed, without claiming what the server job did. */
export function markImageUntrackable(m: ChatMessage, reason: 'no-job-id' | 'not-found', jobId?: string): ChatMessage | undefined {
  if (m.status !== 'streaming') return undefined;
  if (reason === 'no-job-id' && trackedImageJobId(m)) return undefined;
  if (reason === 'not-found' && trackedImageJobId(m) !== jobId) return undefined;
  return { ...m, status: 'error', error: reason === 'no-job-id' ? UNTRACKABLE_IMAGE_TEXT : MISSING_IMAGE_JOB_TEXT };
}

type JobError = { status?: number; code?: string };
/**
 * Follows one job until the server confirms a terminal state. Offline, timeouts, 5xx and auth errors never write
 * a terminal state: after a bounded number of failures it simply stops following (the next load tries again).
 */
export async function reconcileImageJob(options: {
  jobId: string; getJob: (id: string) => Promise<ImageJob>; apply: (job: ImageJob) => void; onNotFound: () => void;
  signal: AbortSignal; intervalMs?: number; maxPolls?: number; maxErrors?: number;
  sleep?: (ms: number, signal: AbortSignal) => Promise<void>;
}): Promise<'applied' | 'not-found' | 'auth' | 'unreachable' | 'stopped' | 'gave-up'> {
  const { jobId, getJob, apply, onNotFound, signal, intervalMs = 2000, maxPolls = 900, maxErrors = 5 } = options;
  const sleep = options.sleep ?? ((ms: number, s: AbortSignal) => new Promise<void>((resolve) => {
    const t = setTimeout(resolve, ms); s.addEventListener('abort', () => { clearTimeout(t); resolve(); }, { once: true });
  }));
  let errors = 0;
  for (let poll = 0; poll < maxPolls; poll++) {
    if (signal.aborted) return 'stopped';
    try {
      const job = await getJob(jobId);
      if (signal.aborted) return 'stopped'; // late response after leaving the chat: write nothing
      errors = 0;
      if (TERMINAL.includes(job.status)) { apply(job); return 'applied'; }
    } catch (e) {
      if (signal.aborted) return 'stopped';
      const err = e as JobError;
      if (err.status === 404) { onNotFound(); return 'not-found'; }
      if (err.status === 401 || err.status === 403) return 'auth';
      if (++errors >= maxErrors) return 'unreachable';
    }
    await sleep(intervalMs, signal);
  }
  return 'gave-up';
}
