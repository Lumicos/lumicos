import {test} from 'node:test';import assert from 'node:assert/strict';
import {routeImage,loadImageGraph,BACKENDS} from '../comfy/imageProfiles.mjs';
import {upscaleGraph,retainGenerationGraph} from '../comfy/upscale.mjs';
test('upscale target changes only output scaling and preserves input',()=>{const g=upscaleGraph('native.png','model','test',{width:960,height:1280});assert.equal(g['1'].inputs.image,'native.png');assert.deepEqual(g['4'].inputs.images,['5',0]);assert.equal(g['5'].inputs.width,960);});

test('upscale keeps generation cache identities without rerunning changed sampler inputs',()=>{
 const original={'2':{class_type:'CLIPLoaderGGUF',inputs:{clip_name:'installed.gguf'}},'7':{class_type:'KSampler',inputs:{seed:123,model:['2',0]}},'10':{class_type:'SaveImage',inputs:{filename_prefix:'native',images:['7',0]}}};
 const combined=retainGenerationGraph(original,upscaleGraph('native.png','model','upscaled'));
 assert.deepEqual(combined.graph['7'],original['7']);assert.equal(combined.graph['10'],undefined);assert.deepEqual(combined.graph.lumicos_upscale_4.inputs.images,['lumicos_upscale_3',0]);assert.equal(combined.output,'lumicos_upscale_4');assert.equal(original.lumicos_upscale_1,undefined);
});

test('upscale graph cannot reach generation sampler even with an empty cache',()=>{const original={'7':{class_type:'KSampler',inputs:{}},'10':{class_type:'SaveImage',inputs:{images:['7',0]}}};const combined=retainGenerationGraph(original,upscaleGraph('native.png','model','output'));const pending=[combined.output],visited=new Set();while(pending.length){const id=pending.pop();if(visited.has(id))continue;visited.add(id);for(const value of Object.values(combined.graph[id]?.inputs??{}))if(Array.isArray(value)&&combined.graph[value[0]])pending.push(value[0]);}assert.equal(visited.has('7'),false);assert.equal(Object.values(combined.graph).filter(n=>n.class_type==='SaveImage').length,1);});
import {ComfyService} from '../comfy/comfyService.mjs';
import {mkdtemp,writeFile,readFile,rm} from 'node:fs/promises';import path from 'node:path';import {tmpdir}from'node:os';
test('saved-native upscale uses the existing GPU lane and preserves its parent without a generation request',async()=>{
 const dir=await mkdtemp(path.join(tmpdir(),'lumicos-upscale-'));
 try{
  // This unit test mocks the Comfy API below; do not cold-start the real ROCm
  // runtime and consume most of the test's one-second completion window.
  const service=new ComfyService({dataDir:dir,keepImageCache:true,autoStartComfy:false});await service.ready;
  const id='00000000-0000-0000-0000-000000000002';const original=Buffer.from('native-test-fixture');
  const source={id,status:'done',prompt:'test',seed:1,backend:'qwen-image-2.1-turbo',images:[{variant:'original',width:960,height:1280}]};service.jobs.set(id,source);await writeFile(path.join(service.dir,id+'-0.png'),original);
  service.waitForLlamaSleep=async()=>{};service.api=async route=>{assert.equal(route,'/queue');return {queue_running:[],queue_pending:[]}};
  let ran=false;service.upscale=async job=>{assert.equal(service.compute.active,1);assert.equal(job.parentJobId,id);ran=true;};
  const job=await service.upscaleSaved(id,{width:960,height:1280});for(let i=0;i<100&&!job.finishedAt;i++)await new Promise(r=>setTimeout(r,10));
  assert.equal(job.status,'done');assert.equal(ran,true);assert.equal(source.status,'done');assert.deepEqual(await readFile(path.join(service.dir,id+'-0.png')),original);assert.deepEqual(await readFile(path.join(service.dir,job.id+'-0.png')),original);
 }finally{await rm(dir,{recursive:true,force:true})}
});
import {EventEmitter} from 'node:events';
test('image GPU handoff restores llama for chat and does not release a resident call GPU lane',async()=>{
 const dir=await mkdtemp(path.join(tmpdir(),'lumicos-handoff-'));const savedFetch=globalThis.fetch;
 try{
  const service=new ComfyService({dataDir:dir,keepImageCache:true});await service.ready;service.llamaNeedsGpuRestore=true;let freed=0,voiceReleased=0,call=false;
  let releaseOptions;service.beforeGpu=async()=>{voiceReleased++};service.models={guard:async()=>call,releaseComfy:async options=>{freed++;releaseOptions=options}};
  globalThis.fetch=async()=>new Response('test stream',{status:200});
  const response=()=>Object.assign(new EventEmitter(),{writeHead(){},write(){},end(){}});
  await service.inference({},response(),{serverUrl:'/llama',request:{}});assert.equal(freed,1);assert.deepEqual(releaseOptions,{restoreLlama:true});assert.equal(voiceReleased,1);assert.equal(service.llamaNeedsGpuRestore,false);
  service.llamaNeedsGpuRestore=true;call=true;const release=await service.compute.acquire();await service.inference({},response(),{serverUrl:'/llama',request:{}});assert.equal(freed,1);assert.equal(voiceReleased,1);assert.equal(service.compute.active,1);assert.equal(service.llamaNeedsGpuRestore,true);release();
 }finally{globalThis.fetch=savedFetch;await rm(dir,{recursive:true,force:true})}
});
test('GPU handoff waits for allocator release rather than free acknowledgement',async()=>{const service=Object.create(ComfyService.prototype);let samples=0,freed=0;service.api=async route=>{if(route==='/queue')return {queue_running:[],queue_pending:[]};if(route==='/free'){freed++;return {}};return {devices:[{torch_vram_total:++samples===1?5*1024**3:23*1024**2}]}};const result=await service.releaseMemory();assert.equal(samples,2);assert.equal(freed,1);assert.ok(result.waitMs>=200);assert.equal(service.imageCacheResident,false)});
test('GPU handoff refuses active external Comfy work',async()=>{const service=Object.create(ComfyService.prototype);service.api=async route=>{assert.equal(route,'/queue');return {queue_running:[1],queue_pending:[]}};await assert.rejects(service.releaseMemory(),/active work/)});

test('GPU handoff waits for the driver and rejects a ComfyUI port rebound',async()=>{
 const service=Object.create(ComfyService.prototype);service.base='http://127.0.0.1:8188';const savedFetch=globalThis.fetch;
 try{
  let calls=0;globalThis.fetch=async()=>{calls++;throw new Error('offline')};
  assert.equal(await service.waitForGpuDriverSettle(1),true);assert.equal(calls,1);
  globalThis.fetch=async()=>new Response('{}',{status:200});
  await assert.rejects(service.waitForGpuDriverSettle(1),/became available again/);
 }finally{globalThis.fetch=savedFetch}
});

test('only Z generation remains and old Qwen selection explicitly fails',()=>{for(const quality of ['fast','normal','high'])assert.ok(BACKENDS[routeImage({prompt:'three friends with a poster',quality}).backend]);assert.throws(()=>routeImage({backend:'qwen-image-2.1-turbo'}),/removed/)});


test('successful image cleanup retains CPU graph cache while unloading GPU models',async()=>{const service=Object.create(ComfyService.prototype);let freed;service.imageCacheResident=true;service.api=async(route,body)=>{if(route==='/queue')return {queue_running:[],queue_pending:[]};if(route==='/free'){freed=body;return {}};return {devices:[{torch_vram_total:0}]}};await service.releaseMemory({preserveCache:true});assert.deepEqual(freed,{unload_models:true,free_memory:false});assert.equal(service.imageCacheResident,false)});
