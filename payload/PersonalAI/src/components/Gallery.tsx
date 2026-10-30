import { useCallback, useEffect, useRef, useState } from 'react';
import { Check, CheckSquare, PenLine, Trash2, X } from 'lucide-react';
import { ImagePreview } from '../chat/MessagePart';
import { localService, type GalleryItem } from '../services/localService';

type Filter = 'all' | GalleryItem['kind'];
const FILTERS: [Filter, string][] = [['all', 'ทั้งหมด'], ['generate', 'สร้างภาพ'], ['edit', 'แต่งภาพ'], ['upscale', 'อัปสเกล']];
const KIND_LABEL: Record<GalleryItem['kind'], string> = { generate: 'สร้าง', edit: 'แต่ง', upscale: 'อัปสเกล' };

/** Thumbnail loaded only when it scrolls near the screen. */
function Thumb({ item, onOpen }: { item: GalleryItem; onOpen: () => void }) {
  const box = useRef<HTMLButtonElement>(null);
  const [src, setSrc] = useState('');
  const [near, setNear] = useState(false);
  useEffect(() => {
    const el = box.current;
    if (!el) return;
    const io = new IntersectionObserver((e) => { if (e.some((x) => x.isIntersecting)) { setNear(true); io.disconnect(); } }, { rootMargin: '300px' });
    io.observe(el);
    return () => io.disconnect();
  }, []);
  useEffect(() => {
    if (!near) return;
    let value = '', alive = true;
    localService.images.download(item.thumb).then((b) => { if (alive) { value = URL.createObjectURL(b); setSrc(value); } }).catch(() => {});
    return () => { alive = false; if (value) URL.revokeObjectURL(value); };
  }, [near, item.thumb]);
  const ratio = item.width && item.height ? `${item.width} / ${item.height}` : '3 / 4';
  return (
    <button ref={box} type="button" className="gallery-open" style={{ aspectRatio: ratio }} aria-label={`ดูภาพ ${item.prompt}`} onClick={onOpen}>
      {src ? <img src={src} alt={item.prompt} /> : <span className="gallery-wait" />}
    </button>
  );
}

export function Gallery({ onEdit }: { onEdit?: (file: File) => void } = {}) {
  const [items, setItems] = useState<GalleryItem[] | null>(null);
  const [filter, setFilter] = useState<Filter>('all');
  const [error, setError] = useState('');
  const [deleting, setDeleting] = useState<string | null>(null);
  const [selecting, setSelecting] = useState(false);
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [view, setView] = useState<{ item: GalleryItem; url: string } | null>(null);

  const load = useCallback(() => {
    localService.images.gallery().then((l) => { setItems(l); setError(''); }).catch((e: Error) => { setItems([]); setError(e.message || 'โหลดคลังภาพไม่สำเร็จ'); });
  }, []);
  useEffect(load, [load]);
  useEffect(() => () => { if (view) URL.revokeObjectURL(view.url); }, [view]);

  const open = async (item: GalleryItem) => {
    try { const b = await localService.images.download(item.url); setView({ item, url: URL.createObjectURL(b) }); }
    catch (e) { setError((e as Error).message); }
  };
  const remove = async (item: GalleryItem) => {
    if (!window.confirm('ลบภาพนี้ถาวร? ภาพจะหายจากแชตด้วย')) return;
    setDeleting(item.id); setError('');
    try {
      const r = await fetch(item.url, { method: 'DELETE', headers: { 'X-PersonalAI': '1' } });
      if (!r.ok) throw Error((await r.json().catch(() => null))?.error?.message ?? 'ลบภาพไม่สำเร็จ');
      setItems((l) => (l ?? []).filter((x) => x.id !== item.id));
    } catch (e) { setError((e as Error).message); } finally { setDeleting(null); }
  };

  const toggle = (id: string) => setPicked((p) => { const n = new Set(p); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  const endSelect = () => { setSelecting(false); setPicked(new Set()); };
  const removePicked = async () => {
    const chosen = (items ?? []).filter((i) => picked.has(i.id));
    if (!chosen.length || !window.confirm(`ลบ ${chosen.length} ภาพที่เลือกถาวร? ภาพจะหายจากแชตด้วย`)) return;
    setError(''); setDeleting('bulk');
    const gone = new Set<string>(); let failed = '';
    for (const item of chosen) {
      try {
        const r = await fetch(item.url, { method: 'DELETE', headers: { 'X-PersonalAI': '1' } });
        if (!r.ok) throw Error((await r.json().catch(() => null))?.error?.message ?? 'ลบภาพไม่สำเร็จ');
        gone.add(item.id);
      } catch (e) { failed = (e as Error).message; }
    }
    setItems((l) => (l ?? []).filter((x) => !gone.has(x.id)));
    setPicked((p) => new Set([...p].filter((id) => !gone.has(id))));
    if (failed) setError(`ลบไม่สำเร็จ ${chosen.length - gone.size} ภาพ: ${failed}`);
    else endSelect();
    setDeleting(null);
  };
  const edit = async (item: GalleryItem) => {
    try { const b = await localService.images.download(item.url); onEdit?.(new File([b], 'album.png', { type: b.type || 'image/png' })); }
    catch (e) { setError((e as Error).message); }
  };

  const shown = (items ?? []).filter((i) => filter === 'all' || i.kind === filter);
  return (
    <main className="gallery">
      <h1>คลังภาพ</h1>
      <p className="muted">ภาพที่สร้าง แต่ง และอัปสเกลทั้งหมด · แตะภาพเพื่อดู · กด "เลือกหลายรูป" เพื่อลบทีเดียวหรือแก้ไข</p>
      <div className="gallery-filters" role="tablist">
        {FILTERS.map(([k, label]) => (
          <button key={k} type="button" role="tab" aria-selected={filter === k} className={filter === k ? 'active' : ''} onClick={() => setFilter(k)}>
            {label}{items ? <em>{k === 'all' ? items.length : items.filter((i) => i.kind === k).length}</em> : null}
          </button>
        ))}
      </div>
      <div className="gallery-bar">
        {!selecting
          ? <button type="button" className="btn btn-ghost btn-sm" disabled={!shown.length} onClick={() => setSelecting(true)}><CheckSquare size={15} /> เลือกหลายรูป</button>
          : <>
            <b>เลือกแล้ว {picked.size} ภาพ</b>
            <button type="button" className="btn btn-ghost btn-sm" onClick={() => setPicked(new Set(shown.map((i) => i.id)))}>เลือกทั้งหมด</button>
            <button type="button" className="btn btn-ghost btn-sm" disabled={!picked.size} onClick={() => setPicked(new Set())}>ล้างที่เลือก</button>
            <button type="button" className="btn btn-sm gallery-bulk-delete" disabled={!picked.size || deleting === 'bulk'} onClick={() => void removePicked()}><Trash2 size={15} /> ลบที่เลือก</button>
            <button type="button" className="btn btn-ghost btn-sm" onClick={endSelect}><X size={15} /> เสร็จ</button>
          </>}
      </div>
      {error && <p className="form-error" role="alert">{error}</p>}
      <div className="gallery-grid">
        {shown.map((it) => (
          <figure key={it.id} className={selecting && picked.has(it.id) ? 'is-picked' : ''}>
            <Thumb item={it} onOpen={() => (selecting ? toggle(it.id) : void open(it))} />
            {selecting && <button type="button" className={`gallery-check ${picked.has(it.id) ? 'on' : ''}`} role="checkbox" aria-checked={picked.has(it.id)} aria-label="เลือกภาพ" onClick={() => toggle(it.id)}>{picked.has(it.id) && <Check size={16} />}</button>}
            {selecting && picked.has(it.id) && onEdit && <button type="button" className="btn btn-sm gallery-edit" onClick={() => void edit(it)}><PenLine size={14} /> แก้ไข</button>}
            <span className={`gallery-kind kind-${it.kind}`}>{KIND_LABEL[it.kind]}</span>
            {!selecting && <button className="icon-btn gallery-delete" title="ลบภาพ" aria-label="ลบภาพ" disabled={deleting === it.id} onClick={() => void remove(it)}><Trash2 size={16} /></button>}
            <figcaption>{it.prompt}</figcaption>
          </figure>
        ))}
      </div>
      {items === null && <p>กำลังโหลด…</p>}
      {items !== null && !shown.length && !error && <p>ยังไม่มีภาพในหมวดนี้</p>}
      {view && <ImagePreview url={view.url} alt={view.item.prompt} downloadName="Lumicos.png" close={() => setView(null)} />}
    </main>
  );
}
