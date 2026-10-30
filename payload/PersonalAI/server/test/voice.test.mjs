import {test} from 'node:test';
import assert from 'node:assert/strict';
import {validateWav,VoiceService,runVoiceProcess} from '../voice/voiceService.mjs';
import {ComputeQueue} from '../comfy/comfyService.mjs';
import fs from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {F5Worker} from '../voice/f5Worker.mjs';
import {RocmF5Client,splitForTts} from '../voice/rocmVoiceBackends.mjs';
function wav(){const b=Buffer.alloc(44+32000);b.write('RIFF');b.writeUInt32LE(b.length-8,4);b.write('WAVEfmt ',8);b.writeUInt32LE(16,16);b.writeUInt16LE(1,20);b.writeUInt16LE(1,22);b.writeUInt32LE(16000,24);b.writeUInt32LE(32000,28);b.writeUInt16LE(2,32);b.writeUInt16LE(16,34);b.write('data',36);b.writeUInt32LE(32000,40);return b;}
test('OmniVoice carries requested speaking speed through every synthesis chunk; default stays unchanged',async()=>{
 const requests=[],audio=wav();audio.writeUInt32LE(24000,24);audio.writeUInt32LE(48000,28);
 const worker=new RocmF5Client({engine:'omnivoice',sentenceChunkChars:20,fetchImpl:async(_url,init)=>{requests.push(JSON.parse(init.body));return new Response(audio,{headers:{'content-type':'audio/wav'}})}});
 await worker.speak('ประโยคแรก และประโยคถัดไป สำหรับทดสอบความเร็ว',undefined,()=>{},true,{speed:.92});
 assert.ok(requests.length>1);assert.ok(requests.every(r=>r.speed===.92));
 await worker.speak('สวัสดี');assert.equal('speed' in requests.at(-1),false);
 await assert.rejects(worker.speak('สวัสดี',undefined,undefined,true,{speed:NaN}),/Invalid speaking speed/);
});
test('voice upload accepts bounded PCM and rejects malformed or wrong-rate input',()=>{
 validateWav(wav());assert.throws(()=>validateWav(Buffer.from('bad')));
 const stereo=wav();stereo.writeUInt16LE(2,22);assert.throws(()=>validateWav(stereo));
 const truncated=wav().subarray(0,100);assert.throws(()=>validateWav(truncated));
});
test('cancel kills the owned voice child before resolving',async()=>{
 const c=new AbortController();const p=runVoiceProcess(process.execPath,['-e','setInterval(()=>{},1000)'],{signal:c.signal});setTimeout(()=>c.abort(),80);
 await assert.rejects(p,{name:'AbortError'});
});
test('voice failure cleans text/audio temporary files and releases compute lane',async()=>{
 const before=new Set((await fs.readdir(tmpdir())).filter(f=>f.startsWith('lumicos-voice-')));
 const compute=new ComputeQueue();const service=new VoiceService({compute,waitForLlamaSleep:async()=>{}},{releaseComfy:async()=>{}});
 service.status=async()=>({tts:{ready:true}});service.worker={speak:async()=>{throw Error('simulated voice failure')}};
 await assert.rejects(service.task('tts','ทดสอบ',new AbortController().signal));assert.equal(compute.active,0);
 const after=(await fs.readdir(tmpdir())).filter(f=>f.startsWith('lumicos-voice-')&&!before.has(f));assert.deepEqual(after,[]);
});
test('Vachana streams without touching shared GPU queue and rejects overlap',async()=>{
 const service=new VoiceService({compute:{acquire:()=>{throw Error('GPU must not be acquired')}}},{});
 service.fastStatus=async()=>({ready:true});let finish;const events=[];
 service.fastWorker={request:async(data,signal,emit)=>{assert.equal(data.text,'ทดสอบ');emit({type:'audio',pcm:'AAAA',sampleRate:22050});await new Promise(r=>finish=r);return {device:'cpu'}},stop:async()=>{}};
 const pending=service.speakFast('ทดสอบ',new AbortController().signal,e=>events.push(e));
 await new Promise(r=>setImmediate(r));await assert.rejects(service.speakFast('ซ้ำ',new AbortController().signal,()=>{}),e=>e.status===409);
 finish();assert.equal((await pending).metrics.device,'cpu');assert.equal(events.length,1);assert.equal(service.fastBusy,false);
});
test('Avatar test speaks with OmniVoice (F5 removed); no F5 export files are required',async()=>{
 const compute=new ComputeQueue();const service=new VoiceService({compute,waitForLlamaSleep:async()=>{}},{releaseComfy:async()=>{}});
 service.status=async()=>({tts:{ready:true}});service.scheduleRelease=()=>{};
 const spoken=[];service.worker={preload:async()=>{},speak:async(text,_signal,onAudio,_stream,options)=>{spoken.push({text,options});onAudio?.({type:'audio',pcm:'AAAA',sampleRate:24000});return {}},release:async()=>{},kill:()=>{}};
 const signal=new AbortController().signal;
 await service.task('tts','อา อี อู',signal,()=>{},undefined,{speed:.85});
 assert.equal(spoken.at(-1).text,'อา อี อู');assert.deepEqual(spoken.at(-1).options,{nfe:7,speed:.85});
 await assert.rejects(service.task('tts','x',signal,()=>{},undefined,{speed:2}),/Invalid Avatar test/);
 assert.equal(service.engines.tts,'omnivoice');
});

test('OmniVoice release offloads an owned service instead of stopping it',async()=>{
 const worker=new RocmF5Client({baseUrl:'http://127.0.0.1:8767',port:8767,engine:'omnivoice'});
 worker.child={pid:123};let stopped=false;worker.stop=async()=>{stopped=true};
 worker.control=async path=>{assert.equal(path,'/offload');return {ready:true,engine:'omnivoice',on_gpu:false}};
 const result=await worker.release();assert.equal(result.on_gpu,false);assert.equal(stopped,false);assert.equal(worker.child.pid,123);
});
test('OmniVoice preload onloads an offloaded owned service',async()=>{
 const worker=new RocmF5Client({baseUrl:'http://127.0.0.1:8767',port:8767,engine:'omnivoice'});
 worker.child={pid:123};worker.health=async()=>({ready:true,engine:'omnivoice',on_gpu:false});let endpoint;
 worker.control=async path=>{endpoint=path;return {ready:true,engine:'omnivoice',on_gpu:true}};
 const result=await worker.preload();assert.equal(endpoint,'/onload');assert.equal(result.on_gpu,true);
});
test('OmniVoice release retries transient offload failure without killing CPU residency',async()=>{
 const worker=new RocmF5Client({baseUrl:'http://127.0.0.1:8767',port:8767,engine:'omnivoice'});
 worker.child={pid:123};let attempts=0;worker.control=async()=>{attempts++;throw Error('offload failed')};let stopped=false;worker.stop=async()=>{stopped=true;worker.child=null};
 await assert.rejects(worker.release(),/offload failed/);assert.equal(attempts,3);assert.equal(stopped,false);assert.equal(worker.child.pid,123);
});
test('OmniVoice streams long text in sentence-sized pieces before the whole read-aloud completes',async()=>{
 const worker=new RocmF5Client({baseUrl:'http://127.0.0.1:8767',port:8767,engine:'omnivoice',maxChars:1000,sentenceChunkChars:80});
 const text='ประโยคแรกสำหรับเริ่มเล่นเสียงให้เร็วขึ้น '.repeat(3)+'ประโยคสุดท้ายสำหรับทดสอบการแบ่งข้อความ';
 const expected=splitForTts(text,80);const heard=[];let completed=0;
 worker.speakOne=async piece=>{heard.push(piece);await new Promise(resolve=>setImmediate(resolve));completed++;return {inferenceSeconds:.1,audioSeconds:.2}};
 const pending=worker.speak(text,new AbortController().signal);
 await new Promise(resolve=>setImmediate(resolve));
 assert.ok(expected.length>1);assert.ok(heard.length>=1);assert.ok(completed<expected.length);
 const metrics=await pending;assert.deepEqual(heard,expected);assert.equal(metrics.pieces,expected.length);
});
