import test from 'node:test';
import assert from 'node:assert/strict';
import {nativeResolution,routeImage,loadImageGraph} from '../comfy/imageProfiles.mjs';
test('ROCm square presets use the requested budgets and always eight steps',()=>{
 // fast was raised from 576² to a 620² budget on 2026-10-21 (1:1 snaps to 624×624, a multiple of 16).
 for(const [quality,size] of [['fast',624],['normal',720],['high',1024]]){
  assert.deepEqual(nativeResolution(quality,1,1),{width:size,height:size});
  assert.equal(routeImage({quality}).steps,8);
 }
 assert.equal(routeImage({}).quality,'normal');
});
test('ROCm common aspect ratios remain exact with aligned dimensions and nearby budgets',()=>{
 for(const [w,h] of [[3,4],[4,3],[16,9],[9,16]]){
  let previous=0;
  for(const [quality,size] of [['fast',620],['normal',720],['high',1024]]){
   const r=nativeResolution(quality,w,h),pixels=r.width*r.height;
   assert.equal(r.width*h,r.height*w);assert.equal(r.width%16,0);assert.equal(r.height%16,0);
   assert.ok(Math.abs(pixels-size*size)/(size*size)<0.15);assert.ok(pixels>previous);previous=pixels;
  }
 }
});
test('missing verified ROCm graph blocks generation with an actionable error',async()=>{
 await assert.rejects(loadImageGraph(routeImage({}),{readFile:async()=>{throw Object.assign(Error('missing'),{code:'ENOENT'})}}),e=>e.status===503&&/Validated/.test(e.message));
});
