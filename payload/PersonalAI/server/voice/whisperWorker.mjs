import net from 'node:net';
import path from 'node:path';
import {spawn} from 'node:child_process';
import {setTimeout as delay} from 'node:timers/promises';

// One owned whisper-server per call. It keeps the Vulkan model resident across turns.
export class WhisperWorker {
 async start(exe,model,signal,{port=0,threads=6,env=process.env,language='th',backendPattern=/using (?:Vulkan|CUDA|SYCL|ROCm|HIP).*backend|(?:Vulkan|CUDA|ROCm|HIP)\d*.*(?:buffer|size)|(?:Vulkan|CUDA|ROCm|HIP).*total size/i}={}){
  if(!port){const reservation=net.createServer();await new Promise((resolve,reject)=>{reservation.once('error',reject);reservation.listen(0,'127.0.0.1',resolve)});port=reservation.address().port;await new Promise(resolve=>reservation.close(resolve));}
  signal.throwIfAborted();
  const child=spawn(exe,['-m',model,'--host','127.0.0.1','--port',String(port),'-l',language,'-t',String(threads),'-nt'],{cwd:path.dirname(exe),windowsHide:true,stdio:['ignore','pipe','pipe'],env});
  this.child=child;this.language=language;this.url=`http://127.0.0.1:${port}`;let log='',failure;
  this.closed=new Promise(resolve=>child.once('close',resolve));
  child.on('error',e=>{failure=e});
  const collect=d=>{log=(log+d.toString()).slice(-64000);this.startupLog=log};
  child.stdout.on('data',collect);child.stderr.on('data',collect);
  try{
   for(let i=0;i<240;i++){
    signal.throwIfAborted();
    if(failure)throw failure;
    if(child.exitCode!==null||child.signalCode!==null)throw Error('Whisper GPU stopped: '+log.slice(-1200));
    const response=await fetch(this.url,{signal:AbortSignal.timeout(750)}).catch(()=>null);
    if(response){
     if(!backendPattern.test(log))throw Error('Whisper did not confirm the requested GPU backend; refusing CPU fallback. '+log.slice(-1200));
     this.pid=child.pid;this.backendEvidence=log.split(/\r?\n/).filter(line=>/ROCm|HIP|gfx1032|ggml_cuda|device/i.test(line)).slice(-30);
     return;
    }
    await delay(500,undefined,{signal});
   }
   throw Error('Whisper GPU startup timed out');
  }catch(e){await this.stop();throw e}
 }
 async request(wav,language,format,signal){
  const form=new FormData();form.append('file',new Blob([wav],{type:'audio/wav'}),'input.wav');form.append('language',language);form.append('response_format',format);
  const response=await fetch(this.url+'/inference',{method:'POST',body:form,signal});
  if(!response.ok)throw Error('Whisper: '+(await response.text()).slice(0,500));
  return response.json();
 }
 async transcribe(wav,signal){
  if(!this.child||this.child.exitCode!==null||this.child.signalCode!==null)throw Error('Whisper GPU is no longer running');
  const language=this.language??'th';
  let result=await this.request(wav,language,language==='auto'?'verbose_json':'json',signal);
  // Auto-detect sometimes hears short Thai as English and writes an English *translation*.
  // The owner speaks Thai most: if Thai was a real candidate, transcribe again as Thai.
  if(language==='auto'&&preferThai(result))result=await this.request(wav,'th','json',signal);
  const text=joinThaiWords(result.text);
  if(!text)throw Error('ไม่ได้ยินคำพูดชัดเจน ลองพูดใหม่');
  return text;
 }
 async stop(){const child=this.child;this.child=null;if(child&&child.exitCode===null&&child.signalCode===null){child.kill();await this.closed}this.pid=null}
 kill(){this.child?.kill()}
}

/** Whisper writes Thai with a space after every word ("คุย เรื่อง ท่องเที่ยว"). Thai text has no spaces
 *  between words, so join Thai-Thai gaps; spaces next to Latin letters or digits are kept. */
/** Re-run as Thai when detection picked another language but Thai was still plausible, or the
 *  text came back without any Thai although Thai scored at least 10%. */
export function preferThai(result){
 const detected=String(result?.language??result?.detected_language??'').toLowerCase();
 if(!detected||detected==='thai'||detected==='th')return false;
 const thai=Number(result?.language_probabilities?.th??0);
 const best=Number(result?.detected_language_probability??0);
 return thai>=0.10||(thai>0.02&&best<0.75);
}
export function joinThaiWords(raw){
 return String(raw??'').replace(/([\u0E00-\u0E7F])[ \t]+(?=[\u0E00-\u0E7F])/gu,'$1').replace(/\s+/g,' ').trim();
}
