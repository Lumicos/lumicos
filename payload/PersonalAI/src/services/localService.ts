/**
 * Client for the PersonalAI local service (server/). The ONLY frontend module
 * that talks to it; components use this, never fetch() directly.
 *
 * Requests go to "/api" on the web UI's own origin; Vite proxies them to
 * http://127.0.0.1:8787, so there is no CORS and nothing leaves this PC.
 */
import type { Memory, MemoryCandidate, MemoryType, ToolPermission, ToolPreview } from '../types';
import {clientId} from './deviceIdentity';



export class ServiceError extends Error {
  status: number;
  code: string;
  constructor(message: string, status = 0, code = 'SERVICE_ERROR') {
    super(message);
    this.status = status;
    this.code = code;
  }
}


const q = (params: Record<string, string | undefined>) => {
  const u = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) if (v !== undefined && v !== '') u.set(k, v);
  const s = u.toString();
  return s ? `?${s}` : '';
};

/* ------------------------------------------------------------------ */

export interface ServiceHealth {
  ok: boolean;
  version: number;
  workspace: string;
  dataDir: string;
  tools: number;
}
export interface OwnerStatus {configured:boolean;authenticated:boolean;role:'owner'|'agent';transport:'local'|'tailscale';subject:string;expiresAt:string|null;csrf?:string;challenge:string;canEnroll?:boolean}
export interface WorkshopStatus {ready:boolean;contractVersion:'1';pluginId:string;controller:string;ownerAuthorization:string;isolation:string;executionEnabled:boolean;activationEnabled:boolean;blockers:string[];integrity:Record<string,{actual:string;expected:string;verified:boolean;adapter:boolean}>}
export interface ManagedProposal {proposal_id:string;state:string;version:string|null;description:string;capabilities:string[]}
export interface ManagedPlugin {plugin_id:string;status:'PENDING'|'INACTIVE'|'ACTIVE'|'DELETED';enabled:boolean;installed:boolean;version:string|null;description:string;pending_proposals:number;latest_proposal_id:string|null;proposals:ManagedProposal[]}

export interface FileEntry {
  name: string;
  path: string;
  type: 'folder' | 'text' | 'markdown' | 'csv' | 'json' | 'docx' | 'xlsx' | 'image' | 'pdf' | 'file';
  ext: string;
  size: number;
  modified: string;
}

export interface XlsxCell {
  v: string | number | boolean;
  f?: string;
}
export interface FilePreview {
  stat: FileEntry & { created: string };
  kind: string;
  text?: string;
  rows?: string[][];
  blocks?: DocBlock[];
  stats?: Record<string, number>;
  workbook?: { sheets: { name: string; rowCount: number; columnCount: number; rows: XlsxCell[][]; truncated: boolean }[] };
}
export type DocBlock =
  | { type: 'title' | 'paragraph'; text: string }
  | { type: 'heading'; level: number; text: string }
  | { type: 'bullets' | 'numbered'; items: string[] }
  | { type: 'table'; rows: string[][] };

export interface ToolDefinition {
  name: string;
  description: string;
  parameters: { type: 'object'; required?: string[]; properties?: Record<string, { type?: string | string[]; description?: string; enum?: string[] }> };
  permission: ToolPermission;
  example?: Record<string, unknown>;
}

export interface ToolValidation {
  tool: string;
  permission: ToolPermission;
  preview: ToolPreview;
  approvalId: string | null;
}

export interface ToolExecution {
  tool: string;
  permission: ToolPermission;
  summary: string;
  content: string;
  data?: unknown;
  candidate?: Omit<MemoryCandidate, 'id' | 'status' | 'source'> & { rule?: string };
}

export interface RetrievedMemory {
  memory: Memory;
  score: number;
  reason: 'match' | 'pinned';
}

export interface AttachmentUpload {
  id: string;
  name: string;
  size: number;
  kind: string;
  totalChunks: number;
  context: string;
  complete: boolean;
}

export type NewMemory = Partial<Pick<Memory, 'tags' | 'importance' | 'pinned' | 'sourceConversationId' | 'sourceConversationTitle' | 'characterId'>> & {
  type: MemoryType;
  content: string;
};

/* ------------------------------------------------------------------ */

export type ImageBackend=string;
export interface ImageProfile {id:ImageBackend;labOnly?:boolean;label:string;available:boolean;installed:boolean;compatible?:boolean;detected?:boolean;primary?:boolean;file?:string;reason?:string;tasks:string[]}
export type ImageQuality='fast'|'normal'|'high';
export interface ImageJob {
  id: string;
  status: 'queued' | 'preparing' | 'running' | 'done' | 'failed' | 'cancelled';
  prompt: string; seed: number; workflow: string;
  backend?:ImageBackend;quality?:ImageQuality;routingReason?:string;qualityPendingReview?:boolean;
  width?:number;height?:number;inputId?:string;denoise?:number;originalSize?:boolean;edit?:unknown;
  images: {url: string; alt: string;variant?:'original'|'upscaled';width?:number;height?:number}[];
  stage?:string;generationMs?:number;upscaleMs?:number;upscaleModel?:string;
  error?: string; warning?: string;
}

export interface GalleryItem {id:string;index:number;kind:'generate'|'edit'|'upscale';prompt:string;width?:number;height?:number;createdAt:string;url:string;thumb:string}

export function createServiceClient(BASE='/api', transport:typeof fetch=fetch) {
async function request<T>(path: string, init: RequestInit & { json?: unknown; raw?: boolean } = {}): Promise<T> {
  const headers: Record<string, string> = { 'X-PersonalAI': '1', 'X-Lumicos-Device':clientId, ...(init.headers as Record<string, string>) };
  let body = init.body;
  if (init.json !== undefined) {
    headers['Content-Type'] = 'application/json';
    body = JSON.stringify(init.json);
  }
  let res: Response;
  try {
    res = await transport(`${BASE}${path}`, { ...init, headers, body });
  } catch {
    throw new ServiceError('The PersonalAI local service is not running. Start it with start-personalai.bat (or npm run service).', 0, 'OFFLINE');
  }
  if (res.status === 502 || res.status === 504) {
    throw new ServiceError('The PersonalAI local service is not running. Start it with start-personalai.bat (or npm run service).', res.status, 'OFFLINE');
  }
  if (!res.ok) {
    let msg = `${res.status} ${res.statusText}`;
    let code = 'ERROR';
    try {
      const j = await res.json();
      msg = j?.error?.message ?? msg;
      code = j?.error?.code ?? code;
    } catch {
      /* not JSON */
    }
    throw new ServiceError(msg, res.status, code);
  }
  if (init.raw) return (await res.blob()) as T;
  return (await res.json()) as T;
}

return {
  owner: {
    status: () => request<OwnerStatus>('/owner/status'),
    enroll: (password:string,challenge:string) => request<OwnerStatus>('/owner/enroll',{method:'POST',json:{password,challenge}}),
    login: (password:string,challenge:string) => request<OwnerStatus>('/owner/login',{method:'POST',json:{password,challenge}}),
    logout: (csrf:string,nonce:string) => request<{ok:boolean;role:'agent'}>('/owner/logout',{method:'POST',headers:{'X-Lumicos-CSRF':csrf},json:{nonce}}),
  },
  images: {
    profiles: () => request<ImageProfile[]>('/images/profiles'),
    preferences: () => request<{backend:ImageBackend;quality:ImageQuality}>('/images/preferences'),
    setPreferences: (value:{backend:ImageBackend;quality:ImageQuality})=>request('/images/preferences',{method:'POST',json:value}),
    status: () => request<{online:boolean; workflow:string; error?:string}>('/images/status'),
    create: (prompt:string, options: {engine?:'flux3-edit'|'flux3-merge'|'flux3-ref';inputIds?:string[];edit?:unknown;width?:number;height?:number;inputId?:string;denoise?:number;originalSize?:boolean;backend?:ImageBackend;lab?:boolean;quality?:ImageQuality;upscale?:boolean;correlationId?:string;messageId?:string} = {}) => request<ImageJob>('/images/jobs', {method:'POST', json:{prompt,...options}}),
    upload: (file:File) => request<{id:string;url:string}>('/images/inputs',{method:'POST',body:file}),
    upscale: (inputId:string,scale:2|4) => request<ImageJob>('/images/upscale',{method:'POST',json:{inputId,scale}}),
    gallery: () => request<GalleryItem[]>('/images/gallery'),
    get: (id:string) => request<ImageJob>(`/images/jobs/${id}`),
    cancel: (id:string) => request<ImageJob>(`/images/jobs/${id}/cancel`, {method:'POST'}),
    /** Image Lab: ask the service to start ComfyUI now (no-op when it is already running). */
    warm: () => request<{state:string}>('/images/warm', {method:'POST'}),
    removeBackground: (file:Blob) => request<Blob>('/images/remove-bg',{method:'POST',body:file,raw:true}),
    recover: () => request<{ok:boolean}>('/images/recover',{method:'POST'}),
    download: (url:string) => {
      if (!/^\/api\/images\/(?:jobs\/[a-f0-9-]{36}\/images\/\d+|thumb\/[a-f0-9-]{36}\/\d+|lab-cover\/[a-z0-9-]{1,40}|inputs\/[a-f0-9-]{36})$/.test(url)) throw new Error('Invalid image URL.');
      return request<Blob>(url.slice(4),{raw:true});
    },
  },
  health: () => request<ServiceHealth>('/health', { signal: AbortSignal.timeout(3000) }),
  bugReports: {
    create: (input: { replyId: string; note?: string; replyText?: string }) =>
      request<{ name: string; file: string; traced: boolean }>('/bug-reports', { method: 'POST', json: input }),
    list: () => request<{ reports: { name: string; note: string }[] }>('/bug-reports').then((r) => r.reports),
  },
  selfCheck: (mode?: 'health') => request<{ model: string; files?: string[]; report: string; errorsSeen?: number; ms?: number; digest?: string }>('/selfcheck', { method: 'POST', json: mode ? { mode } : {}, signal: AbortSignal.timeout(330_000) }),

  files: {
    list: (path = '') => request<{ path: string; entries: FileEntry[] }>(`/files/list${q({ path })}`),
    preview: (path: string) => request<FilePreview>(`/files/preview${q({ path })}`),
    download: (path: string) => request<Blob>(`/files/download${q({ path })}`, { raw: true }),
    upload: (path: string, file: Blob) => request<{ path: string; renamed: boolean }>(`/files/upload${q({ path })}`, { method: 'PUT', body: file }),
    mkdir: (path: string) => request<{ path: string }>('/files/mkdir', { method: 'POST', json: { path } }),
    rename: (path: string, newName: string) => request<{ path: string }>('/files/rename', { method: 'POST', json: { path, newName } }),
    move: (path: string, to: string) => request<{ path: string }>('/files/move', { method: 'POST', json: { path, to } }),
    copy: (path: string, to: string) => request<{ path: string }>('/files/copy', { method: 'POST', json: { path, to } }),
    /** Only called from a confirmation dialog. */
    remove: (path: string) => request<{ path: string; backup: string }>('/files/delete', { method: 'POST', json: { path, confirm: true } }),
  },

  tools: {
    list: () => request<{ tools: ToolDefinition[] }>('/tools').then((r) => r.tools),
    validate: (name: string, args: Record<string, unknown>) => request<ToolValidation>('/tools/validate', { method: 'POST', json: { name, args } }),
    execute: (name: string, args: Record<string, unknown>, approvalId?: string | null, signal?:AbortSignal) =>
      request<ToolExecution>('/tools/execute', { method: 'POST', json: { name, args, approvalId },signal }),
  },

  memory: {
    list: (filters: { q?: string; type?: string; characterId?: string } = {}) =>
      request<{ memories: Memory[] }>(`/memory${q(filters)}`).then((r) => r.memories),
    create: (m: NewMemory) => request<Memory>('/memory', { method: 'POST', json: m }),
    update: (id: string, patch: Partial<Memory>) => request<Memory>(`/memory/${id}`, { method: 'PATCH', json: patch }),
    remove: (id: string) => request<{ id: string }>(`/memory/${id}`, { method: 'DELETE' }),
    retrieve: (query: string, characterId: string | null, limit: number) =>
      request<{ memories: RetrievedMemory[] }>('/memory/retrieve', { method: 'POST', json: { query, characterId, limit } }).then((r) => r.memories),
    candidates: (text: string, pending: string[]) =>
      request<{ candidates: Omit<MemoryCandidate, 'id' | 'status' | 'source'>[] }>('/memory/candidates', { method: 'POST', json: { text, pending } }).then((r) => r.candidates),
    dedupe: (candidates: unknown[]) =>
      request<{ candidates: Omit<MemoryCandidate, 'id' | 'status' | 'source'>[] }>('/memory/dedupe', { method: 'POST', json: { candidates } }).then((r) => r.candidates),
  },

  knowledge: {
    learn: (input: { question: string; answer: string; sources: { title?: string; url: string }[]; confirmed?: boolean }) =>
      request<{ file: string; status: string }>('/knowledge/learn', { method: 'POST', json: input }),
  },

  attachments: {
    pdfPage: (id: string, page: number) =>
      request<{
        page: number;
        totalPages: number;
        width: number;
        height: number;
        image: string;
      }>(`/attachments/${encodeURIComponent(id)}/pdf/pages/${page}`),
    upload: (file: File) => request<AttachmentUpload>(`/attachments${q({ name: file.name })}`, { method: 'POST', body: file }),
    usage: () => request<{ count: number; bytes: number }>('/attachments/usage'),
    clear: () => request<{ removed: number }>('/attachments', { method: 'DELETE' }),
  },
};

}
export const localService = createServiceClient();

export const ATTACHMENT_ACCEPT = '.txt,.md,.markdown,.csv,.json,.docx,.xlsx,.pdf';
