import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {ComfyService} from '../comfy/comfyService.mjs';
test('explicit 16:9 overrides mistaken portrait tool dimensions at every preset',async()=>{
 const dir=await fs.mkdtemp(path.join(os.tmpdir(),'lumicos-aspect-'));
 try{const service=new ComfyService({dataDir:dir,autoStartComfy:false});await service.ready;service.run=async()=>{};
  for(const quality of ['fast','normal','high']){
   const job=await service.create({prompt:'An orange cat, 16:9',width:768,height:1024,quality});
   assert.equal(job.width/job.height,16/9);
   assert.equal(job.upscale,true);
   assert.equal(job.width%16,0);assert.equal(job.height%16,0);
  }
  const tall=await service.create({prompt:'cat 9:16',width:1024,height:576});assert.equal(tall.width/tall.height,9/16);
 }finally{await fs.rm(dir,{recursive:true,force:true})}
});

test('Comfy jobs always persist a normalized integer seed before workflow execution',async()=>{
 const dir=await fs.mkdtemp(path.join(os.tmpdir(),'lumicos-seed-'));
 try{
  const service=new ComfyService({dataDir:dir,autoStartComfy:false});await service.ready;service.run=async()=>{};
  for(const [input,expected] of [[42,42],['42',42]]){
   const job=await service.create({prompt:'An orange cat',seed:input});
   assert.equal(job.seed,expected);
  }
  for(const input of [undefined,null,'','random','invalid',-1]){
   const job=await service.create({prompt:'An orange cat',seed:input});
   assert.ok(Number.isSafeInteger(job.seed)&&job.seed>=0,`seed ${String(input)} normalized to ${job.seed}`);
  }
 }finally{await fs.rm(dir,{recursive:true,force:true})}
});
