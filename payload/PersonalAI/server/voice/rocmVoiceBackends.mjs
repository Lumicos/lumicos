import fs from 'node:fs/promises';
import {pythonLaunch} from '../util/hiddenPython.mjs';
import path from 'node:path';
import {spawn,spawnSync,execFile} from 'node:child_process';
import {promisify} from 'node:util';
const execFileAsync=promisify(execFile);
const fail=(message,status=502)=>Object.assign(new Error(message),{status});

/** ROCm 10.0 builds (whisper-server, llama-server) ship their own HIP/rocBLAS DLLs next to the exe:
 * strip the system HIP SDK 6.2/7.1 variables and PATH entries so nothing older is picked up. */
export function rocm10Environment(base=process.env){
 const clean={...base};for(const key of ['HIP_PATH','HIP_PATH_62','HIP_PATH_71','ROCM_PATH','HIP_PLATFORM','HSA_OVERRIDE_GFX_VERSION','HIP_DEVICE_LIB_PATH'])delete clean[key];
 const segments=String(base.PATH??base.Path??'').split(';').filter(Boolean).filter(item=>!/[\\/]AMD[\\/]ROCm[\\/]/i.test(item));
 delete clean.Path;return {...clean,PATH:segments.join(';')};
}
export function whisperRocmEnvironment(base=process.env){return rocm10Environment(base)}

function loopbackUrl(value,expectedPort){
 const url=new URL(value);
 if(url.protocol!=='http:'||url.hostname!=='127.0.0.1'||Number(url.port)!==expectedPort||url.username||url.password||url.pathname!=='/')throw fail(`ROCm voice endpoint must be http://127.0.0.1:${expectedPort}/`,400);
 return url.origin;
}

function wavPcm(bytes){
 if(bytes.length<44||bytes.toString('ascii',0,4)!=='RIFF'||bytes.toString('ascii',8,12)!=='WAVE')throw fail('F5 ROCm returned invalid WAV');
 let sampleRate=0,pcm=null;
 for(let at=12;at+8<=bytes.length;){const name=bytes.toString('ascii',at,at+4),size=bytes.readUInt32LE(at+4),start=at+8;if(start+size>bytes.length)throw fail('F5 ROCm returned truncated WAV');
  if(name==='fmt '){if(size<16||bytes.readUInt16LE(start)!==1||bytes.readUInt16LE(start+2)!==1||bytes.readUInt16LE(start+14)!==16)throw fail('F5 ROCm WAV must be mono PCM16');sampleRate=bytes.readUInt32LE(start+4);}
  if(name==='data')pcm=bytes.subarray(start,start+size);at=start+size+(size%2);
 }
 if(sampleRate!==24000||!pcm?.length)throw fail('F5 ROCm WAV must be 24 kHz PCM16');
 return {sampleRate,pcm};
}

export function splitForTts(text,max){
 const out=[];let rest=text.replace(/\s+/g,' ').trim();
 while(rest.length>max){
  const window=rest.slice(0,max);
  let cut=Math.max(window.lastIndexOf('. '),window.lastIndexOf('! '),window.lastIndexOf('? '),window.lastIndexOf('。'),window.lastIndexOf('\n'));
  if(cut<max*0.4)cut=window.lastIndexOf(' ');
  if(cut<max*0.4)cut=max-1;
  out.push(rest.slice(0,cut+1).trim());rest=rest.slice(cut+1).trim();
 }
 if(rest)out.push(rest);
 return out;
}

export class RocmF5Client{
 constructor({baseUrl='http://127.0.0.1:8766',port=8766,engine='f5',steps=7,extraEnv={},maxChars=250,sentenceChunkChars,venv='C:/AI/Lumicos-JaiTTS-ROCm/env',fetchImpl=fetch,healthTimeout=1500,synthesisTimeout=30000,startupTimeout=90000,pythonExe='C:/AI/Lumicos-JaiTTS-ROCm/env/Scripts/python.exe',serviceScript='C:/AI/Lumicos-JaiTTS-ROCm/lumicos-rocm-service/rocm_tts_service.py',spawnImpl=spawn,ownershipProbe=probeF5Ownership,lifecycle=()=>{}}={}){this.port=port;this.engine=engine;this.extraEnv=extraEnv;this.steps=steps;this.maxChars=maxChars;this.sentenceChunkChars=Math.min(maxChars,sentenceChunkChars??(engine==='omnivoice'?320:maxChars));this.venv=venv;this.baseUrl=loopbackUrl(baseUrl,port);this.fetch=fetchImpl;this.healthTimeout=healthTimeout;this.synthesisTimeout=synthesisTimeout;this.startupTimeout=startupTimeout;this.pythonExe=pythonExe;this.serviceScript=serviceScript;this.spawn=spawnImpl;this.ownershipProbe=ownershipProbe;this.lifecycle=lifecycle;this.child=null;this.identity=null;this.ready=null;this.stderrTail='';}
 trace(event,detail={}){try{void this.lifecycle({event,engine:this.engine,port:this.port,pid:this.child?.pid??null,...detail})}catch{}}
 async available(){return (await Promise.all([this.pythonExe,this.serviceScript].map(p=>fs.access(p).then(()=>true,()=>false)))).every(Boolean)}
 async health(signal){const timeout=AbortSignal.timeout(this.healthTimeout),combined=signal?AbortSignal.any([signal,timeout]):timeout;const response=await this.fetch(this.baseUrl+'/health',{signal:combined});if(!response.ok)throw fail('F5 ROCm health check failed: '+response.status,503);const body=await response.json();if(body.ready!==true||body.backend!==(process.env.LUMICOS_GPU_BACKEND||'rocm')||(this.engine==='f5'&&body.steps!==this.steps)||(this.engine!=='f5'&&body.engine!==this.engine))throw fail(this.engine+' ROCm health contract mismatch',503);return body;}
 async control(pathname,signal){const timeout=AbortSignal.timeout(this.startupTimeout),combined=signal?AbortSignal.any([signal,timeout]):timeout;const response=await this.fetch(this.baseUrl+pathname,{method:'POST',headers:{'Content-Type':'application/json'},body:'{}',signal:combined});if(!response.ok)throw fail(`${this.engine} ROCm ${pathname.slice(1)} failed: ${response.status}`,503);const body=await response.json();if(body.ready!==true||body.engine!==this.engine||typeof body.on_gpu!=='boolean')throw fail(`${this.engine} ROCm ${pathname.slice(1)} contract mismatch`,503);return body;}
 startupError(message){const tail=this.stderrTail.trim();return fail(tail?`${message}: ${tail.slice(-1536)}`:message,503)}
 /** Long read-aloud text is split at sentence/space boundaries and spoken piece by piece. */
 async speak(text,signal,onAudio,_stream,options){
  if(typeof text!=='string'||!text.trim())throw fail(`${this.engine} ROCm needs text`,400);
  if(options?.speed!==undefined&&(!Number.isFinite(options.speed)||options.speed<0.75||options.speed>1.25))throw fail('Invalid speaking speed',400);
  // OmniVoice accepts a much larger request, but a bounded sentence-sized first
  // request lets the UI start playback while the remaining text is synthesized.
  const pieces=splitForTts(text.trim(),this.sentenceChunkChars);
  if(pieces.length===1)return this.speakOne(pieces[0],signal,onAudio,options);
  let inference=0,audio=0;
  for(const piece of pieces){const m=await this.speakOne(piece,signal,onAudio,options);inference+=m.inferenceSeconds??0;audio+=m.audioSeconds??0}
  return {backend:(process.env.LUMICOS_GPU_BACKEND||'rocm'),engine:this.engine,steps:this.steps,pieces:pieces.length,inferenceSeconds:inference||null,audioSeconds:audio||null};
 }
 async speakOne(text,signal,onAudio,options){
  if(typeof text!=='string'||!text.trim()||text.length>this.maxChars)throw fail(`${this.engine} ROCm accepts text 1–${this.maxChars} characters`,400);
  signal?.throwIfAborted();const timeout=AbortSignal.timeout(this.synthesisTimeout),combined=signal?AbortSignal.any([signal,timeout]):timeout;
  const response=await this.fetch(this.baseUrl+'/synthesize',{method:'POST',headers:{'Content-Type':'application/json; charset=utf-8'},body:JSON.stringify({text:text.trim(),...(this.engine==='omnivoice'&&options?.speed!==undefined?{speed:options.speed}:{})}),signal:combined});
  if(!response.ok)throw fail(response.status===503?'F5 ROCm is busy':'F5 ROCm synthesis failed: '+response.status,response.status===503?503:502);
  if(!/^audio\/wav(?:;|$)/i.test(response.headers.get('content-type')??''))throw fail('F5 ROCm returned unexpected content type');
  const bytes=Buffer.from(await response.arrayBuffer()),{sampleRate,pcm}=wavPcm(bytes);
  onAudio?.({type:'audio',pcm:pcm.toString('base64'),sampleRate});
  return {backend:(process.env.LUMICOS_GPU_BACKEND||'rocm'),engine:this.engine,steps:this.steps,inferenceSeconds:Number(response.headers.get('x-tts-inference-seconds'))||null,audioSeconds:Number(response.headers.get('x-tts-audio-seconds'))||null};
 }
 async preload(signal){
  if(this.engine==='omnivoice'&&this.child){const health=await this.health(signal);if(health.on_gpu===false){this.trace('onload');const result=await this.control('/onload',signal);this.trace('ready',{onGpu:result.on_gpu});return result}return health}
  if(this.ready)return this.ready;
  this.ready=(async()=>{
   signal?.throwIfAborted();
   try{await this.health(signal);throw fail(`${this.engine} ROCm port ${this.port} is already owned by an external process`,409)}catch(e){if(e?.status===409)throw e}
   if(!await this.available())throw fail('F5 ROCm known-good service files are unavailable',503);
   // OmniVoice temporarily uses the known-good venv launcher. Its long-lived child/process
   // ownership is more important than hiding a console until pythonLaunch is proven stable here.
   const launch=this.engine==='omnivoice'?{command:this.pythonExe,env:{}}:pythonLaunch(this.pythonExe);
   const child=this.spawn(launch.command,['-u',this.serviceScript],{cwd:path.dirname(this.serviceScript),windowsHide:true,shell:false,stdio:['ignore','ignore','pipe'],env:{...f5RocmEnvironment(process.env,this.venv),...this.extraEnv,...launch.env}});
   this.child=child;this.stderrTail='';this.trace('spawn',{command:launch.command,venvLauncher:launch.env.__PYVENV_LAUNCHER__??null});child.stderr?.on('data',chunk=>{this.stderrTail=(this.stderrTail+String(chunk)).slice(-1536)});
   child.once('exit',(code,signalName)=>this.trace('exit',{pid:child.pid,code,signal:signalName,stderrTail:this.stderrTail.slice(-1536)}));
   const deadline=Date.now()+this.startupTimeout;
   while(Date.now()<deadline){
    signal?.throwIfAborted();if(child.exitCode!==null)throw this.startupError('F5 ROCm service exited during startup');
    try{const health=await this.health(signal);const identity=await this.ownershipProbe(child.pid,this.port);validateF5Ownership(identity,child.pid,this.port);this.identity=identity;this.trace('ready',{onGpu:health.on_gpu??null,listenerPid:identity.listener.pid});return health}catch(e){if(e?.status===409)throw e;await new Promise(r=>setTimeout(r,250))}
   }
   const error=this.startupError('F5 ROCm service did not become ready in time');error.status=504;throw error;
  })().catch(async e=>{await this.stop();throw e});
  return this.ready;
 }
 /** Free the GPU between read-aloud uses (a call keeps its own session and never calls this). */
 async release(){if(!this.child)return;if(this.engine!=='omnivoice'){this.trace('release',{action:'stop'});return this.stop('release-non-omnivoice')}
  // During startup OmniVoice is loading on CPU only. A chat may arrive before /health is ready;
  // there is no GPU model to offload yet, so do not fail the chat or kill the preload process.
  try{
   const health=await this.health();
   if(health.on_gpu===false){this.ready=null;this.trace('release',{onGpu:false,action:'already-cpu'});return health}
  }catch(error){
   if(this.ready&&this.child?.exitCode==null){this.trace('release',{onGpu:false,action:'cpu-preload-in-progress'});return {ready:false,engine:this.engine,on_gpu:false,deferred:true}}
   this.trace('health_fail',{operation:'release-health',error:error?.message??String(error)});
  }
  let lastError;
  for(let attempt=1;attempt<=3;attempt++)try{this.trace('offload',{attempt});const result=await this.control('/offload');if(result.on_gpu!==false)throw fail('OmniVoice offload did not release the model from GPU',503);this.ready=null;this.trace('release',{onGpu:false,attempt});return result}catch(error){lastError=error;this.trace('health_fail',{operation:'offload',attempt,error:error?.message??String(error)});if(attempt<3)await new Promise(r=>setTimeout(r,400*attempt))}
  // A transient health/control failure must not kill the CPU-resident process. The caller can
  // retry; an observed child exit is recorded separately by the lifecycle trace.
  throw lastError;
 }
 async stop(reason='requested'){const child=this.child,identity=this.identity;this.trace('stop',{reason});this.child=null;this.identity=null;this.ready=null;if(!child?.pid)return;if(identity){const current=await this.ownershipProbe(child.pid,this.port).catch(()=>null);if(!current||current.launcher?.creationDate!==identity.launcher.creationDate)throw fail('Refusing to stop F5 ROCm: launcher identity changed',409)}stopTree(child);}
 kill(){this.trace('stop',{reason:'kill'});if(this.child?.pid&&this.identity)stopTree(this.child);this.child=null;this.identity=null;this.ready=null;}
}

export function f5RocmEnvironment(base=process.env,venv='C:/AI/Lumicos-JaiTTS-ROCm/env'){
 const clean={...base};for(const key of ['HIP_PATH','HIP_PATH_62','HIP_PATH_71','ROCM_PATH','HIP_PLATFORM','HSA_OVERRIDE_GFX_VERSION'])delete clean[key];
 const site=path.join(venv,'Lib/site-packages'),segments=String(base.PATH??base.Path??'').split(';').filter(Boolean).filter(p=>!/[\\/]AMD[\\/]ROCm[\\/]/i.test(p));
 return {...clean,PATH:[path.join(venv,'Scripts'),path.join(site,'_rocm_sdk_core/bin'),path.join(site,'_rocm_sdk_libraries/bin'),...segments].join(';'),PYTHONUTF8:'1',PYTHONIOENCODING:'utf-8'};
}

export function validateF5Ownership(value,launcherPid,port=8766){
 if(!value?.launcher||value.launcher.pid!==launcherPid||!value.launcher.creationDate||!value.listener?.creationDate||value.listener.port!==port||value.listener.address!=='127.0.0.1'||!value.listener.descendsFromLauncher)throw fail('F5 ROCm listener ownership could not be verified',409);
 return value;
}

async function probeF5Ownership(launcherPid,port=8766){
 const script=`$l=Get-CimInstance Win32_Process -Filter \"ProcessId=${launcherPid}\" -ErrorAction Stop;$c=Get-NetTCPConnection -LocalPort ${Number(port)} -State Listen -ErrorAction Stop|Select-Object -First 1;$p=Get-CimInstance Win32_Process -Filter \"ProcessId=$($c.OwningProcess)\" -ErrorAction Stop;$x=$p;$d=$false;for($i=0;$i -lt 8 -and $x;$i++){if($x.ProcessId -eq ${launcherPid}){$d=$true;break};$x=Get-CimInstance Win32_Process -Filter \"ProcessId=$($x.ParentProcessId)\" -ErrorAction SilentlyContinue};[pscustomobject]@{launcher=[pscustomobject]@{pid=[int]$l.ProcessId;creationDate=[string]$l.CreationDate};listener=[pscustomobject]@{pid=[int]$p.ProcessId;creationDate=[string]$p.CreationDate;port=${Number(port)};address=[string]$c.LocalAddress;descendsFromLauncher=$d}}|ConvertTo-Json -Compress -Depth 4`;
 const {stdout}=await execFileAsync('powershell.exe',['-NoProfile','-NonInteractive','-Command',script],{windowsHide:true,timeout:5000});return JSON.parse(stdout);
}
function stopTree(child){if(!child?.pid||child.exitCode!==null||child.signalCode!==null)return;if(process.platform==='win32')spawnSync('taskkill.exe',['/PID',String(child.pid),'/T','/F'],{windowsHide:true,stdio:'ignore',timeout:10000});else child.kill();}

export function assertF5RocmGpuSafe(models){
 const child=models?.manager?.child,state=models?.manager?.state;
 const owned=!!child&&child.exitCode===null&&child.signalCode===null;
 if(owned||!['stopped','failed'].includes(state?.phase))throw fail('F5 ROCm requires Gemma to be fully stopped; GPU co-residency is not approved',409);
}

export function assertF5RocmCallSafe(models){
 const manager=models?.manager,child=manager?.child,state=manager?.state;
 const owned=!!child&&child.exitCode===null&&child.signalCode===null;
 const callId=models?.callModelId;
 if(!owned||state?.phase!=='running'||!callId||state?.model?.id!==callId||models?.callSession===false)throw fail('F5 ROCm call requires the Model Manager-owned E2B call model and an active call session',409);
}
