import { AlertTriangle, Brain, Check, ChevronRight, Copy, Pencil, RotateCcw, ThumbsDown, ThumbsUp } from 'lucide-react';
import { memo, useEffect, useRef, useState } from 'react';
import { Avatar } from '../components/Avatar';
import type { Character, ChatMessage, EvidenceCitation } from '../types';
import { useChatActions } from './chatActions';
import { MemoryDebug, MemorySuggestions } from './MemorySuggestions';
import { KnowledgeSuggestion } from './KnowledgeSuggestion';
import { MessagePart } from './MessagePart';
import { ToolActivity } from './ToolActivity';
import { textOf } from './messageUtils';
import {SpeakButton} from '../voice/Voice';
import { BugReportButton } from './BugReportButton';

interface Props {
  message: ChatMessage;
  character?: Character;
  streaming: boolean;
  busy: boolean;
  canRegenerate: boolean;
  showReasoning: boolean;
  ttsEnabled?: boolean;
  onCopy: (m: ChatMessage) => void;
  onFeedback: (id: string, feedback: 'like' | 'dislike') => void;
  onRegenerate: (id: string) => void;
  onEdit: (id: string, text: string) => void;
}

export const MessageItem = memo(function MessageItem(p: Props) {
  const { message: m } = p;
  const isUser = m.role === 'user';
  const [copied, setCopied] = useState(false);
  const [editing, setEditing] = useState(false);

  const copy = () => {
    p.onCopy(m);
    setCopied(true);
    setTimeout(() => setCopied(false), 1400);
  };

  const { memoryDebug,serviceOnline } = useChatActions();
  const hasText = !!textOf(m);
  const waiting = p.streaming && !hasText && !m.toolRuns?.length;

  if (isUser) {
    return (
      <div className="msg msg-user">
        {editing ? (
          <EditBox
            initial={textOf(m)}
            onCancel={() => setEditing(false)}
            onSave={(t) => {
              setEditing(false);
              p.onEdit(m.id, t);
            }}
          />
        ) : (
          <>
            <div className="bubble">
              {m.imageRequest && m.imageRequest.hidePrompt !== false ? <details className="image-request"><summary>{m.imageRequest.kind==='edit'?'แก้ไขภาพ':'สร้างภาพ'}</summary><p>{m.imageRequest.prompt}</p>{m.imageRequest.translatedPrompt&&m.imageRequest.translatedPrompt!==m.imageRequest.prompt&&<details><summary>พรอมต์ที่ใช้สร้างภาพ</summary><p>{m.imageRequest.translatedPrompt}</p></details>}{m.parts.filter(part=>part.type!=='text').map((part,i)=><MessagePart key={i} part={part} markdown={false} messageId={m.id}/>)}</details> : m.parts.map((part, i) => (
                <MessagePart key={i} part={part} markdown={false} messageId={m.id} />
              ))}
            </div>
            <div className="msg-actions">
              {m.imageRequest?.kind==='create'&&<button className="link-btn" disabled={p.busy} onClick={()=>window.dispatchEvent(new CustomEvent('lumicos-compose',{detail:{action:'image',text:m.imageRequest!.prompt}}))}>ใช้พรอมต์นี้อีกครั้ง</button>}
              {m.editedAt && <span className="msg-meta">edited</span>}
              <IconAction label={copied ? 'Copied' : 'Copy'} onClick={copy}>
                {copied ? <Check size={14} /> : <Copy size={14} />}
              </IconAction>
              <IconAction label="Edit" onClick={() => setEditing(true)} disabled={p.busy||!!m.imageRequest}>
                <Pencil size={14} />
              </IconAction>
            </div>
          </>
        )}
      </div>
    );
  }

  return (
    <div className={`msg msg-ai ${p.streaming ? 'is-streaming' : ''}`}>
      <Avatar character={p.character} size={30} className="msg-avatar" />
      <div className="msg-main">
        <div className="msg-name">{p.character?.name ?? 'AI'}</div>

        {p.showReasoning && m.reasoning && <Reasoning text={m.reasoning} live={p.streaming && !hasText} />}
        {memoryDebug&&m.chatLatency&&!p.streaming&&<details className="chat-latency-debug"><summary>Chat timing · {m.chatLatency.selected} → {m.chatLatency.effective}</summary><dl>{Object.entries(m.chatLatency).map(([key,value])=><div key={key}><dt>{key}</dt><dd>{typeof value==='number'?value.toFixed(2):String(value)}{key.endsWith('Ms')?' ms':''}</dd></div>)}</dl></details>}
        {memoryDebug && !m.isGreeting && (m.memoriesUsed || m.contextInfo) && <MemoryDebug memories={m.memoriesUsed} info={m.contextInfo} />}
        {m.toolRuns && m.toolRuns.length > 0 && <ToolActivity runs={m.toolRuns} live={p.streaming} />}

        {waiting ? (
          <div className="typing" aria-label="Thinking">
            <span />
            <span />
            <span />
          </div>
        ) : (
          <div className="msg-content">
            {m.parts.map((part, i) => (
              <MessagePart key={i} part={part} markdown />
            ))}
          </div>
        )}

        {m.memoryCandidates && !p.streaming && <MemorySuggestions messageId={m.id} candidates={m.memoryCandidates} />}
        {!p.streaming && m.citations && m.citations.length > 0 && <CitationList citations={m.citations} />}
        {!p.streaming && m.knowledgeCandidate && <KnowledgeSuggestion messageId={m.id} candidate={m.knowledgeCandidate} />}

        {m.status === 'error' && (
          <div className="msg-error">
            <AlertTriangle size={15} />
            <span>{m.error ?? 'Generation failed.'}</span>
          </div>
        )}

        {!p.streaming && (
          <div className="msg-actions">
            {hasText && (
              <IconAction label={copied ? 'Copied' : 'Copy'} onClick={copy}>
                {copied ? <Check size={14} /> : <Copy size={14} />}
              </IconAction>
            )}
            {hasText && (
              <IconAction label="ชอบคำตอบนี้" pressed={m.feedback === 'like'} onClick={() => p.onFeedback(m.id, 'like')}>
                <ThumbsUp size={14} />
              </IconAction>
            )}
            {hasText && (
              <IconAction label="ไม่ชอบคำตอบนี้" pressed={m.feedback === 'dislike'} onClick={() => p.onFeedback(m.id, 'dislike')}>
                <ThumbsDown size={14} />
              </IconAction>
            )}
            {hasText && serviceOnline && p.ttsEnabled !== false && <SpeakButton text={textOf(m)} id={m.id} disabled={p.busy}/>}
            {p.canRegenerate && (
              <IconAction label="Regenerate" onClick={() => p.onRegenerate(m.id)} disabled={p.busy}>
                <RotateCcw size={14} />
              </IconAction>
            )}
            {!m.isGreeting && <BugReportButton message={m} />}
            {m.isGreeting && (
              <span className="msg-meta" title="The character’s First Message (not generated by the model)">
                First message
              </span>
            )}
            {m.status === 'stopped' && <span className="msg-meta">Stopped</span>}
            {m.stats && (
              <span className="msg-meta" title="Reported by llama-server">
                {m.stats.tokensGenerated} tok · {m.stats.tokensPerSecond.toFixed(1)} tok/s
              </span>
            )}
          </div>
        )}
      </div>
    </div>
  );
});

function CitationList({ citations }: { citations: EvidenceCitation[] }) {
  return <details className="citation-list"><summary>Sources · {citations.length}</summary><ol>{citations.map(citation => {
    const location = [citation.file, citation.page === undefined ? undefined : `page ${citation.page}`, citation.chunk === undefined ? undefined : `chunk ${citation.chunk}`].filter(Boolean).join(' · ');
    const href = safeCitationUrl(citation.url);
    const metadata=[citation.source,citation.publishedAt].filter(Boolean).join(' · ');
    return <li key={citation.id}><span className="citation-id">{citation.id}</span>{href
      ? <a href={href} target="_blank" rel="noreferrer">{citation.title ?? href}</a>
      : <span>{citation.title ?? citation.sourceId ?? citation.kind}</span>}{metadata&&<small>{metadata}</small>}{location && <small>{location}</small>}</li>;
  })}</ol></details>;
}

function safeCitationUrl(value?: string) {
  try { const url = new URL(value ?? ''); return url.protocol === 'http:' || url.protocol === 'https:' ? url.href : undefined; }
  catch { return undefined; }
}

function IconAction(props: { label: string; onClick: () => void; disabled?: boolean; pressed?: boolean; children: React.ReactNode }) {
  return (
    <button className={`act-btn${props.pressed ? ' is-active' : ''}`} onClick={props.onClick} disabled={props.disabled} title={props.label} aria-label={props.label} aria-pressed={props.pressed}>
      {props.children}
    </button>
  );
}

function Reasoning({ text, live }: { text: string; live: boolean }) {
  const [open, setOpen] = useState(false);
  return (
    <div className={`reasoning ${open ? 'open' : ''}`}>
      <button className="reasoning-toggle" onClick={() => setOpen((o) => !o)}>
        <Brain size={14} />
        {live ? 'Thinking…' : 'Thought process'}
        <ChevronRight size={14} className="chev" />
      </button>
      {open && <div className="reasoning-body">{text}</div>}
    </div>
  );
}

function EditBox(props: { initial: string; onSave: (t: string) => void; onCancel: () => void }) {
  const [text, setText] = useState(props.initial);
  const ref = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = Math.min(el.scrollHeight, 320) + 'px';
  }, [text]);

  useEffect(() => {
    const el = ref.current;
    el?.focus();
    el?.setSelectionRange(el.value.length, el.value.length);
  }, []);

  return (
    <div className="edit-box">
      <textarea
        ref={ref}
        value={text}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Escape') props.onCancel();
          if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) props.onSave(text);
        }}
      />
      <div className="edit-box-actions">
        <span className="muted small">Saving resends from this message.</span>
        <button className="btn btn-ghost btn-sm" onClick={props.onCancel}>
          Cancel
        </button>
        <button className="btn btn-primary btn-sm" onClick={() => props.onSave(text)} disabled={!text.trim()}>
          Save & send
        </button>
      </div>
    </div>
  );
}
