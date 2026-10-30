import { Check, Download, FileSpreadsheet, FileText, FolderInput, ImageIcon, Loader2, Wrench } from 'lucide-react';
import { useEffect, useLayoutEffect, useState, useRef } from 'react';
import { createPortal } from 'react-dom';
import { localService } from '../services/localService';
import { useChatActions } from './chatActions';
import type { MessagePart as Part } from '../types';
import { Markdown } from './Markdown';

/**
 * Renders one part of a message. Text is live today; image and tool_result
 * renderers are ready for ComfyUI and tool calling.
 */
export function MessagePart({ part, markdown, messageId }: { part: Part; markdown: boolean; messageId?: string }) {
  switch (part.type) {
    case 'text':
      if (!part.text) return null;
      return markdown ? <Markdown text={part.text} /> : <div className="plain-text">{part.text}</div>;

    case 'image':
      if(part.url.startsWith('/api/images/')) return <GeneratedImage part={part} />;
      return (
        <figure className="msg-image">
          <img src={part.url} alt={part.alt ?? ''} loading="lazy" />
          <figcaption>
            <ImageIcon size={13} /> {part.source === 'generated' ? 'Generated image' : 'Attachment'}
            {part.alt ? ` · ${part.alt}` : ''}
          </figcaption>
        </figure>
      );

    case 'attachment':
      return <AttachmentChip part={part} messageId={messageId} />;

    case 'tool_result':
      return (
        <div className="tool-result">
          <div className="tool-result-head">
            <Wrench size={13} /> {part.toolName}
          </div>
          {part.summary && <div>{part.summary}</div>}
        </div>
      );
  }
}

const fmtSize = (n: number) => (n < 1024 ? `${n} B` : n < 1024 * 1024 ? `${(n / 1024).toFixed(0)} KB` : `${(n / 1024 / 1024).toFixed(1)} MB`);

/** A file attached to a user message. It lives in the attachment cache until imported. */
function AttachmentChip({ part, messageId }: { part: Extract<Part, { type: 'attachment' }>; messageId?: string }) {
  const { importAttachment, openFile, serviceOnline } = useChatActions();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const Icon = part.kind === 'xlsx' || part.kind === 'csv' ? FileSpreadsheet : FileText;
  return (
    <div className="attach-chip" title="Attached to this message. Not saved in your workspace unless you import it.">
      <Icon size={16} />
      <span className="attach-chip-text">
        <span className="attach-chip-name">{part.name}</span>
        <span className="attach-chip-meta">
          {part.kind.toUpperCase()} · {fmtSize(part.size)}
          {!part.complete && ` · ${part.totalChunks} parts`}
        </span>
      </span>
      {part.importedPath ? (
        <button className="link-btn" onClick={() => openFile(part.importedPath!)}>
          <Check size={12} /> In workspace
        </button>
      ) : (
        messageId && (
          <button
            className="link-btn"
            disabled={busy || !serviceOnline}
            onClick={async () => {
              setBusy(true);
              setError(undefined);
              try {
                await importAttachment(messageId, part);
              } catch (e) {
                setError((e as Error).message);
              } finally {
                setBusy(false);
              }
            }}
          >
            {busy ? <Loader2 size={12} className="spin" /> : <FolderInput size={12} />} Import to workspace
          </button>
        )
      )}
      {error && <span className="form-error">{error}</span>}
    </div>
  );
}

function GeneratedImage({part}:{part:Extract<Part,{type:'image'}>}) {
  const [viewing,setViewing]=useState(false);
  const [url,setUrl]=useState('');
  const [error,setError]=useState('');
  useEffect(()=>{
    let disposed=false;let objectUrl='';
    Promise.resolve().then(()=>localService.images.download(part.url)).then(blob=>{if(disposed)return;objectUrl=URL.createObjectURL(blob);setUrl(objectUrl);}).catch(e=>{if(!disposed)setError(e.message);});
    return ()=>{disposed=true;if(objectUrl)URL.revokeObjectURL(objectUrl);};
  },[part.url]);
  const original=typeof part.meta?.originalUrl==='string'?part.meta.originalUrl:undefined;
  const saveOriginal=async()=>{try{const blob=await localService.images.download(original!);const link=URL.createObjectURL(blob),a=document.createElement('a');a.href=link;a.download='lumicos-original.png';a.click();setTimeout(()=>URL.revokeObjectURL(link),1000)}catch(e){setError((e as Error).message)}};
  return <figure className="msg-image">{error?<p className="form-error">{error}</p>:url?<button type="button" aria-label="เปิดดูภาพ" style={{padding:0,border:0,background:'transparent',cursor:'zoom-in'}} onClick={()=>setViewing(true)}><img src={url} alt={part.alt??'Generated image'} /></button>:<p>กำลังโหลดภาพ…</p>}<figcaption>{part.source==='attachment'?'ภาพต้นฉบับ':part.meta?.upscaled?`อัปสเกล 4× · ${part.meta.width} × ${part.meta.height} · เพิ่ม ${((Number(part.meta.upscaleMs)||0)/1000).toFixed(1)} วินาที`:`${String(part.meta?.workflow??'Z image')} · Seed ${String(part.meta?.seed??'')}`} · คลิกเพื่อดูภาพ {original&&<button className="link-btn" onClick={()=>void saveOriginal()}>ดาวน์โหลดต้นฉบับ</button>}</figcaption>{viewing&&url&&<ImagePreview url={url} alt={part.alt??'ภาพ Lumicos'} downloadName={'lumicos-'+String(part.meta?.seed??'image')+'.png'} close={()=>setViewing(false)}/>}</figure>;
}

export function ImagePreview({url,alt,downloadName='Lumicos.png',close}:{url:string;alt:string;downloadName?:string;close:()=>void}) {
  const ref=useRef<HTMLDialogElement>(null);
  const [zoomed,setZoomed]=useState(false);
  const scrollRef=useRef<HTMLDivElement>(null);
  const imageRef=useRef<HTMLImageElement>(null);
  const [fit,setFit]=useState<{width:number;height:number}|null>(null);
  const measureFit=()=>{
    const area=scrollRef.current,image=imageRef.current;
    if(!area||!image?.naturalWidth)return;
    const style=getComputedStyle(area);
    const width=area.clientWidth-parseFloat(style.paddingLeft)-parseFloat(style.paddingRight);
    const height=area.clientHeight-parseFloat(style.paddingTop)-parseFloat(style.paddingBottom);
    const scale=Math.min(1,width/image.naturalWidth,height/image.naturalHeight);
    const next={width:image.naturalWidth*scale,height:image.naturalHeight*scale};
    setFit(previous=>previous&&Math.abs(previous.width-next.width)<1&&Math.abs(previous.height-next.height)<1?previous:next);
  };
  const drag=useRef<{id:number;x:number;y:number;left:number;top:number}|null>(null);
  const moved=useRef(false);
  useEffect(()=>{const dialog=ref.current!;dialog.showModal();return()=>dialog.close()},[]);
  useEffect(()=>{const observer=new ResizeObserver(measureFit);observer.observe(scrollRef.current!);measureFit();return()=>observer.disconnect()},[]);
  useLayoutEffect(()=>{
    const area=scrollRef.current;
    if(!area)return;
    // Recenter after the zoomed dimensions have been laid out, before painting.
    area.scrollLeft=zoomed?(area.scrollWidth-area.clientWidth)/2:0;
    area.scrollTop=zoomed?(area.scrollHeight-area.clientHeight)/2:0;
  },[zoomed]);
  return createPortal(<dialog ref={ref} className="image-lightbox" aria-label="ดูภาพ" onCancel={close} onClick={close}><div className="image-lightbox-actions" onClick={e=>e.stopPropagation()}><a className="btn btn-soft" href={url} download={downloadName}><Download size={17}/> ดาวน์โหลด</a><button className="btn btn-soft" autoFocus onClick={close}>ปิด ✕</button></div><div ref={scrollRef} className={`image-lightbox-scroll ${zoomed?'is-zoomed':''}`}><img ref={imageRef} onLoad={measureFit} style={zoomed&&fit?{width:fit.width*1.4,height:fit.height*1.4}:undefined} src={url} alt={alt} draggable={false} tabIndex={0} role="button" aria-label={zoomed?'ลากเพื่อเลื่อนภาพ คลิกเพื่อย่อ':'ขยายภาพ'} onPointerDown={e=>{moved.current=false;if(!zoomed||e.button!==0)return;const area=scrollRef.current!;drag.current={id:e.pointerId,x:e.clientX,y:e.clientY,left:area.scrollLeft,top:area.scrollTop};e.currentTarget.setPointerCapture(e.pointerId)}} onPointerMove={e=>{const start=drag.current;if(!start||start.id!==e.pointerId)return;const dx=e.clientX-start.x,dy=e.clientY-start.y;if(Math.hypot(dx,dy)>5)moved.current=true;if(moved.current){const area=scrollRef.current!;area.scrollLeft=start.left-dx;area.scrollTop=start.top-dy;}}} onPointerUp={()=>{drag.current=null}} onPointerCancel={()=>{drag.current=null;moved.current=true}} onClick={e=>{e.stopPropagation();if(moved.current){moved.current=false;return;}setZoomed(value=>!value)}} onKeyDown={e=>{if(e.key==='Enter'||e.key===' '){e.preventDefault();setZoomed(value=>!value)}}}/></div></dialog>,document.body);
}
