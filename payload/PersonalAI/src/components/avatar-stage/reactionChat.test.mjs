import test from 'node:test';import assert from 'node:assert/strict';
import {runChatReply,DEFAULT_CHARACTER,DEFAULT_SETTINGS} from '../../../.runtime/chat.mjs';
test('real shared reply stores canonical reaction, strips streaming metadata and keeps Private nonpersistent',async()=>{
 for(const privateChat of [false,true])for(const mode of ['FAST','DEEP']){
  let calls=0,memoryCalls=0;const events=[],conv={id:'phase5-fixture',characterId:DEFAULT_CHARACTER.id,private:privateChat,messages:[]};
  const user={id:'user-fixture',role:'user',parts:[{type:'text',text:'สวัสดี'}]};
  await runChatReply({provider:{async streamChat(req,cb){calls++;assert.equal(req.enableThinking,mode==='DEEP');for(const t of ['สวัสดีค่ะ','\n[[','lumicos e=happy i=0.3 g=nod]]'])cb.onToken(t);cb.onDone({stopped:false})}},settings:{...DEFAULT_SETTINGS,chatReasoningMode:mode,memory:{enabled:true,autoCandidates:false,maxInjected:6}},resolveCharacter:()=>DEFAULT_CHARACTER,service:{online:true,tools:[]},localService:{memory:{async retrieve(){memoryCalls++;return []}}},patchConversation:(id,fn)=>Object.assign(conv,fn(conv)),patchMessage:(id,mid,fn)=>{const i=conv.messages.findIndex(m=>m.id===mid);conv.messages[i]=fn(conv.messages[i])},setGeneratingId(){},setLastStats(){},abortRef:{current:null},imageJobRef:{current:null},approvals:{current:new Map()},chatEvents:{emit:(name,payload)=>events.push({name,payload})}},conv,[user],{id:mode,ctx:8192,capabilities:{tools:true},generation:DEFAULT_SETTINGS.generation});
  const reply=conv.messages.at(-1);assert.equal(calls,1);assert.deepEqual(reply.reaction,{version:1,emotion:'happy',intensity:.3,gesture:'nod'});assert.equal(reply.parts[0].text.trim(),'สวัสดีค่ะ');assert.doesNotMatch(reply.modelText,/\[\[lumicos/);assert.doesNotMatch(events.filter(e=>e.name==='token').map(e=>e.payload.text).join(''),/\[\[lumicos/);
  if(privateChat){assert.equal(memoryCalls,0);assert.equal(events.length,0)}
 }
});
