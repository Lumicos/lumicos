import {test} from 'node:test';
import assert from 'node:assert/strict';
import {IMAGE_SIZES,requestedSize,imagePrompt,imageFollowup,imageContinuation,imagePromptFromModelText,resolveImageIntent,needsImageResearch,preserveImageAspect} from './imageRequest.ts';
test('source ratio survives translation that invents a conflicting ratio',()=>{
 const prompt=preserveImageAspect('A cat, 3:4','landscape');
 assert.equal(requestedSize(prompt),'landscape');assert.doesNotMatch(prompt,/3:4/);
 assert.equal(requestedSize(preserveImageAspect('cat 16:9','wide')),'wide');
});
test('short confirmation continues an image generation proposal',()=>{
 assert.equal(imageFollowup('เจนได้เลย ๆ','เรากำลังจะเจนภาพลิซ่าให้เธอค่ะ'),true);
 assert.equal(imageFollowup('สวัสดี','เรากำลังจะเจนภาพให้เธอค่ะ'),false);
 assert.equal(imageFollowup('เจนได้เลย ๆ','เราคุยเรื่องภาพเฉย ๆ'),false);
});
test('model prompt concept can be routed to the real image tool',()=>{
 assert.match(imagePromptFromModelText('**New Prompt Concept:** *Lisa wearing a black dress*\n\nรอสักครู่ค่ะ'),/Lisa wearing/);
});
test('Thai confirmation continues an existing image refinement',()=>{
 assert.equal(imageContinuation('ได้ ๆ ลองทำตามที่เธอว่าดู',[{parts:[{type:'image',url:'/old.png'}]}]),true);
});
test('a detailed outfit refinement is not left as prose',()=>{
 assert.ok(imagePromptFromModelText('ลองปรับเป็นสไตล์นี้ดูไหมคะ? เสื้อ Ribbed Knit Top สีครีม สำหรับคาเฟ่น่ารัก ๆ'));
});
test('one resolver classifies direct, followup, refinement and ordinary chat',()=>{
 assert.equal(resolveImageIntent([{role:'user',parts:[{type:'text',text:'สร้างภาพแมว'}]}]).kind,'create');
 assert.equal(resolveImageIntent([{role:'assistant',parts:[{type:'text',text:'กำลังจะสร้างภาพให้ค่ะ'}]},{role:'user',parts:[{type:'text',text:'ได้เลย'}]}]).kind,'followup');
 assert.equal(resolveImageIntent([{role:'assistant',parts:[{type:'image',url:'/x'}]},{role:'user',parts:[{type:'text',text:'ได้ ๆ ลองทำตามที่เธอว่าดู'}]}]).kind,'refine');
 assert.equal(resolveImageIntent([{role:'user',parts:[{type:'text',text:'วันนี้เป็นอย่างไร'}]}]).kind,'none');
});
test('ordinary named-subject scenes bypass research; current references still search',()=>{
 assert.equal(needsImageResearch('เจนภาพ Lisa Blackpink กำลังดื่มกาแฟในคาเฟ่ให้หน่อย'),false);
 assert.equal(needsImageResearch('สร้างภาพนักร้องนั่งในสวน'),false);
 assert.equal(needsImageResearch('Lisa Blackpink ใน MV ล่าสุด'),true);
 assert.equal(needsImageResearch('ค้นเว็บอ้างอิงชุดของเธอก่อนสร้างภาพ'),true);
});
test('natural Thai/English generation requests and orientation',()=>{
  assert.ok(imagePrompt('เธอช่วยเจนภาพของ Lisa Blackpink ให้หน่อยสิ เอาให้ใกล้เคียงกับใน MV เพลงล่าสุด'));
  for(const text of ['ช่วยสร้างภาพหมาขาวแนวนอน','สร้างภาพ: หมาน่ารัก','เจนรูปแมว','please generate an image of a dog','/image a dog']) assert.ok(imagePrompt(text),text);
  for(const text of ['ภาพนี้น่ารักดี','สร้างภาพได้ไหม','อย่าสร้างภาพหมา','ช่วยอธิบายการสร้างภาพ']) assert.equal(imagePrompt(text),undefined,text);
  assert.equal(requestedSize('แนวนอน 16:9'),'landscape');
  assert.equal(requestedSize('แนวตั้ง'),'portrait');
  assert.equal(requestedSize('จัตุรัส'),'square');
  assert.equal(requestedSize('9:16'),'tall');
  assert.equal(IMAGE_SIZES.landscape.width/IMAGE_SIZES.landscape.height,16/9);
  for(const {width,height} of Object.values(IMAGE_SIZES)){assert.equal(width%16,0);assert.equal(height%16,0);}
});

test('talking about a finished picture is chat, not an edit (15 ต.ค. bug)',()=>{
 const after=[{role:'assistant',parts:[{type:'image',url:'/x'}],toolRuns:[{tool:'generate_image'}]}];
 const k=(text)=>resolveImageIntent([...after,{role:'user',parts:[{type:'text',text}]}]).kind;
 for(const chat of ['สวยมาก ชอบสีท้องฟ้าตรงไหน','จริง ๆ เราแค่จะถามเธอนะ ว่าชอบสีท้องฟ้าตอนไหนที่สุด','ชอบตอนพระอาทิตย์ตกเหมือนกันเลย แสงสีทองที่สาดส่อง มันอบอุ่นจริง ๆ นะ','น่ารักมาก ตั้งชื่อให้แมวตัวนี้หน่อย','มันทำให้รู้สึกดีจัง','หมาพันธุ์นี้นิสัยเป็นยังไง'])
  assert.equal(k(chat),'none',chat);
 for(const edit of ['เปลี่ยนเป็นสีฟ้าได้ไหม','ช่วยปรับให้สว่างขึ้นหน่อย','ขอชุดสีแดง','แก้ผมให้ยาวขึ้น','ทำให้พื้นหลังเป็นทะเล','อยากให้เปลี่ยนพื้นหลังเป็นภูเขา','ได้ ๆ ลองทำตามที่เธอว่าดู','make it more dramatic'])
  assert.equal(k(edit),'refine',edit);
});
