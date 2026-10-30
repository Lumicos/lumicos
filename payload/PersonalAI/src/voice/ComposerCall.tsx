import { AudioLines, PhoneOff } from 'lucide-react';
import type { ChatMessage } from '../types';
import { SpeechCall } from './SpeechCall';

type Props = {
  conversationId: string;
  disabled: boolean;
  busy: boolean;
  onReply: Parameters<typeof SpeechCall>[0]['onReply'];
  onActive: (value: boolean) => void;
  onFinish: (conversationId: string, turns: ChatMessage[]) => void;
};

const shortPhase = (phase: string) =>
  /กำลังฟัง/.test(phase) ? 'กำลังฟัง' : /พูด/.test(phase) ? 'Lumicos กำลังพูด' : /วางสาย/.test(phase) ? 'กำลังวางสาย'
  : /เตรียม|เริ่มโทร/.test(phase) ? 'กำลังโทร…' : 'กำลังคิด';

/** Voice call button that lives in the chat composer (like ChatGPT's voice mode button). */
export function ComposerCall(p: Props) {
  return <SpeechCall key={p.conversationId} {...p} render={call => (call.active || call.ending)
    ? <span className="composer-call is-live" role="status">
        <span className="composer-call-dot" />{shortPhase(call.phase)}
        <button className="composer-call-hang" onClick={call.hangup} disabled={call.ending} aria-label="วางสาย" title="วางสาย"><PhoneOff size={15} /></button>
      </span>
    : <button className="tool-btn composer-call-btn" onClick={call.start} disabled={!call.canStart}
        title={call.error || 'โทรคุยด้วยเสียง'} aria-label="โทรคุยด้วยเสียง"><AudioLines size={20} /></button>} />;
}
