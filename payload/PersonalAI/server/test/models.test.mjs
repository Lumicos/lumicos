import {test} from 'node:test';
import assert from 'node:assert/strict';
import {ModelService} from '../llama/modelService.mjs';
import {ComputeQueue} from '../comfy/comfyService.mjs';
import {makeGguf,readGgufInfo} from '../llama/gguf.mjs';
import {mkdtemp,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
function fixture({failB=false,failRollback=false,external=false}={}){
 const events=[];
 const data={models:[{id:'a',name:'A',capabilities:{text:true,tools:true,vision:false}},{id:'b',name:'B',capabilities:{text:true,tools:true,vision:true}}],selectedId:'a',primaryId:'a'};
 const store={data,scan:async()=>[],removeModel:async id=>{data.models=data.models.filter(m=>m.id!==id);if(data.selectedId===id)data.selectedId=data.models[0]?.id??null},get:()=>structuredClone(data),selected:()=>data.models.find(m=>m.id===data.selectedId),select:async id=>{data.selectedId=id},save:async()=>{}};
 let owned=!external,phase=external?'external':'running',loaded='a';
 const manager={state:{model:store.selected()},status:async()=>({owned,phase,visionLoaded:loaded==='b',model:owned?{id:loaded}:null}),stop:async()=>{events.push('stop');owned=false;phase='stopped'},stopChild:async()=>{owned=false;phase='stopped'},start:async()=>{events.push('start:'+data.selectedId);if(data.selectedId==='b'&&failB||data.selectedId==='a'&&failRollback){phase='failed';throw new Error('load failed')}owned=true;phase='running';loaded=data.selectedId;manager.state.model=store.selected()}};
 const service=new ModelService({dataDir:tmpdir()},{compute:new ComputeQueue(),stopOwnedRuntime:async()=>events.push('stop-comfy')},{store,manager,ready:Promise.resolve()});
 service.validate=async m=>events.push('validate:'+m.id);service.releaseComfy=async()=>events.push('free');
 return {service,events,data,manager};
}
test('switch validates before stop, owns single process and records previous',async()=>{
 const {service,events,data}=fixture();await service.switch('b');
 assert.deepEqual(events,['validate:b','free','stop','start:b']);assert.equal(data.previousId,'a');assert.equal((await service.status()).profile.id,'b');
});
test('load failure rolls back and rollback failure stays failed',async()=>{
 for(const failRollback of [false,true]){const {service}=fixture({failB:true,failRollback});await assert.rejects(service.switch('b'),/โหลดโมเดล/);assert.equal((await service.status()).phase,failRollback?'failed':'running');}
});
test('external process and overlapping switches are never stopped',async()=>{
 const f=fixture({external:true});await assert.rejects(f.service.switch('b'),/ภายนอก/);assert.ok(!f.events.includes('stop'));
 const g=fixture();let release;g.service.validate=()=>new Promise(r=>release=r);const first=g.service.switch('b');await new Promise(r=>setTimeout(r,0));await assert.rejects(g.service.switch('a'),/งานค้าง/);release();await first;
});
test('whole turn protects tool approval gap and temporary use returns primary',async()=>{
 const {service}=fixture();await service.switch('b',{temporary:true});const t=await service.begin(['vision']);
 await assert.rejects(service.switch('a'),/งานค้าง/);await service.end(t.id);assert.equal((await service.status()).profile.id,'a');
});
test('Workshop may borrow coding model only for the authenticated active chat turn',async()=>{
 const {service}=fixture();const turn=await service.begin(['tools']);let ran=false;
 await service.withTemporaryModel('b',async()=>{ran=true;assert.equal((await service.status()).profile.id,'b')},{turnId:turn.id});
 assert.equal(ran,true);assert.equal((await service.status()).profile.id,'a');
 await assert.rejects(service.withTemporaryModel('b',async()=>{}, {turnId:'not-the-active-turn'}),/งานค้าง/);
 service.turns.set('other',{touched:Date.now(),mode:'chat'});
 await assert.rejects(service.withTemporaryModel('b',async()=>{}, {turnId:turn.id}),/งานค้าง/);
 service.turns.delete('other');await service.end(turn.id);
});
test('validation failure and GPU work leave current model untouched',async()=>{
 const {service,events}=fixture();service.validate=async()=>{throw new Error('missing')};await assert.rejects(service.switch('b'),/missing/);assert.ok(!events.includes('stop'));
 const release=await service.comfy.compute.acquire();await assert.rejects(service.switch('b'),/งานค้าง/);release();
});
test('GGUF metadata with ordinary arrays can be read',async()=>{
 const dir=await mkdtemp(path.join(tmpdir(),'gguf-test-'));try{const file=path.join(dir,'model.gguf');await writeFile(file,makeGguf({'general.architecture':'test',tags:['one','two'],'test.embedding_length':1024}));assert.equal((await readGgufInfo(file)).embeddingLength,1024)}finally{await rm(dir,{recursive:true,force:true})}
});


test('saved edits do not misreport the running profile and apply on switch',async()=>{
 const {service,data,events}=fixture();
 data.models=data.models.map(m=>m.id==='a'?{...m,name:'A edited'}:m);
 assert.equal((await service.status()).profile.name,'A');
 await service.switch('a');assert.equal((await service.status()).profile.name,'A edited');
 assert.ok(events.includes('stop'));
});
test('remembering multiple capabilities creates editable rules and no permanent switch',async()=>{
 const {service,data}=fixture();await service.switch('b',{temporary:true,remember:['vision','tools']});
 assert.deepEqual(data.rules,{vision:'b',tools:'b'});
 const t=await service.begin(['vision','tools']);await service.end(t.id);
 assert.equal((await service.status()).profile.id,'a');
 await service.rules({});assert.deepEqual(data.rules,{});
});
test('expired abandoned turn can be replaced, live turn cannot overlap',async()=>{
 const {service}=fixture();const a=await service.begin([]);
 await assert.rejects(service.begin([]),/งานตอบ/);
 service.turns.get(a.id).touched=Date.now()-130000;
 const b=await service.begin([]);assert.notEqual(a.id,b.id);await service.end(b.id);
});


test('signal-terminated llama child is already stopped, not waited or killed again',async()=>{
 const {LlamaManager}=await import('../llama/manager.mjs');
 const manager=new LlamaManager({store:{get:()=>({port:8080}),selected:()=>null},logDir:'.',pidFile:'unused'});
 manager.child={exitCode:null,signalCode:'SIGTERM',kill:()=>{throw new Error('must not kill again')}};
 await manager.stopChild();
 await assert.rejects(manager.start(),/No model selected/);
});

test('deleting a profile rejects current/busy model, clears references and preserves model files',async()=>{
 const {service,data}=fixture();
 await assert.rejects(service.remove('a'),/กำลังใช้/);
 const turn=await service.begin([]);await assert.rejects(service.remove('b'),/งานค้าง/);await service.end(turn.id);
 data.previousId='b';data.rules={vision:'b',tools:'a'};data.primaryId='b';
 await service.remove('b');assert.equal(data.models.length,1);assert.equal(data.primaryId,'a');assert.equal(data.previousId,undefined);assert.deepEqual(data.rules,{tools:'a'});
});
test('discovery filters registered models and projectors, refreshes cached downloads',async()=>{
 const {service,data}=fixture();data.models[0].path='C:/model/a.gguf';data.models[1].path='C:/model/b.gguf';
 let scans=0,files=[{path:'c:/model/A.gguf',name:'A.gguf'},{path:'C:/model/new.gguf',name:'new.gguf'},{path:'C:/model/mmproj.gguf',name:'mmproj.gguf',isProjector:true},{path:'C:/model/partial.gguf',error:'bad header'}];
 service.store.scan=async()=>{scans++;return files};
 let state=await service.status();assert.deepEqual(state.discovered.map(f=>f.name),['new.gguf']);assert.equal(state.projectors.length,1);assert.equal(state.profiles[0].available,false);
 files=[...files,{path:'C:/model/another.gguf',name:'another.gguf'}];await service.status();assert.equal(scans,1);
 service.scanAt=0;state=await service.status();assert.equal(scans,2);assert.equal(state.discovered.length,2);
});
test('llama raw prompt logs are discarded after startup including shutdown tails',async()=>{
 const {LlamaManager}=await import('../llama/manager.mjs');
 const manager=new LlamaManager({store:{get:()=>({port:8080}),selected:()=>null},logDir:'.',pidFile:'unused'});
 for(const phase of ['running','stopping','stopped','failed']){manager.state.phase=phase;manager.log('PRIVATE_SENTINEL');}
 assert.equal(manager.logs().lines.length,0);
});
