import { Bug, Check } from 'lucide-react';
import { useState } from 'react';
import { Modal } from '../components/Modal';
import { localService } from '../services/localService';
import type { ChatMessage } from '../types';
import { textOf } from './messageUtils';

/** "แจ้งบั๊ก" on a reply: saves this turn (messages, tools, log timeline) to data/bug-reports so Claude can read one file. */
export function BugReportButton({ message }: { message: ChatMessage }) {
  const [open, setOpen] = useState(false);
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const [saved, setSaved] = useState<string>();

  const submit = async () => {
    setBusy(true);
    setError(undefined);
    try {
      const r = await localService.bugReports.create({ replyId: message.id, note: note.trim(), replyText: textOf(message).slice(0, 8000) });
      setSaved(r.name);
      setOpen(false);
      setNote('');
      setTimeout(() => setSaved(undefined), 8000);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <button
        className={`act-btn${saved ? ' is-active' : ''}`}
        onClick={() => setOpen(true)}
        title={saved ? `บันทึกแล้ว: ${saved}` : 'แจ้งบั๊กข้อความนี้'}
        aria-label="แจ้งบั๊กข้อความนี้"
      >
        {saved ? <Check size={14} /> : <Bug size={14} />}
      </button>
      {saved && <span className="msg-meta">บันทึกบั๊กแล้ว</span>}
      {open && (
        <Modal
          title="แจ้งบั๊กข้อความนี้"
          size="sm"
          onClose={() => { if (!busy) setOpen(false); }}
          footer={
            <>
              <button className="btn btn-ghost" onClick={() => setOpen(false)} disabled={busy}>ยกเลิก</button>
              <button className="btn btn-primary" onClick={() => void submit()} disabled={busy}>{busy ? 'กำลังบันทึก…' : 'บันทึก'}</button>
            </>
          }
        >
          <label className="field">
            <span className="field-label">ผิดตรงไหน (ไม่ใส่ก็ได้)</span>
            <textarea
              rows={3}
              autoFocus
              value={note}
              placeholder="เช่น ค้นเว็บแล้วได้ราคาผิด / ตอบยาวเกิน / หลุดบท"
              onChange={(e) => setNote(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) void submit(); }}
            />
            <span className="field-hint">เก็บบทสนทนาช่วงนี้ เครื่องมือที่ใช้ และไทม์ไลน์จาก log ไว้ในไฟล์เดียวที่ data/bug-reports ให้ Claude อ่านแล้วแก้ต่อ</span>
          </label>
          {error && <div className="form-error">{error}</div>}
        </Modal>
      )}
    </>
  );
}
