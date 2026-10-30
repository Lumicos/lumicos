// claude-20261015: focused invariants for Conversation Reliability v2 (tasks 1–6).
// Fixtures/fake providers only (MOCK/STATIC): no real model, web, image or production data.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import * as runtime from '../../.runtime/chat.mjs';
import {ConversationStore} from '../chat/conversationStore.mjs';
import {ChatService} from '../chat/chatService.mjs';
import {ModelService} from '../llama/modelService.mjs';
import {ComfyService} from '../comfy/comfyService.mjs';
import {KnowledgeChatIntegration} from '../knowledge/chat/integration.mjs';
import {DeterministicKnowledgeRouter} from '../knowledge/router/router.mjs';
import {webTools} from '../knowledge/web/tool.mjs';
import {extractSearchConstraints,classifyWebResult,validateWebResults} from '../knowledge/web/queryRewrite.mjs';
import {imageReconcilePlan,applyImageJobState,markImageUntrackable,reconcileImageJob,LEGACY_IMAGE_PLACEHOLDER_MS} from '../../src/chat/imageJob.ts';
import {translateImagePrompt} from '../../src/chat/translateImagePrompt.ts';
import {LUMICOS_PERSONA} from '../../src/prompt/lumicosPersona.mjs';

const {runChatReply,compactContext,contextSummarySignature,DEFAULT_CHARACTER,DEFAULT_SETTINGS}=runtime;
const msg=(role,text,extra={})=>({id:randomUUID(),role,parts:[{type:'text',text}],createdAt:Date.now(),status:'done',...extra});
const tmp=(t,prefix)=>{const dir=fs.mkdtempSync(path.join(os.tmpdir(),prefix));t.after(()=>{if(path.dirname(dir)===os.tmpdir()&&path.basename(dir).startsWith(prefix))fs.rmSync(dir,{recursive:true,force:true})});return dir};
const NOW=Date.parse('2026-10-15T09:00:00Z');

/* ---------------- Task 1: final provider payload ---------------- */
function replyRuntime(conv,sent){
  return {
    provider:{async streamChat(request,cb){sent.push(request);cb.onToken('โอเค');cb.onDone({stopped:false,stats:{tokensGenerated:1,tokensPerSecond:1,durationMs:1,promptTokens:1}})}},
    settings:{...DEFAULT_SETTINGS,tools:{...DEFAULT_SETTINGS.tools,mode:'off'},memory:{...DEFAULT_SETTINGS.memory,enabled:false,autoCandidates:false}},
    resolveCharacter:()=>DEFAULT_CHARACTER,service:{online:true,tools:[]},localService:{},
    patchConversation:(id,fn)=>Object.assign(conv,fn(conv)),patchMessage:(id,mid,fn)=>{const i=conv.messages.findIndex(m=>m.id===mid);conv.messages[i]=fn(conv.messages[i])},
    setGeneratingId(){},setLastStats(){},abortRef:{current:null},imageJobRef:{current:null},approvals:{current:new Map()},chatEvents:{emit(){}},
    knowledgeContext:null,
  };
}
function movieHistory(){
  const h=[];
  for(let i=0;i<6;i++){h.push(msg('user',`ฝนบนดาวอังคาร ${i} `+'ก'.repeat(300)));h.push(msg('assistant',`ตอบเรื่องฝน ${i} `+'ข'.repeat(300)));}
  h.push(msg('user','จัดอันดับหนังที่ชอบให้หน่อย'));h.push(msg('assistant','1. Spirited Away 2. Your Name 3. Parasite'));
  h.push(msg('user','อันดับ 3 แย่ไหม'));h.push(msg('assistant','Parasite ไม่แย่เลยนะ'));
  return h;
}

test('A→B→compaction→"ไม่แย่ ๆ": final provider payload keeps the movie topic, drops the old summary first, order intact',async()=>{
  const h=movieHistory();
  const conv={id:'c1',title:'t',messages:[...h],createdAt:1,updatedAt:1,characterId:DEFAULT_CHARACTER.id,
    contextSummary:'- คุยเรื่องฝนบนดาวอังคาร '+'ฝน'.repeat(2500),contextSummaryUpTo:h[1].id,contextSummarySig:contextSummarySignature(h.slice(0,2))};
  const sent=[];const user=msg('user','ไม่แย่ ๆ');
  await runChatReply(replyRuntime(conv,sent),conv,[...h,user],{ctx:4500,capabilities:{tools:false},generation:{...DEFAULT_SETTINGS.generation,maxTokens:1000}});
  const reply=sent.filter(r=>r.purpose==='chat-reply').at(-1);assert.ok(reply,'chat reply sent');
  const m=reply.messages;
  assert.equal(m[0].role,'system');assert.equal(m[1].role,'user');assert.equal(m.at(-1).role,'user');
  assert.ok(m.at(-1).content.startsWith('ไม่แย่ ๆ'));
  for(let i=2;i<m.length;i++)assert.notEqual(m[i].role,m[i-1].role,'roles alternate');
  const body=m.map(x=>x.content).join('\n');
  assert.match(body,/Parasite/);assert.match(body,/อันดับ 3 แย่ไหม/);
  const info=conv.messages.at(-1).contextInfo;
  assert.ok(info.estimatedTokens<=4500-1000,'fits the budget');
  assert.deepEqual(info.droppedContext,['context-summary'],'old summary gives way before recent turns');
  assert.doesNotMatch(m[0].content,/ฝนบนดาวอังคาร/,'volatile summary never enters the cached system prefix');
});

test('tight budget with tools: tool call JSON is never cut, no orphan tool result leads the history, evidence URLs survive',()=>{
  const h=movieHistory().slice(-4);
  const call={id:'r1',tool:'web_search',args:{query:'Japan box office October 2026'},status:'done',callText:'```tool\n{"tool":"web_search","arguments":{"query":"Japan box office October 2026"}}\n```',resultForModel:'R'.repeat(9000)};
  const toolTurn={...msg('assistant','ผลค้น'),toolRuns:[call]};
  const history=[msg('user','ค้นเว็บหนังทำเงินญี่ปุ่น ต.ค. 2026'),toolTurn,...h,msg('user','ทำเป็นตารางให้หน่อย')];
  const {messages,info}=runtime.buildMessages({globalPrompt:'',character:DEFAULT_CHARACTER,userName:'U',greetingMode:'none',history,memories:[],
    evidenceContext:'[E1 kind=web title=JP url=https://example.jp/boxoffice]\n'+'ข้อมูล '.repeat(800),budget:{contextTokens:6000,replyTokens:600}});
  const body=messages.map(x=>x.content).join('\n');
  for(const t of messages)if(/```tool/.test(t.content))assert.match(t.content,/"arguments":\{"query":"Japan box office October 2026"\}\}\n```/);
  assert.ok(!/^\[Tool /.test(messages[1].content),'first history turn is not an orphaned tool result');
  assert.match(body,/https:\/\/example\.jp\/boxoffice/);
  assert.ok(messages.at(-1).content.startsWith('ทำเป็นตารางให้หน่อย'));
  assert.ok(!info.overBudget);
  assert.ok(info.shortened?.includes('tool-result')||info.shortened?.includes('evidence-excerpts'),'bulky material shortened, not the protocol');
});

test('when even the latest user message cannot fit, nothing malformed is sent: the reply reports the limit',async()=>{
  const conv={id:'c2',title:'t',messages:[],createdAt:1,updatedAt:1,characterId:DEFAULT_CHARACTER.id};
  const sent=[];const huge=msg('user','อ่านข้อความนี้ '+'ยาว'.repeat(6000));
  await runChatReply(replyRuntime(conv,sent),conv,[huge],{ctx:8192,capabilities:{tools:false},generation:{...DEFAULT_SETTINGS.generation,maxTokens:256}});
  assert.equal(sent.filter(r=>r.purpose==='chat-reply').length,0);
  assert.equal(conv.messages.at(-1).status,'error');assert.match(conv.messages.at(-1).error,/context/);
});

test('summary boundary: edited/deleted/regenerated prefix (same ids) invalidates the summary; appended turns do not',()=>{
  const h=[];for(let i=0;i<20;i++)h.push(msg(i%2?'assistant':'user','m'+i));
  const conv={id:'c',contextSummary:'- เก่า',contextSummaryUpTo:h[7].id,contextSummarySig:contextSummarySignature(h.slice(0,8))};
  assert.equal(compactContext(conv,h).base,'- เก่า','valid while unchanged');
  assert.equal(compactContext(conv,[...h,msg('user','ใหม่')]).base,'- เก่า','appending later messages keeps it');
  const edited=h.map((m,i)=>i===2?{...m,parts:[{type:'text',text:'แก้แล้ว'}],editedAt:5}:m);
  const c1=compactContext(conv,edited);assert.equal(c1.base,undefined);assert.equal(c1.invalidated,true);
  const deleted=h.filter((_,i)=>i!==3);assert.equal(compactContext(conv,deleted).base,undefined,'deleted message inside prefix');
  assert.equal(compactContext(conv,h.slice(0,6)).base,undefined,'boundary gone (regenerate/delete)');
  const legacy={id:'c',contextSummary:'- เก่า',contextSummaryUpTo:h[7].id};
  assert.equal(compactContext(legacy,h).base,'- เก่า');assert.equal(compactContext(legacy,edited).base,undefined,'legacy summary with an edited prefix is not trusted');
});

/* ---------------- Task 2: deferred summary (server/shared path) ---------------- */
function deferred(t,replyPatch){
  const dir=tmp(t,'lumicos-claude-sum-');
  const store=new ConversationStore(path.join(dir,'conversations.json'));
  const history=[];for(let i=0;i<20;i++)history.push(msg(i%2?'assistant':'user','turn '+i));
  const cid='conv1';store.state.conversations.push({id:cid,title:'t',characterId:DEFAULT_CHARACTER.id,messages:history,createdAt:1,updatedAt:1});
  const calls={fold:0,begin:0,end:0};const folds=[];
  const models={turns:new Map(),callSession:null,enqueueChat:ModelService.prototype.enqueueChat,
    async begin(){calls.begin++;const id=randomUUID();this.turns.set(id,{});return {id,profile:{ctx:8192,capabilities:{tools:false},generation:{maxTokens:100}}}},touch(){},async end(id){calls.end++;this.turns.delete(id)}};
  const chats=new ChatService({store,models,config:{port:0,internalToken:'x'},tools:{definitions:()=>[]}});
  const fake={...runtime,LlamaCppProvider:class{},createServiceClient:()=>({}),
    async runChatReply(rt,c){assert.equal(rt.deferContextSummary,true);rt.patchMessage(c.id,rt.replyId,m=>({...m,parts:[{type:'text',text:'ตอบ'}],status:'done',...(replyPatch??{})}))},
    foldContext(provider,previous,block,signal){calls.fold++;return new Promise(resolve=>{folds.push({block,signal,resolve});signal.addEventListener('abort',()=>resolve(undefined),{once:true})})}};
  chats.runtime=async()=>fake;
  t.after(async()=>{chats.close();await models.chatTail;await store.close()});
  const submit=(text='ใหม่')=>chats.submit({requestId:randomUUID(),conversationId:cid,user:{id:randomUUID(),role:'user',parts:[{type:'text',text}]},settings:{memory:{enabled:false},tools:{mode:'off'}}});
  const until=async cond=>{for(let i=0;i<500&&!cond();i++)await new Promise(r=>setTimeout(r,2));assert.ok(cond())};
  return {store,chats,models,calls,folds,cid,submit,until,conv:()=>store.state.conversations.find(c=>c.id===cid)};
}

test('deferred summary: the reply and job finish before the summary; it saves only its fields and keeps later messages',async t=>{
  const f=deferred(t);const job=await f.submit();
  await f.until(()=>f.folds.length===1);
  assert.equal(job.status,'done','job is done while the summary is still running');
  assert.equal(f.conv().messages.find(m=>m.id===job.replyId).status,'done');
  assert.equal(f.calls.begin,1,'no second model turn / wake for the summary');
  f.folds[0].resolve('- สรุปใหม่');await f.models.chatTail;
  const c=f.conv();assert.equal(c.contextSummary,'- สรุปใหม่');assert.equal(c.contextSummaryUpTo,f.folds[0].block.at(-1).id);
  assert.equal(c.contextSummarySig,contextSummarySignature(c.messages.slice(0,c.messages.findIndex(m=>m.id===c.contextSummaryUpTo)+1)));
  assert.equal(c.messages.length,22,'messages untouched');assert.equal(f.calls.end,1,'turn released once');
});

test('deferred summary: a new chat aborts it and goes first; the stale result is never written',async t=>{
  const f=deferred(t);await f.submit();await f.until(()=>f.folds.length===1);
  const second=await f.submit('ข้อความใหม่');
  assert.equal(f.folds[0].signal.aborted,true,'new chat has priority');
  await f.until(()=>second.status==='done');
  f.folds[0].resolve('- ผลเก่า');
  for(const x of f.folds.slice(1))x.resolve(undefined);
  await f.models.chatTail;
  assert.notEqual(f.conv().contextSummary,'- ผลเก่า');
});

test('deferred summary: edited prefix (same id), a newer summary, or a deleted conversation → result rejected',async t=>{
  const f=deferred(t);await f.submit();await f.until(()=>f.folds.length===1);
  const target=f.conv().messages[1];
  f.store.patch(f.cid,cur=>({...cur,messages:cur.messages.map(m=>m.id===target.id?{...m,parts:[{type:'text',text:'แก้ไขแล้ว'}],editedAt:9}:m)}));
  f.folds[0].resolve('- สรุปจากข้อความเดิม');await f.models.chatTail;
  assert.equal(f.conv().contextSummary,undefined,'edited prefix rejects the old fold');

  const g=deferred(t);await g.submit();await g.until(()=>g.folds.length===1);
  g.store.patch(g.cid,cur=>({...cur,contextSummary:'- ใหม่กว่า',contextSummaryUpTo:cur.messages[7].id,contextSummarySig:'x'}));
  g.folds[0].resolve('- เก่ากว่า');await g.models.chatTail;
  assert.equal(g.conv().contextSummary,'- ใหม่กว่า','newer summary wins');

  const h=deferred(t);await h.submit();await h.until(()=>h.folds.length===1);
  h.store.state.conversations=h.store.state.conversations.filter(x=>x.id!==h.cid);
  h.folds[0].resolve('- ลบแล้ว');await h.models.chatTail;
  assert.equal(h.conv(),undefined,'deleted conversation is not recreated');
});

test('deferred summary: skipped after an image turn (would wake Gemma / close ComfyUI)',async t=>{
  const f=deferred(t,{parts:[{type:'image',source:'generated',url:'/x'}],toolRuns:[{tool:'generate_image',status:'done',data:{jobId:'j'}}]});
  const job=await f.submit();await f.until(()=>job.status==='done');await f.models.chatTail;
  assert.equal(f.calls.fold,0);
});

/* ---------------- Task 3: web evidence fit ---------------- */
test('constraints come from user words (Thai/English, พ.ศ./ค.ศ.); latest correction wins, follow-up inherits',()=>{
  assert.deepEqual(extractSearchConstraints('หนังทำเงินญี่ปุ่น ต.ค. 2026'),{countries:['JP'],year:2026,month:10,ranking:'box-office',category:'movie'});
  assert.equal(extractSearchConstraints('ตุลาคม 2569').year,2026);
  const router=new DeterministicKnowledgeRouter();
  const prev={previousQuery:'หนังทำเงินญี่ปุ่น ต.ค. 2026',previousRoute:'WEB'};
  assert.equal(router.route({query:'ทำเป็นตารางให้หน่อย',context:prev}).route,'DIRECT','formatting the previous answer does not search (no country/year drift)');
  const more=router.route({query:'แล้วอันดับ 2 ล่ะ',context:prev});
  assert.deepEqual(extractSearchConstraints(more.resolvedQuery).countries,['JP']);assert.equal(extractSearchConstraints(more.resolvedQuery).year,2026);
  const thai=router.route({query:'แล้วของไทยล่ะ',context:prev});
  assert.deepEqual(extractSearchConstraints(thai.resolvedQuery).countries,['TH'],'explicit correction replaces Japan');
  assert.equal(extractSearchConstraints(thai.resolvedQuery).year,2026,'period still inherited');
});

test('fit: Thai 2024 table, anime schedule and manga sales are mismatches; JP in USD, undated snippet, other years in body stay usable',()=>{
  const c=extractSearchConstraints('หนังทำเงินญี่ปุ่น ต.ค. 2026');
  const v=r=>classifyWebResult(r,c).verdict;
  assert.equal(v({title:'หนังทำเงินสูงสุดในไทย ปี 2024',snippet:'อันดับ',url:'https://b.co.th/'}),'mismatch');
  assert.equal(v({title:'Fall 2026 anime schedule',snippet:'simulcast',url:'https://c.com/'}),'mismatch');
  assert.equal(v({title:'Top manga sales ranking 2026',snippet:'ยอดขายมังงะ',url:'https://d.com/'}),'mismatch');
  assert.notEqual(v({title:'Japan weekend box office',snippet:'Detective Conan earned US$12M in Japan',url:'https://e.com/'}),'mismatch','USD does not disprove Japan');
  assert.equal(v({title:'Box office report',snippet:'top films this week',url:'https://f.com/'}),'unknown','missing country/date is unknown, not wrong');
  assert.notEqual(v({title:'Japan box office October',snippet:'compared with the 2019 record, this month…',url:'https://g.com/'}),'mismatch','a year mentioned in passing is not a mismatch');
  assert.equal(v({title:'Japan box office October 2026',snippet:'興行収入 ranking',url:'https://h.com/'}),'match');
  const {validation}=validateWebResults([{title:'Japan box office October 2026',snippet:'x',url:'https://h.com/'}],c,{now:NOW});
  assert.equal(validation.periodOpen,true,'October 2026 is not finished on 15 Oct');
});

test('automatic route: mismatches removed, unverified labelled, scope note; mismatch-only is reported distinctly',async()=>{
  const compatibility={forKnowledge:async()=>({validity:'missing',outputMode:'plain-text-citations',toolTransport:'plain-text'})};
  const settings={...DEFAULT_SETTINGS,knowledge:{...DEFAULT_SETTINGS.knowledge,enabled:true,webEnabled:true,searchMode:'AUTO'}};
  const make=results=>new KnowledgeChatIntegration({router:{route:()=>({route:'WEB',resolvedQuery:'หนังทำเงินญี่ปุ่น ต.ค. 2026',reason:'freshness-required'})},compatibility,
    executor:{execute:async()=>({local:[],memory:[],web:{provider:'fx',searchedAt:'2026-10-15T00:00:00Z',results,diagnostics:{status:'ok'}},diagnostics:{route:'WEB'}})}});
  const mixed=await make([{title:'Japan box office October 2026',snippet:'Chainsaw Man',url:'https://h.com/a'},{title:'หนังทำเงินไทย 2024',snippet:'x',url:'https://b.co.th/'},{title:'Box office report',snippet:'top films',url:'https://f.com/'}])
    .prepare({query:'หนังทำเงินญี่ปุ่น ต.ค. 2026',settings});
  assert.doesNotMatch(mixed.evidence,/b\.co\.th/);assert.match(mixed.evidence,/fit=match/);assert.match(mixed.evidence,/fit=unverified/);assert.match(mixed.evidence,/^\[Evidence scope\]/);
  assert.equal(mixed.citations.length,2);assert.equal(mixed.diagnostics.validation.status,'partial');
  assert.ok(!JSON.stringify(mixed.diagnostics.validation).includes('Chainsaw'),'diagnostics are bounded (no snippet text)');
  const none=await make([{title:'หนังทำเงินไทย 2024',snippet:'x',url:'https://b.co.th/'}]).prepare({query:'หนังทำเงินญี่ปุ่น ต.ค. 2026',settings});
  assert.equal(none.citations.length,0);assert.equal(none.diagnostics.validation.status,'mismatch_only');
  const conv={id:'w',title:'t',messages:[],createdAt:1,updatedAt:1,characterId:DEFAULT_CHARACTER.id};const sent=[];
  const rt=replyRuntime(conv,sent);rt.knowledgeContext={...none,decision:{route:'WEB'}};
  await runChatReply(rt,conv,[msg('user','หนังทำเงินญี่ปุ่น ต.ค. 2026')],{ctx:8192,capabilities:{tools:false},generation:DEFAULT_SETTINGS.generation});
  assert.match(JSON.stringify(sent.at(-1).messages),/none were about the market\/period/);
});

test('explicit web_search tool path uses the same validation without a second search; timeout stays a timeout',async()=>{
  let searches=0;const [tool]=webTools({search:async()=>{searches++;return {results:[{title:'Japan box office October 2026',snippet:'x',url:'https://h.com/a'},{title:'หนังทำเงินไทย 2024',snippet:'y',url:'https://b.co.th/'}],diagnostics:{status:'ok'}}}});
  const r=await tool.handler({query:'Japan box office October 2026'});
  assert.equal(searches,1);assert.equal(r.data.results.length,1);assert.match(r.summary,/ตัดที่ไม่ตรง 1/);assert.match(r.content,/Evidence scope/);
  await assert.rejects(webTools({search:async()=>({results:[],diagnostics:{status:'timeout'}})})[0].handler({query:'q'}),/เกินเวลา/);
});

/* ---------------- Task 4: stopping cue (STATIC) ---------------- */
test('stopping-cue rule distinguishes a bare cue from a cue followed by a new question (STATIC: prompt text only)',()=>{
  const rule=[].concat(LUMICOS_PERSONA).join('\n').split('\n').find(r=>r.includes('Stopping cues'));
  assert.match(rule,/whole message is just a stopping cue/);assert.match(rule,/ไม่เป็นไร แล้วดาวอังคารมีหิมะไหม/);assert.match(rule,/answer the new part/);
});

/* ---------------- Task 5: image placeholders after reload ---------------- */
const job=(status,extra={})=>({id:'job-1',status,images:status==='done'?[{url:'/i.png',alt:'a',variant:'original'}]:[],...extra});
const placeholder=(extra={})=>({id:'r',role:'assistant',parts:[{type:'text',text:'กำลังสร้างภาพ…'}],createdAt:NOW-1000,status:'streaming',imageJob:{requestId:'root-1',jobId:'job-1'},...extra});

test('reconcile maps confirmed server states only: done/failed/cancelled; queued/running keep following',()=>{
  const p=placeholder();
  assert.equal(applyImageJobState(p,'job-1',job('done')).status,'done');
  assert.equal(applyImageJobState(p,'job-1',job('failed',{error:'boom'})).error,'boom');
  assert.equal(applyImageJobState(p,'job-1',job('cancelled')).status,'stopped');
  for(const s of ['queued','preparing','running'])assert.equal(applyImageJobState(p,'job-1',job(s)),undefined);
  assert.equal(applyImageJobState({...p,status:'done'},'job-1',job('running')),undefined,'late poll never rewrites a terminal message');
  assert.equal(applyImageJobState({...p,imageJob:{jobId:'job-2'}},'job-1',job('done')),undefined,'stale poll for another job');
  assert.deepEqual(imageReconcilePlan(p,undefined,NOW),{kind:'poll',jobId:'job-1'});
  const tool={...placeholder({imageJob:undefined}),toolRuns:[{tool:'generate_image',status:'done',data:{jobId:'job-9'}}]};
  assert.deepEqual(imageReconcilePlan(tool,undefined,NOW),{kind:'poll',jobId:'job-9'},'generate_image tool path');
  assert.equal(imageReconcilePlan({...msg('assistant','x'),status:'streaming'},msg('user','hi'),NOW),null,'non-image chat untouched');
});

test('legacy placeholder without job id: no guessing; only old ones end, with a "cannot verify" note',()=>{
  const prevReq={...msg('user','วาดแมว'),imageRequest:{kind:'create',prompt:'วาดแมว'}};
  const young=placeholder({imageJob:{requestId:'root'},createdAt:NOW-60_000});
  assert.equal(imageReconcilePlan(young,prevReq,NOW),null,'may still be translating in another tab');
  const old={...placeholder({imageJob:undefined}),createdAt:NOW-LEGACY_IMAGE_PLACEHOLDER_MS-1};
  assert.deepEqual(imageReconcilePlan(old,prevReq,NOW),{kind:'untrackable'});
  const ended=markImageUntrackable(old,'no-job-id');assert.equal(ended.status,'error');assert.match(ended.error,/ไม่ทราบว่างานบนเซิร์ฟเวอร์เสร็จหรือหยุด/);
  assert.equal(markImageUntrackable(placeholder(),'no-job-id'),undefined,'a message with a job id is never marked legacy');
});

test('reconcile loop: offline/5xx/auth never write; 404 is "cannot verify"; abort ignores late responses',async()=>{
  const sleep=async()=>{};
  const run=async responses=>{const applied=[];let notFound=0;let i=0;
    const result=await reconcileImageJob({jobId:'job-1',signal:new AbortController().signal,sleep,maxErrors:3,getJob:async()=>{const r=responses[Math.min(i++,responses.length-1)];if(r instanceof Error)throw r;return r},apply:j=>applied.push(j.status),onNotFound:()=>notFound++});
    return {result,applied,notFound}};
  const err=(status,code)=>Object.assign(new Error('x'),{status,code});
  assert.deepEqual(await run([job('queued'),job('running'),job('done')]),{result:'applied',applied:['done'],notFound:0});
  assert.deepEqual(await run([err(0,'OFFLINE')]),{result:'unreachable',applied:[],notFound:0});
  assert.deepEqual(await run([err(502,'OFFLINE'),job('cancelled')]),{result:'applied',applied:['cancelled'],notFound:0});
  assert.deepEqual(await run([err(401)]),{result:'auth',applied:[],notFound:0});
  assert.deepEqual(await run([err(404)]),{result:'not-found',applied:[],notFound:1});
  const ctl=new AbortController();let release;
  const late=reconcileImageJob({jobId:'job-1',signal:ctl.signal,sleep,getJob:()=>new Promise(r=>{release=r}),apply:()=>assert.fail('late response written'),onNotFound(){}});
  await new Promise(r=>setImmediate(r));ctl.abort();release(job('done'));assert.equal(await late,'stopped','switching chat stops client tracking only');
  assert.match(markImageUntrackable(placeholder(),'not-found','job-1').error,/ไม่ได้แปลว่างานล้มเหลว/);
});

test('reconcile only reads jobs: the image service create/cancel are never called',async()=>{
  const service={created:0,cancelled:0,create(){this.created++},cancel(){this.cancelled++},get:async()=>job('done')};
  await reconcileImageJob({jobId:'job-1',signal:new AbortController().signal,sleep:async()=>{},getJob:id=>service.get(id),apply(){},onNotFound(){}});
  assert.equal(service.created,0);assert.equal(service.cancelled,0);
});

/* ---------------- Task 6: purpose + correlation chain ---------------- */
test('translation sends purpose:image-prompt with the root id in the envelope, not in the prompt',async()=>{
  let req;const provider={streamChat:async(r,cb)=>{req=r;cb.onToken('A cat');cb.onDone({stopped:false,finishReason:'stop'})}};
  await translateImagePrompt(provider,'แมวสีส้ม',new AbortController().signal,'','root-123');
  assert.equal(req.purpose,'image-prompt');assert.equal(req.correlationId,'root-123');assert.ok(!JSON.stringify(req.messages).includes('root-123'));
});

test('image job keeps its own id, logs root/message links for tracing; bad trace ids rejected',async t=>{
  const dir=tmp(t,'lumicos-claude-img-');
  const comfy=Object.create(ComfyService.prototype);comfy.config={dataDir:dir};comfy.models=null;
  await comfy.logImageStage({id:'00000000-0000-4000-8000-000000000001',requestCorrelationId:'root-1',messageId:'msg-1',width:1,height:1,status:'queued'},'request_received');
  const row=JSON.parse(fs.readFileSync(path.join(dir,'logs','image-jobs.jsonl'),'utf8').trim());
  assert.equal(row.correlationId,'00000000-0000-4000-8000-000000000001','existing consumer field = job id (unchanged)');
  assert.equal(row.requestCorrelationId,'root-1');assert.equal(row.messageId,'msg-1');
  await assert.rejects(comfy.create({prompt:'cat',correlationId:'bad id with spaces'}),/Invalid trace id/);
});

// ---- step 2 (claude-20261015): token estimator calibrated against the Gemma 4 tokenizer ----
const TOKENIZER_SAMPLES=[
  // [text, real token count measured with the Gemma 4 E4B vocabulary]
  ['You are a careful assistant. Keep answers short and on topic. When the user asks you to search the web, use only web results and cite the source URL for each claim you make. Never mix in older notes unless asked.',46],
  ['ฝนตกเพราะไอน้ำในอากาศควบแน่นเป็นละอองน้ำเล็ก ๆ แล้วรวมตัวกันจนหนักเกินกว่าอากาศจะพยุงไว้ได้ จึงตกลงมาเป็นหยดฝน บนดาวอังคารบรรยากาศบางมากและเย็นจัด จึงไม่มีฝนน้ำแบบบนโลก',63],
  ['export const estimateTokens = (text: string) => Math.ceil(text.length / 2.4) + 4;\nfunction foo(a: number, b: number) { return a * b + 42; }\n',52],
];
test('token estimator: English is no longer counted like Thai; low bound never above real; pessimistic bound stays near',()=>{
  for(const [text,real] of TOKENIZER_SAMPLES){
    const hi=runtime.estimateTokens(text),lo=runtime.estimateTokensLow(text);
    assert.ok(lo<=real*1.25,`low ${lo} vs real ${real}`);
    assert.ok(hi>=real*0.8&&hi<=real*1.6,`pessimistic ${hi} vs real ${real}`);
    assert.ok(lo<=hi);
  }
  const sum=(f)=>TOKENIZER_SAMPLES.reduce((a,[x])=>a+f(x),0),realTotal=TOKENIZER_SAMPLES.reduce((a,[,r])=>a+r,0);
  assert.ok(sum(runtime.estimateTokensLow)<=realTotal*1.1,'low bound is optimistic overall');
  assert.ok(sum(runtime.estimateTokens)>=realTotal,'pessimistic bound is not below real overall');
  const english=TOKENIZER_SAMPLES[0][0];
  assert.ok(runtime.estimateTokens(english)<Math.ceil(english.length/2.4)*0.85,'English clearly cheaper than the old flat ÷2.4');
});

test('overBudget only when even the optimistic estimate cannot fit (no false "too long" errors)',()=>{
  const build=(n)=>runtime.buildMessages({globalPrompt:'',character:runtime.DEFAULT_CHARACTER,userName:'U',greetingMode:'none',memories:[],
    history:[{id:randomUUID(),role:'user',parts:[{type:'text',text:'word '.repeat(n)}],createdAt:Date.now(),status:'done'}],
    budget:{contextTokens:4000,replyTokens:500}});
  const limit=4000-500-64;
  const window=[];let hugeOver=false;
  for(let n=100;n<=2400;n+=50){
    const {info}=build(n);
    if(info.estimatedTokens>limit&&!info.overBudget)window.push(n);
    if(n===2400)hugeOver=!!info.overBudget;
  }
  assert.ok(window.length>0,'borderline sizes (pessimistic > limit, optimistic fits) must not be refused');
  assert.ok(hugeOver,'a message that cannot fit even optimistically is still refused');
});
