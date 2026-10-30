import {useEffect,useRef,useState} from 'react';
import {Mic,Square,X} from 'lucide-react';
import {transcribe,useVoice} from './Voice';
import {watchSilence} from './silence';
export async function wav16k(blob:Blob){
 const context=new AudioContext();let decoded:AudioBuffer;try{decoded=await context.decodeAudioData(await blob.arrayBuffer())}finally{await context.close()}
 const offline=new OfflineAudioContext(1,Math.min(60*16000,Math.ceil(decoded.duration*16000)),16000);const source=offline.createBufferSource();source.buffer=decoded;source.connect(offline.destination);source.start();const data=(await offline.startRendering()).getChannelData(0);
 const buffer=new ArrayBuffer(44+data.length*2),view=new DataView(buffer);const str=(at:number,s:string)=>{for(let i=0;i<s.length;i++)view.setUint8(at+i,s.charCodeAt(i))};str(0,'RIFF');view.setUint32(4,36+data.length*2,true);str(8,'WAVE');str(12,'fmt ');view.setUint32(16,16,true);view.setUint16(20,1,true);view.setUint16(22,1,true);view.setUint32(24,16000,true);view.setUint32(28,32000,true);view.setUint16(32,2,true);view.setUint16(34,16,true);str(36,'data');view.setUint32(40,data.length*2,true);data.forEach((v,i)=>view.setInt16(44+i*2,Math.max(-1,Math.min(1,v))*(v<0?32768:32767),true));return new Blob([buffer],{type:'audio/wav'});
}
export function MicrophoneButton({disabled,onText,onBusy}:{disabled:boolean;onText:(text:string)=>void;onBusy:(busy:boolean)=>void}){
 const v=useVoice();const [phase,setPhase]=useState<'idle'|'requesting'|'recording'|'transcribing'>('idle');const [error,setError]=useState('');const recorder=useRef<MediaRecorder|null>(null);const stream=useRef<MediaStream|null>(null);const controller=useRef<AbortController|null>(null);const timer=useRef<ReturnType<typeof setTimeout>|undefined>(undefined);const mounted=useRef(true);
 const silenceStop=useRef<(()=>void)|null>(null);
 const release=()=>{silenceStop.current?.();silenceStop.current=null;clearTimeout(timer.current);stream.current?.getTracks().forEach(t=>t.stop());stream.current=null;recorder.current=null};
 const cancel=()=>{controller.current?.abort();if(recorder.current?.state==='recording'){recorder.current.onstop=null;recorder.current.stop()}release();if(mounted.current){setPhase('idle');onBusy(false)}};
 useEffect(()=>{mounted.current=true;return()=>{mounted.current=false;cancel()}},[]);
 useEffect(()=>{if(disabled&&controller.current&&!controller.current.signal.aborted)cancel()},[disabled]);
 const start=async()=>{
  if(phase==='recording'){recorder.current?.stop();return}if(phase!=='idle')return;
  setError('');setPhase('requesting');onBusy(true);v.stop();const abort=new AbortController();controller.current=abort;
  try{
   const mic=await navigator.mediaDevices.getUserMedia({audio:{channelCount:1,echoCancellation:true,noiseSuppression:true}});if(abort.signal.aborted||!mounted.current){mic.getTracks().forEach(t=>t.stop());return}stream.current=mic;
   const rec=new MediaRecorder(mic);recorder.current=rec;const chunks:BlobPart[]=[];rec.ondataavailable=e=>{if(e.data.size)chunks.push(e.data)};
   rec.onstop=async()=>{release();if(abort.signal.aborted)return;setPhase('transcribing');try{const wav=await wav16k(new Blob(chunks,{type:rec.mimeType}));abort.signal.throwIfAborted();const result=await transcribe(wav,abort.signal);if(mounted.current&&!abort.signal.aborted)onText(result.text)}catch(e){if(mounted.current&&!abort.signal.aborted)setError((e as Error).message)}finally{if(mounted.current&&!abort.signal.aborted){setPhase('idle');onBusy(false)}}};
   rec.start();setPhase('recording');timer.current=setTimeout(()=>{if(rec.state==='recording')rec.stop()},60000);
   const stopWatching=await watchSilence(mic,empty=>{if(empty){cancel();setError('ยังไม่ได้ยินเสียงพูด ลองกดไมค์ใหม่อีกครั้ง')}else if(rec.state==='recording')rec.stop()});
   if(abort.signal.aborted||rec.state!=='recording')stopWatching();else silenceStop.current=stopWatching;
  }catch(e){release();if(mounted.current&&!abort.signal.aborted){setError((e as Error).name==='NotAllowedError'?'ยังไม่ได้อนุญาตไมโครโฟน กรุณาอนุญาตในเบราว์เซอร์':(e as Error).message);setPhase('idle');onBusy(false)}}
 };
 return <span className="voice-input"><button className="tool-btn" disabled={disabled||!v.status?.stt.ready||phase==='requesting'||phase==='transcribing'} onClick={()=>void start()} title={disabled?'เสียงใช้ได้ในแชตปกติเมื่อบริการพร้อม':v.status?.stt.reason??'พูดแล้วตรวจข้อความก่อนส่ง'} aria-label={phase==='recording'?'หยุดอัดเสียง':'เริ่มพูด'}>{phase==='recording'?<Square size={17}/>:<Mic size={17}/>}</button>{phase!=='idle'&&<><small role="status">{phase==='recording'?'กำลังอัดเสียง…':phase==='transcribing'?'กำลังถอดเสียง…':'กำลังเปิดไมค์…'}</small><button className="tool-btn" aria-label="ยกเลิกเสียง" onClick={cancel}><X size={14}/></button></>}{error&&<small className="form-error" role="alert">{error}</small>}</span>;
}
