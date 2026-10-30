import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import {LocalTtsClient,pcm24k} from '../payload/PersonalAI/server/voice/localTts.mjs';
import {VoiceService} from '../payload/PersonalAI/server/voice/voiceService.mjs';
import {pcmWav} from '../payload/PersonalAI/server/voice/f5Worker.mjs';
test('public package contains no private voice assets or model downloads',async()=>{
 const entries=JSON.parse(await fs.readFile(new URL('../catalog/payload.json',import.meta.url)));
 for(const e of entries)assert.doesNotMatch(e.path,/TTS-Bench|call-fillers|ref5\.(wav|txt)/i);
 const models=JSON.parse(await fs.readFile(new URL('../catalog/models.json',import.meta.url)));
 assert.ok(models.every(m=>m.group!=='tts'));
});
test('PCM conversion validates WAV and preserves 24 kHz mono samples',()=>{
 const pcm=Buffer.alloc(480);for(let i=0;i<240;i++)pcm.writeInt16LE(i*20,i*2);
 assert.deepEqual(pcm24k(pcmWav(pcm)),pcm);
 assert.throws(()=>pcm24k(Buffer.from('not audio')));
 assert.throws(()=>pcm24k(pcmWav(pcm).subarray(0,60)));
});
test('TTS cancellation and input validation occur before subprocess work',async()=>{
 const c=new LocalTtsClient({engine:'windows'});c.preload=()=>{throw Error('Should not launch')};
 await assert.rejects(c.speak('',undefined),/1–1500/);
 await assert.rejects(c.speak('hello',undefined,undefined,false,{speed:99}),/speed/);
 const controller=new AbortController();controller.abort();await assert.rejects(c.speak('hello',controller.signal),{name:'AbortError'});
});
test('read-aloud CPU voice does not acquire GPU or unload the chat model',async()=>{
 const forbidden=()=>{throw Error('CPU TTS must not touch GPU')};
 const worker={status:async()=>({ready:true}),available:async()=>true,preload:async()=>{},speak:async(t,s,cb)=>{cb({type:'audio',sampleRate:24000,pcm:Buffer.alloc(480).toString('base64')});return {backend:'cpu'}},release:async()=>{},kill(){}};
 const v=new VoiceService({compute:{acquire:forbidden},waitForLlamaSleep:forbidden},{releaseComfy:forbidden},{omniTts:worker});
 v.status=async()=>({tts:{ready:true}});v.scheduleRelease=()=>{};
 const result=await v.task('tts','hello',new AbortController().signal);
 assert.equal(result.audio.toString('ascii',0,4),'RIFF');assert.equal(result.metrics.backend,'cpu');v.close();
});
