import { BookOpenCheck, Check, X } from 'lucide-react';
import { useRef, useState } from 'react';
import type { KnowledgeCandidate } from '../types';
import { useChatActions } from './chatActions';

/** "ข้อมูลนี้มาจากเว็บ ถูกต้องไหม? [ถูกต้อง เก็บไว้] [ไม่ต้อง]" — nothing is kept until the user agrees. */
export function KnowledgeSuggestion({ messageId, candidate }: { messageId: string; candidate: KnowledgeCandidate }) {
  const { learnKnowledge, dismissKnowledge, serviceOnline } = useChatActions();
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  const inflight = useRef(false);
  if (candidate.status === 'dismissed') return null;
  if (candidate.status === 'saved' || done) {
    return <div className="mem-suggest"><div className="mem-suggest-item saved">
      <Check size={14} className="ok" />
      <span className="mem-suggest-text">{candidate.auto ? 'เก็บข้อมูลนี้เข้าคลังความรู้อัตโนมัติแล้ว' : 'เก็บเข้าคลังความรู้แล้ว'}{candidate.file ? ` · ${candidate.file}` : ''}</span>
    </div></div>;
  }
  const save = async () => {
    if (inflight.current) return;
    inflight.current = true; setBusy(true);
    try { if (await learnKnowledge(messageId)) setDone(true); } finally { setBusy(false); inflight.current = false; }
  };
  return <div className="mem-suggest"><div className="mem-suggest-item">
    <div className="mem-suggest-head"><BookOpenCheck size={14} /><span>ข้อมูลนี้มาจากเว็บ ({candidate.sources.length} แหล่ง) ถูกต้องไหม? ถ้าถูก เก็บเข้าคลังความรู้ไว้ใช้ครั้งหน้าได้</span></div>
    {candidate.error && <div className="form-error" role="alert">{candidate.error}</div>}
    <div className="mem-suggest-actions">
      <button className="btn btn-primary btn-sm" disabled={busy || !serviceOnline} onClick={() => void save()}><Check size={14} /> ถูกต้อง เก็บไว้</button>
      <button className="btn btn-soft btn-sm" disabled={busy} onClick={() => dismissKnowledge(messageId)}><X size={14} /> ไม่ต้อง</button>
    </div>
  </div></div>;
}
