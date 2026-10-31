import { ArrowUp, FileText, Loader2, Paperclip, Plus, Square, X } from 'lucide-react';
import { useEffect, useRef, useState, type KeyboardEvent } from 'react';
import { ATTACHMENT_ACCEPT, localService } from '../services/localService';
import type { ChatAttachment as AttachmentPart } from '../types';
import type {ChatReasoningMode} from '../types';
import {MicrophoneButton} from '../voice/MicrophoneButton';
import {ModelSwitcher} from '../components/ModelSwitcher';
import type { ImageOptions } from './imageRequest';

interface Props {
  disabled?: boolean;
  isGenerating: boolean;
  enterToSend: boolean;
  placeholder: string;
  disabledReason?: string;
  /** Attachments need the local service (it reads DOCX/XLSX and caches the file). */
  canAttach: boolean;
  onSend: (text: string, attachments: AttachmentPart[]) => void;
  onStop: () => void;
  onGenerateImage?: (prompt:string, options?:ImageOptions) => void;
  /** Voice-call control shown next to the microphone. */
  callButton?: import('react').ReactNode;
  sttEnabled?: boolean;
  reasoningMode:ChatReasoningMode;
  onReasoningChange:(mode:ChatReasoningMode)=>void;
}

type Pending = { key: string; name: string; status: 'uploading' | 'ready' | 'error'; part?: AttachmentPart; error?: string;original?:File };

export function ChatInput({ disabled, isGenerating, enterToSend, placeholder, disabledReason, canAttach, onSend, onStop, callButton, sttEnabled = true, reasoningMode, onReasoningChange }: Props) {
  const [text, setText] = useState('');
  const [voiceBusy,setVoiceBusy]=useState(false);
  const [files, setFiles] = useState<Pending[]>([]);
  const ref = useRef<HTMLTextAreaElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = Math.min(el.scrollHeight, 260) + 'px';
  }, [text]);

  useEffect(() => {
    const compose = (event: Event) => {
      const d = (event as CustomEvent).detail;
      if (d.action === 'attach') { if (canAttach) fileRef.current?.click(); }
      else if (d.action === 'image') setText('สร้างภาพ ' + (d.text ?? ''));
      else if (d.text) setText(d.text);
      ref.current?.focus();
    };
    window.addEventListener('lumicos-compose', compose);
    return () => window.removeEventListener('lumicos-compose', compose);
  }, [canAttach]);
  const uploading = files.some((f) => f.status === 'uploading');
  const ready = files.filter((f) => f.status === 'ready' && f.part).map((f) => f.part!);
  const hasDraft = !!text.trim() || ready.length > 0;
  const canSend = (!!text.trim() || ready.length > 0) && !isGenerating && !disabled && !uploading && !voiceBusy;

  const submit = () => {
    if (!canSend) return;
    onSend(text, ready);
    setText('');
    setFiles([]);
  };

  const onKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key !== 'Enter' || e.nativeEvent.isComposing) return; // Thai/IME composition
    const wantsSend = enterToSend ? !e.shiftKey : e.ctrlKey || e.metaKey;
    if (wantsSend) {
      e.preventDefault();
      submit();
    }
  };

  const addFiles = async (list: FileList | null) => {
    for (const file of Array.from(list ?? [])) {
      const key = `${file.name}-${Date.now()}-${Math.random()}`;
      setFiles((f) => [...f, { key, name: file.name, status: 'uploading' }]);
      try {
        let part: AttachmentPart;
        if(/\.(png|jpe?g)$/i.test(file.name)){
          const up=await localService.images.upload(file);
          part={type:'image',source:'attachment',url:up.url,alt:file.name};
        }else{
          const up=await localService.attachments.upload(file);
          part={type:'attachment',...up};
        }
        setFiles((f) => f.map((x) => (x.key === key ? { ...x, status: 'ready', part,original:file } : x)));
      } catch (e) {
        setFiles((f) => f.map((x) => (x.key === key ? { ...x, status: 'error', error: (e as Error).message } : x)));
      }
    }
  };

  return (
    <div className={`composer-wrap ${disabled ? 'is-disabled' : ''}`}>
      <div
        className="composer"
        onDragOver={(e) => canAttach && e.preventDefault()}
        onDrop={(e) => {
          if (!canAttach || isGenerating) return;
          e.preventDefault();
          addFiles(e.dataTransfer.files);
        }}
      >
        {files.length > 0 && (
          <div className="composer-files">
            {files.map((f) => (
              <span key={f.key} className={`composer-file st-${f.status}`} title={f.error ?? 'Attached for this message only'}>
                {f.status === 'uploading' ? <Loader2 size={13} className="spin" /> : <FileText size={13} />}
                <span className="composer-file-name">{f.name}</span>
                {f.part?.type==='image'&&<><small>วิเคราะห์ / อธิบายภาพ</small></>}
                {f.status === 'error' && <span className="bad small">failed</span>}
                <button onClick={() => setFiles((all) => all.filter((x) => x.key !== f.key))} aria-label={`Remove ${f.name}`}>
                  <X size={12} />
                </button>
              </span>
            ))}
          </div>
        )}
        <textarea
          ref={ref}
          rows={1}
          value={text}
          placeholder={placeholder}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={onKeyDown}
          disabled={disabled}
          autoFocus
        />
        <div className="composer-bar">
          <div className="composer-tools composer-attachments">
            <details className="mobile-composer-menu"><summary aria-label="แนบไฟล์"><Plus size={22}/></summary><div className="mobile-composer-options"><button type="button" disabled={!canAttach||disabled||voiceBusy} onClick={e=>{fileRef.current?.click();e.currentTarget.closest('details')?.removeAttribute('open')}}><Paperclip size={18}/>แนบไฟล์ / รูปภาพ</button></div></details>
            <button
              className="tool-btn"
              disabled={!canAttach || disabled || voiceBusy}
              onClick={() => fileRef.current?.click()}
              title={canAttach ? 'แนบไฟล์หรือภาพเพื่อวิเคราะห์ อธิบาย หรืออ่านข้อความ' : 'Attachments need the local service (start-personalai.bat)'}
              aria-label="Attach file"
            >
              <Paperclip size={17} />
            </button>
            <input
              ref={fileRef}
              type="file"
              hidden
              multiple
              accept={ATTACHMENT_ACCEPT+',.png,.jpg,.jpeg'}
              onChange={(e) => {
                addFiles(e.target.files);
                e.target.value = '';
              }}
            />
            {<ModelSwitcher online={canAttach} disabled={!!disabled || isGenerating || voiceBusy} reasoningMode={reasoningMode} onReasoningChange={onReasoningChange} />}
          </div>
          <div className="composer-tools composer-send-tools">
            {sttEnabled && <MicrophoneButton disabled={!canAttach||!!disabled||isGenerating} onBusy={setVoiceBusy} onText={value=>setText(previous=>previous?previous+' '+value:value)}/>}
            {isGenerating ? (
              <button className="send-btn stop" onClick={onStop} title="Stop generating" aria-label="Stop generating">
                <Square size={13} fill="currentColor" />
              </button>
            ) : !hasDraft && callButton ? (
              callButton
            ) : (
              <button className="send-btn" onClick={submit} disabled={!canSend} title="Send" aria-label="Send">
                <ArrowUp size={18} strokeWidth={2.4} />
              </button>
            )}
          </div>
        </div>
      </div>
      {disabledReason && <div className="composer-hint has-notice">{disabledReason}</div>}
    </div>
  );
}
