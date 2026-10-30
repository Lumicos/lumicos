import path from 'node:path';
import fs from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { checkLlamaDir, ModelConfigStore } from './modelConfig.mjs';
import { LlamaManager, probePort } from './manager.mjs';
import { runtimeConfig } from '../../scripts/runtime.mjs';
import { projectorMatches } from './gguf.mjs';
const fail=(message,status=409)=>Object.assign(new Error(message),{status});
export class ModelService {
 enqueueChat(task){
  this.pendingChats=(this.pendingChats??0)+1;
  const next=(this.chatTail??Promise.resolve()).then(task);
  this.chatTail=next.catch(()=>{}).finally(()=>{this.pendingChats--});
  return next;
 }
 /** Background agent steps (server/agent) share the chat queue so they never overlap a chat turn, but they are not
  *  chats: pendingChats keeps meaning "chats waiting for the model". */
 enqueueBackground(task){
  const next=(this.chatTail??Promise.resolve()).then(task);
  this.chatTail=next.catch(()=>{});
  return next;
 }
 constructor(config,comfy,dependencies={}) {
  this.comfy=comfy;this.dir=config.dataDir;
  this.store=dependencies.store??new ModelConfigStore(path.join(this.dir,'models.json'));
  this.manager=dependencies.manager??new LlamaManager({store:this.store,logDir:path.join(this.dir,'logs'),pidFile:path.join(this.dir,'llama.pid.json')});
  this.busy=false;this.turns=new Map();this.error=null;
  this._ready=dependencies.ready;
 }
 get ready(){ if(!this._ready){this._ready=this.initialize();this._ready.catch(e=>{this.error=e.message;this._ready=undefined})}return this._ready }
 async initialize(){
  if(!this.store.get().models.length){
   const cfg=runtimeConfig();
   await this.store.setGeneral({llamaDir:cfg.llamaDir,modelDirs:cfg.modelDir?[cfg.modelDir]:[],retryWithoutVision:false});
   const entry=await this.store.upsertModel({name:'Gemma 4 E4B',path:cfg.model,mmproj:cfg.mmproj,ctx:cfg.context,ngl:99,
    capabilities:{text:true,vision:true,tools:true},generation:{temperature:.8,topP:.95,maxTokens:1024},toolFormat:'json-block'});
   this.store.data.primaryId=entry.id;await this.store.save();
  }
  await this.manager.recoverPreviousSession();
  const cfg=this.store.get();
  const primary=cfg.models.find(m=>m.id===(cfg.primaryId??cfg.selectedId));
  if(primary){
   const callPath=path.join(path.dirname(primary.path),'gemma-4-E2B_q4_0-it.gguf');
   if(await fs.access(callPath).then(()=>true,()=>false)){
    const existing=cfg.models.find(m=>m.path.toLowerCase()===callPath.toLowerCase());
    const call=existing??await this.store.upsertModel({name:'Gemma 4 E2B · Call',path:callPath,mmproj:null,ctx:8192,ngl:99,
     capabilities:{text:true,vision:false,tools:false},generation:{temperature:.7,topP:.95,maxTokens:220},toolFormat:'json-block'});
    this.callModelId=call.id;
   }
  }
 }
 async discover(){
  if(this.scanCache&&Date.now()-this.scanAt<10000)return this.scanCache;
  if(this.scanning)return this.scanning;
  this.scanning=this.store.scan().then(files=>{this.scanAt=Date.now();this.scanCache=files;return files}).finally(()=>{this.scanning=null});
  return this.scanning;
 }
 /** Forget the cached folder scan (new model folders show up immediately). */
 async refresh(){this.scanCache=null;this.scanAt=0;if(this.scanning)await this.scanning.catch(()=>{});this.scanCache=null;return this.status()}
 /** Register a discovered .gguf as a model profile, picking the matching mmproj from the same folder. */
 async addFromFile(file){
  await this.ready;
  const files=await this.discover();
  const f=files.find(x=>x.path.toLowerCase()===String(file??'').toLowerCase());
  if(!f)throw fail('ไม่พบไฟล์โมเดลนี้ในโฟลเดอร์โมเดล กด Refresh แล้วลองใหม่',404);
  if(f.isProjector)throw fail('ไฟล์นี้เป็น mmproj (ตัวช่วยดูภาพ) ไม่ใช่โมเดล',400);
  if(f.error)throw fail('อ่านไฟล์ GGUF ไม่ได้: '+f.error,422);
  const existing=this.store.get().models.find(m=>m.path.toLowerCase()===f.path.toLowerCase());
  if(existing)return existing;
  const sameFolder=files.filter(x=>path.dirname(x.path).toLowerCase()===path.dirname(f.path).toLowerCase());
  const proj=ModelConfigStore.suggestProjectors(f,sameFolder).find(p=>p.pairing.ok===true||p.nameMatch);
  const pretty=f.name.replace(/\.gguf$/i,'').replace(/[-_]+/g,' ').replace(/\s+/g,' ').trim().slice(0,80);
  const ctx=Math.max(2048,Math.min(8192,f.contextLength||8192));
  const entry=await this.store.upsertModel({name:pretty,path:f.path,mmproj:proj?.path??null,ctx,ngl:99,
   capabilities:{text:true,vision:!!proj,tools:true},generation:{temperature:.8,topP:.95,maxTokens:1024},toolFormat:'json-block'});
  this.scanCache=null;
  return entry;
 }
 async remove(id){
  await this.ready;this.assertIdle();this.busy=true;
  try{
   const s=await this.manager.status();
   if(s.owned&&s.model?.id===id)throw fail('กำลังใช้โมเดลนี้อยู่ กรุณาสลับไปตัวอื่นก่อนลบโปรไฟล์');
   await this.store.removeModel(id);
   if(this.store.data.primaryId===id)this.store.data.primaryId=this.store.data.selectedId;
   if(this.store.data.previousId===id)delete this.store.data.previousId;
   this.store.data.rules=Object.fromEntries(Object.entries(this.store.data.rules??{}).filter(([,v])=>v!==id));
   await this.store.save();return {ok:true};
  }finally{this.busy=false}
 }
 async status(){
  await this.ready;
  const s=await this.manager.status(),cfg=this.store.get();
  const profiles=await Promise.all(cfg.models.map(async m=>({...m,available:await fs.access(m.path).then(()=>true,()=>false)})));
  const discovered=(await this.discover()).filter(f=>!f.isProjector&&!f.error&&!cfg.models.some(m=>m.path.toLowerCase()===f.path.toLowerCase()));
  const projectors=(this.scanCache??[]).filter(f=>f.isProjector&&!f.error);
  const actual=s.owned?structuredClone(this.manager.state.model):null;
  return {...s,phase:this.busy?'switching':this.error&&s.phase==='stopped'?'failed':s.phase,error:this.error??s.error,profile:actual??null,profiles,discovered,projectors,
   modelDirs:cfg.modelDirs??[],primaryId:cfg.primaryId??cfg.selectedId,previousId:cfg.previousId,rules:cfg.rules??{},busy:this.busy,activeTurns:this.turns.size};
 }
 assertIdle(allowedTurnId){
  // Keep a whole tool loop protected, including time spent awaiting approval.
  for(const [id,t] of this.turns)if(Date.now()-t.touched>120000)this.turns.delete(id);
  const blockingTurns=[...this.turns.keys()].filter(id=>id!==allowedTurnId);
  if(this.busy||blockingTurns.length||(allowedTurnId&& !this.turns.has(allowedTurnId))||(this.comfy.compute.waiting||this.comfy.compute.active))throw fail('ยังมีงานค้างอยู่ กรุณารอให้จบหรือยกเลิกก่อนสลับโมเดล');
 }
 async validate(model){
  await checkLlamaDir(this.store.get().llamaDir);
  if(!Number.isInteger(model.ctx)||model.ctx<512||model.ctx>262144||!Number.isInteger(model.ngl)||model.ngl<0||model.ngl>999)throw fail('Invalid context / GPU layers',400);
  if(model.capabilities?.vision&&!model.mmproj)throw fail('Vision requires mmproj',400);
  const m=await this.store.checkGguf(model.path,'Model',{projector:false});
  if(model.mmproj){const p=await this.store.checkGguf(model.mmproj,'Projector',{projector:true});
   const pair=projectorMatches(m.info,p.info);if(pair.ok===false)throw fail(pair.reason,422);
  }
  if(model.chatTemplateFile)await fs.access(model.chatTemplateFile);
 }
 async releaseComfy({restoreLlama=false}={}){
  const status=await this.comfy.status();
  if(this.comfy.blocked)throw fail(this.comfy.blocked);
  if(status.online){
   const q=await this.comfy.api('/queue');
   if(q.queue_running?.length||q.queue_pending?.length)throw fail('ComfyUI ยังมีงานอยู่');
   await this.comfy.releaseMemory();
   // ROCm may leave a sleeping llama process on CPU after ComfyUI displaced
   // its GPU allocations. Restart only the process owned by Model Manager so
   // the selected model is offloaded to the RX 6600 again before inference.
   if(restoreLlama){
    // On the RX 6600, an idle ROCm ComfyUI process still makes llama.cpp fall
    // back to CPU-speed inference. Stop only the child Lumicos started; an
    // externally managed ComfyUI instance remains untouched.
    await this.comfy.stopOwnedRuntime?.();
    const state=await this.manager.status();
    if(state.owned)await this.manager.restart();
   }
  }
 }
 async switch(id,{temporary=false,remember,primary=false,force=false,holdGpu=false,allowedTurnId}={}){
  await this.ready;this.assertIdle(allowedTurnId);this.busy=true;let release,retained=false;
  const previous=structuredClone(this.manager.state.model??this.store.selected());
  try {
   const target=this.store.get().models.find(m=>m.id===id);if(!target)throw fail('ไม่พบโปรไฟล์โมเดล',404);
   if(remember!==undefined){remember=Array.isArray(remember)?remember:[remember];if(remember.some(c=>!['vision','tools'].includes(c)||!target.capabilities?.[c]))throw fail('Invalid remembered capability',400);}
   await this.validate(target); // Validate before stopping the current process.
   const state=await this.manager.status();
   if(!state.owned&& !['stopped','failed'].includes(state.phase))throw fail('โมเดลนี้เปิดจากภายนอก กรุณาปิดจากหน้าต่างเดิมก่อน แอปจะไม่หยุด process ที่ไม่ได้เป็นเจ้าของ');
   release=await this.comfy.compute.acquire();await (this.comfy.beforeModelLoad??this.comfy.beforeGpu)?.();await this.releaseComfy();
   if(!force&&state.owned&&state.model?.id===id&&JSON.stringify(previous)===JSON.stringify(target)){
    if(primary)this.store.data.primaryId=id;
    if(remember)this.store.data.rules={...this.store.data.rules,...Object.fromEntries(remember.map(c=>[c,id]))};
    if(temporary)this.temporary=true;
    await this.store.save();this.error=null;return;
   }
   if(state.owned)await this.manager.stop();
   await this.store.select(id);
   try {
    await this.manager.start({reason:'model switch',withVision:!this.lazyVision});
    this.store.data.previousId=previous?.id!==id?previous?.id:this.store.data.previousId;
    if(primary)this.store.data.primaryId=id;
    if(remember)this.store.data.rules={...this.store.data.rules,...Object.fromEntries(remember.map(c=>[c,id]))};
    this.temporary=temporary;
    await this.store.save();this.error=null;
   } catch(e){
    if(holdGpu)this.store.callResident=false;
    await this.manager.stopChild();
    this.error='โหลดโมเดลไม่สำเร็จ: '+e.message;
    if(previous&&state.owned){
     this.store.data.models=this.store.data.models.map(m=>m.id===previous.id?previous:m);
     await this.store.select(previous.id);
     try {await this.manager.start({reason:'rollback'});this.error+=' — คืนโมเดลก่อนหน้าแล้ว';}
     catch(rollback){await this.manager.stopChild();this.error+=' — ย้อนกลับไม่สำเร็จ: '+rollback.message;}
    } else if(previous)await this.store.select(previous.id);
    throw fail(this.error,502);
   }
   if(holdGpu){retained=true;return release;}
  }finally{if(!retained)release?.();this.busy=false}
 }
 async start(){const s=await this.status();if(s.phase==='external'||s.phase==='running'){await this.pruneMissing().catch(()=>{});return this.status()}const id=await this.startableId();await this.pruneMissing().catch(()=>{});await this.switch(id);return this.status()}
 /** Drop profiles whose .gguf no longer exists (the user deleted the model). */
 async pruneMissing(){
  const cfg=this.store.get();
  for(const m of [...cfg.models]){
   if(await fs.access(m.path).then(()=>true,()=>false))continue;
   if(m.id===(cfg.primaryId??cfg.selectedId)||m.id===this.store.get().selectedId&&this.store.get().models.length===1)continue;
   await this.store.removeModel(m.id).catch(()=>{});
   if(this.store.data.previousId===m.id)delete this.store.data.previousId;
   this.store.data.rules=Object.fromEntries(Object.entries(this.store.data.rules??{}).filter(([,v])=>v!==m.id));
   console.log(`[models] removed ${m.name} from the list (file deleted)`);
  }
  await this.store.save();
 }
 /** The primary profile, or, when its .gguf was deleted/replaced, the best one that still exists on disk. */
 async startableId(){
  const cfg=this.store.get(),want=cfg.primaryId??cfg.selectedId;
  const exists=m=>fs.access(m.path).then(()=>true,()=>false);
  const primary=cfg.models.find(m=>m.id===want);
  if(primary&&await exists(primary))return primary.id;
  // A replacement dropped into the same folder wins (delete old .gguf, drop new one, restart).
  if(primary){
   this.scanCache=null;
   const files=(await this.discover()).filter(f=>!f.isProjector&&!f.error&&path.dirname(f.path).toLowerCase()===path.dirname(primary.path).toLowerCase());
   const fresh=files.find(f=>!cfg.models.some(m=>m.path.toLowerCase()===f.path.toLowerCase()))??files[0];
   if(fresh){const entry=await this.addFromFile(fresh.path);this.store.data.primaryId=entry.id;await this.store.save();await this.pruneMissing();console.log(`[models] ${path.basename(primary.path)} is gone; using ${fresh.name} instead`);return entry.id}
  }
  for(const m of cfg.models)if(m.id!==this.callModelId&&!/workshop/i.test(m.name)&&await exists(m)){this.store.data.primaryId=m.id;await this.store.save();await this.pruneMissing();console.log(`[models] primary model file is missing; using ${m.name} instead`);return m.id}
  throw fail('ไม่พบไฟล์โมเดลที่ใช้ได้ ใส่ไฟล์ .gguf ในโฟลเดอร์โมเดลแล้วเลือกใน Settings → Model Manager',404);
 }
 async withTemporaryModel(id,task,{turnId}={}){
  if(typeof task!=='function')throw fail('Temporary model task is required',400);
  await this.ready;this.assertIdle(turnId);
  const state=await this.status(),primary=this.store.get().primaryId??this.store.get().selectedId;
  const current=state.profile?.id;
  if(current===id)return await task();
  await this.switch(id,{temporary:true,allowedTurnId:turnId});
  // Keep chat/call turns from borrowing the coding model while Workshop owns it.
  this.busy=true;
  try{return await task();}
  finally{
   this.busy=false;this.temporary=false;
    if(primary&&primary!==id)await this.switch(primary,{allowedTurnId:turnId});
  }
 }
 async save(input){
  await this.ready;this.assertIdle();this.busy=true;
  try{
   return await this.store.upsertModel(input);
  }finally{this.busy=false}
 }
 async folders(modelDirs){await this.ready;this.assertIdle();this.busy=true;try{const result=await this.store.setGeneral({modelDirs});this.scanCache=null;return result}finally{this.busy=false}}
 async rules(rules){await this.ready;this.assertIdle();const cfg=this.store.get();for(const [cap,id]of Object.entries(rules))if(!['vision','tools'].includes(cap)||!cfg.models.some(m=>m.id===id&&m.capabilities?.[cap]))throw fail('กฎไม่ถูกต้อง',400);this.store.data.rules=rules;await this.store.save()}
 async begin(required=[],mode='chat',callId){
  if(!['chat','call'].includes(mode))throw fail('Invalid conversation mode',400);
  if(!Array.isArray(required)||required.some(c=>!['text','vision','tools'].includes(c)))throw fail('Invalid capability request',400);
  for(const [id,t] of this.turns)if(Date.now()-t.touched>120000)this.turns.delete(id);
  if(mode==='call'&&(!this.callSession||this.callSession!==callId))throw fail('กรุณาเริ่มสายโทรใหม่');
  await this.ready;if(this.callSession&&mode!=='call')throw fail('กรุณาวางสายก่อนใช้แชท');
  // A read-aloud voice model may still be on the GPU; free it before Gemma wakes up for this chat turn.
  if(mode==='chat')await this.comfy?.beforeChat?.()?.catch?.(()=>{});
  if(this.busy||this.turns.size)throw fail('โมเดลกำลังเปลี่ยนหรือมีงานตอบอยู่');
  const cfg=this.store.get();
  const state=await this.manager.status();
  const primary=cfg.primaryId??cfg.selectedId;
  const current=cfg.models.find(m=>m.id===state.model?.id);
  const currentFits=current&&required.every(cap=>cap==='text'||current.capabilities?.[cap]);
  const routed=[...new Set(required.filter(cap=>cap!=='text').map(cap=>cfg.rules?.[cap]).filter(Boolean))];
  const routedId=routed.length===1&&required.every(cap=>cap==='text'||cfg.rules?.[cap]===routed[0])?routed[0]:null;
  const target=mode==='call'?this.callModelId:(this.temporary&&currentFits?current.id:routedId??primary);
  if(mode==='call'&&!target)throw fail('ไม่พบ Gemma E2B สำหรับโทรคุย');
  if(target&&(!state.owned||state.model?.id!==target))await this.switch(target,{temporary:mode==='chat'&&target!==primary});
  // Lazy vision (voice model kept resident): load the image projector only for turns that carry an image.
  else if(this.lazyVision&&mode==='chat'&&required.includes('vision')&&state.owned&&!this.manager.state.visionLoaded)await this.restartVision(true);
  if(this.busy||this.turns.size)throw fail('โมเดลกำลังเปลี่ยนหรือมีงานตอบอยู่');
  const id=randomUUID();this.turns.set(id,{touched:Date.now(),mode,callId});
  try {
   const s=await this.status();
   if(!['running','external'].includes(s.phase))throw fail('โมเดลยังไม่พร้อม');
   const caps={...(s.profile?.capabilities??{text:true,vision:false,tools:false}),vision:s.profile?.capabilities?.vision===true&&s.visionLoaded===true};
   if(required.some(c=>!caps[c]))throw fail('โมเดลปัจจุบันไม่รองรับ '+required.filter(c=>!caps[c]).join(', '));
   return {id,profile:s.profile,capabilities:caps};
  }catch(e){this.turns.delete(id);throw e}
 }
 /** Restart the running model with or without its vision projector (lazy-vision mode). */
 async restartVision(on){
  if(this.busy||this.turns.size||this.callSession)return false;
  const state=await this.manager.status();if(!state.owned||!state.model)return false;
  if(!!this.manager.state.visionLoaded===on)return true;
  this.busy=true;let release;
  try{
   release=await this.comfy.compute.acquire();
   if(on)await this.comfy.beforeGpu?.(); // the voice model leaves the GPU while Gemma looks at the image
   await this.manager.stop();await this.manager.start({reason:on?'load vision for an image':'unload vision (lazy)',withVision:on});
   return true;
  }finally{this.busy=false;release?.()}
 }
 /** Turn lazy vision on/off; when turning on, drop the projector from an idle running model. */
 setLazyVision(on){this.lazyVision=!!on;this.store.voiceResident=!!on;if(on)setTimeout(()=>void this.restartVision(false).catch(()=>{}),1000).unref?.()}
 /** Free the GPU for an image job: stop an idle Gemma (it restarts on the next chat turn). */
 async unloadForGpu(){if(this.busy||this.turns.size||this.callSession)return false;const s=await this.manager.status().catch(()=>null);if(!s?.owned)return false;await this.manager.stopChild();console.log('[models] Gemma unloaded to free the GPU');return true}
 touch(id){const t=this.turns.get(id);if(!t)throw fail('หมดอายุงาน กรุณาส่งใหม่');t.touched=Date.now()}
 async end(id){if(!this.turns.delete(id))return;if(this.lazyVision&&!this.turns.size&&this.manager.state.visionLoaded)setTimeout(()=>void this.restartVision(false).catch(()=>{}),15000).unref?.();if(this.temporary&&!this.turns.size){this.temporary=false;await this.switch(this.store.get().primaryId??this.store.get().selectedId)}}
 async guard(body){
  if(this.busy)throw fail('กำลังสลับโมเดล กรุณารอ');
  if(!body.turnId)throw fail('ต้องเริ่มงานก่อนส่งคำขอโมเดล');
  this.touch(body.turnId);
  const turn=this.turns.get(body.turnId);
  const residentCall=!!this.callSession&&turn.mode==='call'&&turn.callId===this.callSession;
  if(this.callSession&&!residentCall)throw fail('คำขอนี้ไม่ได้อยู่ในสายโทรปัจจุบัน');
  if(!['http://127.0.0.1:8080','http://localhost:8080','/llama'].includes(body.serverUrl))throw fail('Model Manager uses the registered backend on port 8080');
  const profile=this.manager.state.model;
  const vision=profile?.capabilities?.vision&&this.manager.state.visionLoaded;
  if(body.request?.messages?.some(m=>Array.isArray(m.content)&&m.content.some(p=>p.type==='image_url'))&&!vision)throw fail('โมเดลนี้ยังไม่ได้ยืนยันว่ารองรับ Vision');
  return residentCall;
 }
}

