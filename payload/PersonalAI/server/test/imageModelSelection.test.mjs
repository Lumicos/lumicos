import {test} from 'node:test';
import assert from 'node:assert/strict';
import {BACKENDS,routeImage,loadImageGraph,imageProfiles} from '../comfy/imageProfiles.mjs';
import fs from 'node:fs/promises';import os from 'node:os';import path from 'node:path';
test('manual Z model selection is preserved and mapped to its own file',async()=>{
 for(const [id,p] of Object.entries(BACKENDS).filter(([id,p])=>p.workflow&&id!=='moss-image')){
  const job=routeImage({backend:id,quality:'fast'});assert.equal(job.backend,id);
  const graph=await loadImageGraph(job);assert.equal(graph['4'].inputs.unet_name,p.model);
  assert.equal(graph['7'].inputs.steps,8);assert.equal(graph['2'].inputs.clip_name,'qwen_3_4b.safetensors');
 }
});
test('Moss Image uses its own 4-step LoRA workflow and tiles the VAE decode only for large images',async()=>{
 const job=routeImage({backend:'moss-image',quality:'fast'});assert.equal(job.backend,'moss-image');assert.equal(job.steps,4);
 const small=await loadImageGraph({...job,width:432,height:576});
 assert.equal(small['4'].inputs.unet_name,BACKENDS['moss-image'].model);assert.equal(small['7'].inputs.steps,4);assert.equal(small['17'].class_type,'LoraLoaderModelOnly');
 assert.equal(small['6'].class_type,'EmptyFlux2LatentImage');assert.equal(small['12'].class_type,'VAEDecode');
 const big=await loadImageGraph({...job,width:864,height:1152});assert.equal(big['12'].class_type,'VAEDecodeTiled');
});
test('Moss is Image-Lab-only: never the default backend',async()=>{
 const {pickDefaultBackend}=await import('../comfy/imageProfiles.mjs');
 assert.equal(BACKENDS['moss-image'].labOnly,true);
 assert.equal(pickDefaultBackend([{id:'moss-image',labOnly:true},{id:'other'}]),'other');
 assert.equal(pickDefaultBackend([{id:'moss-image',labOnly:true}]),undefined);
});
test('incompatible Krea2 never enters Z workflow',()=>{
 for(const id of ['moody-krea2','redcraft-krea2'])assert.throws(()=>routeImage({backend:id}),/removed or unavailable/);
});
test('profiles are available without contacting ComfyUI; incompatible profiles stay disabled',async()=>{
 const profiles=await imageProfiles();assert.ok(profiles.length>=3);
 for(const id of ['moody-krea2','redcraft-krea2'])assert.equal(profiles.find(p=>p.id===id),undefined);
});
test('new compatible safetensors files are detected from their header and incompatible files stay disabled',async()=>{
 const dir=await fs.mkdtemp(path.join(os.tmpdir(),'lumicos-image-models-'));try{
  const write=async(name,header)=>{const json=Buffer.from(JSON.stringify(header));const size=Buffer.alloc(8);size.writeBigUInt64LE(BigInt(json.length));await fs.writeFile(path.join(dir,name),Buffer.concat([size,json,Buffer.alloc(16)]));};
  await write('My-Z-Image-Turbo.safetensors',{'__metadata__':{architecture:'Z-Image-Turbo'},'layers.0.attention.qkv.weight':{},'layers.0.feed_forward.w1.weight':{}});
  await write('other-model.safetensors',{'model.diffusion_model.input_blocks.0.weight':{}});
  const profiles=await imageProfiles({directory:dir});const compatible=profiles.find(p=>p.file==='My-Z-Image-Turbo.safetensors'),other=profiles.find(p=>p.file==='other-model.safetensors');
  assert.equal(compatible?.available,true);assert.equal(compatible?.detected,true);assert.equal(BACKENDS[compatible.id].model,'My-Z-Image-Turbo.safetensors');
  assert.equal(other?.available,false);assert.match(other?.reason,/ไม่ใช่โมเดล Z-Image/);
 }finally{await fs.rm(dir,{recursive:true,force:true});}
});
