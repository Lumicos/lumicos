import {test} from 'node:test';
import assert from 'node:assert/strict';
import {LocalTtsClient} from '../payload/PersonalAI/server/voice/localTts.mjs';
import {VoiceService} from '../payload/PersonalAI/server/voice/voiceService.mjs';
test('missing Pattara stays unavailable without trying another engine',async()=>{
 const c=new LocalTtsClient();let calls=0;c.run=async(exe)=>{assert.equal(exe,'powershell.exe');calls++;return {stdout:JSON.stringify({ready:false,reason:'Microsoft Pattara is missing'})}};
 assert.equal((await c.status()).ready,false);assert.equal(calls,1);
 await assert.rejects(c.preload(),/Pattara/);
 for(const engine of ['auto','espeak','omnivoice'])assert.equal((await c.status(engine)).ready,false);
 assert.equal(calls,2);
});
test('settings expose only Pattara and reject alternate engines',async()=>{
 const v=new VoiceService({}, {}, {omniTts:{status:async()=>({ready:true,name:'Microsoft Pattara'}),kill(){}}});
 assert.equal(v.engines.tts,'windows');assert.deepEqual(Object.keys((await v.engineStatus()).options.tts),['windows']);
 await assert.rejects(v.setEngines({tts:'espeak'}),/Invalid TTS/);v.close();
});
