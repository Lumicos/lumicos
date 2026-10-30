import {watchSilence} from './silence';
import {wav16k} from './MicrophoneButton';

export async function captureUtterance(signal:AbortSignal):Promise<Blob>{
 signal.throwIfAborted();
 const mic=await navigator.mediaDevices.getUserMedia({audio:{channelCount:1,echoCancellation:true,noiseSuppression:true}});
 if(signal.aborted){mic.getTracks().forEach(t=>t.stop());signal.throwIfAborted();}
 const blob=await new Promise<Blob>((resolve,reject)=>{
  const rec=new MediaRecorder(mic),chunks:BlobPart[]=[];let cleanupSilence:(()=>void)|undefined;let settled=false;
  const timer=setTimeout(()=>rec.state==='recording'&&rec.stop(),60000);
  const clean=()=>{clearTimeout(timer);cleanupSilence?.();mic.getTracks().forEach(t=>t.stop());signal.removeEventListener('abort',abort)};
  const fail=(error:unknown)=>{if(settled)return;settled=true;rec.onstop=null;if(rec.state==='recording')rec.stop();clean();reject(error)};
  const abort=()=>fail(signal.reason);signal.addEventListener('abort',abort,{once:true});
  rec.ondataavailable=e=>{if(e.data.size)chunks.push(e.data)};
  rec.onerror=()=>fail(Error('บันทึกเสียงไม่ได้'));
  rec.onstop=()=>{if(settled)return;settled=true;clean();resolve(new Blob(chunks,{type:rec.mimeType}))};
  try{rec.start();void watchSilence(mic,empty=>{if(empty)fail(Object.assign(Error('ยังไม่ได้ยินเสียงพูด'),{code:'NO_SPEECH'}));else if(rec.state==='recording')rec.stop()}).then(stop=>{if(settled)stop();else cleanupSilence=stop}).catch(fail)}catch(e){fail(e)}
  if(signal.aborted)abort();
 });
 signal.throwIfAborted();return wav16k(blob);
}
