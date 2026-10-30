import { ArrowLeft, Check, ChevronDown, ChevronRight, Loader2, Zap } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { modelApi, type ModelProfile, type ModelStatus } from '../services/models';
import type {ChatReasoningMode} from '../types';

const CALL_MODEL = 'Gemma 4 E2B · Call';

const friendlyName = (profile: ModelProfile) =>
  profile.name
    .replace(/\s*·\s*Workshop$/i, '')
    .replace(/\s*·\s*Chat$/i, '')
    .trim();

const levels:{mode:ChatReasoningMode;label:string;description:string}[]=[
  {mode:'FAST',label:'Low',description:'ตอบไว เหมาะกับการคุยทั่วไป'},
  {mode:'AUTO',label:'Auto',description:'ให้ Lumicos เลือกระดับที่เหมาะสม'},
  {mode:'DEEP',label:'High',description:'คิดละเอียดสำหรับงานซับซ้อน'},
];

export function ModelSwitcher({ online, disabled = false, reasoningMode, onReasoningChange }: { online: boolean; disabled?: boolean; reasoningMode:ChatReasoningMode; onReasoningChange:(mode:ChatReasoningMode)=>void }) {
  const [status, setStatus] = useState<ModelStatus>();
  const [open, setOpen] = useState(false);
  const [switching, setSwitching] = useState<string>();
  const [error, setError] = useState('');
  const [page,setPage]=useState<'main'|'models'>('main');
  const root = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!online) return;
    const load = () => void modelApi<ModelStatus>().then(setStatus).catch(() => undefined);
    load();
    window.addEventListener('lumicos-model-refresh', load);
    return () => window.removeEventListener('lumicos-model-refresh', load);
  }, [online]);

  useEffect(() => {
    if (!open) return;
    const close = (event: PointerEvent) => {
      if (!root.current?.contains(event.target as Node)) {setOpen(false);setPage('main');}
    };
    const escape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {setOpen(false);setPage('main');}
    };
    document.addEventListener('pointerdown', close);
    document.addEventListener('keydown', escape);
    return () => {
      document.removeEventListener('pointerdown', close);
      document.removeEventListener('keydown', escape);
    };
  }, [open]);

  const active = status?.profile;
  const profiles = (status?.profiles ?? []).filter(profile => profile.name !== CALL_MODEL);
  const locked = disabled || !!switching || !!status?.busy || (status?.activeTurns ?? 0) > 0;

  const choose = async (profile: ModelProfile) => {
    if (locked || profile.id === active?.id || profile.available === false) return;
    setSwitching(profile.id);
    setError('');
    try {
      const next = await modelApi<ModelStatus>('/switch', { id: profile.id });
      setStatus(next);
      setOpen(false);
      window.dispatchEvent(new Event('lumicos-model-refresh'));
    } catch (reason) {
      setError((reason as Error).message);
    } finally {
      setSwitching(undefined);
    }
  };

  const found = status?.discovered ?? [];
  const chooseFile = async (file: { name: string; path: string }) => {
    if (locked) return;
    setSwitching(file.path);
    setError('');
    try {
      const next = await modelApi<ModelStatus>('/switch', { path: file.path });
      setStatus(next);
      setOpen(false);
      window.dispatchEvent(new Event('lumicos-model-refresh'));
    } catch (reason) {
      setError((reason as Error).message);
    } finally {
      setSwitching(undefined);
    }
  };

  return <div className="model-switcher" ref={root}>
    <button
      className="model-switcher-trigger"
      type="button"
      aria-haspopup="menu"
      aria-expanded={open}
      disabled={!online || !status}
      onClick={() => {setOpen(value => !value);setPage('main')}}
    >
      {switching ? <Loader2 size={16} className="spin" /> : <Zap size={16} fill="currentColor" />}
      <span>{active ? friendlyName(active) : online ? 'เลือกโมเดล' : 'Lumicos ออฟไลน์'}</span>
      <ChevronDown size={15} className={open ? 'is-open' : ''} />
    </button>
    {open && <div className="model-switcher-menu" role="menu" aria-label="ตั้งค่าโมเดลและระดับการคิด">
      {page==='main'?<>
        <div className="model-switcher-title">ระดับการคิด</div>
        <div className="model-thinking-levels">
          {levels.map(level=><button key={level.mode} type="button" className="model-switcher-option thinking-option" disabled={disabled} onClick={()=>onReasoningChange(level.mode)}>
            <span className="model-switcher-copy"><b>{level.label}</b><small>{level.description}</small></span>
            {reasoningMode===level.mode&&<Check size={20}/>} 
          </button>)}
        </div>
        <div className="model-switcher-divider"/>
        <button type="button" className="model-switcher-option model-switcher-nav" onClick={()=>{setPage('models');void modelApi<ModelStatus>('/refresh',{}).then(setStatus).catch(()=>undefined);}}>
          <span className="model-switcher-copy"><b>โมเดล</b><small>{active?friendlyName(active):'ยังไม่ได้เลือก'}</small></span><ChevronRight size={20}/>
        </button>
        <button type="button" className="model-switcher-option model-switcher-nav" onClick={()=>document.querySelector<HTMLElement>('.thinking-option')?.focus()}>
          <span className="model-switcher-copy"><b>ความเร็ว</b><small>{levels.find(level=>level.mode===reasoningMode)?.label??'Auto'}</small></span><ChevronRight size={20}/>
        </button>
      </>:<>
      <button type="button" className="model-switcher-back" onClick={()=>setPage('main')}><ArrowLeft size={18}/> โมเดล</button>
      {profiles.map(profile => {
        const selected = profile.id === active?.id;
        const unavailable = profile.available === false;
        return <button
          key={profile.id}
          type="button"
          role="menuitemradio"
          aria-selected={selected}
          disabled={locked || unavailable}
          className="model-switcher-option"
          onClick={() => void choose(profile)}
        >
          <span className="model-switcher-copy">
            <b>{friendlyName(profile)}</b>
            <small>{profile.capabilities.vision ? 'แชตและดูภาพ' : profile.capabilities.tools ? 'แชตและใช้เครื่องมือ' : 'แชตทั่วไป'}{unavailable ? ' · ไม่พบไฟล์' : ''}</small>
          </span>
          {switching === profile.id ? <Loader2 size={17} className="spin" /> : selected ? <Check size={18} /> : null}
        </button>;
      })}
      {found.length > 0 && <div className="model-switcher-title">ใหม่ในโฟลเดอร์โมเดล</div>}
      {found.map(file => <button key={file.path} type="button" role="menuitem" disabled={locked} className="model-switcher-option" onClick={() => void chooseFile(file)}>
        <span className="model-switcher-copy">
          <b>{file.name.replace(/\.gguf$/i, '').replace(/[-_]+/g, ' ')}</b>
          <small>ยังไม่เคยใช้ · กดเพื่อโหลด</small>
        </span>
        {switching === file.path ? <Loader2 size={17} className="spin" /> : null}
      </button>)}</>}
      {locked && !switching && <p className="model-switcher-note">เปลี่ยนโมเดลได้หลังคำตอบปัจจุบันเสร็จ</p>}
      {error && <p className="model-switcher-error" role="alert">{error}</p>}
    </div>}
  </div>;
}
