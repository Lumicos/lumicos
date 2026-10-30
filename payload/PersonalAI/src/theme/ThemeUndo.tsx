import { useEffect, useState } from 'react';
import { customTheme } from './customTheme';

/** Small floating button: appears for a while after the assistant changes the theme. */
export function ThemeUndo() {
  const [shown, setShown] = useState(false);
  useEffect(() => {
    let timer: number | undefined;
    let last = JSON.stringify(customTheme.state().active);
    const on = () => {
      const now = JSON.stringify(customTheme.state().active);
      if (now === last) return;
      last = now;
      setShown(true);
      window.clearTimeout(timer);
      timer = window.setTimeout(() => setShown(false), 20000);
    };
    window.addEventListener(customTheme.EVENT, on);
    return () => { window.removeEventListener(customTheme.EVENT, on); window.clearTimeout(timer); };
  }, []);
  if (!shown) return null;
  return (
    <div className="theme-undo" role="status">
      <span>เปลี่ยนธีมแล้ว</span>
      <button type="button" onClick={() => { customTheme.revert(); setShown(false); }}>ย้อนกลับ</button>
      <button type="button" className="ghost" onClick={() => setShown(false)} aria-label="ปิด">✕</button>
    </div>
  );
}
