import test from 'node:test';import assert from 'node:assert/strict';import {installedUpscaler,upscaleGraph} from '../comfy/upscale.mjs';
test('matches ComfyUI Windows model names in legacy and new combo schemas',()=>{
 const name='ClearRealityV1\\4x-ClearRealityV1.pth';
 for(const definition of [[[name]],['COMBO',{options:[name]}]])assert.equal(installedUpscaler({UpscaleModelLoader:{input:{required:{model_name:definition}}}}),name);
 assert.equal(installedUpscaler({}),undefined);
});
test('upscale workflow uses the actual source pixels and installed model',()=>{
 const graph=upscaleGraph('Lumicos/original.png','installed.pth');assert.equal(graph['1'].inputs.image,'Lumicos/original.png');assert.equal(graph['2'].inputs.model_name,'installed.pth');assert.deepEqual(graph['3'].inputs.image,['1',0]);assert.deepEqual(graph['4'].inputs.images,['3',0]);
});
