import test from 'node:test';
import assert from 'node:assert/strict';
import { existingImageReply } from './existingImage.mjs';
const image=(url)=>({type:'image',source:'generated',url});
test('favorite image reference returns one image',()=>{
 const result=existingImageReply([
  {role:'assistant',parts:[{type:'text',text:'ภาพก่อนหน้า'},image('/one.png')]},
  {role:'assistant',parts:[{type:'text',text:'นี่คือภาพที่ชอบที่สุดค่ะ'},image('/favorite.png')]},
  {role:'user',parts:[{type:'text',text:'เอาภาพที่เธอชอบมาโชว์หน่อย'}]},
 ]);
 assert.deepEqual(result?.images.map((p)=>p.url),['/favorite.png']);
});
test('favorite reference prefers the assistant turn that says it likes an older image',()=>{
 const result=existingImageReply([
  {role:'assistant',parts:[{type:'text',text:'ภาพนี้ชอบที่สุดค่ะ'},image('/liked.png')]},
  {role:'assistant',parts:[{type:'text',text:'นี่เป็นอีกภาพหนึ่งค่ะ'},image('/newer.png')]},
  {role:'user',parts:[{type:'text',text:'เอาภาพที่เธอชอบมาโชว์'}]},
 ]);
 assert.deepEqual(result?.images.map((p)=>p.url),['/liked.png']);
});
