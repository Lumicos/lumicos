import {test} from 'node:test';
import assert from 'node:assert/strict';
import {imageTools} from '../tools/imageTools.mjs';
import {ToolRegistry} from '../tools/registry.mjs';
import {normalizeImageSeed} from '../comfy/imageSeed.mjs';

test('image aliases enqueue through the permission gate and return a cancellable job ID immediately',async()=>{
  const calls=[];
  const registry=new ToolRegistry({});
  registry.register(imageTools({create:async args=>{calls.push(args);return {id:'job-1',status:'queued'};}})[0]);
  for(const name of ['generate_image','image_generator','Z image','create_image']) {
    const args={prompt:'a dog',width:1024,height:576};
    await assert.rejects(registry.execute(name,args),e=>e.code==='APPROVAL_REQUIRED');
    const approval=await registry.validate(name,args);
    const result=await registry.execute(name,args,approval.approvalId);
    assert.equal(result.data.jobId,'job-1');
    assert.equal(JSON.parse(result.content).status,'queued');
  }
  assert.equal(calls.length,4);
  assert.equal(calls[0].width,1024);
});

test('image seed normalization preserves integers and converts or randomizes every other supported form',()=>{
  assert.equal(normalizeImageSeed(42,()=>99),42);
  assert.equal(normalizeImageSeed('42',()=>99),42);
  for(const value of [undefined,null,'','random','12.5',-1,{},Number.NaN]) assert.equal(normalizeImageSeed(value,()=>99),99,String(value));
});

test('generate_image validation accepts model seed forms before ComfyUI normalization',async()=>{
  const registry=new ToolRegistry({});
  registry.register(imageTools({create:async args=>({id:'job',status:'queued',seed:args.seed})})[0]);
  for(const seed of [42,'42','random','',null]){
    const args={prompt:'cat',seed};
    const approval=await registry.validate('generate_image',args);
    await registry.execute('generate_image',args,approval.approvalId);
  }
});
