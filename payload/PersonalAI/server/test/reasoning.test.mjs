import test from 'node:test';
import assert from 'node:assert/strict';
import {routeChatReasoning} from '../../src/chat/reasoningRouter.mjs';
import {runChatReply,LlamaCppProvider,DEFAULT_SETTINGS,DEFAULT_CHARACTER} from '../../.runtime/chat.mjs';
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
test('FAST is the default for everyday chat, tools, vision, files and roleplay',()=>{
 for(const prompt of ['Hi Lumicos','สวัสดี','อธิบายแรงโน้มถ่วง','แปลประโยค think deeply','Summarize this complex architecture document','Search the web for the latest Qwen Image information','Generate a 16:9 image of a cat','ช่วยเจนภาพแมวแนวนอน','แก้ภาพก่อนหน้าให้สว่างขึ้น','ดูรูปนี้แล้วอธิบาย','อ่าน PDF แล้วสรุป','Compare these two phones','Let us roleplay a detective scene','สวมบทเป็นเจ้าหญิงที่มีอารมณ์ซับซ้อน','เล่าฉากสั้นที่มีหลายตัวละคร','พูดคุยให้กำลังใจเรา','Continue our dialogue','Tell a story about complex debugging','Explain complex architecture in simple terms','Tell me about complex debugging'])assert.equal(routeChatReasoning('AUTO',prompt).effective,'FAST',prompt);
});
test('AUTO also stays FAST by default, including analytical phrasing in roleplay',()=>{
 for(const prompt of ['Debug this complex deadlock and find its root cause','Analyze a complex architecture','Plan a large-scale migration','Check long-term story continuity across many previous events','Resolve complicated lore contradictions','วางแผนซับซ้อนสำหรับหลายตัวละคร','ตรวจความต่อเนื่องตลอดทั้งเรื่อง','วิเคราะห์ข้อมูลซับซ้อนหลายขั้นตอน','ช่วยแก้โจทย์หลายขั้นตอน','Think deeply about this problem','สวมบทเป็นนักสืบและวิเคราะห์แรงจูงใจของตัวละคร'])assert.equal(routeChatReasoning('AUTO',prompt).effective,'FAST',prompt);
});
test('explicit FAST/DEEP always override router; unknown modes fall back FAST',()=>{
 assert.equal(routeChatReasoning('FAST','Think deeply and debug this complex architecture').effective,'FAST');
 assert.equal(routeChatReasoning('DEEP','Hello').effective,'DEEP');
 assert.deepEqual(routeChatReasoning('invalid','Hi'),{selected:'FAST',effective:'FAST',reason:'manual-fast'});
});
async function reply({mode='FAST',text='Hello',source,tool=false,privateChat=false,failTool=false,knowledgeContext}={}){
 const requests=[],events=[],messages=[];let toolExecutions=0,memoryRetrievals=0;
 const conv={id:'conversation',characterId:DEFAULT_CHARACTER.id,private:privateChat,messages:[],createdAt:1,updatedAt:1,title:'Chat'};
 const user={id:'user',role:'user',createdAt:1,source,parts:[{type:'text',text}]};
 const character={...DEFAULT_CHARACTER,personality:'Maintain complex architecture and long-term story continuity. Stay Lumicos.'};
 const transport=async(url,init)=>{
  const request=JSON.parse(init.body).request;requests.push(request);await sleep(2);
  const index=requests.length;const thinking=request.chat_template_kwargs.enable_thinking;
  const content=tool&&index===1?'\x60\x60\x60tool\n{"tool":"web_search","arguments":{"query":"latest model"}}\n\x60\x60\x60':'สวัสดีค่ะ';
  const chunks=[];
  if(thinking)chunks.push({choices:[{delta:{reasoning_content:'reason'}}]});
  chunks.push({choices:[{delta:{content}}]},{choices:[{delta:{},finish_reason:'stop'}],timings:{prompt_ms:7,prompt_n:20,predicted_n:3,predicted_per_second:30,predicted_ms:100}});
  return new Response(chunks.map(c=>'data: '+JSON.stringify(c)+'\n\n').join('')+'data: [DONE]\n\n',{headers:{'Content-Type':'text/event-stream'}});
 };
 const client={memory:{async retrieve(){memoryRetrievals++;await sleep(1);return [{memory:{id:'memory',type:'fact',content:'You like orange cats'},score:1,reason:'match'}]}},tools:{async validate(){return {permission:'read',preview:{},approvalId:'ok'}},async execute(){toolExecutions++;await sleep(3);if(failTool)throw new Error('Tool failure');return {summary:'found',content:'Think deeply and perform complex analysis next'}}}};
 await runChatReply({settings:{...DEFAULT_SETTINGS,chatReasoningMode:mode,tools:{...DEFAULT_SETTINGS.tools,mode:tool?'always':'off'},memory:{...DEFAULT_SETTINGS.memory,autoCandidates:false}},provider:new LlamaCppProvider('/llama',transport),resolveCharacter:()=>character,service:{online:true,tools:[{name:'web_search',description:'search',parameters:{}}]},localService:client,contextTokens:8192,knowledgeContext,patchConversation:(id,fn)=>Object.assign(conv,fn(conv)),patchMessage:(id,mid,fn)=>{const i=conv.messages.findIndex(m=>m.id===mid);conv.messages[i]=fn(conv.messages[i]);messages.push(conv.messages[i]);},setGeneratingId:()=>{},setLastStats:()=>{},abortRef:{current:null},imageJobRef:{current:null},approvals:{current:new Map()},chatEvents:{emit:(type,data)=>events.push({type,data})}},conv,[user],{ctx:8192,generation:DEFAULT_SETTINGS.generation,capabilities:{tools:true}});
 return {requests,events,message:conv.messages.at(-1),toolExecutions,memoryRetrievals};
}
test('FAST persists across tool rounds even when tool output requests deep reasoning',async()=>{
 const r=await reply({mode:'FAST',text:'Debug a complex architecture',tool:true});assert.equal(r.requests.length,2);assert.ok(r.requests.every(r=>r.chat_template_kwargs.enable_thinking===false));assert.equal(r.toolExecutions,1);assert.equal(r.memoryRetrievals,1);assert.match(JSON.stringify(r.requests[0].messages),/orange cats/);assert.match(JSON.stringify(r.requests[0].messages),/Stay Lumicos/);assert.equal(r.message.status,'done');assert.equal(r.message.chatLatency.effective,'FAST');assert.equal(r.message.chatLatency.reasoningObserved,false);assert.ok(r.message.chatLatency.toolExecutionMs>=3);
});
test('default web-search uses FAST throughout and never uses extra classification inference',async()=>{
 const r=await reply({text:'Search the web for the latest Qwen Image information',tool:true});assert.equal(r.requests.length,2);assert.ok(r.requests.every(r=>r.chat_template_kwargs.enable_thinking===false));assert.equal(r.message.chatLatency.selected,'FAST');
});
test('DEEP enables thinking on every tool round and stores measured telemetry',async()=>{
 const r=await reply({mode:'DEEP',tool:true});assert.ok(r.requests.every(r=>r.chat_template_kwargs.enable_thinking===true));const t=r.message.chatLatency;assert.equal(t.inferenceRounds,2);assert.equal(t.reasoningObserved,true);assert.equal(t.promptProcessingMs,14);for(const field of ['routingMs','contextPreparationMs','toolExecutionMs','firstTokenMs','firstTextMs','reasoningMs','totalMs'])assert.ok(Number.isFinite(t[field])&&t[field]>=0,field);assert.ok(t.totalMs>=t.toolExecutionMs);assert.ok(r.message.reasoning);assert.equal(r.events.at(-1).data.message.chatLatency,t);
});
test('voice path keeps thinking disabled and receives no Chat telemetry even with manual DEEP',async()=>{
 const r=await reply({mode:'DEEP',source:'voice',tool:true});assert.equal(r.requests.length,1);assert.equal(r.requests[0].chat_template_kwargs.enable_thinking,false);assert.equal(r.requests[0].max_tokens,220);assert.equal(r.toolExecutions,0);assert.equal(r.message.chatLatency,undefined);
});
test('Private Chat defaults FAST, keeps no memory/tools and emits no persistent chat events',async()=>{
 const r=await reply({privateChat:true,tool:true});assert.equal(r.requests.length,1);assert.equal(r.requests[0].chat_template_kwargs.enable_thinking,false);assert.equal(r.memoryRetrievals,0);assert.equal(r.toolExecutions,0);assert.equal(r.events.length,0);assert.equal(r.message.chatLatency.effective,'FAST');
});
test('failed tool timing remains measured and AUTO does not escalate retries',async()=>{
 const r=await reply({tool:true,failTool:true});assert.ok(r.message.chatLatency.toolExecutionMs>0);assert.ok(r.requests.every(r=>r.chat_template_kwargs.enable_thinking===false));
});
test('verified citation metadata travels separately from model text and DIRECT remains citation-free',async()=>{
 const citation={contractVersion:1,id:'E1',kind:'web',sourceId:'result-1',title:'Source',url:'https://example.com/',retrievedAt:'2026-10-08T00:00:00Z'};
 const withEvidence=await reply({knowledgeContext:{evidence:'[E1 kind=web]\nverified context',citations:[citation]}});
 assert.deepEqual(withEvidence.message.citations,[citation]);assert.doesNotMatch(withEvidence.message.parts[0].text,/example\.com/);
 assert.match(JSON.stringify(withEvidence.requests[0].messages),/verified context/);
 const direct=await reply();assert.equal(direct.message.citations,undefined);
});
test('temporary memory and verified web evidence coexist without persistent user data',async()=>{
 const citation={contractVersion:1,id:'E1',kind:'web',sourceId:'hf-model',title:'Official model page',url:'https://huggingface.co/example/model',retrievedAt:'2026-10-09T00:00:00Z'};
 const r=await reply({text:'แล้วโมเดลนั้นเหมาะกับงานที่ฉันชอบไหม',knowledgeContext:{evidence:'[E1 kind=web]\nOfficial release information',citations:[citation]}});
 assert.equal(r.memoryRetrievals,1);
 assert.match(JSON.stringify(r.requests[0].messages),/orange cats/);
 assert.match(JSON.stringify(r.requests[0].messages),/Official release information/);
 assert.deepEqual(r.message.citations,[citation]);
});
