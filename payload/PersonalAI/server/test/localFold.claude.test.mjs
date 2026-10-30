import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {runChatReply,DEFAULT_CHARACTER,DEFAULT_SETTINGS} from '../../.runtime/chat.mjs';

const message=(role,text,createdAt)=>({id:randomUUID(),role,parts:[{type:'text',text}],createdAt,status:'done'});
const profile={ctx:8192,capabilities:{tools:false},generation:DEFAULT_SETTINGS.generation};
function rig(foldGate){
  const conv={id:'lf',title:'t',messages:[],createdAt:1,updatedAt:1,characterId:DEFAULT_CHARACTER.id};
  const sent=[];
  const runtime={
    provider:{async streamChat(request,cb,signal){
      sent.push(request.purpose);
      if(request.purpose==='context-summary'){
        if(foldGate)await foldGate(signal);
        if(signal?.aborted){cb.onDone({stopped:true});return;}
        cb.onToken('- สรุป: ผู้ใช้ตั้งชื่อแมวว่าส้มซ่า');
      }else cb.onToken('ตอบ');
      cb.onDone({stopped:false,stats:{tokensGenerated:1,tokensPerSecond:1,durationMs:1,promptTokens:1}});
    }},
    settings:{...DEFAULT_SETTINGS,tools:{...DEFAULT_SETTINGS.tools,mode:'off'},memory:{...DEFAULT_SETTINGS.memory,enabled:false,autoCandidates:false}},
    resolveCharacter:()=>DEFAULT_CHARACTER,service:{online:true,tools:[]},localService:{},
    patchConversation:(id,fn)=>Object.assign(conv,fn(conv)),patchMessage:(id,mid,fn)=>{const i=conv.messages.findIndex(m=>m.id===mid);conv.messages[i]=fn(conv.messages[i])},
    setGeneratingId(){},setLastStats(){},abortRef:{current:null},imageJobRef:{current:null},approvals:{current:new Map()},chatEvents:{emit(){}},
  };
  const turn=async i=>{const user=message('user','turn-'+i,9000+i*2);await runChatReply(runtime,conv,[...conv.messages,user],profile)};
  return {conv,sent,runtime,turn};
}
const settle=()=>new Promise(r=>setTimeout(r,20));

test('local path: the context summary is written AFTER the reply, never before it',async()=>{
  const r=rig();
  for(let i=0;i<9;i++){await r.turn(i);await settle()}   // 18 messages: the first fold is due on the 9th turn
  const at=r.sent.indexOf('context-summary');
  assert.ok(at>0,'a summary was requested');
  // The reply of the turn that made the fold due is requested before the summary, and nothing summary-shaped precedes a reply.
  assert.equal(r.sent[at-1],'chat-reply');
  assert.equal(r.sent.filter(p=>p==='chat-reply').length,9);
  assert.match(r.conv.contextSummary,/^- สรุป/);
  assert.ok(r.conv.contextSummaryUpTo);
});

test('local path: the reply is finished and shown while the summary is still being written',async()=>{
  let release;const gate=new Promise(res=>{release=res});
  const r=rig(()=>gate);
  for(let i=0;i<8;i++){await r.turn(i);await settle()}
  await r.turn(8);                                        // must resolve although the summary call is blocked
  assert.equal(r.conv.messages.at(-1).status,'done');
  assert.equal(r.conv.contextSummary,undefined,'not written yet');
  release();await settle();
  assert.match(r.conv.contextSummary,/^- สรุป/);
});

test('local path: a newer message cancels the pending summary, which is then dropped',async()=>{
  let release;const gate=new Promise(res=>{release=res});
  let first=true;
  const r=rig(async signal=>{if(first){first=false;await gate}});
  for(let i=0;i<9;i++){await r.turn(i);await settle()}   // summary #1 pending on the gate
  await r.turn(9);                                       // starts: aborts #1
  release();await settle();
  assert.equal(r.conv.contextSummary&&r.conv.contextSummary.length>0,true,'the later fold still lands');
  assert.ok(r.conv.messages.at(-1).status==='done');
});

test('local path: no summary after a failed reply',async()=>{
  const r=rig();
  for(let i=0;i<8;i++){await r.turn(i);await settle()}
  const real=r.runtime.provider.streamChat;
  r.runtime.provider.streamChat=async(req,cb,sig)=>{if(req.purpose!=='context-summary'){r.sent.push(req.purpose);cb.onError(new Error('offline'));return}return real(req,cb,sig)};
  await r.turn(8);await settle();
  assert.equal(r.sent.includes('context-summary'),false);
  assert.equal(r.conv.contextSummary,undefined);
});
