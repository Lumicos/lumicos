import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import ts from 'typescript';
const source=fs.readFileSync(new URL('./SpokenChunks.ts',import.meta.url),'utf8');
const {SpokenChunks}=await import('data:text/javascript;base64,'+Buffer.from(ts.transpileModule(source,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ESNext}}).outputText).toString('base64'));
test('call preserves Thai text while waiting for a safe phrase boundary',()=>{
 const text='สวัสดีค่ะ วันนี้เราอยากชวนเธอคุยเรื่องที่น่าสนใจด้วยกันนะคะ';
 const call=new SpokenChunks(25,8),normal=new SpokenChunks();
 const prefix=text.slice(0,40);
 const emitted=call.push(prefix);
 assert.deepEqual(emitted,[]);assert.deepEqual(normal.push(prefix),[]);
 const all=[...emitted,...call.push(text.slice(40),true)].join('');
 assert.equal(all.replace(/\s/g,''),text.replace(/\s/g,''));
});
test('final short phrase flushes and later groups retain existing size',()=>{
 const chunker=new SpokenChunks(25,8);
 assert.deepEqual(chunker.push('สวัสดีค่ะ',true),['สวัสดีค่ะ']);
 assert.deepEqual(chunker.push('a'.repeat(90)),[]);
 assert.deepEqual(chunker.push('',true),['a'.repeat(90)]);
});
test('call does not split the Thai compound ช็อปปิ้ง before a nearby space',()=>{
 const text='ดูเหมือนว่าหลังจากช็อปปิ้ง เธอควรจะพักผ่อนสบายๆ นะ';
 const chunker=new SpokenChunks(25,8),chunks=[];
 for(let i=0;i<text.length;i+=3)chunks.push(...chunker.push(text.slice(i,i+3)));
 chunks.push(...chunker.push('',true));
 assert.equal(chunks.join('').replace(/\s/g,''),text.replace(/\s/g,''));
 assert.ok(chunks.some(chunk=>chunk.includes('ช็อปปิ้ง')));
 assert.ok(!chunks.some((chunk,index)=>chunk.endsWith('ช็อป')&&chunks[index+1]?.startsWith('ปิ้ง')));
});
test('call waits for phrase boundaries instead of splitting common Thai compounds',()=>{
 const cases=[
  ['วิกฤตเหล็กขาดตลาดน่าจะยืดเยื้อไปอีกสักสองถึงสามปี เธอจะให้ดูแนวโน้มไหม','ยืดเยื้อ'],
  ['แรมราคาแรงเป็นปัจจัยที่ทำให้ความต้องการสูงขึ้นนะ ถ้าเป็นแรม ราคาที่สูงขึ้นต้องติดตาม','ทำให้'],
 ];
 for(const [text,compound] of cases){
  const chunker=new SpokenChunks(25,8),chunks=[];
  for(let i=0;i<text.length;i+=3)chunks.push(...chunker.push(text.slice(i,i+3)));
  chunks.push(...chunker.push('',true));
  assert.ok(chunks.some(chunk=>chunk.includes(compound)),JSON.stringify(chunks));
 }
});
test('call-mode budget keeps a normal Thai reply in natural phrase-sized chunks',()=>{
 const text='โนวาคิดว่าการออกไปช็อปปิ้งด้วยกันวันนี้น่าจะสนุกมาก แล้วเราแวะกินขนมต่อกันได้นะคะ';
 const chunker=new SpokenChunks(55,20),chunks=[];
 for(let i=0;i<text.length;i+=3)chunks.push(...chunker.push(text.slice(i,i+3)));
 chunks.push(...chunker.push('',true));
 assert.equal(chunks.join('').replace(/\s/g,''),text.replace(/\s/g,''));
 assert.ok(chunks.length<=2,JSON.stringify(chunks));
 assert.ok(!chunks.some((chunk,index)=>chunk.endsWith('ช็อป')&&chunks[index+1]?.startsWith('ปิ้ง')));
});
