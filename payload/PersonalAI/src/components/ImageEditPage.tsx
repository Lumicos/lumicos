import '../imageEdit.css';
import '../imageLab.css';
import { LAB_TEMPLATES, type LabTemplate } from '../imageLab/templates';
import { ArrowUp, Brush, Check, Layers, ChevronLeft, Download, Eraser, Expand, Images, ImagePlus, ImageUp, Loader2, PenLine, Plus, Sparkles, Square, Trash2, Undo2, Wand2, X, ZoomIn } from 'lucide-react';
import { Gallery } from './Gallery';
import { useEffect, useRef, useState, type PointerEvent } from 'react';
import type { LLMProvider } from '../providers/types';
import { localService, type ImageJob } from '../services/localService';

type Mode = 'create' | 'extend' | 'edit' | 'upscale' | 'style' | 'cutout' | 'instruct' | 'merge' | 'ref';
const MERGE_MAX = 4;
const REF_SIZES = [['portrait', 'แนวตั้ง', 576, 768], ['square', 'จัตุรัส', 640, 640], ['landscape', 'แนวนอน', 768, 576]] as const;
type Side = 'left' | 'top' | 'right' | 'bottom';
type Pad = Record<Side, number>;
const NO_PAD: Pad = { left: 0, top: 0, right: 0, bottom: 0 };
const KEEP = 'seamless natural continuation of the scene, same style, lighting and camera as the original photo';
const DELETE_WORDS = /(ลบ|เอา.{0,24}ออก|หายไป|ไม่ต้องมี|\b(?:remove|delete|erase|get rid)\b)/i;
const CLEAN = 'clean empty background that continues the surrounding scene naturally, same style, lighting and camera';
const MODES = [['instruct', 'แก้ด้วยคำสั่ง', Wand2], ['merge', 'รวมภาพ', Layers], ['ref', 'อ้างอิงภาพ', ImagePlus], ['cutout', 'ลบพื้นหลัง', Eraser], ['extend', 'ขยายขอบ', Expand], ['edit', 'เติม / แก้', PenLine], ['upscale', 'อัปสเกล', ZoomIn]] as const;
const SIZES = [['portrait', 'แนวตั้ง', 768, 1024], ['square', 'จัตุรัส', 768, 768], ['landscape', 'แนวนอน', 1024, 576], ['r23', '2:3', 768, 1152], ['r32', '3:2', 1152, 768], ['wide', '4:3', 1024, 768], ['tall', '9:16', 576, 1024], ['r219', '21:9', 1120, 480], ['r52', '5:2', 1120, 448]] as const;
const RATIOS = [['2:3', 2, 3], ['3:2', 3, 2], ['4:3', 4, 3], ['1:1', 1, 1], ['9:16', 9, 16], ['16:9', 16, 9], ['21:9', 21, 9], ['5:2', 5, 2]] as const;
/** Fast = about 620x620 worth of pixels (server rounds to a multiple of 16: 624); quality = about 890x890. The server picks the final size from the quality budget. */
const dimsFor = (rw: number, rh: number, fast: boolean): readonly [number, number] => {
  const area = fast ? 624 * 624 : 888 * 888, r = rw / rh;
  const al = (n: number) => Math.max(256, Math.round(n / 16) * 16);
  return [al(Math.sqrt(area * r)), al(Math.sqrt(area / r))];
};
const RatioIcon = ({ w, h }: { w: number; h: number }) => { const k = 18 / Math.max(w, h); return <span className="ratio-ico" style={{ width: Math.max(8, w * k), height: Math.max(8, h * k) }} />; };
const CARDS = [
  { mode: 'edit', title: 'แก้ภาพ', desc: 'ระบายแล้วสั่งด้วยข้อความ', kind: 'edit', pick: 0, Icon: PenLine },
  { mode: 'extend', title: 'ขยายขอบ', desc: 'ต่อภาพให้กว้างขึ้น', kind: 'edit', pick: 1, Icon: Expand },
  { mode: 'cutout', title: 'ลบพื้นหลัง', desc: 'ได้ PNG พื้นหลังโปร่งใส', kind: 'edit', pick: 0, Icon: Eraser },
  { mode: 'upscale', title: 'อัปสเกล', desc: 'ทำให้คมและใหญ่ขึ้น', kind: 'upscale', pick: 0, Icon: ZoomIn },
  { mode: 'merge', title: 'รวมภาพ', desc: 'รวม 2–4 รูปเป็นภาพเดียว เช่น คนจากรูปหนึ่ง สินค้าจากอีกรูป', kind: 'edit', pick: 0, Icon: Layers },
  { mode: 'ref', title: 'อ้างอิงภาพ', desc: 'สร้างภาพใหม่ โดยใช้คนหรือสินค้าจากรูปอ้างอิง', kind: 'edit', pick: 0, Icon: ImagePlus },
] as const;
const clamp = (n: number, lo = 0, hi = 1) => Math.min(hi, Math.max(lo, n));
const snap = (n: number) => Math.round(n / 0.05) * 0.05;

/** Largest value a side may take: each side ≤100%, and opposite sides together ≤150% (server limit). */
function limit(side: Side, pad: Pad) {
  const other = side === 'left' ? pad.right : side === 'right' ? pad.left : side === 'top' ? pad.bottom : pad.top;
  return Math.min(1, 1.5 - other);
}

interface Props { online: boolean; provider: LLMProvider; onBack: () => void; initialScreen?: 'home' | 'album' }


type Result = { url: string; before: string; pad: Pad; w: number; h: number };
type Done = { url: string; blob: Blob; kind: Mode; before: string; pad: Pad; w: number; h: number };
/** One submitted job. Jobs run one after another on the server's GPU queue; the user can keep submitting. */
type QItem = { id: string; kind: Mode; label: string; before: string; status: 'sending' | 'queued' | 'running' | 'done' | 'failed' | 'cancelled'; stage: string; error?: string; jobId?: string; done?: Done };
type Snap = { refSize?: readonly [number, number]; files?: File[]; file?: File; mode: Mode; text: string; tpl?: LabTemplate; pad: Pad; scale: 2 | 4; mask?: File; sizeKey: (typeof SIZES)[number][0]; autoUp: boolean; model?: string; dims?: readonly [number, number]; fast?: boolean };
const KIND_LABEL: Record<Mode, string> = { ref: 'อ้างอิงภาพ', merge: 'รวมภาพ', instruct: 'แก้ด้วยคำสั่ง', cutout: 'ลบพื้นหลัง', extend: 'ขยายขอบ', edit: 'เติม / แก้', upscale: 'อัปสเกล', style: 'แปลงสไตล์', create: 'สร้างภาพ' };
/** Before/after with a smooth cross-fade. The original sits where it ended up in the result (extended borders show as empty). */
function Compare({ r }: { r: Result }) {
  const [before, setBefore] = useState(false);
  const f = 1 + r.pad.left + r.pad.right, g = 1 + r.pad.top + r.pad.bottom;
  const ratio = r.w / r.h;
  return <div className="imgedit-compare-wrap">
    <div className={`imgedit-compare ${before ? 'show-before' : ''}`} style={{ aspectRatio: String(ratio), width: `min(100%, calc(62vh * ${ratio}))` }}
      onPointerDown={() => setBefore(true)} onPointerUp={() => setBefore(false)} onPointerLeave={() => setBefore(false)} onPointerCancel={() => setBefore(false)}>
      <img className="imgedit-after imgedit-reveal" src={r.url} alt="หลัง" draggable={false} />
      <div className="imgedit-before">
        <img src={r.before} alt="ก่อน" draggable={false} style={{ left: `${(r.pad.left / f) * 100}%`, top: `${(r.pad.top / g) * 100}%`, width: `${100 / f}%`, height: `${100 / g}%` }} />
      </div>
      <span className="imgedit-tag">{before ? 'ก่อน' : 'หลัง'}</span>
    </div>
    <div className="imgedit-seg" role="group" aria-label="ก่อน / หลัง">
      <button className={!before ? 'on' : ''} onClick={() => setBefore(false)}>หลัง</button>
      <button className={before ? 'on' : ''} onClick={() => setBefore(true)}>ก่อน</button>
    </div>
    <small className="muted">กดค้างที่ภาพเพื่อดูภาพก่อนแก้ หรือกดสลับด้านล่าง</small>
  </div>;
}

export function ImageEditPage({ online, initialScreen = 'home' }: Props) {
  const [file, setFile] = useState<File>();
  const [mergeFiles, setMergeFiles] = useState<File[]>([]);
  const [mergeUrls, setMergeUrls] = useState<string[]>([]);
  const [src, setSrc] = useState('');
  const [dims, setDims] = useState<{ w: number; h: number }>();
  const [mode, setMode] = useState<Mode>('extend');
  const [prompt, setPrompt] = useState('');
  const [pad, setPad] = useState<Pad>(NO_PAD);
  const [painted, setPainted] = useState(false);
  const [brush, setBrush] = useState(48);
  const [erasing, setErasing] = useState(false);
  const [ring, setRing] = useState<{ x: number; y: number }>();
  const paintRef = useRef<HTMLCanvasElement>(null);
  const strokes = useRef<ImageData[]>([]);
  const last = useRef<{ x: number; y: number } | undefined>(undefined);
  const [scale, setScale] = useState<2 | 4>(2);
  const [screen, setScreen] = useState<'home' | 'work' | 'album'>(initialScreen);
  const [homePrompt, setHomePrompt] = useState('');
  const pickRef = useRef<HTMLInputElement>(null);
  const [tpl, setTpl] = useState<LabTemplate>();
  const [covers, setCovers] = useState<Record<string, string>>({});
  const [sizeKey, setSizeKey] = useState<(typeof SIZES)[number][0]>('portrait');
  const [autoUp, setAutoUp] = useState(false);
  const homeCreate = true; // the home prompt bar always creates; the picture button starts an edit
  const [homeQuality, setHomeQuality] = useState<'fast' | 'high'>('high');
  const [autoRun, setAutoRun] = useState(false);
  const [ratioKey, setRatioKey] = useState<(typeof RATIOS)[number][0]>('2:3');
  const [ratioOpen, setRatioOpen] = useState(false);
  const [createDims, setCreateDims] = useState<readonly [number, number]>();
  const [createFast, setCreateFast] = useState(false);
  const [mossReady, setMossReady] = useState(false);
  const [createModel, setCreateModel] = useState<'default' | 'moss-image'>('default');
  useEffect(() => { let live = true; localService.images.profiles().then(l => { if (live) setMossReady(l.some(p => p.id === 'moss-image' && p.available)); }).catch(() => {}); return () => { live = false; }; }, []);
  const [refKey, setRefKey] = useState<(typeof REF_SIZES)[number][0]>('portrait');
  const [busy, setBusy] = useState(false);
  const stage = 'กำลังส่งภาพ…';
  const [error, setError] = useState('');
  const [result, setResult] = useState<Done>();
  const [queue, setQueue] = useState<QItem[]>([]);
  const queueRef = useRef<QItem[]>([]);
  queueRef.current = queue;
  const ctrls = useRef(new Map<string, AbortController>());
  const fileRef = useRef<File | undefined>(undefined);
  fileRef.current = file;
  const mergeRef = useRef<File[]>([]);
  mergeRef.current = mergeFiles;
  const [fixedW, setFixedW] = useState<number>();
  const resizing = useRef<{ side: Side; start: number; startPad: Pad; imgPx: number } | undefined>(undefined);
  const imgRef = useRef<HTMLImageElement>(null);

  // Keep ComfyUI started while Image Lab is open and visible, so the first job skips the ComfyUI boot.
  // Re-sent every 2 min in case a chat (e.g. from the phone) handed the GPU back to Gemma meanwhile.
  useEffect(() => {
    if (!online) return;
    const ping = () => { if (document.visibilityState === 'visible') void localService.images.warm().catch(() => {}); };
    ping();
    const t = window.setInterval(ping, 120_000);
    document.addEventListener('visibilitychange', ping);
    return () => { window.clearInterval(t); document.removeEventListener('visibilitychange', ping); };
  }, [online]);
  useEffect(() => {
    const urls = mergeFiles.map(f => URL.createObjectURL(f)); setMergeUrls(urls);
    return () => urls.forEach(u => URL.revokeObjectURL(u));
  }, [mergeFiles]);
  useEffect(() => {
    if (!file) { setSrc(''); setDims(undefined); return; }
    const u = URL.createObjectURL(file); setSrc(u);
    const probe = new Image(); probe.onload = () => setDims({ w: probe.naturalWidth, h: probe.naturalHeight }); probe.src = u;
    return () => URL.revokeObjectURL(u);
  }, [file]);
  useEffect(() => () => { ctrls.current.forEach(c => c.abort()); queueRef.current.forEach(i => { if (i.before) URL.revokeObjectURL(i.before); if (i.done) URL.revokeObjectURL(i.done.url); }); }, []);

  const choose = (f?: File, keepMode = false) => {
    if (!f) return;
    if (!/\.(png|jpe?g)$/i.test(f.name) || f.size > 20 * 1024 * 1024) { setError('เลือกภาพ PNG หรือ JPG ขนาดไม่เกิน 20 MB'); return; }
    setError(''); setFile(f); setPainted(false); setPad(NO_PAD); setResult(undefined);
    if (!keepMode) setMode(m => m);
  };

  const addMerge = (list?: FileList | null) => {
    const picked = Array.from(list ?? []);
    if (!picked.length) return;
    if (picked.some(f => !/\.(png|jpe?g)$/i.test(f.name) || f.size > 20 * 1024 * 1024)) { setError('เลือกภาพ PNG หรือ JPG ขนาดไม่เกิน 20 MB'); return; }
    setError(picked.length + mergeFiles.length > MERGE_MAX ? `รวมได้สูงสุด ${MERGE_MAX} ภาพ` : '');
    setMergeFiles(cur => [...cur, ...picked].slice(0, MERGE_MAX));
  };

  // ---- drag the picture's edges outwards (extend mode) ----
  const startResize = (side: Side) => (e: PointerEvent) => {
    if (busy || !imgRef.current) return;
    e.preventDefault(); e.stopPropagation();
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    const r = imgRef.current.getBoundingClientRect();
    const horizontal = side === 'left' || side === 'right';
    resizing.current = { side, start: horizontal ? e.clientX : e.clientY, startPad: pad, imgPx: horizontal ? r.width : r.height };
    setFixedW(r.width);
  };
  const moveResize = (e: PointerEvent) => {
    const d = resizing.current; if (!d) return;
    const horizontal = d.side === 'left' || d.side === 'right';
    const pos = horizontal ? e.clientX : e.clientY;
    const outward = d.side === 'left' || d.side === 'top' ? d.start - pos : pos - d.start;
    const value = clamp(snap(d.startPad[d.side] + outward / d.imgPx), 0, limit(d.side, d.startPad));
    setPad({ ...d.startPad, [d.side]: value < 0.05 ? 0 : value });
  };
  const endResize = () => { resizing.current = undefined; setFixedW(undefined); };

  // ---- paint the area to change (edit mode): free-form brush on a canvas laid over the picture ----
  const WORK = dims ? Math.min(1, 1024 / Math.max(dims.w, dims.h)) : 1;
  const cw = dims ? Math.max(1, Math.round(dims.w * WORK)) : 1, ch = dims ? Math.max(1, Math.round(dims.h * WORK)) : 1;
  useEffect(() => { strokes.current = []; setPainted(false); }, [cw, ch, file]);
  const canPaint = mode === 'edit' && !busy && !!src && !result;
  const canvasPoint = (e: PointerEvent) => { const r = paintRef.current!.getBoundingClientRect(); return { x: ((e.clientX - r.left) / r.width) * cw, y: ((e.clientY - r.top) / r.height) * ch, sx: e.clientX - r.left, sy: e.clientY - r.top, scale: cw / r.width }; };
  const stroke = (from: { x: number; y: number }, to: { x: number; y: number }, px: number) => {
    const x = paintRef.current!.getContext('2d')!;
    x.globalCompositeOperation = erasing ? 'destination-out' : 'source-over';
    x.strokeStyle = x.fillStyle = '#8b9cff'; x.lineCap = x.lineJoin = 'round'; x.lineWidth = px;
    x.beginPath(); x.moveTo(from.x, from.y); x.lineTo(to.x + 0.01, to.y); x.stroke();
  };
  const pdown = (e: PointerEvent) => {
    if (!canPaint) return;
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    const c = paintRef.current!, x = c.getContext('2d')!;
    strokes.current = [...strokes.current.slice(-14), x.getImageData(0, 0, c.width, c.height)];
    const p = canvasPoint(e); last.current = p; stroke(p, p, brush * p.scale); if (!erasing) setPainted(true);
  };
  const pmove = (e: PointerEvent) => {
    if (!canPaint) { setRing(undefined); return; }
    const p = canvasPoint(e); setRing({ x: p.sx, y: p.sy });
    if (last.current) { stroke(last.current, p, brush * p.scale); last.current = p; }
  };
  const pup = () => { last.current = undefined; };
  const undo = () => { const s = strokes.current.pop(); if (!s) return; paintRef.current!.getContext('2d')!.putImageData(s, 0, 0); setPainted(strokes.current.length > 0 && hasInk()); };
  const hasInk = () => { const c = paintRef.current; if (!c) return false; const d = c.getContext('2d')!.getImageData(0, 0, c.width, c.height).data; for (let i = 3; i < d.length; i += 4) if (d[i] > 127) return true; return false; };
  const clearPaint = () => { const c = paintRef.current; if (!c) return; c.getContext('2d')!.clearRect(0, 0, c.width, c.height); strokes.current = []; setPainted(false); };
  /** White where painted, black elsewhere (what the server expects). */
  const maskFile = async () => {
    const c = paintRef.current!, d = c.getContext('2d')!.getImageData(0, 0, c.width, c.height);
    const out = document.createElement('canvas'); out.width = c.width; out.height = c.height;
    const ox = out.getContext('2d')!, img = ox.createImageData(c.width, c.height);
    for (let i = 0; i < d.data.length; i += 4) { const v = d.data[i + 3] > 127 ? 255 : 0; img.data[i] = img.data[i + 1] = img.data[i + 2] = v; img.data[i + 3] = 255; }
    ox.putImageData(img, 0, 0);
    const blob = await new Promise<Blob>(res => out.toBlob(b => res(b!), 'image/png'));
    return new File([blob], 'mask.png', { type: 'image/png' });
  };

  const preset = (sides: Side[], v = 0.25) => setPad({ ...NO_PAD, ...Object.fromEntries(sides.map(s => [s, v])) });

  const patch = (id: string, p: Partial<QItem>) => setQueue(q => q.map(i => (i.id === id ? { ...i, ...p } : i)));
  const measure = (url: string) => new Promise<{ w: number; h: number }>(res => { const im = new Image(); im.onload = () => res({ w: im.naturalWidth, h: im.naturalHeight }); im.onerror = () => res({ w: 1, h: 1 }); im.src = url; });

  /** Validates the form, snapshots it into the queue and frees the form straight away so the next image can be set up. */
  const run = async () => {
    if ((!file && mode !== 'create' && mode !== 'merge' && mode !== 'ref') || busy) return;
    if (mode === 'style' && !tpl) return;
    const text = prompt.trim();
    if (mode === 'merge' && mergeFiles.length < 2) { setError('เลือกภาพอย่างน้อย 2 ภาพ'); return; }
    if (mode === 'ref' && mergeFiles.length < 1) { setError('เลือกภาพอ้างอิงอย่างน้อย 1 ภาพ'); return; }
    if (mode === 'ref' && !text) { setError('พิมพ์ว่าอยากได้ภาพใหม่แบบไหน เช่น ผู้หญิงในภาพ 1 ยืนที่ชายหาดตอนเย็น'); return; }
    if (mode === 'merge' && !text) { setError('พิมพ์ว่าจะรวมภาพยังไง เช่น ให้คนในภาพ 1 ถือสินค้าในภาพ 2'); return; }
    if (mode === 'create' && !text) { setError('พิมพ์ก่อนว่าอยากได้ภาพอะไร'); return; }
    if (mode === 'instruct' && !text) { setError('พิมพ์คำสั่งก่อน เช่น เปลี่ยนเสื้อเป็นสีแดง'); return; }
    if (mode === 'edit' && !painted) { setError('ระบายสีบริเวณที่จะแก้บนภาพก่อน'); return; }
    if (mode === 'edit' && !text) { setError('พิมพ์ว่าจะให้เปลี่ยนเป็นอะไร หรือพิมพ์ "ลบ" ถ้าอยากลบ'); return; }
    if (mode === 'extend' && !Object.values(pad).some(v => v >= 0.05)) { setError('ลากขอบภาพออกไปอย่างน้อยหนึ่งด้าน (ตั้งแต่ 5% ขึ้นไป)'); return; }
    setError(''); setBusy(true);
    try {
      const snap: Snap = { files: mode === 'merge' || mode === 'ref' ? mergeFiles : undefined, refSize: REF_SIZES.find(x => x[0] === refKey)!.slice(2) as unknown as readonly [number, number], file, mode, text, tpl, pad, scale, sizeKey, dims: createDims, fast: !!createDims && createFast, autoUp, model: mode === 'create' && createModel === 'moss-image' ? 'moss-image' : undefined, mask: mode === 'edit' ? await maskFile() : undefined };
      const id = crypto.randomUUID();
      setQueue(q => [...q, { id, kind: mode, label: (mode === 'style' && tpl ? tpl.title : KIND_LABEL[mode]) + (text ? ' · ' + text : ''), before: (mode === 'merge' || mode === 'ref' ? mergeFiles[0] : file) ? URL.createObjectURL((mode === 'merge' || mode === 'ref' ? mergeFiles[0] : file)!) : '', status: 'sending', stage: 'กำลังส่งภาพ…' }]);
      void process(id, snap);
      // Free the form for the next picture (the template stays selected).
      setFile(undefined); setMergeFiles([]); setPainted(false); setPad(NO_PAD); setPrompt(''); setResult(undefined);
    } finally { setBusy(false); }
  };

  const process = async (id: string, s: Snap) => {
    const controller = new AbortController(); ctrls.current.set(id, controller);
    const { file: f, mode: m, text, tpl: t } = s;
    try {
      if (m === 'cutout' && f) {
        patch(id, { status: 'running', stage: 'กำลังลบพื้นหลัง…' });
        const blob = await localService.images.removeBackground(f);
        controller.signal.throwIfAborted();
        finish(id, blob, m, NO_PAD);
        return;
      }
      let job: ImageJob;
      if (m === 'ref' && s.files && s.refSize) {
        const ids: string[] = [];
        for (const x of s.files) { ids.push((await localService.images.upload(x)).id); controller.signal.throwIfAborted(); }
        job = await localService.images.create(text, { inputIds: ids, engine: 'flux3-ref', width: s.refSize[0], height: s.refSize[1], upscale: false, correlationId: crypto.randomUUID() });
      } else if (m === 'merge' && s.files) {
        const ids: string[] = [];
        for (const x of s.files) { ids.push((await localService.images.upload(x)).id); controller.signal.throwIfAborted(); }
        job = await localService.images.create(text, { inputIds: ids, engine: 'flux3-merge', upscale: false, correlationId: crypto.randomUUID() });
      } else if (m === 'create') {
        const [width, height] = s.dims ?? (() => { const z = SIZES.find(x => x[0] === s.sizeKey)!; return [z[2], z[3]] as const; })();
        job = await localService.images.create(text, { width, height, upscale: s.autoUp, ...(s.fast ? { quality: 'fast' as const } : {}), ...(s.model ? { backend: s.model, lab: true } : {}), correlationId: crypto.randomUUID() });
      } else if (!f) { return; } else if (m === 'style' && t) {
        const input = await localService.images.upload(f);
        // Flux 3 Klein reference edit keeps the face (Z-Image img2img redraws it).
        job = await localService.images.create(t.prompt + (text ? ', ' + text : ''), { inputId: input.id, engine: 'flux3-edit', upscale: false, correlationId: crypto.randomUUID() });
      } else if (m === 'instruct') {
        const input = await localService.images.upload(f);
        // Free-form instruction edit with Flux 3 Klein (keeps the face; no mask needed).
        job = await localService.images.create(text, { inputId: input.id, engine: 'flux3-edit', upscale: false, correlationId: crypto.randomUUID() });
      } else if (m === 'upscale') {
        const input = await localService.images.upload(f);
        job = await localService.images.upscale(input.id, s.scale);
      } else {
        let edit: any, finalPrompt: string;
        if (m === 'extend') { edit = { mode: 'outpaint', pad: s.pad }; finalPrompt = text || KEEP; }
        else {
          const mask = await localService.images.upload(s.mask!);
          edit = { mode: 'inpaint', maskId: mask.id };
          finalPrompt = DELETE_WORDS.test(text) ? CLEAN : text;
        }
        controller.signal.throwIfAborted();
        const input = await localService.images.upload(f);
        job = await localService.images.create(finalPrompt, { inputId: input.id, originalSize: true, edit, correlationId: crypto.randomUUID() });
      }
      patch(id, { jobId: job.id });
      const working = m === 'upscale' ? 'กำลังอัปสเกล…' : m === 'style' ? 'กำลังแปลงภาพ…' : m === 'instruct' ? 'กำลังแก้ภาพ…' : m === 'merge' ? 'กำลังรวมภาพ…' : m === 'ref' ? 'กำลังสร้างภาพจากภาพอ้างอิง…' : 'กำลังสร้างภาพ…';
      while (!['done', 'failed', 'cancelled'].includes(job.status)) {
        patch(id, job.status === 'queued' ? { status: 'queued', stage: 'รอคิว…' } : { status: 'running', stage: job.stage === 'upscaling' ? 'กำลังอัปสเกล…' : working });
        await new Promise(r => setTimeout(r, 1000));
        controller.signal.throwIfAborted();
        job = await localService.images.get(job.id);
      }
      if (job.status === 'cancelled') throw new Error('ยกเลิกแล้ว');
      if (job.status === 'failed') throw new Error(job.error ?? 'ทำภาพไม่สำเร็จ');
      const img = job.images.find(i => i.variant === 'upscaled') ?? job.images[job.images.length - 1];
      if (!img) throw new Error('งานเสร็จแต่ไม่พบภาพผลลัพธ์');
      finish(id, await localService.images.download(img.url), m, m === 'extend' ? s.pad : NO_PAD);
    } catch (e) {
      patch(id, controller.signal.aborted ? { status: 'cancelled', stage: 'ยกเลิกแล้ว' } : { status: 'failed', stage: 'ไม่สำเร็จ', error: (e as Error).message });
    } finally { ctrls.current.delete(id); }
  };
  const finish = async (id: string, blob: Blob, kind: Mode, p: Pad) => {
    const url = URL.createObjectURL(blob);
    const size = await measure(url);
    const before = queueRef.current.find(i => i.id === id)?.before ?? '';
    const done: Done = { url, blob, kind, before, pad: p, ...size };
    patch(id, { status: 'done', stage: 'เสร็จแล้ว', done });
    // Show it straight away unless the user is already busy with another picture.
    if (!fileRef.current && mergeRef.current.length === 0) setResult(done);
  };
  const stopItem = (it: QItem) => { ctrls.current.get(it.id)?.abort(); if (it.jobId) void localService.images.cancel(it.jobId).catch(() => {}); if (it.status === 'sending' || it.status === 'queued') patch(it.id, { status: 'cancelled', stage: 'ยกเลิกแล้ว' }); };
  const dropItem = (it: QItem) => {
    if (it.before) URL.revokeObjectURL(it.before);
    if (it.done && result?.url !== it.done.url) URL.revokeObjectURL(it.done.url);
    setQueue(q => q.filter(x => x.id !== it.id));
  };
  const active = queue.filter(i => ['sending', 'queued', 'running'].includes(i.status)).length;
  const queueView = queue.length > 0 && <div className="imgedit-queue" aria-label="คิวงาน">
    <div className="imgedit-queue-head"><b>คิวงาน{active ? ` · กำลังทำ ${active}` : ''}</b>
      {queue.some(i => !['sending', 'queued', 'running'].includes(i.status)) && <button type="button" className="link-btn" onClick={() => queue.filter(i => !['sending', 'queued', 'running'].includes(i.status)).forEach(dropItem)}>ล้างที่เสร็จแล้ว</button>}</div>
    {queue.map(it => <div key={it.id} className={`imgedit-qitem q-${it.status}`}>
      {it.before ? <img src={it.before} alt="" draggable={false} /> : <span className="q-ph" />}
      <button type="button" className="q-main" disabled={it.status !== 'done'} onClick={() => { if (it.done) { setResult(it.done); setScreen('work'); } }}>
        <span className="q-label">{it.label}</span>
        <small>{['sending', 'queued', 'running'].includes(it.status) ? <><Loader2 className="spin" size={12} /> {it.stage}</> : it.status === 'done' ? <><Check size={12} /> เสร็จแล้ว · กดเพื่อดู</> : it.error ?? it.stage}</small>
      </button>
      {['sending', 'queued', 'running'].includes(it.status)
        ? <button type="button" className="q-x" title="ยกเลิก" aria-label="ยกเลิก" onClick={() => stopItem(it)}><Square size={14} /></button>
        : <button type="button" className="q-x" title="เอาออกจากคิว" aria-label="เอาออกจากคิว" onClick={() => dropItem(it)}><X size={14} /></button>}
    </div>)}
  </div>;
  const continueFrom = (next: Mode) => { if (!result) return; const f = new File([result.blob], 'edited.png', { type: result.blob.type || 'image/png' }); choose(f, true); setMode(next); };
  const save = () => { if (!result) return; const a = document.createElement('a'); a.href = result.url; a.download = `lumicos-${result.kind}-${Date.now()}.png`; a.click(); };

  const shown = src;
  const showExtend = mode === 'extend' && !result && !!src;
  const f = (1 + pad.left + pad.right), g = (1 + pad.top + pad.bottom);
  const ratio = dims ? (dims.w * f) / (dims.h * g) : 1;
  const sizeText = dims && mode === 'upscale' ? `${dims.w}×${dims.h} → ${dims.w * scale}×${dims.h * scale}` : '';
  const canGo = mode === 'ref' ? mergeFiles.length >= 1 : mode === 'merge' ? mergeFiles.length >= 2 : !!file || mode === 'create';
  const tooBig = !!dims && mode === 'upscale' && Math.max(dims.w, dims.h) * scale > 4096;

  const hints: Record<Mode, string> = {
    ref: 'เลือกภาพอ้างอิง 1–4 ภาพ (คน สินค้า หรือสไตล์ที่อยากได้) แล้วพิมพ์ว่าอยากได้ภาพใหม่แบบไหน โดยเรียกตามลำดับ เช่น "ผู้หญิงในภาพ 1 ยืนที่ชายหาดตอนเย็น" เลือกสัดส่วนภาพได้ ต่างจากรวมภาพที่ขนาดตามภาพแรก ใช้เวลาราว 1–3 นาที',
    merge: 'เลือกภาพ 2–4 ภาพ แล้วพิมพ์ว่าจะรวมยังไง โดยเรียกตามลำดับ เช่น "ให้คนในภาพ 1 ถือขวดในภาพ 2" คงใบหน้าและหน้าตาสินค้าเดิม (Flux 3) ใช้เวลาราว 1–2 นาที',
    instruct: 'เลือกรูป แล้วพิมพ์ว่าอยากแก้อะไร เช่น เปลี่ยนเสื้อเป็นสีแดง ไม่ต้องระบายพื้นที่ ใบหน้าคนในรูปจะคงเดิม (Flux 3) ใช้เวลาราว 2–3 นาที',
    cutout: 'เลือกรูป แล้วกดลบพื้นหลัง ได้ไฟล์ PNG โปร่งใส ใช้เวลาไม่กี่วินาที ไม่ใช้การ์ดจอ',
    style: 'เลือกรูปที่อยากแปลง แล้วกดแปลงภาพ ใส่รายละเอียดเพิ่มได้ถ้าต้องการ ภาพที่ได้จะเก็บไว้ในอัลบั้ม',
    create: 'พิมพ์บอกว่าอยากได้ภาพอะไร (ภาษาไทยได้เลย ส่งตรงไปที่โมเดลภาพ) เลือกขนาด แล้วกดสร้าง ภาพที่ได้จะเก็บไว้ในคลังภาพ',
    extend: 'จับที่แถบสีบนขอบภาพแล้วลากออกไปด้านที่อยากขยาย จากนั้นพิมพ์ว่าฉากที่ต่อออกไปควรมีอะไร (ไม่พิมพ์ก็ได้)',
    edit: 'ระบายสีทับส่วนที่จะแก้ แล้วพิมพ์ว่าจะให้เป็นอะไร เช่น "ถือแอปเปิ้ลในมือ" หรือพิมพ์ "ลบ" เพื่อเอาสิ่งที่ระบายออก คำสั่งส่งตรงไปที่โมเดลภาพ ไม่ผ่านโมเดลภาษา',
    upscale: 'ทำภาพให้คมและใหญ่ขึ้น ไม่เปลี่ยนเนื้อหา ใช้แยกจากการขยายขอบ เลือกเองเมื่อต้องการ',
  };

  const runRef = useRef(run);
  runRef.current = run;
  useEffect(() => { if (autoRun && screen === 'work' && mode === 'create') { setAutoRun(false); void runRef.current(); } }, [autoRun, screen, mode]);
  // Home cards use the newest pictures from the gallery as covers (falls back to a colour card).
  useEffect(() => {
    if (screen !== 'home' || !online) return;
    let alive = true; const urls: string[] = [];
    (async () => {
      try {
                const out: Record<string, string> = {};
        for (const t of LAB_TEMPLATES) {
          try { const b = await localService.images.download('/api/images/lab-cover/' + t.id); const u = URL.createObjectURL(b); urls.push(u); out['t:' + t.id] = u; } catch { /* no cover yet */ }
        }
        if (alive) setCovers(out);
      } catch { /* covers are optional */ }
    })();
    return () => { alive = false; urls.forEach(u => URL.revokeObjectURL(u)); };
  }, [screen, online]);
  const open = (m: Mode) => { setTpl(undefined); setMode(m); setError(''); setResult(undefined); setScreen('work'); };
  const openTpl = (t: LabTemplate) => { setTpl(t); setMode('style'); setFile(undefined); setPrompt(''); setError(''); setResult(undefined); setScreen('work'); };
  const editFromAlbum = (f: File) => { choose(f); setTpl(undefined); setMode('instruct'); setPrompt(''); setScreen('work'); };
  const startEdit = (f?: File) => { if (!f) return; choose(f); setTpl(undefined); setMode('instruct'); setPrompt(homePrompt.trim()); setScreen('work'); };

  if (!online) return <main className="imgedit"><h1>Image Lab</h1><p className="muted">ต้องเปิดบริการ PersonalAI ก่อน</p></main>;
  if (screen === 'album') return <div className="lab-album"><button type="button" className="imgedit-back lab-album-back" onClick={() => setScreen('home')} aria-label="กลับ"><ChevronLeft size={22} /> Image Lab</button><Gallery onEdit={editFromAlbum} /></div>;
  if (screen === 'home') return <main className="imgedit lab-home">
    <div className="lab-titlebar"><h1>Image Lab</h1><button type="button" className="btn btn-ghost btn-sm" onClick={() => setScreen('album')}><Images size={15} /> อัลบั้มภาพ</button></div>
    {queueView}
    <h2 className="lab-sub">แต่งภาพ</h2>
    <div className="lab-tools">
      {CARDS.map(({ mode: m, title, desc, Icon }) => <button key={m} className={`lab-card lab-tool tool-${m}`} onClick={() => open(m)}>
        <Icon className="lab-bg-ico" size={92} strokeWidth={1.3} />
        <span className="lab-ico"><Icon size={18} /></span>
        <span className="lab-txt"><h3>{title}</h3><p>{desc}</p></span>
      </button>)}
    </div>
    {([['style', 'สไตล์', 'อัปโหลดรูป แล้วแปลงเป็นสไตล์'], ['mood', 'แสงและบรรยากาศ', 'เปลี่ยนแสง คงหน้าเดิม']] as const).map(([g, label, note]) => <section key={g}>
      <div className="lab-sec"><h2 className="lab-sub">{label}</h2><small>{note}</small></div>
      <div className="lab-row">
        {LAB_TEMPLATES.filter(t => t.group === g).map(t => <button key={t.id} className="lab-card lab-tpl" onClick={() => openTpl(t)}>
          {covers['t:' + t.id] && <img src={covers['t:' + t.id]} alt="" draggable={false} />}
          {!covers['t:' + t.id] && <Sparkles className="lab-bg-ico" size={110} strokeWidth={1.2} />}
          <span className="lab-txt"><h3>{t.title}</h3></span>
        </button>)}
      </div>
    </section>)}
    {error && <p className="form-error" role="alert">{error}</p>}
    <div className="lab-bar">
      {homeCreate && <div className="lab-genbar">
        <div className="lab-seg" role="group" aria-label="โหมดสร้างภาพ">
          <button type="button" className={homeQuality === 'fast' ? 'on' : ''} onClick={() => setHomeQuality('fast')}>ความเร็ว</button>
          <button type="button" className={homeQuality === 'high' ? 'on' : ''} onClick={() => setHomeQuality('high')}>คุณภาพ</button>
        </div>
        <div className="ratio-wrap">
          <button type="button" className="ratio-btn" aria-haspopup="listbox" aria-expanded={ratioOpen} onClick={() => setRatioOpen(v => !v)}>
            {(() => { const r = RATIOS.find(x => x[0] === ratioKey)!; return <><RatioIcon w={r[1]} h={r[2]} />{r[0]}</>; })()}
          </button>
          {ratioOpen && <ul className="ratio-menu" role="listbox" aria-label="สัดส่วนภาพ">
            {RATIOS.map(([k, rw, rh]) => <li key={k} role="option" aria-selected={ratioKey === k}><button type="button" onClick={() => { setRatioKey(k); setRatioOpen(false); }}><RatioIcon w={rw} h={rh} /><span>{k}</span>{ratioKey === k && <Check size={16} />}</button></li>)}
          </ul>}
        </div>
        <select aria-label="โมเดลสร้างภาพ" value={createModel} onChange={e => setCreateModel(e.target.value as 'default' | 'moss-image')}>
          <option value="default">Z-Image</option>
          {mossReady && <option value="moss-image">Moss</option>}
        </select>
      </div>}
      <form className="lab-pill" onSubmit={e => {
        e.preventDefault();
        if (!homeCreate) { pickRef.current?.click(); return; }
        if (!homePrompt.trim()) { setError('พิมพ์ก่อนว่าอยากได้ภาพอะไร'); return; }
        setTpl(undefined); setFile(undefined); setResult(undefined); setError('');
        setPrompt(homePrompt.trim()); setHomePrompt(''); setAutoUp(homeQuality === 'high'); { const r = RATIOS.find(x => x[0] === ratioKey)!; setCreateDims(dimsFor(r[1], r[2], homeQuality === 'fast')); setCreateFast(homeQuality === 'fast'); } setRatioOpen(false);
        setMode('create'); setScreen('work'); setAutoRun(true);
      }}>

      <label className="lab-round" title="เลือกภาพเพื่อแต่ง" aria-label="เลือกภาพเพื่อแต่ง"><ImageUp size={20} />
        <input ref={pickRef} type="file" hidden accept="image/png,image/jpeg" onChange={e => { startEdit(e.target.files?.[0]); e.target.value = ''; }} /></label>
      <input type="text" value={homePrompt} onChange={e => setHomePrompt(e.target.value)} placeholder={homeCreate ? 'พิมพ์เพื่อสร้างภาพ' : 'พิมพ์คำสั่งแต่งภาพ แล้วเลือกรูป'} enterKeyHint="go" />
      <button type="submit" className="go" aria-label={homeCreate ? 'สร้างภาพ' : 'เลือกภาพ'}><ArrowUp size={20} /></button>
    </form></div>
  </main>;
  return <main className="imgedit">
    <header className="imgedit-head"><button className="imgedit-back" onClick={() => setScreen('home')} aria-label="กลับ"><ChevronLeft size={22} /></button><h1>Image Lab</h1>
      <button type="button" className="imgedit-back" onClick={() => setScreen('album')} aria-label="อัลบั้มภาพ" title="อัลบั้มภาพ"><Images size={20} /></button>
      {mode !== 'style' && <div className="imgedit-modes" role="tablist">
        {MODES.map(([k, l, Icon]) => <button key={k} role="tab" aria-selected={mode === k} className={mode === k ? 'active' : ''} disabled={busy} onClick={() => { setMode(k); setError(''); setResult(undefined); }}><Icon size={15} />{l}</button>)}
      </div>}
    </header>
    <div className="imgedit-body">
      <section className={`imgedit-canvas ${result?.kind === 'cutout' ? 'is-cutout' : ''}`}>
        {result ? (result.kind === 'create' ? <div className="imgedit-compare-wrap"><img className="imgedit-after imgedit-reveal" src={result.url} alt="ภาพที่สร้าง" draggable={false} style={{ maxHeight: '66vh', maxWidth: '100%', borderRadius: 14 }} /></div> : <Compare r={result} />)
          : mode === 'merge' || mode === 'ref' ? <div className="imgedit-merge">
            <div className="imgedit-merge-grid">
              {mergeUrls.map((u, i) => <figure key={u} className="imgedit-merge-slot"><img src={u} alt={`ภาพ ${i + 1}`} draggable={false} /><span className="imgedit-merge-n">{i + 1}</span><button type="button" aria-label={`เอาภาพ ${i + 1} ออก`} onClick={() => setMergeFiles(cur => cur.filter((_, k) => k !== i))}><X size={14} /></button></figure>)}
              {mergeFiles.length < MERGE_MAX && <label className="imgedit-merge-add"><ImagePlus size={26} /><b>{mergeFiles.length ? 'เพิ่มภาพ' : mode === 'ref' ? 'เลือกภาพอ้างอิง 1–4 ภาพ' : 'เลือกภาพ 2–4 ภาพ'}</b><small>PNG / JPG ไม่เกิน 20 MB</small>
                <input type="file" hidden multiple accept="image/png,image/jpeg" onChange={e => { addMerge(e.target.files); e.target.value = ''; }} /></label>}
            </div>
            <small className="muted">ลำดับภาพคือเลขที่มุมภาพ ใช้อ้างในคำสั่ง เช่น "ภาพ 1", "ภาพ 2"</small>
          </div>
          : mode === 'create' ? <div className="imgedit-drop imgedit-create-stage" style={{ cursor: 'default' }}>{busy ? <><Loader2 className="spin" size={26} /><b>{stage}</b></> : <><span className="imgedit-drop-icon"><ImagePlus size={30} /></span><b>พิมพ์คำอธิบายภาพทางขวา แล้วกดสร้าง</b><small>หรือไปแท็บอื่นเพื่อแต่งภาพที่มีอยู่</small></>}</div>
          : !shown ? <label className="imgedit-drop" onDragOver={e => e.preventDefault()} onDrop={e => { e.preventDefault(); choose(e.dataTransfer.files[0]); }}>
          <span className="imgedit-drop-icon"><ImageUp size={30} /></span><b>วางภาพที่นี่ หรือกดเพื่อเลือก</b><small>PNG / JPG ไม่เกิน 20 MB</small>
          <input type="file" hidden accept="image/png,image/jpeg" onChange={e => { choose(e.target.files?.[0]); e.target.value = ''; }} />
        </label> : showExtend ? <div className="imgedit-extend">
          <div className={`imgedit-frame ${busy ? 'is-busy' : ''}`} style={{ aspectRatio: String(ratio), ...(fixedW ? { width: fixedW * f, transition: 'none' } : { width: `min(100%, calc(66vh * ${ratio}))` }) }}>
            <div className={`imgedit-fill ${busy ? 'pulse' : ''}`} aria-hidden><img src={shown} alt="" draggable={false} /></div>
            <img ref={imgRef} src={shown} alt="ภาพต้นฉบับ" draggable={false} style={{ left: `${(pad.left / f) * 100}%`, top: `${(pad.top / g) * 100}%`, width: `${100 / f}%`, height: `${100 / g}%` }} />
            {(['left', 'right', 'top', 'bottom'] as Side[]).map(s => {
              const horizontal = s === 'left' || s === 'right';
              const style = horizontal
                ? { top: `${(pad.top / g) * 100}%`, height: `${100 / g}%`, [s]: s === 'left' ? 0 : 0 }
                : { left: `${(pad.left / f) * 100}%`, width: `${100 / f}%`, [s]: 0 };
              return <div key={s} className={`imgedit-edge edge-${s} ${pad[s] >= 0.05 ? 'on' : ''}`} style={style as any} onPointerDown={startResize(s)} onPointerMove={moveResize} onPointerUp={endResize} onPointerCancel={endResize}>
                <i className="grip" />{pad[s] >= 0.05 && <em>+{Math.round(pad[s] * 100)}%</em>}
              </div>;
            })}
            {busy && <div className="imgedit-busy"><Loader2 className="spin" size={22} /> {stage}</div>}
          </div>
          <p className="imgedit-note">{dims ? `${dims.w}×${dims.h} px · → ประมาณ ${Math.round(dims.w * f)}×${Math.round(dims.h * g)} px` : ''}</p>
        </div> : <div className={`imgedit-stage ${canPaint ? 'paintable' : ''}`}>
          <img src={shown} alt="ภาพ" draggable={false} />
          {mode === 'edit' && !result && <canvas ref={paintRef} width={cw} height={ch} className="imgedit-paint" onPointerDown={pdown} onPointerMove={pmove} onPointerUp={pup} onPointerCancel={pup} onPointerLeave={() => { pup(); setRing(undefined); }} />}
          {canPaint && ring && <i className="imgedit-ring" style={{ left: ring.x, top: ring.y, width: brush * (paintRef.current ? paintRef.current.getBoundingClientRect().width / cw : 1), height: brush * (paintRef.current ? paintRef.current.getBoundingClientRect().width / cw : 1) }} />}
          {busy && <div className="imgedit-busy"><Loader2 className="spin" size={22} /> {stage}</div>}
        </div>}
        {result && <div className="imgedit-actions">
          <button className="btn btn-ghost btn-sm" onClick={() => continueFrom(mode === 'upscale' || mode === 'create' || mode === 'style' || mode === 'cutout' ? 'edit' : mode)}><Undo2 size={14} /> แก้ต่อจากผลนี้</button>
          {result.kind !== 'upscale' && result.kind !== 'cutout' && <button className="btn btn-ghost btn-sm" onClick={() => continueFrom('upscale')}><ZoomIn size={14} /> อัปสเกลผลนี้</button>}
          <button className="btn btn-ghost btn-sm" onClick={() => setResult(undefined)}><Plus size={14} /> เริ่มภาพใหม่</button>
          <button className="btn btn-sm" onClick={save}><Download size={14} /> บันทึกภาพ</button>
        </div>}
        {file && !busy && mode !== 'create' && <label className="link-btn imgedit-change">เปลี่ยนภาพ<input type="file" hidden accept="image/png,image/jpeg" onChange={e => { choose(e.target.files?.[0]); e.target.value = ''; }} /></label>}
      </section>
      <aside className="imgedit-panel">
        {queueView}
        <p className="imgedit-hint">{hints[mode]}</p>
        {mode === 'extend' && <div className="imgedit-presets">
          <button className="chip" disabled={busy} onClick={() => preset(['left', 'right'])}>ซ้าย-ขวา</button>
          <button className="chip" disabled={busy} onClick={() => preset(['top', 'bottom'])}>บน-ล่าง</button>
          <button className="chip" disabled={busy} onClick={() => preset(['left', 'top', 'right', 'bottom'])}>ทุกด้าน</button>
          <button className="chip" disabled={busy} onClick={() => setPad(NO_PAD)}>ล้าง</button>
        </div>}
        {mode === 'create' && <div className="imgedit-scale">
          <div className="imgedit-presets">
            {SIZES.map(([k, l, w, h]) => <button key={k} className={`chip ${sizeKey === k ? 'on' : ''}`} disabled={busy} onClick={() => { setSizeKey(k); setCreateDims(undefined); }}>{l} {w}×{h}</button>)}
          </div>
          {mossReady && <div className="imgedit-presets">
            <button className={`chip ${createModel === 'default' ? 'on' : ''}`} disabled={busy} onClick={() => setCreateModel('default')}>โมเดลปกติ (Z-Image)</button>
            <button className={`chip ${createModel === 'moss-image' ? 'on' : ''}`} disabled={busy} onClick={() => setCreateModel('moss-image')}>Moss 4 step</button>
          </div>}
          <label className="imgedit-check"><input type="checkbox" disabled={busy} checked={autoUp} onChange={e => setAutoUp(e.target.checked)} /> อัปสเกลให้อัตโนมัติ (ช้าลง แต่ภาพคมขึ้น)</label>
        </div>}
        {mode === 'ref' && <div className="imgedit-presets">
          {REF_SIZES.map(([k, l, w, h]) => <button key={k} className={`chip ${refKey === k ? 'on' : ''}`} disabled={busy} onClick={() => setRefKey(k)}>{l} {w}×{h}</button>)}
        </div>}
        {mode === 'upscale' && <div className="imgedit-scale">
          <div className="imgedit-presets">
            {([2, 4] as const).map(n => <button key={n} className={`chip ${scale === n ? 'on' : ''}`} disabled={busy} onClick={() => setScale(n)}>{n} เท่า</button>)}
          </div>
          {sizeText && <small className={tooBig ? 'bad' : 'muted'}>{sizeText}{tooBig ? ' · ใหญ่เกินไป ลองเลือกขนาดเล็กลง' : ''}</small>}
        </div>}
        {mode === 'edit' && <div className="imgedit-brush">
          <div className="imgedit-presets">
            <button className={`chip ${!erasing ? 'on' : ''}`} disabled={busy} onClick={() => setErasing(false)}><Brush size={13} /> ระบาย</button>
            <button className={`chip ${erasing ? 'on' : ''}`} disabled={busy} onClick={() => setErasing(true)}><Eraser size={13} /> ยางลบ</button>
            <button className="chip" disabled={busy} onClick={undo}><Undo2 size={13} /> ย้อน</button>
            <button className="chip" disabled={busy || !painted} onClick={clearPaint}><Trash2 size={13} /> ล้าง</button>
          </div>
          <label>ขนาดแปรง {brush}<input type="range" min="10" max="160" step="2" disabled={busy} value={brush} onChange={e => setBrush(+e.target.value)} /></label>
        </div>}
        {mode === 'style' && tpl && <div className="imgedit-tpl"><span>เทมเพลต · <b>{tpl.title}</b></span><button type="button" disabled={busy} aria-label="เอาเทมเพลตออก" onClick={() => setScreen('home')}>✕</button></div>}
        {mode !== 'upscale' && mode !== 'cutout' && <textarea rows={mode === 'style' ? 2 : 4} disabled={busy} value={prompt} onChange={e => setPrompt(e.target.value)}
          placeholder={mode === 'ref' ? 'เช่น ผู้หญิงในภาพ 1 ยืนที่ชายหาดตอนเย็น ถือสินค้าในภาพ 2' : mode === 'merge' ? 'เช่น ให้คนในภาพ 1 ถือขวดน้ำหอมในภาพ 2 ในร้านกาแฟ' : mode === 'style' ? 'เพิ่มรายละเอียด (ไม่บังคับ)' : mode === 'instruct' ? 'เช่น เปลี่ยนเสื้อเป็นสีแดง · ให้ยิ้ม · เปลี่ยนฉากหลังเป็นทะเล' : mode === 'create' ? 'เช่น แมวสีส้มนั่งริมหน้าต่าง แสงยามเย็น สไตล์ภาพถ่าย' : mode === 'extend' ? 'ฉากที่ต่อออกไปมีอะไร (ไม่บังคับ)…' : 'เช่น ถือแอปเปิ้ลในมือ · เปลี่ยนเสื้อเป็นสีแดง · ลบ'} />}
        {error && <p className="form-error" role="alert">{error}</p>}
        <button className="btn imgedit-go" disabled={!canGo || tooBig || busy} onClick={() => void run()}><Sparkles size={15} /> {mode === 'cutout' ? 'ลบพื้นหลัง' : mode === 'ref' ? 'สร้างภาพ' : mode === 'merge' ? 'รวมภาพ' : mode === 'style' ? 'แปลงภาพ' : mode === 'instruct' ? 'แก้ภาพ' : mode === 'create' ? 'สร้างภาพ' : mode === 'extend' ? 'ขยายภาพ' : mode === 'edit' ? 'เติม / แก้ภาพ' : 'อัปสเกล'}{active ? ' · ต่อคิว' : ''}</button>
        <small className="muted">{mode === 'upscale' ? 'ใช้เวลาราว 10–40 วินาที' : mode === 'cutout' ? 'ใช้เวลาไม่กี่วินาที' : mode === 'ref' ? 'ใช้เวลาราว 1–3 นาที (Flux 3 คงใบหน้าและหน้าตาสินค้าจากภาพอ้างอิง)' : mode === 'merge' ? 'ใช้เวลาราว 1–2 นาที (Flux 3 คงใบหน้าและหน้าตาสินค้าเดิม)' : mode === 'style' || mode === 'instruct' ? 'ใช้เวลาราว 2–3 นาที (Flux 3 คงใบหน้าเดิม)' : mode === 'create' ? 'ใช้เวลาราว 40–90 วินาที (รอบแรกนานกว่าเพราะเปิด ComfyUI)' : 'ใช้เวลาราว 50–100 วินาที (รอบแรกนานกว่าเพราะเปิด ComfyUI) · ไม่อัปสเกลให้อัตโนมัติ'}</small>
      </aside>
    </div>
  </main>;
}
