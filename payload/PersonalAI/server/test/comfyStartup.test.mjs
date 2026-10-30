import test from 'node:test';
import assert from 'node:assert/strict';
import {comfyAutoStart} from '../comfy/comfyService.mjs';
test('ordinary API startup enables managed local Comfy without launcher-only environment',()=>{
 assert.equal(comfyAutoStart({},{}),true);
 assert.equal(comfyAutoStart({}, {LUMICOS_AUTO_COMFY:'1'}),true);
 assert.equal(comfyAutoStart({}, {LUMICOS_AUTO_COMFY:'0'}),false);
 assert.equal(comfyAutoStart({autoStartComfy:false},{}),false);
 assert.equal(comfyAutoStart({comfyUrl:'http://127.0.0.1:9999'}, {LUMICOS_AUTO_COMFY:'1'}),false);
});
