import { ArrowDown, FlaskConical, MessageCirclePlus, Palette, UserX } from 'lucide-react';
import './roleplayScene.css';
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { LumicosLogo } from '../components/LumicosLogo';
import { FileText, Image, Calendar } from 'lucide-react';
import { ConfirmDialog } from '../components/Modal';
import type { ChatAttachment as AttachmentPart, Character, ChatMessage, Conversation } from '../types';
import type {ChatReasoningMode} from '../types';
import { ChatInput } from './ChatInput';
import { isLumicosCharacter } from '../identity/lumicosIdentity.mjs';
import { ASSISTANT_ID } from '../config/defaults';
import type { ImageOptions } from './imageRequest';
import { MessageItem } from './MessageItem';

/** Text sent by the roleplay "วาดฉากนี้" button (an explicit วาดภาพ… request, so the image tool runs). */
export const ROLEPLAY_SCENE_REQUEST = 'วาดภาพฉากตอนนี้: ตัวละคร สถานที่ และสิ่งที่เพิ่งเกิดขึ้นล่าสุดในเรื่อง';

interface Props {
  conversation: Conversation;
  character?: Character;
  /** The chat's character was deleted: show read-only notice, disable sending. */
  characterMissing: boolean;
  generatingId: string | null;
  enterToSend: boolean;
  showReasoning: boolean;
  isMock: boolean;
  connectionHint?: string;
  serviceOnline: boolean;
  memoryEnabled: boolean;
  suggesting: boolean;
  onSuggestMemories: () => Promise<number>;
  onSend: (text: string, attachments: AttachmentPart[],source?:'keyboard'|'voice') => void;
  onStop: () => void;
  calling: boolean;
  onGenerateImage: (prompt:string, options?:ImageOptions) => void;
  onRegenerate: (id?: string) => void;
  onEdit: (id: string, text: string) => void;
  onCopy: (m: ChatMessage) => void;
  onFeedback: (id: string, feedback: 'like' | 'dislike') => void;
  onClear: () => void;
  onNewChat: () => void;
  /** Voice-call control for the composer. */
  callButton?: import('react').ReactNode;
  reasoningMode:ChatReasoningMode;
  onReasoningChange:(mode:ChatReasoningMode)=>void;
}

export function ChatView(p: Props) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const atBottom = useRef(true);
  const [showJump, setShowJump] = useState(false);
  const [confirmClear, setConfirmClear] = useState(false);
  useEffect(()=>{const clear=()=>setConfirmClear(true);window.addEventListener('lumicos-clear-chat',clear);return()=>window.removeEventListener('lumicos-clear-chat',clear)},[]);
  const calling=p.calling;
  const msgs = p.conversation.messages;
  const busy = p.generatingId !== null;

  const onScroll = () => {
    const el = scrollRef.current;
    if (!el) return;
    const near = el.scrollHeight - el.scrollTop - el.clientHeight < 120;
    atBottom.current = near;
    setShowJump(!near);
  };

  const scrollToBottom = useCallback((smooth = false) => {
    const el = scrollRef.current;
    if (el) el.scrollTo({ top: el.scrollHeight, behavior: smooth ? 'smooth' : 'auto' });
  }, []);

  // Follow the stream unless the user scrolled up to read.
  useLayoutEffect(() => {
    if (atBottom.current) scrollToBottom();
  }, [msgs, scrollToBottom]);

  useEffect(() => {
    atBottom.current = true;
    setShowJump(false);
    requestAnimationFrame(() => scrollToBottom());
  }, [p.conversation.id, scrollToBottom]);

  const lastAssistant = [...msgs].reverse().find((m) => m.role === 'assistant' && !m.isGreeting);
  const hasUser = msgs.some((m) => m.role === 'user');
  const name = p.character?.name ?? 'AI';

  return (
    <main className="chat">
      <header className="chat-header">
        <div className="chat-header-actions">
          {p.isMock && (
            <span className="badge badge-warn" title="Replies come from the demo provider, not llama.cpp">
              <FlaskConical size={13} /> Demo mode
            </span>
          )}
        </div>
      </header>

      <div className="messages" ref={scrollRef} onScroll={onScroll}>
        {!hasUser ? (
          <div className="lumicos-welcome">
            {isLumicosCharacter(p.character)
              ? <><LumicosLogo/><h1>Lumicos</h1><h2>วันนี้ให้ฉันช่วยอะไรดีคะ?</h2><p>คุย วางแผน หรือเริ่มไอเดียใหม่ไปด้วยกัน</p></>
              : <><h1>{name}</h1><h2>วันนี้ให้ช่วยอะไรดี?</h2><p>{p.character?.id === ASSISTANT_ID ? 'ถามคำถาม สรุปเอกสาร ค้นข้อมูล หรือจัดการไฟล์ได้เลย' : (p.character?.description || 'ถามคำถาม สรุปเอกสาร ค้นข้อมูล หรือจัดการไฟล์ได้เลย')}</p></>}
            <div className="starter-cards">
              <button disabled={!p.serviceOnline} title={p.serviceOnline?'แนบเอกสาร':'ต้องเปิดบริการ PersonalAI ก่อน'} onClick={()=>window.dispatchEvent(new CustomEvent('lumicos-compose',{detail:{action:'attach'}}))}><FileText/><span><b>สรุปเอกสาร</b><small>สรุปใจความสำคัญจากไฟล์ของคุณ</small></span></button>
              <button disabled={!p.serviceOnline} title={p.serviceOnline?'สร้างหรือแต่งภาพ':'ต้องเปิดบริการ PersonalAI ก่อน'} onClick={()=>window.dispatchEvent(new CustomEvent('lumicos-compose',{detail:{action:'image'}}))}><Image/><span><b>สร้างภาพ</b><small>เปลี่ยนไอเดียของคุณให้เป็นภาพ</small></span></button>
              <button onClick={()=>window.dispatchEvent(new CustomEvent('lumicos-compose',{detail:{text:'ช่วยวางแผนวันนี้ให้หน่อย '}}))}><Calendar/><span><b>วางแผนวันนี้</b><small>จัดการเวลาและสิ่งที่ต้องทำ</small></span></button>
            </div>
          </div>
        ) : (
          <div className="messages-inner">
            {msgs.map((m) => (
              <MessageItem
                key={m.id}
                message={m}
                character={p.character}
                streaming={m.id === p.generatingId}
                busy={busy||calling}
                canRegenerate={m.id === lastAssistant?.id && !p.characterMissing}
                showReasoning={p.showReasoning}
                onCopy={p.onCopy}
                onFeedback={p.onFeedback}
                onRegenerate={p.onRegenerate}
                onEdit={p.onEdit}
              />
            ))}
          </div>
        )}
      </div>

      {p.conversation.mode === 'roleplay' && (
        <div className="model-banner roleplay-banner">
          🎭 กำลังเล่นเป็น <strong>{p.character?.name ?? 'ตัวละคร'}</strong> · ไม่ใช้เว็บ/คลัง/ความจำ ไม่มีเสียง ใช้ได้แค่สร้างภาพ · พิมพ์ (OOC: …) เพื่อคุยกับ Lumicos นอกเรื่อง · ไฟล์เรื่องอยู่ที่ data/roleplay/{p.conversation.id}
          {/* Sends an ordinary image request: the character writes the scene prompt from the story so far,
              and the card's appearance line is prepended on the way (runChatReply), so the look stays the same. */}
          <button type="button" className="roleplay-scene-btn" disabled={busy || calling || p.characterMissing}
            onClick={() => p.onSend(ROLEPLAY_SCENE_REQUEST, [])}>
            <Palette size={14} /> วาดฉากนี้
          </button>
        </div>
      )}
      {!!lastAssistant?.contextInfo?.droppedMessages && <div className="model-banner">บริบทที่ส่งรอบนี้ใช้ข้อความล่าสุด โดยเว้นข้อความเก่า {lastAssistant.contextInfo.droppedMessages} รายการให้พอดีกับโมเดล ประวัติแชตยังอยู่ครบ</div>}
      <div className="composer-dock">
        {showJump && (
          <button className="jump-btn" onClick={() => scrollToBottom(true)} aria-label="Scroll to latest">
            <ArrowDown size={16} />
          </button>
        )}
        {p.characterMissing && (
          <div className="readonly-banner">
            <UserX size={16} />
            <span>This chat’s character was deleted, so it’s read-only. Start a new chat to continue.</span>
            <button className="btn btn-soft btn-sm" onClick={p.onNewChat}>
              <MessageCirclePlus size={14} /> New chat
            </button>
          </div>
        )}
        <ChatInput key={p.conversation.id}
          callButton={p.conversation.mode === 'roleplay' ? undefined : p.callButton}
          disabled={p.characterMissing||calling}
          isGenerating={busy}
          enterToSend={p.enterToSend}
          placeholder={`พิมพ์ข้อความถึง ${name}…`}
          disabledReason={p.connectionHint}
          canAttach={p.serviceOnline}
          onSend={p.onSend}
          onStop={p.onStop}
          onGenerateImage={p.onGenerateImage}
          reasoningMode={p.reasoningMode}
          onReasoningChange={p.onReasoningChange}
        />
      </div>

      {confirmClear && (
        <ConfirmDialog
          title="Clear this chat?"
          message="All messages in this conversation will be removed. The chat itself stays in your history."
          confirmLabel="Clear"
          onConfirm={p.onClear}
          onCancel={() => setConfirmClear(false)}
        />
      )}
    </main>
  );
}
