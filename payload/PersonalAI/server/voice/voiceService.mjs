import {LocalTtsClient} from './localTts.mjs';
import fs from 'node:fs/promises';
import {readFileSync} from 'node:fs';
import path from 'node:path';
import {tmpdir} from 'node:os';
import {spawn} from 'node:child_process';
import {F5Worker,pcmWav} from './f5Worker.mjs';
import {WhisperWorker} from './whisperWorker.mjs';
import {randomUUID} from 'node:crypto';
import {RocmF5Client,assertF5RocmCallSafe,whisperRocmEnvironment} from './rocmVoiceBackends.mjs';
const exists=async p=>fs.access(p).then(()=>true,()=>false);
const fail=(text,status=400)=>Object.assign(new Error(text),{status});
export function validateWav(bytes){
 if(bytes.length<44||bytes.length>2*1024*1024||bytes.toString('ascii',0,4)!=='RIFF'||bytes.toString('ascii',8,12)!=='WAVE')throw fail('รับเฉพาะ WAV PCM 16 kHz mono ไม่เกิน 60 วินาที');
 let format=false,data=false;
 for(let at=12;at+8<=bytes.length;){const name=bytes.toString('ascii',at,at+4),size=bytes.readUInt32LE(at+4),start=at+8;if(start+size>bytes.length)throw fail('ไฟล์เสียงไม่ครบ');
  if(name==='fmt '){if(size<16||bytes.readUInt16LE(start)!==1||bytes.readUInt16LE(start+2)!==1||bytes.readUInt32LE(start+4)!==16000||bytes.readUInt16LE(start+14)!==16)throw fail('เสียงต้องเป็น PCM 16 bit / 16 kHz / mono');format=true;}
  if(name==='data'){if(size<3200||size>1920000)throw fail('เสียงต้องยาว 0.1–60 วินาที');data=true;}at=start+size+(size%2);
 }
 if(!format||!data)throw fail('ไม่มีข้อมูลเสียงใน WAV');
}
export async function runVoiceProcess(exe,args,{cwd,signal,timeout=240000}={}){
 signal?.throwIfAborted();
 return new Promise((resolve,reject)=>{
  const child=spawn(exe,args,{cwd,windowsHide:true,shell:false,stdio:['ignore','pipe','pipe'],env:{...process.env,PYTHONUTF8:'1',HF_HUB_OFFLINE:'1',TRANSFORMERS_OFFLINE:'1'}});
  child.stdout.setEncoding('utf8');child.stderr.setEncoding('utf8');
  let stdout='',stderr='',aborted=false,timedOut=false;
  child.stdout.on('data',d=>{stdout=(stdout+d.toString('utf8')).slice(-16000)});child.stderr.on('data',d=>{stderr=(stderr+d.toString('utf8')).slice(-4000)});
  const stop=()=>{aborted=true;child.kill()};signal?.addEventListener('abort',stop,{once:true});
  const timer=setTimeout(()=>{timedOut=true;child.kill()},timeout);
  const clean=()=>{clearTimeout(timer);signal?.removeEventListener('abort',stop)};
  child.once('error',e=>{clean();reject(e)});
  child.once('close',code=>{clean();if(aborted)return reject(new DOMException('ยกเลิกเสียงแล้ว','AbortError'));if(timedOut)return reject(fail('งานเสียงใช้เวลานานเกินกำหนด กรุณาลองข้อความสั้นลง',504));if(code!==0)return reject(fail('โปรแกรมเสียงทำงานไม่สำเร็จ: '+stderr.slice(-1000),502));resolve({stdout,stderr})});
  if(signal?.aborted)stop();
 });
}
async function findWhisper(dir){
 for(const e of await fs.readdir(dir,{withFileTypes:true}).catch(()=>[])){
  const file=path.join(dir,e.name);if(e.isFile()&&e.name.toLowerCase()==='whisper-cli.exe')return file;
  if(e.isDirectory()){const found=await findWhisper(file);if(found)return found;}
 }
 return null;
}
// Public CPU voices; private reference recordings are never shipped.
function readEngines(file){try{const v=JSON.parse(readFileSync(file,'utf8'));return {tts:'windows',stt:v.stt==='multi'?'multi':'th',resident:false}}catch{return {tts:'windows',stt:'multi',resident:false}}}
export class VoiceService{
 constructor(comfy,models,options={}){this.comfy=comfy;this.models=models;this.lifecycle=row=>this.logLifecycle(row);this.sttDir=process.env.LUMICOS_STT_DIR||'C:/AI/whisper-th';this.sttBackend=options.sttBackend??process.env.LUMICOS_STT_BACKEND??'legacy-cli';this.ttsBackend='local-cpu';this.whisperRocmExe=options.whisperRocmExe??process.env.LUMICOS_WHISPER_ROCM_EXE??'C:/AI/whisper-rocm/build-rocm100/bin/whisper-server.exe';this.whisperModelThai=options.whisperModel??process.env.LUMICOS_WHISPER_MODEL??path.join(this.sttDir,'models/thonburian-medium-q5_0.bin');this.whisperModelMulti=options.whisperModelMulti??process.env.LUMICOS_WHISPER_MULTI_MODEL??path.join(this.sttDir,'models/ggml-large-v3-turbo-q5_0.bin');this.engineFile=options.engineFile??(models?.dir?path.join(models.dir,'voice-engines.json'):null);this.engines=readEngines(this.engineFile);if(models&&this.engines.resident){models.lazyVision=true;if(models.store)models.store.voiceResident=true;}this.whisperPort=Number(options.whisperPort??process.env.LUMICOS_WHISPER_ROCM_PORT??8178);this.whisperRocmEnv=options.whisperRocmEnv??whisperRocmEnvironment();this.whisperWorkerFactory=options.whisperWorkerFactory??(()=>new WhisperWorker());this.omniWorker=options.omniTts??new LocalTtsClient({engine:this.engines.tts});}

 async logLifecycle(row){try{const dir=this.comfy?.config?.dataDir;if(!dir)return;await fs.mkdir(path.join(dir,'logs'),{recursive:true});await fs.appendFile(path.join(dir,'logs','voice-lifecycle.jsonl'),JSON.stringify({at:new Date().toISOString(),...row})+'\n')}catch{}}
 /** CPU TTS adapter shared by read-aloud and calls. */
 get worker(){return this.omniWorker}
 set worker(value){this.omniWorker=value}
 get whisperModel(){return this.engines.stt==='multi'?this.whisperModelMulti:this.whisperModelThai}
 get sttLanguage(){return this.engines.stt==='multi'?'auto':'th'}
 async omniStatus(){return this.worker.status()}
 async engineStatus(){
  return {tts:this.engines.tts,stt:this.engines.stt,resident:this.engines.resident,options:{tts:{windows:{...await this.worker.status('windows'),label:'Microsoft Pattara'}},
   stt:{th:{ready:await exists(this.whisperModelThai),label:'ไทย (Thonburian)'},multi:{ready:await exists(this.whisperModelMulti),label:'หลายภาษา (large-v3-turbo)',reason:await exists(this.whisperModelMulti)?null:'ยังไม่ได้ดาวน์โหลดโมเดล ให้รัน C:\\AI\\whisper-th\\DOWNLOAD-MULTILINGUAL.bat'}}}};
 }
 async setEngines(next={}){
  if(this.call||this.callStarting||this.callEnding)throw fail('วางสายก่อนเปลี่ยนเสียงหรือภาษา',409);
  const tts=next.tts??this.engines.tts,stt=next.stt??this.engines.stt,resident=false;
  if(tts!=='windows')throw fail('Invalid TTS engine');
  if(!['th','multi'].includes(stt))throw fail('ตัวเลือกเสียงไม่ถูกต้อง');
  {const s=await this.worker.status(tts);if(!s.ready)throw fail(s.reason,503)}
  if(next.stt!==undefined&&stt==='multi'&&!await exists(this.whisperModelMulti))throw fail('ยังไม่ได้ดาวน์โหลด Whisper หลายภาษา ให้รัน C:\\AI\\whisper-th\\DOWNLOAD-MULTILINGUAL.bat',503);
    this.worker.kill();this.worker.engine=tts;this.worker.selected=null;this.engines={tts,stt,resident};if(!resident)this.scheduleRelease();this.models?.setLazyVision?.(resident);
  if(this.engineFile){await fs.mkdir(path.dirname(this.engineFile),{recursive:true});await fs.writeFile(this.engineFile,JSON.stringify(this.engines,null,1))}
  return this.engineStatus();
 }
 async preload(){if((await this.status()).tts.ready)await this.worker.preload();}
 async preloadCpu(){if(this.engines.resident)return;try{if((await this.status()).tts.ready)await this.worker.preload()}catch(e){console.warn('[voice] CPU preload unavailable: '+(e?.message??e))}}
 async releaseGpu(){clearTimeout(this.idle);try{await this.worker.release()}catch(e){await this.logLifecycle({event:'health_fail',engine:this.engines.tts,operation:'releaseGpu',error:e?.message??String(e)});throw e}}
 close(){clearTimeout(this.callTimer);this.call?.controller.abort();this.call?.whisper.kill();clearTimeout(this.idle);this.worker.kill();this.fastWorker?.kill();}
 async fastStatus(){return {ready:false,label:'Public CPU voices',reason:'Use Microsoft Pattara.'}}
 async speakFast(input,signal,onAudio){
  if(typeof input!=='string'||!input.trim()||input.length>1500)throw fail('ใส่ข้อความ 1–1,500 ตัวอักษร');
  if(!(await this.fastStatus()).ready)throw fail('Vachana ยังไม่พร้อม',503);
  if(this.fastBusy)throw fail('เสียงสนทนากำลังทำงาน กรุณาลองใหม่',409);
  this.fastBusy=true;const started=Date.now();let firstAudioMs;
  try{
   this.fastWorker??=new F5Worker(this.fastDir,'vachana_worker.py');
   const metrics=await this.fastWorker.request({action:'speak',text:input},signal,event=>{firstAudioMs??=Date.now()-started;onAudio(event)});
   return {metrics,elapsedMs:Date.now()-started,firstAudioMs};
  }catch(e){await this.fastWorker?.stop();throw e}finally{this.fastBusy=false}
 }
 /** Chat is about to wake Gemma: free the voice model unless the user keeps it resident. */
 /** data/logs/vram.jsonl: device-wide free VRAM (from the voice service) and whether Gemma is awake. */
 async logVram(event,elapsedMs){
  try{
   const dir=this.comfy?.config?.dataDir;if(!dir||typeof this.worker?.health!=='function')return;
   const h=await this.worker.health(AbortSignal.timeout(2000)).catch(()=>null);
   const props=await fetch((this.comfy?.llama??'http://127.0.0.1:8080')+'/props',{signal:AbortSignal.timeout(2000)}).then(r=>r.json()).catch(()=>null);
   const row={at:new Date().toISOString(),event,elapsedMs,resident:this.engines.resident,tts:this.engines.tts,
    vram_free_gib:h?.vram_free_gib??null,vram_total_gib:h?.vram_total_gib??null,voice_model_gib:h?.vram_model_gib??null,
    gemma:props?(props.is_sleeping===true?'sleeping':'awake'):'stopped',gemma_vision:this.models?.manager?.state?.visionLoaded??null};
   await fs.mkdir(path.join(dir,'logs'),{recursive:true});await fs.appendFile(path.join(dir,'logs','vram.jsonl'),JSON.stringify(row)+'\n');
  }catch{}
 }
 /** Resident mode: load the voice model in the background at startup so the first read-aloud is fast. */
 async warmResident(){if(!this.engines.resident||this.call||this.callStarting)return;let release;try{release=await this.comfy.compute.acquire();{const t=Date.now();await this.worker.preload();console.log(`[voice] resident ${this.engines.tts} preloaded in ${Math.round((Date.now()-t)/1000)}s`);void this.logVram('preload',Date.now()-t)}}catch(e){console.log('[voice] resident preload skipped: '+(e?.message??e))}finally{release?.()}}
 async releaseForChat(){if(this.engines.resident||this.call)return;await this.releaseGpu()}
 scheduleRelease(){if(this.call||this.engines.resident)return;clearTimeout(this.idle);this.idle=setTimeout(async()=>{let release;try{release=await this.comfy.compute.acquire();await this.worker.release()}catch(e){await this.logLifecycle({event:'health_fail',engine:this.engines.tts,operation:'scheduled-release',error:e?.message??String(e)});}finally{release?.()}},90000);this.idle.unref();}
 async status(){
  const sttOn=process.env.LUMICOS_STT!=='off',ttsOn=process.env.LUMICOS_TTS!=='off';
  const exe=process.env.LUMICOS_WHISPER_EXE||await findWhisper(path.join(this.sttDir,'bin'));
  this.whisper=sttOn&&exe&&await exists(exe)?exe:null;
  const model=await exists(this.whisperModel),rocmStt=this.sttBackend==='rocm-whisper';
  if(rocmStt)this.whisper=sttOn&&await exists(this.whisperRocmExe)?this.whisperRocmExe:null;
  let rocmTtsReady=false,rocmTtsReason=null;
  if(!ttsOn){rocmTtsReason='ปิด TTS ตอนติดตั้ง / TTS declined at install'}
  else {try{const s=await this.omniStatus();rocmTtsReady=s.ready&&await this.worker.available();if(!rocmTtsReady)rocmTtsReason=s.reason??'ระบบเสียง CPU ยังไม่พร้อม'}catch(e){rocmTtsReason=e.message}}
  const sttReason=!sttOn?'ปิด STT ตอนติดตั้ง / STT declined at install':!this.whisper?`ยังไม่พบ ${rocmStt?'whisper-server ROCm':'whisper-cli.exe'}`:!model?'ยังไม่พบโมเดล Thonburian Whisper':null;
  return {tts:{ready:rocmTtsReady,label:'Lumicos · Microsoft Pattara · CPU',reason:rocmTtsReason},stt:{ready:!!sttOn&&!!this.whisper&&model,label:(this.engines.stt==='multi'?'Whisper หลายภาษา':'Whisper ภาษาไทย')+(rocmStt?' · ROCm':''),reason:sttReason},features:{stt:sttOn,tts:ttsOn}};
 }
 async startCall(signal){
  if(process.env.LUMICOS_STT==='off'||process.env.LUMICOS_TTS==='off')throw fail('โทรคุยต้องการทั้ง STT และ TTS — ถูกปิดตอนติดตั้ง',503);
  if(this.call||this.callStarting||this.callEnding||this.models.pendingChats)throw fail('มีสายโทรหรืองานแชทกำลังทำงานอยู่',409);
  this.callStarting=true;
  const session={id:randomUUID(),controller:new AbortController(),whisper:this.whisperWorkerFactory(),ready:false,busy:false};
  const abort=()=>session.controller.abort();signal.addEventListener('abort',abort,{once:true});
  try{
   // A background agent step (server/agent) gives the model back first; callStarting keeps it waiting until the call is up.
   try{await this.models.yieldBackground?.()}catch{}
   signal.throwIfAborted();await this.models.ready;
   if(!this.models.callModelId)throw fail('ไม่พบ Gemma E2B สำหรับโทรคุย');
   await this.status();
   const exe=this.sttBackend==='rocm-whisper'?this.whisperRocmExe:path.join(path.dirname(this.whisper||''),'whisper-server.exe');
   if(!await exists(exe))throw fail('ไม่พบ whisper-server.exe สำหรับเก็บโมเดลบน GPU');
   clearTimeout(this.idle);
   this.models.store.callResident=true;
   session.release=await this.models.switch(this.models.callModelId,{force:true,holdGpu:true});session.modelPrepared=true;
   session.controller.signal.throwIfAborted();
   this.call=session;this.models.callSession=session.id;
   await this.models.releaseComfy();
   await session.whisper.start(exe,this.whisperModel,session.controller.signal,this.sttBackend==='rocm-whisper'?{port:this.whisperPort,env:this.whisperRocmEnv,language:this.sttLanguage}:{language:this.sttLanguage,...(process.env.LUMICOS_WHISPER_CPU==='1'?{backendPattern:/CPU|AVX|threads|n_threads/i}:{})});
   assertF5RocmCallSafe(this.models);await this.worker.preload(session.controller.signal);
   session.controller.signal.throwIfAborted();session.ready=true;this.touchCall(session.id);
   return {id:session.id,devices:{stt:process.env.LUMICOS_WHISPER_CPU==='1'?'CPU':process.env.LUMICOS_WHISPER_BACKEND,llm:process.env.LUMICOS_GPU_BACKEND,tts:'CPU'}};
  }catch(e){
   this.call??=session;await this.endCall(session.id);throw e;
  }finally{signal.removeEventListener('abort',abort);this.callStarting=false}
 }
 touchCall(id){
  if(!this.call||this.call.id!==id||!this.call.ready)throw fail('สายโทรหมดอายุ กรุณาโทรใหม่',409);
  clearTimeout(this.callTimer);this.callTimer=setTimeout(()=>{void this.endCall(id).catch(console.error)},90000);this.callTimer.unref();
 }
 async endCall(id){
  const session=this.call;if(!session||session.id!==id)return;
  if(this.callEnding)return this.callEnding;
  this.callEnding=(async()=>{
   clearTimeout(this.callTimer);session.ready=false;session.controller.abort();
   try{
    await session.whisper.stop();if(session.modelPrepared)await this.worker.stop();
    // Stop the resident E2B before releasing the GPU reservation to queued image work.
    if(session.modelPrepared){
     this.models.busy=true;
     try{
      if(this.models.manager.child)await this.models.manager.stop();
      this.models.store.callResident=false;
      await this.models.store.select(this.models.store.get().primaryId);
      await this.models.manager.start({reason:'restore primary after call',withVision:!this.models.lazyVision});
     }catch(e){throw fail('วางสายแล้ว แต่เปิด E4B กลับไม่สำเร็จ: '+e.message,503)}
     finally{this.models.busy=false}
    }
   }finally{
    this.models.store.callResident=false;this.models.callSession=false;if(session.modelPrepared)this.models.turns.clear();
    this.call=null;session.release?.();this.onCallEnd?.();
   }
  })();
  try{await this.callEnding}finally{this.callEnding=null}
 }
 async recordCallTiming({id,turn,stage,elapsedMs}){
  if(this.call?.id!==id)throw fail('สายโทรนี้จบแล้ว',409);
  if(!Number.isInteger(turn)||turn<0||!['ready','stt','llm_first_token','llm_done','tts_first_audio','audio_queued','reply_complete','memory_lookup','model_prepare','prompt_prepare','inference_first_text','inference_first_reasoning','inference_complete','backend_generation'].includes(stage)||!Number.isFinite(elapsedMs)||elapsedMs<0||elapsedMs>3600000)throw fail('Invalid timing');
  const dir=path.join(this.models.dir,'logs');await fs.mkdir(dir,{recursive:true});
  await fs.appendFile(path.join(dir,'call-timing.jsonl'),JSON.stringify({at:new Date().toISOString(),id,turn,stage,elapsedMs:Math.round(elapsedMs)})+'\n');
 }
 async callTask(kind,input,signal,onAudio,id){
  const session=this.call;this.touchCall(id);
  if(session.busy)throw fail('งานเสียงในสายยังไม่เสร็จ',409);
  session.busy=true;const started=Date.now();
  const combined=AbortSignal.any([signal,session.controller.signal]);
  try{
   if(kind==='stt'){validateWav(input);const text=await session.whisper.transcribe(input,combined);return {text,elapsedMs:Date.now()-started}}
   if(typeof input!=='string'||!input.trim()||input.length>1500)throw fail('ใส่ข้อความ 1–1,500 ตัวอักษร');
   assertF5RocmCallSafe(this.models);
   let firstAudioMs;const chunks=[];
   const metrics=await this.worker.speak(input,combined,event=>{firstAudioMs??=Date.now()-started;if(onAudio)onAudio({...event,firstAudioMs});else chunks.push(Buffer.from(event.pcm,'base64'))},!!onAudio,{speed:0.92});
   return {audio:onAudio?undefined:pcmWav(Buffer.concat(chunks)),elapsedMs:Date.now()-started,firstAudioMs,metrics};
  }finally{session.busy=false}
 }
 async task(kind,input,signal,onAudio,callId,avatarTest){
  let testOptions;
  if(avatarTest!==undefined){
   if(kind!=='tts'||callId||!avatarTest||!Number.isFinite(avatarTest.speed)||avatarTest.speed<0.75||avatarTest.speed>1)throw fail('Invalid Avatar test voice settings');
   testOptions={nfe:7,speed:avatarTest.speed};
  }
  if(callId)return this.callTask(kind,input,signal,onAudio,callId);
  if(this.call||this.callStarting||this.callEnding)throw fail('กรุณาวางสายก่อนใช้งานเสียงนอกสาย',409);
  const status=await this.status();if(!status[kind].ready)throw fail(status[kind].reason,503);
  if(kind==='tts'&&(typeof input!=='string'||!input.trim()||input.length>1500))throw fail('ใส่ข้อความ 1–1,500 ตัวอักษรต่อครั้ง');
  if(kind==='stt')validateWav(input);
  const release=kind==='tts'?()=>{}:await this.comfy.compute.acquire(signal);let dir;
  const started=Date.now();
  try{
   signal.throwIfAborted();
   clearTimeout(this.idle);
   if(kind==='stt')await this.releaseGpu();
   if(kind!=='tts')await this.models.releaseComfy();
   // Resident mode shares the GPU with an awake Gemma (user's choice); otherwise wait for Gemma to unload.
   if(kind!=='tts')await this.comfy.waitForLlamaSleep({get cancelRequested(){return signal.aborted}});
   signal.throwIfAborted();
   if(kind==='tts'){
    // waitForLlamaSleep above confirmed Gemma has unloaded its weights, so the TTS model may use the GPU.
    // The ROCm voice service is started on demand (and stopped again after 90 s idle).
    await this.worker.preload(signal);
    const chunks=[];let firstAudioMs;
    const metrics=await this.worker.speak(input,signal,event=>{firstAudioMs??=Date.now()-started;if(onAudio)onAudio({...event,firstAudioMs});else chunks.push(Buffer.from(event.pcm,'base64'));},!!onAudio,testOptions);
    this.scheduleRelease();
    void this.logVram('tts',Date.now()-started);
    return {audio:onAudio?undefined:pcmWav(Buffer.concat(chunks)),elapsedMs:Date.now()-started,firstAudioMs,metrics};
   }
   if(this.sttBackend==='rocm-whisper'){
    const worker=this.whisperWorkerFactory();try{await worker.start(this.whisperRocmExe,this.whisperModel,signal,{port:this.whisperPort,env:this.whisperRocmEnv,language:this.sttLanguage});const text=await worker.transcribe(input,signal);return {text,elapsedMs:Date.now()-started}}finally{await worker.stop()}
   }
   dir=await fs.mkdtemp(path.join(tmpdir(),'lumicos-voice-'));
   await fs.writeFile(path.join(dir,'input.wav'),input);
   const result=await runVoiceProcess(this.whisper,['-m',this.whisperModel,'-l',this.sttLanguage,'-f',path.join(dir,'input.wav'),'-nt','-np','-t','6'],{cwd:path.dirname(this.whisper),signal});
   const text=result.stdout.trim();if(!text)throw fail('ไม่ได้ยินคำพูดชัดเจน ลองอัดใหม่');
   return {text,elapsedMs:Date.now()-started};
  }finally{
   if(dir){for(const f of ['text.txt','out.wav','input.wav'])await fs.rm(path.join(dir,f),{force:true}).catch(()=>{});await fs.rmdir(dir).catch(()=>{});}
   release();
  }
 }
}

