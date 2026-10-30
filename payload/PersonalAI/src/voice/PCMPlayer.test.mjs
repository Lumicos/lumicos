import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import ts from 'typescript';

let source=fs.readFileSync(new URL('./PCMPlayer.ts',import.meta.url),'utf8');
source=source.replace(/^import .*$/gm,'').replace('export class PCMPlayer','class PCMPlayer')+'\nexport {PCMPlayer};';
source='const registerPlayback=()=>()=>{};const createVisemeTimeline=()=>null;const sampleVisemeTimeline=()=>null;'+source;
const starts=[];
class FakeNode {connect(){} disconnect(){}}
class FakeSource extends FakeNode {start(at){starts.push(at)} stop(){}}
globalThis.AudioContext=class {
 currentTime=1;state='running';destination={};
 createGain(){return new FakeNode()}
 createAnalyser(){return Object.assign(new FakeNode(),{fftSize:0,disconnect(){},getFloatTimeDomainData(){}})}
 createBuffer(_channels,frames,rate){return {duration:frames/rate,getChannelData:()=>new Float32Array(frames)}}
 createBufferSource(){return new FakeSource()}
 async resume(){}async close(){}
};
const {PCMPlayer}=await import('data:text/javascript;base64,'+Buffer.from(ts.transpileModule(source,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ESNext}}).outputText).toString('base64'));

test('consecutive PCM chunks are scheduled without an injected mid-sentence gap',()=>{
 const player=new PCMPlayer();
 const pcm=Buffer.alloc(4800).toString('base64'); // 100 ms at 24 kHz mono PCM16
 player.add(pcm,24000);player.add(pcm,24000);
 assert.equal(starts.length,2);
 assert.ok(Math.abs(starts[1]-(starts[0]+0.1))<1e-9,`unexpected gap: ${starts[1]-(starts[0]+0.1)}s`);
 player.stop();
});
