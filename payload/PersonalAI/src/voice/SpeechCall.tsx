import {useEffect,useRef,useState,type ReactNode} from 'react';
import {Phone,PhoneOff} from 'lucide-react';
import {captureUtterance} from './capture';
import {transcribe,useVoice} from './Voice';
import {PCMPlayer} from './PCMPlayer';
import {SpokenChunks} from './SpokenChunks';
import {WaitingCue} from './WaitingCue';
import {playConnected,playHangup,startRinging,stopRinging} from './callTones';
import type {ChatMessage} from '../types';
import {makeMessage} from '../chat/messageUtils';
import {sync} from '../services/sync';

export type CallControls={active:boolean;phase:string;error:string;ending:boolean;canStart:boolean;start:()=>void;hangup:()=>void};
export function SpeechCall({conversationId,disabled,busy,onReply,onActive,onFinish,render}:{render?:(call:CallControls)=>ReactNode;conversationId:string;disabled:boolean;busy:boolean;onReply:(text:string,turns:ChatMessage[],signal:AbortSignal,callId:string,onToken?:(text:string)=>void,onTiming?:(stage:string,ms:number)=>void)=>Promise<string>;onActive:(value:boolean)=>void;onFinish:(conversationId:string,turns:ChatMessage[])=>void}){
 const [phase,setPhase]=useState(''),[error,setError]=useState(''),[ending,setEnding]=useState(false);
 const [,refresh]=useState(0);useEffect(()=>sync.subscribe(()=>refresh(n=>n+1)),[]);
 const otherCall=!!sync.state.callOwner&&sync.state.callOwner!==sync.ownerId;
 // Call sounds: ring while the voice stack (Whisper · E2B · Microsoft Pattara) is loading, chime when Lumicos picks up / hangs up.
 const tonePhase=useRef<'idle'|'ringing'|'live'>('idle');
 useEffect(()=>{
  const connecting=/เริ่มโทร|เตรียม/.test(phase);
  if(connecting&&tonePhase.current==='idle'){tonePhase.current='ringing';startRinging();}
  else if(phase&&!connecting&&!/วางสาย/.test(phase)&&tonePhase.current==='ringing'){tonePhase.current='live';playConnected();}
  else if((!phase||/วางสาย/.test(phase))&&tonePhase.current!=='idle'){const was=tonePhase.current;tonePhase.current='idle';stopRinging();if(was==='live')playHangup();}
 },[phase]);
 useEffect(()=>()=>stopRinging(),[]);
 const session=useRef<string|null>(null),heartbeat=useRef<ReturnType<typeof setInterval>|null>(null);
 const callApi=async(route:string,body:object,signal?:AbortSignal)=>{const r=await fetch('/api/voice/call/'+route,{method:'POST',headers:{'X-PersonalAI':'1','Content-Type':'application/json'},body:JSON.stringify(body),signal,keepalive:route==='end'});const data=await r.json();if(!r.ok)throw Error(data.error?.message??'โทรคุยไม่พร้อม');return data};
 const endSession=()=>{if(heartbeat.current)clearInterval(heartbeat.current);heartbeat.current=null;const id=session.current;session.current=null;return id?callApi('end',{id}):Promise.resolve()};
 const active=useRef<AbortController|null>(null),audio=useRef<PCMPlayer|null>(null);const callbacks=useRef({onReply,onActive,onFinish});callbacks.current={onReply,onActive,onFinish};const voice=useVoice();
 const transcript=useRef<ChatMessage[]>([]);
 const flush=()=>{const turns=transcript.current;transcript.current=[];if(turns.length)callbacks.current.onFinish(conversationId,turns)};
 const hangup=()=>{active.current?.abort();active.current=null;audio.current?.stop();audio.current=null;flush();setEnding(true);setPhase('กำลังวางสาย · กลับไป E4B');void endSession().catch(e=>setError(e.message)).finally(()=>{callbacks.current.onActive(false);window.dispatchEvent(new Event('lumicos-model-refresh'));setPhase('');setEnding(false)})};
 useEffect(()=>()=>{if(active.current){active.current.abort();callbacks.current.onActive(false)}audio.current?.stop();void endSession().catch(()=>{});flush()},[conversationId]);
 useEffect(()=>{if(disabled&&active.current)hangup()},[disabled]);
 useEffect(()=>{const leave=()=>{active.current?.abort();audio.current?.stop();void endSession().catch(()=>{})};window.addEventListener('pagehide',leave);return()=>window.removeEventListener('pagehide',leave)},[]);
 const start=async()=>{
  if(otherCall){setError('Call active on another device');return;}
  if(!window.isSecureContext){setError('ไมโครโฟนต้องเปิดผ่าน HTTPS ของ Tailscale หรือ localhost');return;}
  if(active.current)return;const controller=new AbortController(),signal=controller.signal;active.current=controller;setError('');setPhase('กำลังเริ่มโทร');voice.stop();callbacks.current.onActive(true);
  let waiting:WaitingCue|undefined;
  try{
   const player=new PCMPlayer();audio.current=player;await player.resume();signal.throwIfAborted();
   waiting=new WaitingCue(player.context);void waiting.preload(signal);
   transcript.current=[];
   setPhase('กำลังเตรียม Whisper · E2B · Microsoft Pattara');
   const preparing=performance.now();
   const prepared=await callApi('start',{},signal);
   if(signal.aborted){await callApi('end',{id:prepared.id});signal.throwIfAborted()}
   session.current=prepared.id;
   heartbeat.current=setInterval(()=>{void callApi('heartbeat',{id:prepared.id}).catch(e=>{if(active.current===controller){setError(e.message);hangup()}})},15000);
   let turn=0;
   const timing=(stage:string,elapsedMs:number)=>{void callApi('timing',{id:prepared.id,turn,stage,elapsedMs}).catch(()=>{})};
   timing('ready',performance.now()-preparing);
   while(!signal.aborted){
    setPhase('กำลังฟัง · พูดจบแล้วหยุดให้อัตโนมัติ');
    let wav:Blob;
    try{wav=await captureUtterance(signal)}catch(e){if(!signal.aborted&&(e as {code?:string}).code==='NO_SPEECH')continue;throw e;}
    signal.throwIfAborted();turn++;const captured=performance.now();setPhase('กำลังถอดเสียง');const {text}=await transcribe(wav,signal,prepared.id);signal.throwIfAborted();timing('stt',performance.now()-captured);
    setPhase('Nova กำลังคิด');
    const context=transcript.current.slice(-40);
    transcript.current.push(makeMessage('user',text,{source:'voice',status:'done'}));
    callbacks.current.onFinish(conversationId,[...transcript.current]);
    // Prefer a full Thai phrase over a very early first fragment. F5 establishes
    // prosody per synthesis request, so fewer boundaries sound more continuous.
    const replyStarted=performance.now(),chunker=new SpokenChunks(55,20);
    const replyAbort=new AbortController(),turnSignal=AbortSignal.any([signal,replyAbort.signal]);
    waiting.arm(turnSignal,turn);
    let queue=Promise.resolve(),speechError:Error|undefined,firstToken=true,firstAudio=true;
    const speak=async(chunk:string)=>{
     turnSignal.throwIfAborted();
     const spoken=chunk.replace(/[*#`_]/g,'').trim();if(!spoken)return;
     const started=performance.now();setPhase('กำลังสร้างเสียง · Nova กำลังตอบ');player.beginUtterance(spoken);
     const response=await fetch('/api/voice/speak',{method:'POST',headers:{'X-PersonalAI':'1','Content-Type':'application/json'},body:JSON.stringify({text:spoken,stream:true,callId:prepared.id}),signal:turnSignal});
     if(!response.ok){const info=await response.json().catch(()=>null);throw Error(info?.error?.message??'สร้างเสียงสนทนาไม่ได้')}
     if(!response.body)throw Error('ไม่ได้รับเสียงสนทนา');
     const reader=response.body.getReader(),decoder=new TextDecoder();let buffer='',done=false,count=0;
     const accept=(line:string)=>{
      if(!line.trim())return;turnSignal.throwIfAborted();const event=JSON.parse(line);
      if(event.type==='error')throw Error(event.error);
       if(event.type==='done'){done=true;player.endUtterance();}
      if(event.type==='audio'){
       waiting?.cancel();
       if(firstAudio){timing('tts_first_audio',performance.now()-started);timing('audio_queued',performance.now()-captured);firstAudio=false;}
       player.add(event.pcm,event.sampleRate);count++;setPhase('Nova กำลังพูด');
      }
     };
     try{
      while(true){const r=await reader.read();if(r.done)break;buffer+=decoder.decode(r.value,{stream:true});let end;while((end=buffer.indexOf('\n'))>=0){accept(buffer.slice(0,end));buffer=buffer.slice(end+1)}}
      accept(buffer+decoder.decode());if(!done||!count)throw Error('เสียงสนทนาขาดช่วง');
     }finally{await reader.cancel().catch(()=>{});reader.releaseLock();}
    };
    const enqueue=(chunks:string[])=>{for(const chunk of chunks)queue=queue.then(()=>speak(chunk)).catch(e=>{speechError??=e;replyAbort.abort(e)})};
    try{
     const answer=await callbacks.current.onReply(text,context,turnSignal,prepared.id,token=>{
      if(firstToken){timing('llm_first_token',performance.now()-replyStarted);firstToken=false;}
      enqueue(chunker.push(token));
     },timing);
     timing('llm_done',performance.now()-replyStarted);signal.throwIfAborted();
     transcript.current.push(makeMessage('assistant',answer,{status:'done'}));
     // Save each finished exchange into the chat right away (finishCall skips ids already saved).
     callbacks.current.onFinish(conversationId,[...transcript.current]);
     // Recover when a reply adapter returns final text without token callbacks.
     enqueue(chunker.push(firstToken?answer:'',true));await queue;
     if(speechError)throw speechError;
     if(firstAudio)throw Error('คำตอบนี้ไม่มีเสียงให้อ่าน');
     await player.drain(signal);timing('reply_complete',performance.now()-captured);
    }catch(e){replyAbort.abort(e);await queue;throw speechError??e;}finally{waiting.cancel()}

   }
  }catch(e){if(!signal.aborted)setError((e as Error).message)}finally{waiting?.dispose();if(active.current===controller)hangup()}
 };
 const canStart=!otherCall&&!ending&&!disabled&&!busy&&!!voice.status?.tts.ready&&!!voice.status?.stt.ready;
 if(render)return <>{render({active:!!phase,phase,error:otherCall?'Call active on another device':error,ending,canStart,start:()=>{if(!active.current)void start()},hangup:()=>{if(active.current)hangup()}})}</>;
 return <div className="speech-call"><button className="tool-btn" title={phase?'วางสาย':'โทรคุย'} aria-label={phase?'วางสาย':'โทรคุย'} aria-pressed={!!phase} disabled={otherCall||ending||(!active.current&&(disabled||busy||!voice.status?.tts.ready||!voice.status?.stt.ready))} onClick={()=>active.current?hangup():void start()}>{phase?<PhoneOff size={17}/>:<Phone size={17}/>}</button>{otherCall&&<span role="status">Call active on another device</span>}{phase&&<span role="status">{phase}</span>}{error&&<span role="alert">{error}</span>}</div>;
}

