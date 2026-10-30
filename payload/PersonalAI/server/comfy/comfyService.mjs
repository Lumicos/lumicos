import fs from 'node:fs/promises';
import fsSync from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
import { saveInput, readInput, editGraph } from './imageInput.mjs';
import { ensureComfy,stopOwnedComfy } from '../../scripts/runtime.mjs';
import {upscaleGraph,installedUpscaler,retainGenerationGraph} from './upscale.mjs';
import {normalizeEdit,maskCoverage,planGeometry,renderEditInputs,editEditGraph,editPatchInstalled,EDIT_PATCH_FILE} from './imageEdit.mjs';
import {PIXEL_BUDGETS,routeImage,loadImageGraph,imageProfiles,BACKENDS,nativeResolution,requestedQuality,pickDefaultBackend,primaryImageBackendId} from './imageProfiles.mjs';
import {requestedAspectDimensions} from './imageAspect.mjs';
import {fluxEditGraph,fluxEditInstruction,fluxEditInstalled,fluxMergeInstruction,fluxRefInstruction,fluxMergeOrder,fluxMergeSize,fluxMergeRefMegapixels,FLUX_MERGE_LIMITS,FLUX_REF_LIMITS} from './fluxEdit.mjs';
import {normalizeImageSeed} from './imageSeed.mjs';

const error = (message, status = 400) => Object.assign(new Error(message), { status });
/** Resizes a photo to about `megapixels` (aspect kept) and encodes JPEG q92; ~65 ms for 1536x2048 with the
 *  already-installed @napi-rs/canvas. Used so huge inputs never reach the GPU at full size. */
async function shrinkForComfy(bytes,megapixels){
  const {loadImage,createCanvas}=await import('@napi-rs/canvas');
  const img=await loadImage(bytes);
  const scale=Math.min(1,Math.sqrt(megapixels*1048576/(img.width*img.height)));
  const canvas=createCanvas(Math.max(1,Math.round(img.width*scale)),Math.max(1,Math.round(img.height*scale)));
  const ctx=canvas.getContext('2d');ctx.imageSmoothingQuality='high';ctx.drawImage(img,0,0,canvas.width,canvas.height);
  return canvas.toBuffer('image/jpeg',92);
}
export function comfyAutoStart(config, env = process.env) {
  const base = localUrl(config.comfyUrl ?? 'http://127.0.0.1:8188');
  return base === 'http://127.0.0.1:8188' && (env.LUMICOS_AUTO_COMFY === '1' || (env.LUMICOS_AUTO_COMFY !== '0' && config.autoStartComfy !== false));
}
export function localUrl(value) {
  const u = new URL(value);
  if (u.protocol !== 'http:' || !['127.0.0.1', 'localhost', '[::1]'].includes(u.hostname) || u.username || u.password || u.search || u.hash) throw error('Only a localhost HTTP service is supported.');
  return u.href.replace(/\/$/, '');
}

/** A single GPU lane shared by chat inference and image generation. */
export class ComputeQueue {
  constructor() { this.tail = Promise.resolve(); this.waiting = 0; this.active = 0; }
  async acquire(signal) {
    if (this.waiting >= 20) throw error('The GPU queue is full. Try again later.', 429);
    this.waiting++;
    const previous = this.tail;
    let release;
    this.tail = new Promise(r => { release = r; });
    await previous;
    this.waiting--;
    if (signal?.aborted) { release(); throw signal.reason; }
    this.active++;
    let released=false;
    return () => { if(released)return; released=true;this.active--;release(); };
  }
}

export class ComfyService {
  constructor(config) {
    this.config = config;
    this.base = localUrl(config.comfyUrl ?? 'http://127.0.0.1:8188');
    this.llama = localUrl(config.llamaUrl ?? 'http://127.0.0.1:8080');
    this.autoStartComfy = comfyAutoStart(config);
    this.dir = path.join(config.dataDir, 'generated-images');
    this.inputDir = path.join(config.dataDir, 'image-inputs');
    this.jobs = new Map();
    this.keepImageCache=config.keepImageCache===true;
    this.imageCacheResident=this.keepImageCache;
    // ComfyUI can displace a sleeping ROCm llama process from the GPU even
    // after its own allocator has been released. Track that handoff
    // independently from ComfyUI cache residency so the next chat can reload
    // the manager-owned llama process onto the GPU.
    this.llamaNeedsGpuRestore=false;
    this.preferences={backend:'auto',quality:'normal'};
    this.compute = new ComputeQueue();
    this.ready = this.initialize();
    this.ready.catch(e=>{this.blocked=e.message;});
  }
  async initialize() {
    await fs.mkdir(this.dir,{recursive:true});
    // Populate auto-detected image backends before restoring a saved dynamic selection.
    await imageProfiles();
    // No saved choice yet: the primary model is the default when it is installed.
    if(BACKENDS[primaryImageBackendId()])this.preferences={...this.preferences,backend:primaryImageBackendId()};
    try{const p=JSON.parse(await fs.readFile(path.join(this.dir,'preferences.json'),'utf8'));if(p.backend==='qwen-image-2.1-turbo'||p.backend==='z-plus')p.backend='auto';const routed=routeImage(p);this.preferences={backend:routed.backend,quality:routed.quality};}catch(e){if(e.code!=='ENOENT')console.warn('[image preferences]',e.message);}
    const marker=path.join(this.dir,'recovery.txt');
    try {this.blocked=await fs.readFile(marker,'utf8');} catch(e) {if(e.code!=='ENOENT') throw e;}
    for(const name of await fs.readdir(this.dir)) {
      if(!/^[a-f0-9-]{36}\.json$/.test(name)) continue;
      const job=JSON.parse(await fs.readFile(path.join(this.dir,name),'utf8'));
      if(!['done','failed','cancelled'].includes(job.status)) {
        this.blocked='บริการรีสตาร์ตระหว่างสร้างภาพ กรุณารอ ComfyUI จบงานแล้วกดคืน GPU';
        await fs.writeFile(marker,this.blocked);
        job.status='failed';job.error=this.blocked;await this.save(job);
      }
    }
  }
  async api(route, body) {
    let r;
    try { r = await fetch(this.base + route, {method:body === undefined ? 'GET' : 'POST', headers:{'Content-Type':'application/json'}, body:body === undefined ? undefined : JSON.stringify(body), signal:AbortSignal.timeout(15000)}); }
    catch { throw error('ComfyUI is not responding. Open ComfyUI on port 8188 and try again.', 503); }
    const text = await r.text();
    let data; try { data = text ? JSON.parse(text) : {}; } catch { throw error('ComfyUI returned an invalid response.', 502); }
    if (!r.ok) throw error(data.error?.message ?? JSON.stringify(data).slice(0,700), 502);
    return data;
  }
  async releaseMemory({preserveCache=false}={}){
    const started=Date.now();const queue=await this.api('/queue');
    if(queue.queue_running?.length||queue.queue_pending?.length)throw error('ComfyUI has active work; GPU handoff deferred.',409);
    await this.api('/free',{unload_models:true,free_memory:!preserveCache});
    // Cleanup is processed by the worker after this acknowledgement.
    await delay(250);
    // /free only acknowledges queued cleanup. Wait for this process's allocator,
    // not zero driver VRAM: a small retained CUDA context is expected.
    const deadline=started+30000;let device;
    while(Date.now()<deadline){
      const q=await this.api('/queue');if(q.queue_running?.length||q.queue_pending?.length)throw error('ComfyUI started another job during GPU handoff.',409);
      device=(await this.api('/system_stats')).devices?.[0];
      if(Number.isFinite(device?.torch_vram_total)&&device.torch_vram_total<=256*1024*1024){this.imageCacheResident=false;return this.lastReclamation={waitMs:Date.now()-started,device};}
      await delay(250);
    }
    throw error('ComfyUI GPU allocator has not released image memory after 30 seconds. Retry GPU recovery when ComfyUI is idle.',409);
  }
  async waitForGpuDriverSettle(ms=1500){
    // Port shutdown happens before WDDM/ROCm has necessarily retired the
    // process allocations. Give the driver a short quiet period, then make
    // sure another ComfyUI did not bind the port during the handoff.
    await delay(ms);
    const online=await fetch(this.base+'/system_stats',{signal:AbortSignal.timeout(1000)}).then(r=>r.ok).catch(()=>false);
    if(online)throw error('ComfyUI became available again while restoring the chat model.',409);
    return true;
  }
  async stopOwnedRuntime(){
    if(!stopOwnedComfy())return false;
    const deadline=Date.now()+30000;
    while(Date.now()<deadline){
      try{await fetch(this.base+'/system_stats',{signal:AbortSignal.timeout(1000)});}
      catch{await this.waitForGpuDriverSettle();return true;}
      await delay(250);
    }
    throw error('Lumicos-owned ComfyUI did not stop before restoring the chat model.',409);
  }
  async status() {
    try { await this.ready; const stats = await this.api('/system_stats'); return {online:true,workflow:'Z-Image INT8',profiles:await imageProfiles(),qualityPendingReview:true,device:stats.devices?.[0]?.name,queued:this.compute.waiting,blocked:this.blocked}; }
    catch(e) { return {online:false,workflow:'Z-Image INT8',error:e.message}; }
  }
  async save(job) { await fs.writeFile(path.join(this.dir,job.id+'.json'),JSON.stringify(job,null,2)); }
  async logImageStage(job,stage,detail={}) {
    try {
      const dir=this.config?.dataDir;if(!dir)return;
      await fs.mkdir(path.join(dir,'logs'),{recursive:true});
      await fs.appendFile(path.join(dir,'logs','image-jobs.jsonl'),JSON.stringify({at:new Date().toISOString(),correlationId:job.id,
        ...(job.requestCorrelationId?{requestCorrelationId:job.requestCorrelationId}:{}),...(job.messageId?{messageId:job.messageId}:{}),...(job.parentJobId?{parentJobId:job.parentJobId}:{}),stage,
        backend:job.backend??null,checkpoint:BACKENDS[job.backend]?.label??job.workflow??null,steps:job.steps??null,
        resolution:[job.width,job.height],quality:job.quality??null,status:job.status,...detail})+'\n');
    } catch {}
  }
  async get(id) {
    if (!/^[a-f0-9-]{36}$/.test(id)) throw error('Invalid image job id.');
    if(this.jobs.has(id)) return this.jobs.get(id);
    let job; try {job=JSON.parse(await fs.readFile(path.join(this.dir,id+'.json'),'utf8'));} catch {throw error('Image job not found.',404);}
    if(!['done','failed','cancelled'].includes(job.status)) {job.status='failed';job.error='The service restarted during this job. Check ComfyUI history before trying again.';}
    return job;
  }
  async upload(buf) { return saveInput(this.inputDir,buf); }
  async uploadToComfy(bytes,filename) {
    const body=new FormData();
    body.set('image',new Blob([bytes],{type:'image/png'}),filename);
    body.set('subfolder','Lumicos');
    const uploaded=await fetch(this.base+'/upload/image',{method:'POST',body,signal:AbortSignal.timeout(30000)});
    if(!uploaded.ok) throw error('ส่งภาพต้นฉบับเข้า ComfyUI ไม่สำเร็จ',502);
    const result=await uploaded.json();
    if(typeof result.name!=='string'||result.name.includes('..')||/[\\/]/.test(result.name)) throw error('Invalid ComfyUI upload response.',502);
    return (result.subfolder?result.subfolder+'/':'')+result.name;
  }
  async input(id) { return (await readInput(this.inputDir,id)).bytes; }
  async create({prompt, width, height, seed, inputId, denoise=0.55, originalSize=false,backend,quality,upscale,upscaleTarget,correlationId,messageId,edit,engine,inputIds,lab}={}) {
    if(backend!==undefined&&BACKENDS[backend]?.labOnly&&lab!==true) throw error('โมเดลนี้ใช้ได้เฉพาะใน Image Lab',400);
    if(this.models?.busy) throw error('กำลังสลับโมเดล กรุณารอ',409);
    // Trace links only (root request id → chat message id → this job id); never part of job identity or dedup.
    const traceId=v=>typeof v==='string'&&/^[A-Za-z0-9_-]{1,100}$/.test(v)?v:undefined;
    if((correlationId!==undefined&&!traceId(correlationId))||(messageId!==undefined&&!traceId(messageId))) throw error('Invalid trace id.');
    if(typeof prompt !== 'string' || !prompt.trim() || prompt.length>8000) throw error('Enter an image prompt (up to 8000 characters).');
    if(engine!==undefined&&engine!=='flux3-edit'&&engine!=='flux3-merge'&&engine!=='flux3-ref') throw error('Unknown image engine.');
    if(engine==='flux3-ref'){
      if(!Array.isArray(inputIds)||inputIds.length<FLUX_REF_LIMITS.min||inputIds.length>FLUX_REF_LIMITS.max||inputIds.some(id=>typeof id!=='string')||new Set(inputIds).size!==inputIds.length||inputId!==undefined||edit!==undefined) throw error(`ภาพอ้างอิงต้องมี ${FLUX_REF_LIMITS.min}-${FLUX_REF_LIMITS.max} ภาพ (ไม่ซ้ำกัน)`);
      if(!Number.isInteger(width)||!Number.isInteger(height)||width%16||height%16||width<256||height<256||width*height>1024*1024) throw error('ขนาดภาพที่สร้างไม่ถูกต้อง');
      inputId=inputIds[0];
      for(const id of inputIds) await readInput(this.inputDir,id);
      const installed=await fluxEditInstalled();
      if(!installed.ready) throw error('ยังไม่ได้ติดตั้งไฟล์ Flux 3 Klein: '+installed.missing.join(', '),503);
    }
    if(engine==='flux3-merge'){
      if(!Array.isArray(inputIds)||inputIds.length<FLUX_MERGE_LIMITS.min||inputIds.length>FLUX_MERGE_LIMITS.max||inputIds.some(id=>typeof id!=='string')||new Set(inputIds).size!==inputIds.length||inputId!==undefined||edit!==undefined) throw error(`รวมภาพต้องใช้ภาพ ${FLUX_MERGE_LIMITS.min}-${FLUX_MERGE_LIMITS.max} ภาพ (ไม่ซ้ำกัน)`);
      inputId=inputIds[0];
      for(const id of inputIds) await readInput(this.inputDir,id);
      const installed=await fluxEditInstalled();
      if(!installed.ready) throw error('ยังไม่ได้ติดตั้งไฟล์ Flux 3 Klein: '+installed.missing.join(', '),503);
    }
    if(engine==='flux3-edit'){
      if(inputId===undefined||edit!==undefined) throw error('Flux edit needs one uploaded photo and no mask edit.');
      const installed=await fluxEditInstalled();
      if(!installed.ready) throw error('ยังไม่ได้ติดตั้งไฟล์ Flux 3 Klein: '+installed.missing.join(', '),503);
    }
    const explicitAspect=inputId===undefined?requestedAspectDimensions(prompt):undefined;
    if(explicitAspect)({width,height}=explicitAspect);
    if(width===undefined&&height===undefined){
      if(/16\s*:\s*9|แนวนอน|\blandscape\b/i.test(prompt)){width=1024;height=576;}
      else if(/9\s*:\s*16/.test(prompt)){width=576;height=1024;}
      else if(/1\s*:\s*1|จัตุรัส|\bsquare\b/i.test(prompt)){width=768;height=768;}
      else if(/4\s*:\s*3/.test(prompt)){width=1024;height=768;}
      else{width=768;height=1024;}
    }else{width??=768;height??=1024;}
    if(typeof denoise!=='number'||!Number.isFinite(denoise)||denoise<0.1||denoise>1) throw error('ระดับการเปลี่ยนภาพต้องอยู่ระหว่าง 0.1 ถึง 1');
    if(inputId!==undefined) {
      const {info}=await readInput(this.inputDir,inputId);
      if(originalSize) {
        const scale=Math.min(1,1024/Math.max(info.width,info.height));
        width=Math.max(256,Math.round(info.width*scale/16)*16);
        height=Math.max(256,Math.round(info.height*scale/16)*16);
      }
    }
    let editPlan;
    if(edit!==undefined) {
      if(inputId===undefined) throw error('แก้ภาพต้องแนบภาพต้นฉบับ');
      editPlan=normalizeEdit(edit);
      if(editPlan.maskId){
        const {bytes}=await readInput(this.inputDir,editPlan.maskId);
        const cover=await maskCoverage(bytes);
        if(cover<0.003) throw error('ยังไม่ได้ระบายสีบริเวณที่จะแก้ (หรือระบายน้อยเกินไป)');
        if(cover>0.92) throw error('ระบายเกือบทั้งภาพ ลองระบายเฉพาะส่วนที่จะแก้');
      }
      if(!await editPatchInstalled()) throw error('ยังไม่ได้ติดตั้งโมเดลแก้ภาพ ('+EDIT_PATCH_FILE+') ในโฟลเดอร์ ComfyUI-Next\\models\\model_patches',503);
    }
    if(!editPlan&&![width,height].every(n=>Number.isInteger(n)&&n>=256&&n<=1536&&n%16===0)) throw error('Image dimensions must be multiples of 16, between 256 and 1536.');
    const requestedSeed=seed;
    seed=normalizeImageSeed(seed);
    await this.ready;
    const profiles=await imageProfiles(),available=profiles.filter(p=>p.available);
    // Preferences can outlive an image model that was removed from disk. An
    // implicit request should keep working with an installed backend, while an
    // explicitly requested missing backend must still fail below.
    const preferred=backend??this.preferences.backend;
    const selectedBackend=backend===undefined&&!available.some(p=>p.id===preferred)
      ? pickDefaultBackend(available)??preferred
      : preferred;
    const routing=routeImage({backend:selectedBackend,quality:quality??requestedQuality(prompt)??this.preferences.quality,prompt,inputId});
    const requestedDimensions={width,height};
    if(editPlan){const {info}=await readInput(this.inputDir,inputId);const g=planGeometry(info,editPlan,PIXEL_BUDGETS[routing.quality]);({width,height}=g);}
    else ({width,height}=nativeResolution(routing.quality,width,height));
    const alignment=BACKENDS[routing.backend].alignment;
    if(width%alignment||height%alignment)throw error('Selected image workflow needs dimensions aligned to '+alignment+' pixels.');
    if(upscale!==undefined&&typeof upscale!=='boolean')throw error('Invalid upscale option');
    if(upscaleTarget&&!['width','height'].every(k=>Number.isInteger(upscaleTarget[k])&&upscaleTarget[k]>=256&&upscaleTarget[k]<=4096))throw error('Invalid upscale target');
    await this.ready;
    if(this.blocked) throw error(this.blocked,409);
    const job={...routing,requestedDimensions,upscale:!editPlan&&upscale!==false,id:randomUUID(),prompt:prompt.trim(),width,height,seed,inputId,denoise,originalSize,...(editPlan?{edit:editPlan,task:'edit'}:{}),workflow:inputId?'Z-Image INT8 Image-to-Image':'Z-Image INT8',status:'queued',createdAt:new Date().toISOString(),images:[],
      ...(correlationId?{requestCorrelationId:correlationId}:{}),...(messageId?{messageId}:{})};
    console.info('[generate_image] normalized seed', {requested:requestedSeed,seed:job.seed});
    const selected=profiles.find(p=>p.id===job.backend);
    if(!selected?.available)throw Object.assign(new Error(selected?.reason??'Selected image model is unavailable.'),{status:503});
    job.workflow=BACKENDS[job.backend].label+(editPlan?' Edit ('+editPlan.mode+')':inputId?' Image-to-Image':'');
    if(engine==='flux3-edit'){job.engine=engine;job.task='restyle';job.upscale=false;job.workflow='Flux 3 Klein Edit';job.editInstruction=fluxEditInstruction(job.prompt);}
    else if(engine==='flux3-ref'){job.engine=engine;job.task='merge';job.upscale=false;job.workflow='Flux 3 Klein Reference';job.inputIds=inputIds;job.refSize={width,height};job.editInstruction=fluxRefInstruction(job.prompt);}
    else if(engine==='flux3-merge'){
      // The place/background image goes first (Flux copies image 1), and the output frame is small whatever the input size.
      const plan=fluxMergeOrder(job.prompt,inputIds.length);
      job.engine=engine;job.task='merge';job.upscale=false;job.workflow='Flux 3 Klein Merge';job.inputIds=plan.order.map(i=>inputIds[i]);
      const {info}=await readInput(this.inputDir,job.inputIds[0]);
      job.refSize=job.inputIds.length>=3?fluxMergeSize(4,3):fluxMergeSize(info.width,info.height);job.width=job.refSize.width;job.height=job.refSize.height;
      job.refMegapixels=fluxMergeRefMegapixels(job.inputIds.length);
      job.editInstruction=fluxMergeInstruction(plan.prompt,job.inputIds.length);
    }
    else await loadImageGraph(job); // Fail unavailable/manual profiles before any GPU work.
    this.jobs.set(job.id,job);
    await this.save(job);
    await this.logImageStage(job,'request_received',{coldWarm:'unknown'});
    void this.run(job).catch(async e=>{job.status='failed';job.error=e.message;await this.save(job).catch(()=>{});});
    return job;
  }
  /** Stand-alone upscale of an uploaded picture (Image Edit page). scale 2 = 4x model then lanczos down; 4 = native. */
  async upscaleInput(inputId,scale){
    await this.ready;
    if(![2,4].includes(scale))throw error('เลือกอัปสเกล 2 เท่า หรือ 4 เท่า');
    if(this.blocked)throw error(this.blocked,409);
    const {info,bytes}=await readInput(this.inputDir,inputId);
    const side=Math.max(info.width,info.height);
    if(side*scale>4096)throw error(scale===4?'ภาพใหญ่เกินไปสำหรับ 4 เท่า (ด้านยาวต้องไม่เกิน 1024 px) ลองเลือก 2 เท่า':'ภาพใหญ่เกินไปสำหรับอัปสเกล (ด้านยาวต้องไม่เกิน 2048 px)');
    const target=scale===2?{width:info.width*2,height:info.height*2}:undefined;
    const job={id:randomUUID(),backend:primaryImageBackendId(),requestedBackend:primaryImageBackendId(),task:'upscale',workflow:'ClearRealityV1',prompt:'Upscale '+scale+'x',seed:0,width:info.width,height:info.height,upscaleTarget:target,status:'queued',createdAt:new Date().toISOString(),images:[]};
    await fs.writeFile(path.join(this.dir,job.id+'-0.png'),bytes,{flag:'wx'});
    job.images.push({url:'/api/images/jobs/'+job.id+'/images/0',alt:job.prompt,variant:'original',width:job.width,height:job.height});
    this.jobs.set(job.id,job);await this.save(job);void this.run(job).catch(async e=>{job.status='failed';job.error=e.message;await this.save(job).catch(()=>{})});return job;
  }
  async upscaleSaved(id,target){
    await this.ready;const source=await this.get(id);
    if(!['done','failed'].includes(source.status)||!source.images?.length)throw error('Native image is not ready for upscale.',409);
    if(target&&!['width','height'].every(k=>Number.isInteger(target[k])&&target[k]>=256&&target[k]<=4096))throw error('Invalid upscale target');
    if(this.blocked)throw error(this.blocked,409);
    const job={id:randomUUID(),parentJobId:id,backend:source.backend??primaryImageBackendId(),requestedBackend:source.backend??primaryImageBackendId(),task:'upscale',workflow:'ClearRealityV1',prompt:source.prompt,seed:source.seed,width:source.images[0].width,height:source.images[0].height,upscaleTarget:target,status:'queued',createdAt:new Date().toISOString(),images:[]};
    await fs.writeFile(path.join(this.dir,job.id+'-0.png'),await fs.readFile(path.join(this.dir,id+'-0.png')),{flag:'wx'});
    job.images.push({url:'/api/images/jobs/'+job.id+'/images/0',alt:job.prompt,variant:'original',width:job.width,height:job.height});
    this.jobs.set(job.id,job);await this.save(job);void this.run(job).catch(async e=>{job.status='failed';job.error=e.message;await this.save(job).catch(()=>{})});return job;
  }
  async setPreferences(p){if(BACKENDS[p?.backend]?.labOnly)throw error('โมเดลนี้ใช้ได้เฉพาะใน Image Lab ตั้งเป็นค่าเริ่มต้นของแชทไม่ได้',400);await imageProfiles();const routed=routeImage(p);await this.ready;const selected=(await imageProfiles()).find(x=>x.id===routed.backend);if(!selected?.available)throw error(selected?.reason??'Selected image model is unavailable.',400);const value={backend:routed.backend,quality:routed.quality};const temporary=path.join(this.dir,'preferences-'+randomUUID()+'.tmp');await fs.writeFile(temporary,JSON.stringify(value));await fs.rename(temporary,path.join(this.dir,'preferences.json'));this.preferences=value;return value;}
  async cancel(id) {
    const job=await this.get(id);
    if(['done','failed','cancelled'].includes(job.status)) return job;
    job.cancelRequested=true;
    if(job.promptId) {
      await this.api('/queue',{delete:[job.promptId]});
      await this.api('/interrupt',{prompt_id:job.promptId});
    }
    await this.save(job);
    return job;
  }
  /** data/logs/llm-cache.jsonl: how much of each prompt llama.cpp reused, and the first part that changed. */
  logPromptCache(body,tail,elapsedMs,call,measurement={}){
    try{
      const dir=this.config?.dataDir; if(!dir) return;
      const t=[...tail.matchAll(/"timings"\s*:\s*(\{[^{}]*\})/g)].at(-1)?.[1]; const timings=t?JSON.parse(t):{};
      const msgs=Array.isArray(body?.request?.messages)?body.request.messages:[];
      const text=m=>typeof m?.content==='string'?m.content:JSON.stringify(m?.content??'');
      const hash=s=>{let h=2166136261;for(let i=0;i<s.length;i++){h^=s.charCodeAt(i);h=Math.imul(h,16777619)}return (h>>>0).toString(36)};
      const parts=[];
      for(const [i,m] of msgs.entries()){
        if(m.role==='system')for(const sec of text(m).split(/\n\n(?=\[[^\]\n]{2,80}\]\n)/))parts.push({k:`system:${(sec.match(/^\[([^\]]+)\]/)?.[1]??'head').slice(0,40)}`,h:hash(sec),n:sec.length});
        else parts.push({k:`${i}:${m.role}`,h:hash(text(m)),n:text(m).length});
      }
      const purpose=typeof body?.purpose==='string'?body.purpose:(call?'call-reply':'other');
      const cacheKey=purpose==='chat-reply'||purpose==='chat-tool-step'?'chat':purpose;
      const prev=(this.promptParts??={})[cacheKey]; this.promptParts[cacheKey]=parts;
      let firstChange=null;
      if(prev){const i=parts.findIndex((p,j)=>!prev[j]||prev[j].h!==p.h);firstChange=i<0?'none':parts[i].k}
      const slotMatch=[...tail.matchAll(/"(?:id_slot|slot_id)"\s*:\s*(\d+)/g)].at(-1);
      const row={at:new Date().toISOString(),purpose,correlationId:typeof body?.correlationId==='string'?body.correlationId:null,
        slot:body?.request?.id_slot??timings.id_slot??timings.slot_id??(slotMatch?Number(slotMatch[1]):null),model:body?.request?.model??null,messages:msgs.length,
        cache_n:timings.cache_n??null,prompt_n:timings.prompt_n??null,prompt_ms:timings.prompt_ms!=null?Math.round(timings.prompt_ms):null,
        predicted_n:timings.predicted_n??null,elapsedMs,sleepingBefore:measurement.sleepingBefore??null,
        requestToFirstChunkMs:measurement.requestToFirstChunkMs??null,
        wakeMs:measurement.requestToFirstChunkMs!=null&&timings.prompt_ms!=null&&timings.predicted_per_second>0?Math.max(0,Math.round(measurement.requestToFirstChunkMs-timings.prompt_ms-1000/timings.predicted_per_second)):null,
        firstChange,sections:parts.filter(p=>p.k.startsWith('system:')).map(p=>`${p.k.slice(7)}=${p.n}`)};
      fsSync.mkdirSync(path.join(dir,'logs'),{recursive:true});
      fsSync.appendFileSync(path.join(dir,'logs','llm-cache.jsonl'),JSON.stringify(row)+'\n');
    }catch{}
  }
  /**
   * Image Lab: start ComfyUI ahead of the first job while the page is open (saves the ~30-60 s boot).
   * Same order as a job: voice off the GPU, wait for Gemma to sleep, then start. The next chat turn
   * stops this ComfyUI and restores Gemma on the GPU (llamaNeedsGpuRestore), exactly as after an image.
   */
  warm(){
    if(!this.autoStartComfy) return {state:'manual'};
    if(this.warming) return {state:'starting'};
    this.warming=(async()=>{
      await this.ready;
      try{const r=await fetch(this.base+'/system_stats',{signal:AbortSignal.timeout(1000)});if(r.ok)return 'ready';}catch{}
      const release=await this.compute.acquire();
      try{
        await this.beforeGpu?.();
        await this.waitForLlamaSleep({});
        await ensureComfy();
        this.llamaNeedsGpuRestore=true;
        console.log('[comfy] started ahead of Image Lab jobs');
        return 'started';
      }finally{release();}
    })().catch(e=>{console.warn('[comfy] Image Lab warm-up skipped:',e.message);return 'failed';}).finally(()=>{this.warming=null;});
    return {state:'starting'};
  }
  async waitForLlamaSleep(job) {
    for(let i=0;i<60;i++) {
      if(job.cancelRequested) throw error('Cancelled');
      if(this.blocked) throw error(this.blocked,409);
      let r;
      try {r=await fetch(this.llama+'/props',{signal:AbortSignal.timeout(3000)});} catch(e) {
        if(e.cause?.code === 'ECONNREFUSED') return;
        throw error('Cannot verify that Gemma has released GPU memory.',503);
      }
      if(!r.ok) throw error('Cannot check Gemma GPU state.',503);
      if((await r.json()).is_sleeping === true) return;
      await delay(1000);
    }
    throw error('Gemma has not released GPU memory. Restart it with --sleep-idle-seconds 5, then retry.',409);
  }
  async run(job) {
    const gpuWaitStarted=Date.now();await this.logImageStage(job,'gpu_wait');
    const release=await this.compute.acquire();
    await this.logImageStage(job,'gpu_acquired',{waitMs:Date.now()-gpuWaitStarted});
    let submitted=false;
    try {
      await this.beforeGpu?.();
      await this.logImageStage(job,'gemma_sleep_ready');
      if(job.cancelRequested) throw error('Cancelled');
      job.status='preparing';await this.save(job);
      if (this.autoStartComfy) {
        await this.waitForLlamaSleep(job);
        await ensureComfy();
        await this.logImageStage(job,'comfy_health_ready');
        if (job.cancelRequested) throw error('Cancelled');
      }
      const q=await this.api('/queue');
      if(q.queue_running?.length || q.queue_pending?.length) throw error('ComfyUI has another job. Wait for it to finish before generating from Lumicos.',409);
      await this.waitForLlamaSleep(job);
      if(job.task==='upscale'){await this.upscale(job);submitted=true;job.status='done';return;}
      const fluxJob=['flux3-edit','flux3-merge','flux3-ref'].includes(job.engine);
      let graph=fluxJob?null:await loadImageGraph(job);
      await this.logImageStage(job,'checkpoint_loaded');
      job.workflow=job.engine==='flux3-ref'?'Flux 3 Klein Reference':job.engine==='flux3-merge'?'Flux 3 Klein Merge':job.engine==='flux3-edit'?'Flux 3 Klein Edit':job.backend;job.stage='generation';job.generationStartedAt=Date.now();
      let inputName,inputNames;
      if(job.edit) {
        const {bytes,info}=await readInput(this.inputDir,job.inputId);
        const maskBytes=job.edit.maskId?(await readInput(this.inputDir,job.edit.maskId)).bytes:undefined;
        const r=await renderEditInputs(bytes,info,job.edit,PIXEL_BUDGETS[job.quality??'normal'],maskBytes);
        const names={};
        for(const [k,buf] of [['image',r.image],['maskHard',r.maskHard],['maskSoft',r.maskSoft]]) names[k]=await this.uploadToComfy(buf,`${job.id}-${k}.png`);
        editEditGraph(graph,job,names);
      } else if(job.inputId) {
        const upload=async(inputId,fileName,shrinkTo)=>{
          let {bytes}=await readInput(this.inputDir,inputId);
          let type='image/png';
          if(shrinkTo){bytes=await shrinkForComfy(bytes,shrinkTo);type='image/jpeg';}
          const body=new FormData();
          body.set('image',new Blob([bytes],{type}),fileName);
          body.set('subfolder','Lumicos');
          const uploaded=await fetch(this.base+'/upload/image',{method:'POST',body,signal:AbortSignal.timeout(30000)});
          if(!uploaded.ok) throw error('ส่งภาพต้นฉบับเข้า ComfyUI ไม่สำเร็จ',502);
          const result=await uploaded.json();
          if(typeof result.name!=='string'||result.name.includes('..')||/[\\/]/.test(result.name)) throw error('Invalid ComfyUI upload response.',502);
          return (result.subfolder?result.subfolder+'/':'')+result.name;
        };
        if(job.engine==='flux3-merge'){inputNames=[];for(const [i,id] of job.inputIds.entries()) inputNames.push(await upload(id,`${job.id}-${i}.jpg`,job.refMegapixels));}
        else if(job.engine==='flux3-ref'){inputNames=[];for(const [i,id] of job.inputIds.entries()) inputNames.push(await upload(id,`${job.id}-${i}.png`));}
        else inputName=await upload(job.inputId,job.id+'.png');
      }
      if(fluxJob) graph=fluxEditGraph({inputName,inputNames,size:job.refSize,keepRefSize:job.engine==='flux3-merge'&&!!job.refMegapixels,prompt:job.editInstruction,seed:job.seed,prefix:'lumicos_'+job.id});
      else if(!job.edit) editGraph(graph,job,inputName);
      await this.logImageStage(job,'prompt_encoded');
      if(job.cancelRequested) throw error('Cancelled');
      const submittedJob=await this.api('/prompt',{prompt:graph,client_id:job.id});
      if(!submittedJob.prompt_id) throw error('ComfyUI did not accept the workflow.',502);
      job.promptId=submittedJob.prompt_id; submitted=true;
      await this.logImageStage(job,'sampling_started',{promptId:job.promptId});
      job.status='running';await this.save(job);
      const deadline=Date.now()+30*60*1000;
      while(Date.now()<deadline) {
        if(job.cancelRequested) {
          await this.api('/queue',{delete:[job.promptId]});
          await this.api('/interrupt',{prompt_id:job.promptId});
        }
        const history=(await this.api('/history/'+encodeURIComponent(job.promptId)))[job.promptId];
        if(history) {
          if(job.cancelRequested) throw error('Cancelled');
          if(history.status?.status_str === 'error') {
            const detail=history.status.messages?.find(m=>m[0]==='execution_error')?.[1];
            throw error(detail?.exception_message ?? 'ComfyUI generation failed. Check its log.',502);
          }
          const outputs=Object.values(history.outputs??{}).flatMap(o=>o.images??[]);
          await this.logImageStage(job,'sampling_completed');
          if(!outputs.length) throw error('ComfyUI finished without an image.',502);
          for(const [index,output] of outputs.entries()) {
            const url=this.base+'/view?'+new URLSearchParams({filename:output.filename,subfolder:output.subfolder??'',type:output.type??'output'});
            const r=await fetch(url,{signal:AbortSignal.timeout(60000)});
            if(!r.ok) throw error('Could not download the generated image.',502);
            const bytes=Buffer.from(await r.arrayBuffer());
            if(bytes.length>50*1024*1024 || !bytes.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10]))) throw error('ComfyUI returned an unsupported image. Expected PNG.',502);
            await fs.writeFile(path.join(this.dir,`${job.id}-${index}.png`),bytes);
            await this.logImageStage(job,'vae_decode',{imageIndex:index,bytes:bytes.length});
            job.images.push({url:`/api/images/jobs/${job.id}/images/${index}`,alt:job.prompt,variant:'original',width:bytes.readUInt32BE(16),height:bytes.readUInt32BE(20)});
          }
          job.generationMs=Date.now()-job.generationStartedAt;
          job.comfyTimings=history.status?.messages;
          if(job.upscale){
            await this.logImageStage(job,'upscale_started');
            await this.save(job);
            try{await this.upscale(job,graph)}catch(e){if(job.cancelRequested)throw e;job.upscaleFailed=true;job.warning='อัปสเกลไม่สำเร็จ แสดงภาพต้นฉบับ: '+e.message;job.failure={backend:job.backend,resolution:[job.width,job.height],task:'upscale',workflow:job.workflow,stage:'upscaling',error:e.message};try{job.failure.vram=(await this.api('/system_stats')).devices?.[0];}catch{job.failure.vram='Unavailable'}console.error('[image upscale failure]',JSON.stringify(job.failure));}
          }
          job.status='done';break;
        }
        if(job.cancelRequested) {
          const q=await this.api('/queue');
          if(![...q.queue_running,...q.queue_pending].some(x=>x[1]===job.promptId)) throw error('Cancelled');
        }
        await delay(1000);
      }
      if(job.status!=='done') throw error('Image generation timed out. Check ComfyUI before retrying.',504);
    } catch(e) {job.failure={backend:job.backend,resolution:[job.width,job.height],task:job.task,workflow:job.workflow,stage:job.stage??job.status};if(submitted||(job.task==='upscale'&&job.promptId))try{job.failure.vram=(await this.api('/system_stats')).devices?.[0];}catch{}else job.failure.vram='Unavailable';;console.error('[image failure]',JSON.stringify({...job.failure,error:e.message}));job.status=job.cancelRequested?'cancelled':'failed';job.error=e.message;await this.logImageStage(job,'failed',{error:e.message});}
    finally {
      if(submitted||(job.task==='upscale'&&job.promptId)) {
        try {
          if(job.status!=='done'||job.upscaleFailed) {
            await this.api('/queue',{delete:[job.promptId]});
            await this.api('/interrupt',{prompt_id:job.promptId});
          }
          // Do not unload another application's active work.
          let idle=false;
          for(let i=0;i<60;i++) {
            const q=await this.api('/queue');
            if(!q.queue_running.length&&!q.queue_pending.length){idle=true;break;}
            await delay(1000);
          }
          if(!idle) throw error('ComfyUI is still busy. Wait before using Gemma.');
          // Keep reusable CPU graph objects, but release GPU residency after every image.
          job.reclamation=await this.releaseMemory({preserveCache:this.keepImageCache&&job.status==='done'&&!job.upscaleFailed});
          this.llamaNeedsGpuRestore=true;
        } catch(e) {job.warning=e.message; this.blocked=e.message;await fs.writeFile(path.join(this.dir,'recovery.txt'),e.message).catch(()=>{});}
      }
      job.finishedAt=new Date().toISOString();
      await this.logImageStage(job,'delivered',{generationMs:job.generationMs??null,upscaleMs:job.upscaleMs??null,warning:job.warning??null});
      try {await this.save(job);} finally {release();}
    }
  }
  async upscale(job,generationGraph){
    if(job.cancelRequested)throw error('Cancelled');
    const model=installedUpscaler(await this.api('/object_info/UpscaleModelLoader'));
    if(!model)throw error('ไม่พบ ClearRealityV1 ใน ComfyUI');
    const started=Date.now();job.stage='upscaling';await this.save(job);
    const bytes=await fs.readFile(path.join(this.dir,`${job.id}-0.png`));
    const form=new FormData();form.set('image',new Blob([bytes],{type:'image/png'}),job.id+'-original.png');form.set('subfolder','Lumicos');
    const uploaded=await fetch(this.base+'/upload/image',{method:'POST',body:form,signal:AbortSignal.timeout(30000)});
    if(!uploaded.ok)throw error('ส่งภาพเข้าอัปสเกลไม่สำเร็จ');
    const input=await uploaded.json();
    if(typeof input.name!=='string'||input.name.includes('..')||/[\\/]/.test(input.name))throw error('Invalid upscaler upload');
    if(job.cancelRequested)throw error('Cancelled');
    const upscale=upscaleGraph((input.subfolder?input.subfolder+'/':'')+input.name,model,'Lumicos/Upscaled/'+job.id,job.upscaleTarget);
    const prepared=generationGraph?retainGenerationGraph(generationGraph,upscale):{graph:upscale,output:'4'};
    const submitted=await this.api('/prompt',{prompt:prepared.graph,client_id:job.id});
    if(!submitted.prompt_id)throw error('ComfyUI ไม่รับงานอัปสเกล');
    job.generationPromptId=job.promptId;job.promptId=submitted.prompt_id;await this.save(job);
    for(let attempt=0;attempt<90;attempt++){
      if(job.cancelRequested)throw error('Cancelled');
      const history=(await this.api('/history/'+encodeURIComponent(job.promptId)))[job.promptId];
      if(history){
        if(history.status?.status_str==='error')throw error('ComfyUI ประมวลผลอัปสเกลไม่สำเร็จ');
        const output=history.outputs?.[prepared.output]?.images?.[0];if(!output)throw error('ไม่ได้รับภาพอัปสเกล');
        const response=await fetch(this.base+'/view?'+new URLSearchParams({filename:output.filename,subfolder:output.subfolder??'',type:output.type??'output'}),{signal:AbortSignal.timeout(60000)});
        if(!response.ok)throw error('รับภาพอัปสเกลไม่สำเร็จ');
        const result=Buffer.from(await response.arrayBuffer());
        if(result.length<24||result.length>50*1024*1024||!result.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10])))throw error('ไฟล์อัปสเกลไม่ใช่ PNG หรือใหญ่เกิน 50 MB');
        const index=job.images.length;await fs.writeFile(path.join(this.dir,`${job.id}-${index}.png`),result);
        job.images.push({url:`/api/images/jobs/${job.id}/images/${index}`,alt:job.prompt,variant:'upscaled',width:result.readUInt32BE(16),height:result.readUInt32BE(20)});
        job.upscaleMs=Date.now()-started;job.upscaleModel=model;return;
      }
      await delay(1000);
    }
    throw error('อัปสเกลใช้เวลานานเกินกำหนด');
  }
  async image(id,index) {
    const job=await this.get(id);
    if(!Number.isInteger(index)||index<0||index>=job.images.length) throw error('Image not found.',404);
    return fs.readFile(path.join(this.dir,`${id}-${index}.png`));
  }
  /** Every finished picture on disk (generated, edited, upscaled), newest first. */
  async gallery() {
    await this.ready;
    const out=[];
    for(const name of await fs.readdir(this.dir)) {
      if(!/^[a-f0-9-]{36}\.json$/.test(name)) continue;
      let job; try{job=JSON.parse(await fs.readFile(path.join(this.dir,name),'utf8'));}catch{continue;}
      if(job.status!=='done'||!Array.isArray(job.images)||!job.images.length) continue;
      let index=-1;
      for(let i=job.images.length-1;i>=0;i--) if(fsSync.existsSync(path.join(this.dir,`${job.id}-${i}.png`))){index=i;break;}
      if(index<0) continue;
      const img=job.images[index]??{};
      out.push({id:job.id,index,kind:['edit','restyle','merge'].includes(job.task)?'edit':job.task==='upscale'||img.variant==='upscaled'&&job.parentJobId?'upscale':'generate',
        prompt:String(job.prompt??'').slice(0,200),width:img.width??job.width,height:img.height??job.height,createdAt:job.createdAt,
        url:`/api/images/jobs/${job.id}/images/${index}`,thumb:`/api/images/thumb/${job.id}/${index}`});
    }
    return out.sort((a,b)=>String(b.createdAt).localeCompare(String(a.createdAt)));
  }
  /** Small JPEG preview for the gallery grid; cached next to the data dir. */
  async thumb(id,index) {
    if(!/^[0-9a-f-]{36}$/.test(id)||!Number.isInteger(index)||index<0||index>99) throw error('Image not found.',404);
    const dir=path.join(this.config.dataDir,'image-thumbs');
    const file=path.join(dir,`${id}-${index}.jpg`);
    try{return await fs.readFile(file);}catch{}
    const src=await fs.readFile(path.join(this.dir,`${id}-${index}.png`));
    const {createCanvas,loadImage}=await import('@napi-rs/canvas');
    const img=await loadImage(src);
    const w=Math.min(384,img.width),h=Math.max(1,Math.round(img.height*w/img.width));
    const c=createCanvas(w,h);c.getContext('2d').drawImage(img,0,0,w,h);
    const buf=c.toBuffer('image/jpeg',80);
    await fs.mkdir(dir,{recursive:true});await fs.writeFile(file,buf);
    return buf;
  }
  /** Gallery delete: removes the PNG; the job record stays so old links simply 404. */
  async deleteImage(id,index) {
    if(!/^[0-9a-f-]{36}$/.test(id)||!Number.isInteger(index)||index<0||index>99) throw error('Image not found.',404);
    await fs.rm(path.join(this.dir,`${id}-${index}.png`),{force:true});
    await fs.rm(path.join(this.config.dataDir,'image-thumbs',`${id}-${index}.jpg`),{force:true});
    return {ok:true};
  }
  async recover() {
    await this.ready;
    const release=await this.compute.acquire();
    try {
    const q=await this.api('/queue');
    if(q.queue_running.length||q.queue_pending.length) throw error('ComfyUI is still busy.',409);
    await this.releaseMemory();
    await fs.rm(path.join(this.dir,'recovery.txt'),{force:true});this.blocked=null;
    return {ok:true};
    } finally {release();}
  }
  async inference(req,res,body) {
    const residentCall=await this.models?.guard(body);
    const controller=new AbortController();
    res.on('close',()=>controller.abort());
    await this.ready;
    // A validated call turn already owns the session-wide GPU reservation.
    const gpuWaitStarted=Date.now();
    const release=residentCall?()=>{}:await this.compute.acquire(controller.signal);
    const gpuWaitMs=Date.now()-gpuWaitStarted;
    try {
      // Chat turns use the chat-aware release: it keeps a resident voice on the GPU (beforeGpu is for image jobs).
      if(!residentCall)await (this.beforeChat ?? this.beforeGpu)?.();
      if(this.blocked) throw error(this.blocked+' Use the image recovery button before chatting.',409);
      await this.models?.guard(body);
      const url=body.serverUrl === '/llama' ? this.llama : localUrl(body.serverUrl);
      if(!residentCall&&this.llamaNeedsGpuRestore){
        await this.models?.releaseComfy({restoreLlama:true});
        this.llamaNeedsGpuRestore=false;
      }else if(!residentCall&&this.imageCacheResident){
        await this.models?.releaseComfy();
        this.imageCacheResident=false;
      }
      const sleepingBefore=await fetch(url+'/props',{signal:AbortSignal.timeout(2000)}).then(r=>r.json()).then(p=>p.is_sleeping===true).catch(()=>null);
      const purpose=typeof body.purpose==='string'?body.purpose:'other';
      // Call mode uses a separate one-slot E2B process. The normal E4B process has slot 0 for
      // conversation replies and slot 1 for all helper work.
      const assignedSlot=purpose==='chat-reply'||purpose==='chat-tool-step'||purpose==='call-reply'?0:1;
      body.request={...body.request,id_slot:assignedSlot};
      const started=Date.now();let firstChunkAt=null;
      const upstream=await fetch(url+'/v1/chat/completions',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body.request),signal:controller.signal});
      res.writeHead(upstream.status,{'Content-Type':upstream.headers.get('content-type')??'text/event-stream','Cache-Control':'no-store','X-Lumicos-Gpu-Wait-Ms':String(gpuWaitMs),'X-Lumicos-Llama-Slot':String(assignedSlot)});
      let tail='';
      for await(const chunk of upstream.body) {if(controller.signal.aborted) break;firstChunkAt??=Date.now();res.write(chunk);tail=(tail+Buffer.from(chunk).toString('utf8')).slice(-6000);}
      res.end();
      this.logPromptCache(body,tail,Date.now()-started,residentCall,{sleepingBefore,requestToFirstChunkMs:firstChunkAt==null?null:firstChunkAt-started});
    } finally {release();}
  }
}
