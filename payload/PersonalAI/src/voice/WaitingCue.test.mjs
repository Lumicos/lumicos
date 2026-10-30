import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import ts from 'typescript';
const source=fs.readFileSync(new URL('./WaitingCue.ts',import.meta.url),'utf8');
const {WaitingCue}=await import('data:text/javascript;base64,'+Buffer.from(ts.transpileModule(source,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ESNext}}).outputText).toString('base64'));
async function setup(t,ok=true){
 t.mock.timers.enable({apis:['setTimeout']});
 t.mock.method(globalThis,'fetch',async()=>({ok,arrayBuffer:async()=>new ArrayBuffer(4)}));
 const sources=[];
 const context={currentTime:0,state:'running',destination:{},decodeAudioData:async()=>({duration:1}),
  createBufferSource(){const s={connect(){},disconnect(){},start(){this.started=true},stop(at){this.stops.push(at)},stops:[]};sources.push(s);return s},
  createGain(){return {connect(){},disconnect(){},gain:{setValueAtTime(){},linearRampToValueAtTime(){}}}}};
 const cue=new WaitingCue(context),controller=new AbortController();await cue.preload(controller.signal);
 t.after(()=>cue.dispose());return {cue,controller,sources};
}
test('fast answer cancels pending filler before it becomes audible',async t=>{
 const {cue,controller,sources}=await setup(t);cue.arm(controller.signal,1);t.mock.timers.tick(600);cue.cancel();t.mock.timers.tick(1000);assert.equal(sources.length,0);
});
test('slow answer plays one cached cue and answer arrival stops it immediately',async t=>{
 const {cue,controller,sources}=await setup(t);cue.arm(controller.signal,1);t.mock.timers.tick(700);assert.equal(sources.length,1);assert.equal(sources[0].started,true);
 cue.cancel();assert.equal(sources[0].stops.at(-1),undefined);t.mock.timers.tick(10000);assert.equal(sources.length,1);
});
test('hangup cancels pending and currently playing filler; quiet turn stays quiet',async t=>{
 const {cue,controller,sources}=await setup(t);cue.arm(controller.signal,3);t.mock.timers.tick(1000);assert.equal(sources.length,0);
 cue.arm(controller.signal,1);controller.abort();t.mock.timers.tick(1000);assert.equal(sources.length,0);
 const next=new AbortController();cue.arm(next.signal,2);t.mock.timers.tick(700);next.abort();assert.equal(sources[0].stops.at(-1),undefined);
});
test('unavailable assets and disposed cue never delay or play into a later call',async t=>{
 const {cue,controller,sources}=await setup(t,false);cue.arm(controller.signal,1);t.mock.timers.tick(1000);assert.equal(sources.length,0);
 cue.dispose();cue.arm(controller.signal,2);t.mock.timers.tick(1000);assert.equal(sources.length,0);
});
