import { useEffect, useState } from 'react';
import { Trash2 } from 'lucide-react';
import { customTheme, PRESET_THEMES, type CustomTheme } from './customTheme';

function Card({ t, active, onUse, onDelete }: { t: CustomTheme; active: boolean; onUse: () => void; onDelete?: () => void }) {
  return (
    <figure className={`tl-card ${active ? 'on' : ''}`}>
      <button type="button" className="tl-preview" aria-label={`ใช้ธีม ${t.name}`} onClick={onUse} style={{ background: t.bg, borderRadius: t.radius }}>
        <span className="tl-msg" style={{ background: t.surface, color: t.text, borderRadius: t.radius * 0.7 }}>สวัสดีค่ะ วันนี้ให้ช่วยอะไรดี</span>
        <span className="tl-msg me" style={{ background: t.accent, color: '#fff', borderRadius: t.radius * 0.7 }} />
        <span className="tl-bar" style={{ background: t.surface, borderRadius: t.radius }}><i style={{ background: t.accent }} /></span>
      </button>
      <figcaption>
        <span className="tl-name">{t.name}</span>
        <small>{t.mode === 'dark' ? 'มืด' : 'สว่าง'}</small>
        {active && <em>ใช้อยู่</em>}
        {onDelete && <button type="button" className="icon-btn" aria-label={`ลบ ${t.name}`} onClick={onDelete}><Trash2 size={15} /></button>}
      </figcaption>
    </figure>
  );
}

/** Theme library: themes the assistant designed, plus ready-made ones. */
export function ThemeLibrary() {
  const [, tick] = useState(0);
  useEffect(() => {
    const on = () => tick((n) => n + 1);
    window.addEventListener(customTheme.EVENT, on);
    return () => window.removeEventListener(customTheme.EVENT, on);
  }, []);
  const { active, previous, saved } = customTheme.state();
  const mine = saved.filter((t) => !PRESET_THEMES.some((p) => p.name === t.name && JSON.stringify(p) === JSON.stringify(t)));
  return (
    <section className="themelib">
      <h3 className="tl-title">คลังธีม</h3>
      <p className="muted">แตะธีมเพื่อใช้ทันที · บอก Nova ให้ออกแบบธีมใหม่ได้ เช่น “ทำธีมโทนทะเลยามเย็น” แล้วธีมจะมาอยู่ในนี้ · ธีมเก็บแยกในแต่ละเครื่อง</p>
      <div className="tl-actions">
        <button type="button" className="btn" disabled={!active && !previous} onClick={() => customTheme.revert()}>ย้อนกลับ</button>
        <button type="button" className="btn" disabled={!active} onClick={() => customTheme.reset()}>กลับธีมเดิมของแอป</button>
      </div>
      <h2>ธีมที่ AI ออกแบบ</h2>
      {mine.length ? <div className="tl-grid">{mine.map((t) => <Card key={t.name} t={t} active={active?.name === t.name} onUse={() => customTheme.set(t)} onDelete={() => customTheme.remove(t.name)} />)}</div>
        : <p className="muted">ยังไม่มี ลองให้ Nova ออกแบบให้สักธีม</p>}
      <h2>ธีมสำเร็จรูป</h2>
      <div className="tl-grid">{PRESET_THEMES.map((t) => <Card key={t.name} t={t} active={active?.name === t.name} onUse={() => customTheme.set(t)} />)}</div>
    </section>
  );
}
