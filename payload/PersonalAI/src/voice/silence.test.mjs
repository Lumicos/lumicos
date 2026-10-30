import test from 'node:test';
import assert from 'node:assert/strict';
import {SilenceDetector} from './silence.ts';
test('does not stop on initial silence, then ends after speech and pause',()=>{
 const d=new SilenceDetector();for(let i=0;i<50;i++)assert.equal(d.update(0.002,50),'continue');
 for(let i=0;i<8;i++)d.update(0.05,50);assert.equal(d.heardSpeech,true);
 for(let i=0;i<23;i++)assert.equal(d.update(0.002,50),'continue');assert.equal(d.update(0.002,50),'finished');
});
test('brief pause is tolerated and silence-only is never transcribed',()=>{
 const d=new SilenceDetector();for(let i=0;i<8;i++)d.update(0.05,50);for(let i=0;i<15;i++)d.update(0.001,50);assert.equal(d.update(0.05,50),'continue');
 const empty=new SilenceDetector();for(let i=0;i<199;i++)assert.equal(empty.update(0.002,50),'continue');assert.equal(empty.update(0.002,50),'empty');
});
