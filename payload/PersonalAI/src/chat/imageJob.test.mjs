import {test} from 'node:test';
import assert from 'node:assert/strict';
import {imageJobParts} from './imageJob.ts';
test('upscaled result keeps downloadable original and replay job identity',()=>{
 const parts=imageJobParts({id:'j',status:'done',images:[{url:'original',variant:'original'},{url:'large',variant:'upscaled'}],upscaleMs:3100});
 assert.equal(parts.length,2);
 assert.equal(parts[1].url,'large');assert.equal(parts[1].meta.originalUrl,'original');
 assert.equal(parts[1].meta.jobId,'j');
});
test('upscale failure still displays original with explanation',()=>{
 const parts=imageJobParts({id:'j',status:'done',images:[{url:'original',variant:'original'}],warning:'upscale failed'});
 assert.match(parts[0].text,/upscale failed/);assert.equal(parts[1].url,'original');
});

test('completion reports measured generation and upscale separately, excluding queue time',()=>{
 const parts=imageJobParts({id:'j',status:'done',images:[],generationMs:32400,upscaleMs:2100});
 assert.equal(parts[0].text,'สร้างภาพแล้ว · สร้างภาพ 32.4 วินาที · อัปสเกล 2.1 วินาที · รวมสร้างและอัปสเกล 34.5 วินาที');
});
test('unknown timings are omitted and cancellation does not claim completed generation',()=>{
 assert.equal(imageJobParts({id:'old',status:'done',images:[]})[0].text,'สร้างภาพแล้ว');
 assert.equal(imageJobParts({id:'j',status:'cancelled',images:[],generationMs:1000})[0].text,'ยกเลิกการสร้างภาพแล้ว');
});
