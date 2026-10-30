import {cancelReactions} from '../components/avatar-stage/reactionSignal.mjs';
import {createContext,useCallback,useContext,useEffect,useRef,useState,type ReactNode} from 'react';
import {Volume2,Square} from 'lucide-react';
import {PCMPlayer} from './PCMPlayer';
type Status={tts:{ready:boolean;reason:string|null;label:string};stt:{ready:boolean;reason:string|null;label:string}};
async function api(route:string,init?:RequestInit){const r=await fetch('/api/voice/'+route,{...init,headers:{'X-PersonalAI':'1',...init?.headers}});if(!r.ok){const d=await r.json();throw Error(d.error?.message??'ระบบเสียงไม่พร้อม')}return r;}
export const transcribe=async(wav:Blob,signal:AbortSignal,callId?:string)=> (await (await api('transcribe',{method:'POST',body:wav,signal,headers:callId?{'X-Lumicos-Call':callId}:{}})).json()) as {text:string;elapsedMs:number};
const Context=createContext<{status?:Status;busy:boolean;readingId:string|null;error:string;stop:()=>void;speak:(text:string,id:string,options?:{literal?:boolean;avatarTest?:{speed:number}})=>void}>({busy:false,readingId:null,error:'',stop:()=>{},speak:()=>{}});
export const useVoice=()=>useContext(Context);
export function VoiceProvider({children}:{children:ReactNode}){
 const [status,setStatus]=useState<Status>();const [busy,setBusy]=useState(false);const [readingId,setReadingId]=useState<string|null>(null);const [error,setError]=useState('');const [playing,setPlaying]=useState(false);const [elapsed,setElapsed]=useState(0);const [chunks,setChunks]=useState(0);
 const abort=useRef<AbortController|null>(null);const player=useRef<PCMPlayer|null>(null);
 const stop=useCallback(()=>{cancelReactions();abort.current?.abort();abort.current=null;player.current?.stop();player.current=null;setPlaying(false);setBusy(false);setReadingId(null);setError('');setChunks(0)},[]);
 useEffect(()=>{let live=true;const refresh=()=>api('status').then(r=>r.json()).then(s=>{if(live)setStatus(s)}).catch(()=>{if(live)setStatus(undefined)});void refresh();const timer=setInterval(refresh,30000);return()=>{live=false;clearInterval(timer);abort.current?.abort();player.current?.stop()}},[]);
 const speak=useCallback(async(text:string,id:string,options?:{literal?:boolean;avatarTest?:{speed:number}})=>{
  stop();setError('');const controller=new AbortController();abort.current=controller;setBusy(true);setReadingId(id);
  // Only the visible answer is read; code blocks and link destinations are omitted.
  const spoken=options?.literal?text:text.replace(/```[\s\S]*?```/g,'').replace(/\[([^\]]+)\]\([^)]*\)/g,'$1').replace(/[*#`_]/g,'').trim();
  try{
   const audio=new PCMPlayer();player.current=audio;audio.beginUtterance(spoken);audio.onEnded=()=>{if(player.current===audio){audio.stop();player.current=null;setPlaying(false);setReadingId(null)}};await audio.resume();
   const start=performance.now();let received=0,finished=false;
   const r=await api('speak',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({text:spoken,stream:true,...(options?.avatarTest?{avatarTest:options.avatarTest}:{})}),signal:controller.signal});if(!r.body)throw Error('ไม่ได้รับ stream เสียง');
   const reader=r.body.getReader(),decoder=new TextDecoder();let buffer='';
   const accept=(line:string)=>{if(!line.trim())return;controller.signal.throwIfAborted();const event=JSON.parse(line);if(event.type==='error')throw Error(event.error);if(event.type==='done'){finished=true;audio.endUtterance();return;}if(event.type==='audio'){audio.add(event.pcm,event.sampleRate);received++;setChunks(received);setPlaying(true);if(received===1)setElapsed(performance.now()-start)}};
   while(true){const {done,value}=await reader.read();if(done)break;buffer+=decoder.decode(value,{stream:true});let at;while((at=buffer.indexOf('\n'))>=0){accept(buffer.slice(0,at));buffer=buffer.slice(at+1)}}
   accept(buffer+decoder.decode());if(!finished||!received)throw Error('stream เสียงจบก่อนงานเสร็จ');audio.done();
  }
  catch(e){if(!controller.signal.aborted){const message=(e as Error).message;stop();setError(message)}}finally{if(abort.current===controller){setBusy(false);abort.current=null;}}
 },[stop]);
 return <Context.Provider value={{status,busy,readingId,error,stop,speak}}>{children}{(busy||playing||error)&&<aside className="voice-player" data-chunks={chunks} aria-label="เสียง Lumicos"><div role="status">{error||(chunks?('เสียง Lumicos · เริ่มเสียงใน '+(elapsed/1000).toFixed(1)+' วินาที'+(busy?' · กำลังสร้างช่วงถัดไป':'')):'กำลังเตรียมเสียง Lumicos…')}</div><button className="btn btn-ghost" onClick={stop}>หยุดเสียง / ปิด</button></aside>}</Context.Provider>;
}
export function SpeakButton({text,id,disabled}:{text:string;id:string;disabled?:boolean}){const v=useVoice();const active=v.readingId===id;return <button className="act-btn" aria-label={active?'หยุดอ่านเสียง':'อ่านด้วยเสียง Lumicos'} title={v.status?.tts.reason??'อ่านด้วยเสียง Lumicos'} disabled={disabled||!v.status?.tts.ready} onClick={()=>active?v.stop():v.speak(text,id)}>{active?<Square size={14}/>:<Volume2 size={14}/>}</button>}
type EngineOption={ready:boolean;label:string;reason?:string|null};
type Engines={tts:'windows';stt:'th'|'multi';resident?:boolean;options:{tts:Record<'windows',EngineOption>;stt:Record<'th'|'multi',EngineOption>}};
/** Select an installed public CPU voice and listening model. */
function EngineChooser(){
 const [engines,setEngines]=useState<Engines>();const [busy,setBusy]=useState(false);const [error,setError]=useState('');
 useEffect(()=>{api('engines').then(r=>r.json()).then(setEngines).catch(()=>{})},[]);
 const choose=async(patch:Partial<Pick<Engines,'tts'|'stt'|'resident'>>)=>{setBusy(true);setError('');try{setEngines(await (await api('engines',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(patch)})).json())}catch(e){setError((e as Error).message)}finally{setBusy(false)}};
 if(!engines)return null;
 const row=<K extends 'tts'|'stt'>(kind:K,title:string)=><div className="voice-engine-row"><b>{title}</b><div className="voice-engine-options">
  {(Object.entries(engines.options[kind]) as [string,EngineOption][]).map(([id,o])=><label key={id} className={`voice-engine-option ${engines[kind]===id?'active':''}`} title={o.reason??''}>
   <input type="radio" name={'engine-'+kind} checked={engines[kind]===id} disabled={busy||(!o.ready&&engines[kind]!==id)} onChange={()=>void choose({[kind]:id} as Partial<Pick<Engines,'tts'|'stt'>>)}/>
   <span>{o.label}{!o.ready&&<small> · {o.reason??'ยังไม่พร้อม'}</small>}</span></label>)}
 </div></div>;
 return <div className="voice-engines">{row('tts','เสียงพูด')}{row('stt','การฟัง')}
  <p className="muted small">ใช้เฉพาะ Microsoft Pattara บน CPU หากไม่พบเสียง ให้ติดตั้ง Thai text-to-speech ใน Windows Settings &gt; Language &amp; region</p>
  {error&&<div className="form-error" role="alert">{error}</div>}</div>;
}
export function VoiceSettings(){const v=useVoice();return <section>
 <h2>เสียง Lumicos</h2><EngineChooser/><p>{v.status?.tts.label??'กำลังตรวจระบบเสียง…'}</p><p>{v.status?.tts.ready?'พร้อมอ่านคำตอบด้วยเสียงที่เตรียมไว้':v.status?.tts.reason}</p>
 <button className="btn btn-soft" disabled={!v.status?.tts.ready||v.busy} onClick={()=>v.speak('สวัสดีค่ะ ระบบลูมิคอส พร้อมคุยกับคุณแล้วค่ะ','voice-test')}>ทดสอบเสียง Lumicos</button>
 <h3>ฟังเสียงภาษาไทย</h3><p>{v.status?.stt.ready?'พร้อมใช้ปุ่มไมค์ในช่องแชต':v.status?.stt.reason??'บริการยังไม่พร้อม'}</p>
 <p>กดไมค์แล้วพูด เมื่อพูดจบและเงียบประมาณ 1.2 วินาที ระบบจะปิดไมค์และถอดเป็นข้อความในช่องพิมพ์ให้ตรวจแก้ก่อนส่ง อัดได้ครั้งละ 60 วินาที หากไม่มีเสียงพูด 10 วินาทีจะหยุดเอง</p>
 <h3>โทรคุย</h3><p>โทรคุยด้วย Gemma E2B และเสียง Microsoft Pattara เมื่อฟังคำตอบจบจะเปิดไมค์รับรอบถัดไป กดวางสายเพื่อหยุดทุกขั้นตอน โหมดนี้ผลัดกันพูดและยังไม่รองรับพูดแทรกระหว่างคำตอบ</p>
 <p>ปุ่มอ่านคำตอบและโทรคุยใช้เสียง CPU โดยไม่ใช้เสียงอ้างอิงส่วนตัว โหมดไม่บันทึกแชตยังใช้ข้อความเท่านั้น</p>
 </section>}

