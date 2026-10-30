import { useState } from 'react';
import { localService } from '../services/localService';

interface Result { model: string; files?: string[]; report: string; errorsSeen?: number; ms?: number; digest?: string }

/** Read-only system check without any AI model: rule-based health report and automated code checks. */
export function SelfCheck() {
  const [busy, setBusy] = useState<'health' | 'code'>();
  const [result, setResult] = useState<Result & { kind: 'health' | 'code' }>();
  const [error, setError] = useState<string>();
  const run = async (kind: 'health' | 'code') => {
    setBusy(kind); setError(undefined); setResult(undefined);
    try { setResult({ ...(await localService.selfCheck(kind === 'health' ? 'health' : undefined)), kind }); }
    catch (e) { setError((e as Error).message); }
    finally { setBusy(undefined); }
  };
  return (
    <section className="settings-section">
      <h3>ตรวจสุขภาพระบบ</h3>
      <div className="note">ไม่ใช้โมเดล AI และไม่สลับโมเดล อ่านอย่างเดียว ไม่แก้อะไร · ตรวจสุขภาพ: นับจากล็อกจริงแล้วตัดสินด้วยกฎ (เขียว/เหลือง/แดง) เสร็จในไม่กี่วินาที · ตรวจโค้ด: ไฟล์ที่แก้ใน 36 ชั่วโมง ตรวจไวยากรณ์ TypeScript lint และรันเทสต์อัตโนมัติที่เกี่ยวข้อง ใช้ราว 1–3 นาที</div>
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        <button type="button" className="btn primary" disabled={!!busy} onClick={() => run('health')}>{busy === 'health' ? 'กำลังตรวจ…' : 'ตรวจสุขภาพตอนนี้'}</button>
        <button type="button" className="btn" disabled={!!busy} onClick={() => run('code')}>{busy === 'code' ? 'กำลังตรวจ…' : 'ตรวจโค้ดที่เพิ่งแก้'}</button>
      </div>
      {error && <div className="note error" role="alert">{error}</div>}
      {result && (
        <div className="selfcheck-result">
          <div className="note">วิธีตรวจ: {result.model}{result.ms ? ` · ใช้เวลา ${Math.round(result.ms / 1000)} วินาที` : ''}{result.files ? ` · ไฟล์ที่ตรวจ: ${result.files.join(', ') || '-'}` : ''}</div>
          <pre style={{ whiteSpace: 'pre-wrap', margin: 0 }}>{result.report}</pre>
          {result.digest && <details><summary>ข้อมูลที่ใช้ตรวจ</summary><pre style={{ whiteSpace: 'pre-wrap', margin: 0 }}>{result.digest}</pre></details>}
        </div>
      )}
    </section>
  );
}
