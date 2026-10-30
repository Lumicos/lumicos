import { useCallback, useEffect, useState } from 'react';
import { Cpu, FolderPlus, Loader2, RefreshCw, Trash2, X } from 'lucide-react';
import { modelApi, type ModelStatus } from '../services/models';

type Found = { name: string; path: string; folder?: string; size?: number; architecture?: string | null };
type Status = ModelStatus & { discovered?: Found[]; activeTurns?: number };

const gb = (bytes?: number) => (bytes ? `${(bytes / 1024 ** 3).toFixed(1)} GB` : '');
const CALL_MODEL = 'Gemma 4 E2B · Call';

/**
 * Model Manager: every .gguf inside the model folders shows up here.
 * Drop a model folder into a model folder, press Refresh, then "ใช้โมเดลนี้".
 */
export function ModelManager({ online }: { online: boolean }) {
  const [status, setStatus] = useState<Status>();
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string>();
  const [folder, setFolder] = useState('');

  const run = useCallback(async (label: string, task: () => Promise<Status>) => {
    setBusy(label); setError(undefined);
    try { setStatus(await task()); window.dispatchEvent(new Event('lumicos-model-refresh')); }
    catch (e) { setError((e as Error).message); setStatus(await modelApi<Status>().catch(() => status)); }
    finally { setBusy(null); }
  }, [status]);

  useEffect(() => {
    if (!online) return;
    const load = () => void modelApi<Status>().then(setStatus).catch(e => setError((e as Error).message));
    load();
    window.addEventListener('lumicos-model-refresh', load);
    return () => window.removeEventListener('lumicos-model-refresh', load);
  }, [online]);

  if (!online) return <p className="muted">บริการ Lumicos ยังไม่เปิด</p>;
  if (!status) return <p className="muted"><Loader2 size={14} className="spin" /> กำลังโหลดรายการโมเดล…</p>;

  const locked = !!busy || status.busy || (status.activeTurns ?? 0) > 0;
  const active = status.profile?.id;
  const folders = status.modelDirs ?? [];
  const found = (status.discovered ?? []) as Found[];

  return <div className="model-manager">
    <div className="mm-head">
      <div>
        <div className="mm-current"><Cpu size={16} /> {status.profile?.name ?? 'ยังไม่ได้โหลดโมเดล'}</div>
        <div className="muted small">สถานะ: {status.phase}{(status.activeTurns ?? 0) > 0 ? ' · กำลังตอบแชทอยู่ (เปลี่ยนโมเดลได้เมื่อตอบเสร็จ)' : ''}</div>
      </div>
      <button className="btn btn-soft" disabled={!!busy} onClick={() => void run('refresh', () => modelApi<Status>('/refresh', {}))}>
        {busy === 'refresh' ? <Loader2 size={14} className="spin" /> : <RefreshCw size={14} />} Refresh
      </button>
    </div>
    {error && <div className="form-error" role="alert">{error}</div>}

    <h4>โมเดลในรายการ</h4>
    <ul className="mm-list">
      {status.profiles.map(p => {
        const isActive = p.id === active;
        return <li key={p.id} className={isActive ? 'active' : ''}>
          <div className="mm-name">
            <b>{p.name}</b>
            <span className="muted small">{p.path.split(/[\\/]/).slice(-2).join('\\')}</span>
            <span className="mm-tags">
              {p.capabilities.vision && <span className="tag">ดูภาพได้</span>}
              {p.capabilities.tools && <span className="tag">ใช้เครื่องมือได้</span>}
              <span className="tag">ctx {p.ctx}</span>
              {p.name === CALL_MODEL && <span className="tag">ใช้ตอนโทร</span>}
              {p.available === false && <span className="tag warn">ไม่พบไฟล์</span>}
            </span>
          </div>
          <div className="mm-actions">
            {isActive ? <span className="tag ok">กำลังใช้</span> :
              <button className="btn btn-primary btn-sm" disabled={locked || p.available === false}
                onClick={() => void run(p.id, () => modelApi<Status>('/switch', { id: p.id }))}>
                {busy === p.id ? <Loader2 size={14} className="spin" /> : null} ใช้โมเดลนี้
              </button>}
            {!isActive && (p.id !== status.primaryId || p.available === false) &&
              <button className="icon-btn" title="เอาออกจากรายการ (ไม่ลบไฟล์)" disabled={locked}
                onClick={() => void run('rm' + p.id, () => modelApi<Status>('/remove', { id: p.id }))}><Trash2 size={14} /></button>}
          </div>
        </li>;
      })}
    </ul>

    <h4>พบในโฟลเดอร์โมเดล (ยังไม่เคยใช้)</h4>
    {found.length === 0 ? <p className="muted small">ไม่มีไฟล์ใหม่ · วางโฟลเดอร์โมเดล (.gguf และ mmproj ถ้ามี) ไว้ในโฟลเดอร์ด้านล่าง แล้วกด Refresh</p> :
      <ul className="mm-list">
        {found.map(f => <li key={f.path}>
          <div className="mm-name">
            <b>{f.name.replace(/\.gguf$/i, '')}</b>
            <span className="muted small">{f.folder ? f.folder + ' · ' : ''}{gb(f.size)}{f.architecture ? ' · ' + f.architecture : ''}</span>
          </div>
          <div className="mm-actions">
            <button className="btn btn-primary btn-sm" disabled={locked}
              onClick={() => void run(f.path, () => modelApi<Status>('/switch', { path: f.path }))}>
              {busy === f.path ? <Loader2 size={14} className="spin" /> : null} ใช้โมเดลนี้
            </button>
            <button className="btn btn-soft btn-sm" disabled={locked}
              onClick={() => void run('add' + f.path, () => modelApi<Status>('/add', { path: f.path }))}>เพิ่มเข้ารายการ</button>
          </div>
        </li>)}
      </ul>}

    <h4>โฟลเดอร์โมเดล</h4>
    <ul className="mm-folders">
      {folders.map(d => <li key={d}><code>{d}</code>
        <button className="icon-btn" title="เลิกค้นในโฟลเดอร์นี้" disabled={!!busy}
          onClick={() => void run('folders', () => modelApi<Status>('/folders', { modelDirs: folders.filter(x => x !== d) }))}><X size={14} /></button>
      </li>)}
    </ul>
    <div className="mm-add-folder">
      <input value={folder} onChange={e => setFolder(e.target.value)} placeholder="C:\AI\models" aria-label="เพิ่มโฟลเดอร์โมเดล" />
      <button className="btn btn-soft" disabled={!!busy || !folder.trim()}
        onClick={() => void run('folders', async () => { const r = await modelApi<Status>('/folders', { modelDirs: [...folders, folder.trim()] }); setFolder(''); return r; })}>
        <FolderPlus size={14} /> เพิ่มโฟลเดอร์
      </button>
    </div>
    <p className="muted small">ค้นลึกได้ 3 ชั้น ไฟล์ mmproj ในโฟลเดอร์เดียวกันจะถูกจับคู่ให้อัตโนมัติ (เปิดการดูภาพ) · การ์ดจอ 8 GB เหมาะกับโมเดลไม่เกินราว 9B แบบ Q4</p>
  </div>;
}
