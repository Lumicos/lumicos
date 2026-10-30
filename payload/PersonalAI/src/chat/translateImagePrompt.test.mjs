import {test} from 'node:test';
import assert from 'node:assert/strict';
import {translateImagePrompt} from './translateImagePrompt.ts';
const signal=()=>new AbortController().signal;
test('English prompt bypasses translation unchanged',async()=>{
 const provider={streamChat:()=>{throw Error('unexpected inference')}};
 assert.equal(await translateImagePrompt(provider,'A white poodle lying belly-up, 16:9',signal()),'A white poodle lying belly-up, 16:9');
});
test('Thai translation uses isolated messages and non-thinking output',async()=>{
 let request;
 const provider={streamChat:async(r,cb)=>{request=r;cb.onToken('A white poodle lying on its back, belly facing upward, paws in the air.');cb.onDone({stopped:false})}};
 const answer=await translateImagePrompt(provider,'พุดเดิ้ลสีขาวนอนหงายท้อง',signal());
 assert.match(answer,/belly facing upward/);assert.equal(request.enableThinking,false);assert.equal(request.messages.length,2);assert.equal(request.messages[1].content,'พุดเดิ้ลสีขาวนอนหงายท้อง');
});
test('empty, Thai, reasoning, network failure and cancellation never fall back to original',async()=>{
 for(const output of ['', 'หมาขาว', '<think>translate</think> A dog']){
  await assert.rejects(translateImagePrompt({streamChat:async(r,cb)=>{cb.onToken(output);cb.onDone({stopped:false})}},'หมาขาว',signal()),/ยังแปลพรอมต์/);
 }
 await assert.rejects(translateImagePrompt({streamChat:async(r,cb)=>cb.onError(Error('offline'))},'หมาขาว',signal()),/offline/);
 const controller=new AbortController();
 await assert.rejects(translateImagePrompt({streamChat:async(r,cb)=>{cb.onToken('A dog');controller.abort();cb.onDone({stopped:true})}},'หมาขาว',controller.signal),{name:'AbortError'});
});
test('token-limit truncation is rejected instead of submitting an incomplete description',async()=>{
 await assert.rejects(translateImagePrompt({streamChat:async(r,cb)=>{cb.onToken('A white dog with');cb.onDone({stopped:false,finishReason:'length'})}},'หมาขาว',signal()),/ขีดจำกัด/);
});
test('translation prompt tells the model to turn negations into positive descriptions',async()=>{
 let request;
 const provider={streamChat:async(r,cb)=>{request=r;cb.onToken('An empty street with only a red motorcycle.');cb.onDone({stopped:false})}};
 await translateImagePrompt(provider,'ถนนที่ไม่มีรถยนต์ มีแต่มอเตอร์ไซค์สีแดง',signal());
 assert.match(request.messages[0].content,/never write negations/);
 assert.match(request.messages[0].content,/instead of "no cars"/);
});
