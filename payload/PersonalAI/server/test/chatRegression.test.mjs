import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {ConversationStore} from '../chat/conversationStore.mjs';
import {ToolRegistry} from '../tools/registry.mjs';
import {imageTools} from '../tools/imageTools.mjs';
import {normalizeImageSeed} from '../comfy/imageSeed.mjs';
import {runChatReply,compactContext,confirmedKnowledgeSave,DEFAULT_CHARACTER,DEFAULT_SETTINGS} from '../../.runtime/chat.mjs';
import {wantsTools} from '../../.runtime/chat.mjs';

const message=(role,text,createdAt=Date.now())=>({id:randomUUID(),role,parts:[{type:'text',text}],createdAt,status:'done'});

test('plugin creation requests enable tools in auto mode',()=>{
  assert.equal(wantsTools([message('user','ช่วยสร้างปลั๊กอินสรุปข้อความ')]),true);
  assert.equal(wantsTools([message('user','Build a plugin that normalizes text')]),true);
});

test('explicit confirmation to save a sourced answer into RAG enables tools',()=>{
  assert.equal(wantsTools([
    message('assistant','ข้อมูลจากเว็บนี้ตรงไหม และต้องการให้เพิ่มเข้าคลังความรู้ RAG ไหม?'),
    message('user','ถูก เพิ่มเลย'),
  ]),true);
});

test('RAG conversational confirmation requires correctness and a save instruction',()=>{
  assert.equal(confirmedKnowledgeSave('ถูกต้อง เก็บไว้เลย'),true);
  assert.equal(confirmedKnowledgeSave('ใช่ บันทึกเข้า RAG'),true);
  assert.equal(confirmedKnowledgeSave('เอาเป็นผลงานของจีซูละกัน'),false);
  assert.equal(confirmedKnowledgeSave('โอเค'),false);
  assert.equal(confirmedKnowledgeSave('ไม่ถูก อย่าเก็บ'),false);
});

test('a web turn with no real web evidence still answers, with a web-search-status note instead of a refusal',async()=>{
  const user=message('user','ลองหาในเน็ตดูก่อน');
  const conv={id:'web-guard',title:'Web guard',messages:[],createdAt:1,updatedAt:1,characterId:DEFAULT_CHARACTER.id};
  let providerCalls=0,sent='';
  const runtime={
    provider:{async streamChat(args){providerCalls++;sent=JSON.stringify(args?.messages??args)}},
    settings:{...DEFAULT_SETTINGS,memory:{...DEFAULT_SETTINGS.memory,enabled:false,autoCandidates:false}},
    resolveCharacter:()=>DEFAULT_CHARACTER,service:{online:true,tools:[]},localService:{},
    patchConversation:(id,fn)=>Object.assign(conv,fn(conv)),patchMessage:(id,mid,fn)=>{const i=conv.messages.findIndex(m=>m.id===mid);conv.messages[i]=fn(conv.messages[i])},
    setGeneratingId(){},setLastStats(){},abortRef:{current:null},imageJobRef:{current:null},approvals:{current:new Map()},chatEvents:{emit(){}},
    knowledgeContext:{decision:{route:'WEB',reason:'explicit-web-request'},evidence:'',citations:[],diagnostics:{status:'timeout'}},
  };
  await runChatReply(runtime,conv,[user],{id:'profile',ctx:8192,capabilities:{tools:true},generation:DEFAULT_SETTINGS.generation});
  assert.ok(providerCalls>=1);
  assert.match(sent,/web search timed out/);
  assert.doesNotMatch(conv.messages.at(-1).parts?.[0]?.text??'',/ไม่ขอตอบจากการคาดเดา/);
});

test('source of truth keeps delayed assistant directly after its triggering user and survives reload',async t=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'lumicos-order-'));t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));
  const file=path.join(dir,'conversations.json');
  const user1=message('user','one',100),reply1={...message('assistant','reply one',101),id:'reply-one'};
  const user2=message('user','two',200),reply2={...message('assistant','reply two',201),id:'reply-two'};
  fs.writeFileSync(file,JSON.stringify({revision:0,conversations:[{id:'chat',title:'Chat',messages:[user1,reply1,user2,reply2],createdAt:1,updatedAt:1}],jobs:[{conversationId:'chat',userId:user1.id,replyId:reply1.id,status:'done'},{conversationId:'chat',userId:user2.id,replyId:reply2.id,status:'done'}],characters:[],activeId:'chat'}));
  const store=new ConversationStore(file);
  store.patch('chat',c=>({...c,messages:[c.messages[0],c.messages[2],c.messages[3],c.messages[1]]}));
  assert.deepEqual(store.conversation('chat').messages.map(m=>m.id),[user1.id,reply1.id,user2.id,reply2.id]);
  await store.close();
  const reload=new ConversationStore(file);
  assert.deepEqual(reload.conversation('chat').messages.map(m=>m.id),[user1.id,reply1.id,user2.id,reply2.id]);
  await reload.close();
});

test('legacy offline errors with no reply link return to their timestamp-matched user instead of the chat bottom',async t=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'lumicos-legacy-order-'));t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));
  const file=path.join(dir,'conversations.json');
  const user1=message('user','first',100),user2=message('user','second',200),user3=message('user','current',300);
  const error1={...message('assistant','',100),id:'error-one',status:'error',error:'offline'};
  const error2={...message('assistant','',200),id:'error-two',status:'error',error:'offline'};
  const reply3={...message('assistant','current reply',301),id:'reply-three',replyToId:user3.id};
  fs.writeFileSync(file,JSON.stringify({revision:0,conversations:[{id:'chat',title:'Chat',messages:[user1,user2,user3,reply3,error1,error2],createdAt:1,updatedAt:1}],jobs:[],characters:[],activeId:'chat'}));
  const store=new ConversationStore(file);
  assert.deepEqual(store.conversation('chat').messages.map(m=>m.id),[user1.id,error1.id,user2.id,error2.id,user3.id,reply3.id]);
  await store.close();
});

test('10 FAST/AUTO + 10 DEEP turns keep user/reply order, one final response, and original history',async()=>{
  const conv={id:'chat',title:'Chat',messages:[],createdAt:1,updatedAt:1,characterId:DEFAULT_CHARACTER.id};
  const requests=[];let memoryWrites=0;
  const runtime={
    provider:{async streamChat(request,cb){requests.push(request);if(request.enableThinking)cb.onReasoning?.('คิด');cb.onToken('ตอบ');cb.onDone({stopped:false,stats:{tokensGenerated:1,tokensPerSecond:1,durationMs:1,promptTokens:1}})}},
    settings:{...DEFAULT_SETTINGS,tools:{...DEFAULT_SETTINGS.tools,mode:'off'},memory:{...DEFAULT_SETTINGS.memory,enabled:false,autoCandidates:false}},
    resolveCharacter:()=>DEFAULT_CHARACTER,service:{online:true,tools:[]},localService:{memory:{async create(){memoryWrites++}}},
    patchConversation:(id,fn)=>Object.assign(conv,fn(conv)),patchMessage:(id,mid,fn)=>{const i=conv.messages.findIndex(m=>m.id===mid);conv.messages[i]=fn(conv.messages[i])},
    setGeneratingId(){},setLastStats(){},abortRef:{current:null},imageJobRef:{current:null},approvals:{current:new Map()},chatEvents:{emit(){}},
  };
  for(let i=0;i<20;i++){
    runtime.settings.chatReasoningMode=i<10?(i%2?'AUTO':'FAST'):'DEEP';
    const user=message('user','turn-'+i,1000+i*2);const history=[...conv.messages,user];
    await runChatReply(runtime,conv,history,{ctx:8192,capabilities:{tools:false},generation:DEFAULT_SETTINGS.generation});
  }
  assert.equal(conv.messages.length,40);
  for(let i=0;i<20;i++){assert.equal(conv.messages[i*2].role,'user');assert.equal(conv.messages[i*2+1].role,'assistant');assert.equal(conv.messages[i*2+1].replyToId,conv.messages[i*2].id)}
  const replies=requests.filter(r=>r.purpose!=='context-summary');assert.ok(requests.some(r=>r.purpose==='context-summary'));
  assert.equal(replies.length,20);assert.ok(replies.slice(0,10).every(r=>r.enableThinking===false));assert.ok(replies.slice(10).every(r=>r.enableThinking===true));
  assert.equal(memoryWrites,0);
  const original=structuredClone(conv.messages);const compact=compactContext(conv,conv.messages);
  // The mock never writes a bullet summary, so folding fails and the raw-tail fallback is used.
  assert.equal(compact.history.length,16);assert.deepEqual(conv.messages,original);assert.ok(compact.summary.length<=2400);assert.equal(conv.contextSummaryUpTo,undefined);
});

test('rolling chat memory folds old turns into a written summary and keeps 8–16 recent messages',async()=>{
  const conv={id:'memory',title:'Memory',messages:[],createdAt:1,updatedAt:1,characterId:DEFAULT_CHARACTER.id};
  const sent=[];
  const runtime={
    provider:{async streamChat(request,cb){sent.push(request);if(request.purpose==='context-summary'){const n=sent.filter(r=>r.purpose==='context-summary').length;cb.onToken(`- สรุปช่วงที่ ${n}: ผู้ใช้ตั้งชื่อแมวว่าส้มซ่า`);}else cb.onToken('ตอบ');cb.onDone({stopped:false,stats:{tokensGenerated:1,tokensPerSecond:1,durationMs:1,promptTokens:1}})}},
    settings:{...DEFAULT_SETTINGS,tools:{...DEFAULT_SETTINGS.tools,mode:'off'},memory:{...DEFAULT_SETTINGS.memory,enabled:false,autoCandidates:false}},
    resolveCharacter:()=>DEFAULT_CHARACTER,service:{online:true,tools:[]},localService:{},
    patchConversation:(id,fn)=>Object.assign(conv,fn(conv)),patchMessage:(id,mid,fn)=>{const i=conv.messages.findIndex(m=>m.id===mid);conv.messages[i]=fn(conv.messages[i])},
    setGeneratingId(){},setLastStats(){},abortRef:{current:null},imageJobRef:{current:null},approvals:{current:new Map()},chatEvents:{emit(){}},
  };
  for(let i=0;i<20;i++){const user=message('user','turn-'+i,5000+i*2);await runChatReply(runtime,conv,[...conv.messages,user],{ctx:8192,capabilities:{tools:false},generation:DEFAULT_SETTINGS.generation});await new Promise(r=>setTimeout(r,5));/* the summary is written after the reply; a real user takes longer than this to type */}
  const folds=sent.filter(r=>r.purpose==='context-summary');
  assert.ok(folds.length>=2);assert.match(conv.contextSummary,/^- สรุปช่วงที่/);assert.ok(conv.contextSummaryUpTo);
  const compact=compactContext(conv,conv.messages);assert.ok(compact.history.length>=8&&compact.history.length<=16);assert.equal(compact.fold,undefined);
  // The newest reply request carries the written summary, not the raw transcript.
  const last=sent.filter(r=>r.purpose!=='context-summary').at(-1);assert.match(JSON.stringify(last.messages),/สรุปช่วงที่/);
  // Every fold receives the previous summary, so nothing earlier is lost.
  assert.match(JSON.stringify(folds.at(-1).messages),/สรุปช่วงที่ \d/);
});

test('FAST and DEEP each execute one missing-seed image call and normalize it before the image job',async()=>{
  for(const mode of ['FAST','DEEP']){
    const conv={id:'image-'+mode,title:'Image',messages:[],createdAt:1,updatedAt:1,characterId:DEFAULT_CHARACTER.id};
    const calls=[];let round=0;
    const registry=new ToolRegistry({});
    registry.register(imageTools({create:async args=>{const normalized={...args,seed:normalizeImageSeed(args.seed,()=>123456)};calls.push(normalized);return {id:'image-job',status:'queued'}}})[0]);
    const runtime={
      provider:{async streamChat(request,cb){
        if(round++===0)cb.onToken('กำลังสร้างค่ะ\n```tool\n{"tool":"generate_image","arguments":{"prompt":"An orange cat"}}\n```');
        else cb.onToken('เสร็จแล้วค่ะ');
        cb.onDone({stopped:false,stats:{tokensGenerated:1,tokensPerSecond:1,durationMs:1,promptTokens:1}});
      }},
      settings:{...DEFAULT_SETTINGS,chatReasoningMode:mode,tools:{...DEFAULT_SETTINGS.tools,mode:'always',confirmWrites:false},memory:{...DEFAULT_SETTINGS.memory,enabled:false,autoCandidates:false}},
      resolveCharacter:()=>DEFAULT_CHARACTER,service:{online:true,tools:registry.definitions()},
      localService:{
        tools:{validate:(name,args)=>registry.validate(name,args),execute:(name,args,approvalId)=>registry.execute(name,args,approvalId)},
        images:{async get(){return {id:'image-job',status:'done',images:[{url:'/api/images/test.png',variant:'original'}]}}},
        memory:{async create(){throw Error('unexpected memory write')}}
      },
      patchConversation:(id,fn)=>Object.assign(conv,fn(conv)),patchMessage:(id,mid,fn)=>{const i=conv.messages.findIndex(m=>m.id===mid);conv.messages[i]=fn(conv.messages[i])},
      setGeneratingId(){},setLastStats(){},abortRef:{current:null},imageJobRef:{current:null},approvals:{current:new Map()},chatEvents:{emit(){}}
    };
    const user=message('user','Generate an image of an orange cat',1);
    await runChatReply(runtime,conv,[user],{ctx:8192,capabilities:{tools:true},generation:DEFAULT_SETTINGS.generation});
    assert.equal(calls.length,1,mode+' duplicated the image tool');
    assert.equal(calls[0].seed,123456,mode+' did not normalize the missing seed');
    assert.equal(conv.messages.filter(m=>m.role==='assistant').length,1,mode+' created duplicate final responses');
  }
});
