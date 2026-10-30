import { randomUUID } from 'node:crypto';
import { conflict, validId } from './conversationStore.mjs';
import fs from 'node:fs';
import path from 'node:path';
import { RoleplayStore, withoutOoc } from '../roleplay/roleplayStore.mjs';
import { matchSkill, buildSkillGuide, skillScriptPath } from '../tools/skillMatch.mjs';

const round1=v=>Math.round(v*10)/10;
const onlyNumbers=o=>Object.fromEntries(Object.entries(o??{}).filter(([,v])=>typeof v==='number'&&Number.isFinite(v)).map(([k,v])=>[k,round1(v)]));
/** What happened inside one reply, in numbers only (no text): context trimming, model timings, latency spans. Lets one log row tell the story of a turn. */
function turnSummary(reply){
  if(!reply)return undefined;
  const c=reply.contextInfo,l=reply.chatLatency;
  return {status:reply.status,...(reply.error?{error:String(reply.error).slice(0,160)}:{}),
    context:{...onlyNumbers(c),...(c?.overBudget?{overBudget:true}:{}),...(c?.droppedContext?.length?{droppedContext:c.droppedContext}:{}),...(c?.shortened?.length?{shortened:c.shortened}:{})},
    stats:onlyNumbers(reply.stats),
    latency:{...onlyNumbers(l),...(l?.effective?{effective:l.effective}:{}),...(l?.reason?{reason:l.reason}:{})}};
}
export class ChatService {
  constructor({store,models,config,tools,knowledge,web,skills}){Object.assign(this,{store,models,config,tools,knowledge,web,skills});this.roleplay=new RoleplayStore(config?.dataDir);this.controllers=new Map();this.approvals=new Map();this.knowledgeState=new Map();this.principals=new Map();this.summaries=new Map();}
  runtime(){return this.runtimePromise??=import('../../.runtime/chat.mjs')}
  async submit(body,principal){
    if(!validId(body.requestId))throw conflict('Stable requestId required',400);
    const old=this.store.state.jobs.find(j=>j.id===body.requestId);if(old)return old;
    const c=this.store.conversation(body.conversationId);
    if(this.models.callSession)throw conflict('กรุณาวางสายก่อนส่งข้อความ');
    if(!body.user||body.user.role!=='user'||!validId(body.user.id)||!Array.isArray(body.user.parts))throw conflict('User message required',400);
    if(c.messages.some(m=>m.id===body.user.id))throw conflict('Message already exists');
    const user={...body.user,createdAt:Date.now(),status:'done'};
    const job={id:body.requestId,conversationId:c.id,userId:user.id,replyId:randomUUID(),status:'queued',createdAt:Date.now()};
    this.store.state.jobs.push(job);
    if(principal)this.principals.set(job.id,{subject:principal.subject,role:principal.role});
    this.store.patch(c.id,current=>({...current,title:current.titleLocked||current.messages.some(m=>m.role==='user')?current.title:user.parts.filter(p=>p.type==='text').map(p=>p.text).join('').slice(0,42)||'Chat',messages:[...current.messages,user,{id:job.replyId,replyToId:user.id,role:'assistant',createdAt:Date.now(),parts:[{type:'text',text:''}],status:'streaming'}],updatedAt:Date.now()}));
    await this.store.persist();
    // A new chat has priority over an optional context summary still running after an earlier reply.
    for(const s of this.summaries.values())s.controller.abort();
    void this.agent?.yieldNow().catch(()=>{}); // ...and over a background agent step (server/agent): it is redone later
    // The existing ModelService owns turn serialization; ComputeQueue still owns GPU execution.
    void this.models.enqueueChat(()=>this.run(job,body.settings)).catch(()=>{});
    this.store.changed({type:'jobs',jobs:this.store.state.jobs});return job;
  }
  /** One line per turn in logs/tool-decisions.jsonl: which route was chosen and why, what ran in which order, how well results fit. */
  logToolTurn(job,query,knowledgeContext){
    if(!this.config?.dataDir)return;
    try{
      const c=this.store.conversation(job.conversationId),reply=c.messages.find(m=>m.id===job.replyId);
      const d=knowledgeContext?.diagnostics??{},cites=knowledgeContext?.citations??[],dec=knowledgeContext?.decision;
      const bound=(v)=>String(v??'').replace(/\s+/g,' ').slice(0,200);
      const entry={at:new Date().toISOString(),conversationId:c.id,jobId:job.id,replyId:job.replyId,mode:c.mode??'assistant',status:job.status,
        route:dec?.route??'none',reason:dec?.reason,isFollowUp:dec?.isFollowUp||undefined,
        ...(c.private?{private:true}:{query:bound(query),resolvedQuery:dec?.resolvedQuery&&dec.resolvedQuery!==query?bound(dec.resolvedQuery):undefined}),
        evidence:{count:d.evidenceCount??0,web:cites.filter(x=>x.kind==='web').length,local:cites.filter(x=>x.kind==='local').length,memory:cites.filter(x=>x.kind==='memory').length,
          status:d.status,fallback:d.fallback,elapsedMs:d.elapsedMs,...(d.validation?{fit:d.validation.counts,fitStatus:d.validation.status}:{})},
        tools:(reply?.toolRuns??[]).map(r=>({tool:r.tool,status:r.status,...(r.tool==='web_search'&&!c.private?{query:bound(r.args?.query)}:{})})),
        ...(job.skills?{skills:job.skills}:{}),
        turn:turnSummary(reply)};
      const dir=path.join(this.config.dataDir,'logs');fs.mkdirSync(dir,{recursive:true});
      fs.appendFileSync(path.join(dir,'tool-decisions.jsonl'),JSON.stringify(entry)+'\n');
    }catch{}
  }
  async run(job,preferences){
    if(job.status!=='queued')return;
    const controller=new AbortController();this.controllers.set(job.id,controller);job.status='running';this.store.changed({type:'jobs',jobs:this.store.state.jobs});
    let turn,heartbeat;
    try{
      const runtime=await this.runtime();
      const c=this.store.conversation(job.conversationId);
      const settings={...runtime.DEFAULT_SETTINGS,...preferences,serverUrl:'/llama',provider:'llamacpp'};
      settings.tools={...runtime.DEFAULT_SETTINGS.tools,...preferences?.tools};settings.memory={...runtime.DEFAULT_SETTINGS.memory,...preferences?.memory};settings.knowledge={...runtime.DEFAULT_SETTINGS.knowledge,...preferences?.knowledge};settings.generation={...runtime.DEFAULT_SETTINGS.generation,...preferences?.generation};
      const history=c.messages.slice(0,c.messages.findIndex(m=>m.id===job.replyId)).filter(m=>m.status!=='error');
      const last=history.at(-1),required=[];
      const lastText=last?.parts?.filter(p=>p.type==='text').map(p=>p.text).join('\n')??'';
      // Agent jobs (server/agent/agentService.mjs): "ค้นเรื่อง X แล้วเก็บเข้าคลัง", "อัปเดตเรื่อง X ในคลัง", "สรุปไฟล์นี้แล้วเก็บเข้าคลัง",
      // "ทุกเช้า 7 โมง สรุปข่าว X ให้หน่อย", "วางแผนเที่ยวเชียงใหม่ 3 วัน", "ทำแบบทดสอบภาษาจีน 20 ข้อ" queue a background job (or a
      // schedule) and this reply only says it was taken; "ทำ excel ยอดขาย …" makes the file at once; "งานค้นคว้าถึงไหนแล้ว",
      // "ดูงานที่ตั้งเวลาไว้", "ยกเลิกงาน…" answer about those jobs. No model turn here.
      const agentAsk=c.mode!=='roleplay'&&this.agent?this.agent.classify(lastText,{message:last,history}):null;
      if(agentAsk){
        const k=settings.knowledge??{},searchMode=['AUTO','ON','OFF'].includes(k.searchMode)?k.searchMode:(k.webEnabled===true?'AUTO':'OFF');
        // "อัปเดตเรื่อง X ในคลัง" moves the old note into knowledge/_archive: ask first, like any write tool (Settings → confirmWrites)
        if(agentAsk.kind==='update'&&settings.tools?.confirmWrites!==false&&!c.private){
          const runId=randomUUID();
          const run={id:runId,tool:'update_library_note',args:{topic:agentAsk.topic},status:'awaiting',permission:'write',callText:'',
            preview:{action:'อัปเดตโน้ตในคลังความรู้',target:agentAsk.topic,details:'ค้นเว็บใหม่ เขียนโน้ตใหม่ แล้วย้ายโน้ตเก่าของเรื่องนี้ไปไว้ใน knowledge/_archive (ไม่ลบ)'}};
          const setRun=(patch,extra={})=>{try{this.store.message(c.id,job.replyId,m=>({...m,...extra,toolRuns:[{...run,...patch}]}));}catch{}};
          setRun({},{status:'streaming',parts:[{type:'text',text:`รอการอนุมัติ: อัปเดตเรื่อง “${agentAsk.topic}” ในคลังความรู้`}]});
          const decision=await new Promise(resolve=>{
            this.approvals.set(runId,resolve);
            if(controller.signal.aborted)resolve('cancel');else controller.signal.addEventListener('abort',()=>resolve('cancel'),{once:true});
          });
          this.approvals.delete(runId);
          if(decision!=='allow'){
            const text=decision==='deny'?`ไม่อัปเดตเรื่อง “${agentAsk.topic}” ในคลังตามที่เลือก ยังไม่มีอะไรถูกเปลี่ยน`:'ยกเลิกแล้ว ยังไม่มีอะไรถูกเปลี่ยนในคลัง';
            setRun({status:decision==='deny'?'denied':'cancelled'},{status:'done',parts:[{type:'text',text}]});
            job.status=decision==='deny'?'done':'cancelled';this.logToolTurn(job,lastText,{decision:{route:'AGENT',reason:'update-denied'}});return;
          }
          setRun({status:'done',summary:`อนุมัติอัปเดต “${agentAsk.topic}”`});
        }
        await this.agent.handle(agentAsk,{conversationId:c.id,replyId:job.replyId,characterId:c.characterId??null,private:c.private===true,webOff:searchMode==='OFF'});
        job.status='done';this.logToolTurn(job,lastText,{decision:{route:'AGENT',reason:agentAsk.kind}});return;
      }
      // A saved skill whose trigger words appear in the message rides along this turn (its script needs tools on).
      const skillHit=c.mode!=='roleplay'&&!c.private&&settings.tools.mode!=='off'&&this.skills?matchSkill(lastText,this.skills.list()):null;
      if(skillHit?.hasScript&&settings.tools.mode!=='always')settings.tools={...settings.tools,mode:'always'};
      let skillGuide;try{skillGuide=skillHit?buildSkillGuide(this.skills,skillHit):undefined;}catch{skillGuide=undefined;}
      // "output: exact" skills (thai-baht-text): the printed result is the answer and must reach the user unchanged.
      let skillExactOutput;try{skillExactOutput=skillGuide&&skillHit.exactOutput?skillScriptPath(this.skills,skillHit.name):undefined;}catch{skillExactOutput=undefined;}
      // Any matched skill with a script: a reply that never runs it gets one reminder (src/chat/replyChecks.ts).
      let skillScript;try{skillScript=skillGuide&&skillHit.hasScript?skillScriptPath(this.skills,skillHit.name):undefined;}catch{skillScript=undefined;}
      job.skills=skillGuide?[skillHit.name]:undefined;
      if(last?.parts.some(p=>p.type==='image'||p.type==='attachment'&&p.kind==='pdf'&&p.context?.includes('no text layer')))required.push('vision');
      if(settings.tools.mode!=='off'&&(settings.tools.mode==='always'||runtime.wantsTools(history)))required.push('tools');
      turn=await this.models.begin(required,'chat');this.models.turns.get(turn.id).device='internal';controller.signal.throwIfAborted();
      heartbeat=setInterval(()=>this.models.touch(turn.id),15000);heartbeat.unref();
      const base=`http://127.0.0.1:${this.config.port}`;
      const principal=this.principals.get(job.id);
      const transport=(url,init={})=>fetch(new URL(url,base),{...init,headers:{...init.headers,'X-Lumicos-Internal':this.config.internalToken,'X-Lumicos-Turn':turn.id,...(principal?{'X-Lumicos-Principal-Subject':principal.subject,'X-Lumicos-Principal-Role':principal.role}:{})}});
      const client=runtime.createServiceClient(base+'/api',transport);
      const query=last?.parts?.filter(p=>p.type==='text').map(p=>p.text).join('\n')??'';
      const previous=this.knowledgeState.get(c.id);
      const webReady=await this.web?.status().then(status=>status.ready===true).catch(()=>false);
      const effectiveSettings=webReady?settings:{...settings,knowledge:{...settings.knowledge,searchMode:'OFF',webEnabled:false}};
      const previousUserText=history.slice(0,-1).filter(m=>m.role==='user').at(-1)?.parts?.filter(p=>p.type==='text').map(p=>p.text).join('\n')??'';
      const knowledgeContext=c.mode==='roleplay'?undefined:await this.knowledge?.prepare({query,previousUserText,settings:effectiveSettings,private:c.private===true,anonymous:c.private===true,
        workspaceId:'default',characterId:c.characterId??null,modelId:turn.profile?.id??'',signal:controller.signal,
        routeContext:previous&&{previousQuery:previous.query,previousRoute:previous.route},
        onStatus:status=>{if(status==='searching')this.store.message(c.id,job.replyId,m=>({...m,parts:[{type:'text',text:'กำลังค้นเว็บ…'}]}));}});
      if(['WEB','HYBRID'].includes(knowledgeContext?.decision?.route)&&this.config?.dataDir){try{const d=knowledgeContext.diagnostics??{};const web=d.web??d;(await import('node:fs')).appendFileSync((await import('node:path')).join(this.config.dataDir,'logs','web-search.jsonl'),JSON.stringify({at:new Date().toISOString(),conversationId:c.id,replyId:job.replyId,query:query.slice(0,300),route:knowledgeContext.decision.route,reason:knowledgeContext.decision.reason,status:d.status??web.status??(knowledgeContext.citations?.some(x=>x.kind==='web')?'ok':'no_evidence'),webCitations:knowledgeContext.citations?.filter(x=>x.kind==='web').length??0,elapsedMs:d.elapsedMs,error:d.error??web.error,...(d.validation?{validation:{status:d.validation.status,counts:d.validation.counts,periodOpen:d.validation.periodOpen,items:d.validation.items}}:{})})+'\n');}catch{}}
      if(knowledgeContext?.decision&&!knowledgeContext.decision.blocked)this.knowledgeState.set(c.id,{query:knowledgeContext.decision.resolvedQuery,route:knowledgeContext.decision.route});
      const searchMode=['AUTO','ON','OFF'].includes(effectiveSettings.knowledge.searchMode)
        ? effectiveSettings.knowledge.searchMode : (effectiveSettings.knowledge.webEnabled===true?'AUTO':'OFF');
      const webAlreadyHandled=['WEB','HYBRID'].includes(knowledgeContext?.decision?.route);
      const replyTools=this.tools.definitions().filter(tool=>tool.name!=='web_search'||(searchMode!=='OFF'&&!webAlreadyHandled));
      const provider=new runtime.LlamaCppProvider('/llama',transport,()=>turn.id);
      const resolveCharacter=id=>this.store.state.characters.find(x=>x.id===id)??(id===runtime.DEFAULT_CHARACTER.id?runtime.DEFAULT_CHARACTER:undefined);
      // Roleplay chats: card.md / story.md / log.md live in data/roleplay/<conversation id>/ (see roleplayStore.mjs).
      const actor=c.mode==='roleplay'?resolveCharacter(c.characterId):undefined;
      let roleplay;
      if(actor&&this.roleplay.ensure(c.id,actor,settings.userName)){
        if(!c.private)this.roleplay.writeLog({...c,messages:withoutOoc(history)},actor.name,settings.userName);
        roleplay={card:this.roleplay.card(c.id),story:this.roleplay.story(c.id),appearance:this.roleplay.appearance(c.id),looks:this.roleplay.looks?.(c.id)??'',recall:(q,ids)=>this.roleplay.recall(c.id,q,ids)};
      }
      await runtime.runChatReply({settings,provider,deferContextSummary:true,roleplay,skillGuide,skillExactOutput,skillScript,
        localService:client,service:{online:true,tools:replyTools},contextTokens:turn.profile?.ctx,
        resolveCharacter,
        replyId:job.replyId,knowledgeContext,abortRef:{current:controller},imageJobRef:{current:null},approvals:{current:this.approvals},
        patchConversation:(id,fn)=>this.store.patch(id,current=>{
          const next=fn(current); // Preserve messages from requests queued behind this turn.
          const ids=new Set(next.messages.map(m=>m.id));return {...next,messages:[...next.messages,...current.messages.filter(m=>!ids.has(m.id))]};
        }),
        patchMessage:(id,mid,fn)=>this.store.message(id,mid,fn),setGeneratingId:()=>{},setLastStats:()=>{},chatEvents:{emit:()=>{}},
      },c,history,turn.profile,controller);
      job.status=controller.signal.aborted?'cancelled':'done';
      this.logToolTurn(job,query,knowledgeContext);
      if(job.status==='done'){
        // The reply is saved and the job is done: release the UI first, then fold the summary inside this
        // same turn (Gemma is still awake; no new begin/switch/wake). Never let it fail the finished reply.
        this.store.changed({type:'jobs',jobs:this.store.state.jobs});
        if(actor&&roleplay)await this.afterRoleplayReply(runtime,job,provider,actor,settings.userName).catch(e=>console.warn('[chat] roleplay story skipped:',e?.message??e));
        else await this.foldAfterReply(runtime,job,provider).catch(e=>console.warn('[chat] context summary skipped:',e?.message??e));
      }
    }catch(e){job.status=controller.signal.aborted?'cancelled':'failed';this.store.message(job.conversationId,job.replyId,m=>({...m,status:controller.signal.aborted?'stopped':'error',error:e.message}));}
    finally{clearInterval(heartbeat);if(turn)await this.models.end(turn.id).catch(()=>{});this.controllers.delete(job.id);this.principals.delete(job.id);this.store.changed({type:'jobs',jobs:this.store.state.jobs});await this.store.persist();}
  }
  /**
   * Deferred rolling summary for the shared/server path. Runs after the reply, in the reply's own model turn,
   * and is aborted as soon as another chat is submitted. Saves only summary fields, only if the conversation
   * still exists, no newer summary was written, and the summarised prefix is unchanged (same ids AND text).
   */
  /**
   * After a roleplay reply: refresh log.md (whole record) and, once 6+ new messages have piled up, rewrite story.md
   * ("story so far") inside the same model turn. Like foldAfterReply it never fails the finished reply, skips image
   * turns (ComfyUI holds the GPU) and gives way to a newer chat. Catches up at most 12 messages per turn, oldest first.
   */
  async afterRoleplayReply(runtime,job,provider,character,userName){
    const c=this.store.conversation(job.conversationId);
    if(c.private)return;
    const index=c.messages.findIndex(m=>m.id===job.replyId),reply=c.messages[index];
    if(!reply||reply.status!=='done')return;
    const record=withoutOoc(c.messages.slice(0,index+1)).filter(m=>(m.role==='user'||m.role==='assistant')&&!m.isGreeting&&m.status!=='error');
    this.roleplay.writeLog({...c,messages:record},character.name,userName);
    if(reply.toolRuns?.some(r=>r.tool==='generate_image')||reply.parts?.some(p=>p.type==='image'))return;
    if(typeof runtime.foldStory!=='function'||this.summaries.has(c.id)||(this.models.pendingChats??0)>1)return;
    const at=c.roleplayStoryUpTo?record.findIndex(m=>m.id===c.roleplayStoryUpTo):-1;
    const pending=record.slice(at+1);
    if(pending.length<6)return;
    const block=pending.slice(0,12);
    const entry={controller:new AbortController()};this.summaries.set(c.id,entry);
    try{
      const folded=await runtime.foldStory(provider,this.roleplay.story(c.id),block,{character:character.name,user:userName||'ผู้เล่น'},entry.controller.signal,job.replyId);
      if(!folded||entry.controller.signal.aborted)return;
      if(!this.store.state.conversations.some(x=>x.id===c.id))return; // deleted meanwhile: never recreate it
      this.roleplay.writeStory(c.id,folded);
      this.store.patch(c.id,cur=>({...cur,roleplayStoryUpTo:block.at(-1).id}));
    }finally{if(this.summaries.get(c.id)===entry)this.summaries.delete(c.id);}
  }
  async foldAfterReply(runtime,job,provider){
    if(typeof runtime.foldContext!=='function'||typeof runtime.contextSummarySignature!=='function')return;
    const c=this.store.conversation(job.conversationId);
    if(c.private||this.summaries.has(c.id))return;
    if((this.models.pendingChats??0)>1)return; // a newer chat is already queued: it goes first
    const index=c.messages.findIndex(m=>m.id===job.replyId),reply=c.messages[index];
    if(!reply||reply.status!=='done')return;
    // Optional work must not wake Gemma: after an image turn the model slept and ComfyUI holds the GPU.
    if(reply.toolRuns?.some(r=>r.tool==='generate_image')||reply.parts?.some(p=>p.type==='image'))return;
    const history=c.messages.slice(0,index+1).filter(m=>m.status!=='error');
    const compact=runtime.compactContext(c,history);
    if(!compact.fold?.length)return;
    const upTo=compact.fold.at(-1).id;
    const sig=runtime.contextSummarySignature(history.slice(0,compact.start+compact.fold.length));
    const seen={upTo:c.contextSummaryUpTo,sig:c.contextSummarySig,summary:c.contextSummary};
    const entry={controller:new AbortController()};this.summaries.set(c.id,entry);
    try{
      const folded=await runtime.foldContext(provider,compact.base,compact.fold,entry.controller.signal,job.replyId);
      if(!folded||entry.controller.signal.aborted)return;
      const current=this.store.state.conversations.find(x=>x.id===c.id);
      if(!current)return; // deleted meanwhile: never recreate it
      if(current.contextSummaryUpTo!==seen.upTo||current.contextSummarySig!==seen.sig||current.contextSummary!==seen.summary)return; // newer summary
      const end=current.messages.findIndex(m=>m.id===upTo);
      if(end<0||runtime.contextSummarySignature(current.messages.slice(0,end+1))!==sig)return; // prefix edited/deleted/regenerated
      this.store.patch(c.id,cur=>({...cur,contextSummary:folded,contextSummaryUpTo:upTo,contextSummarySig:sig}));
    }finally{if(this.summaries.get(c.id)===entry)this.summaries.delete(c.id);}
  }
  cancel(id){const job=this.store.state.jobs.find(j=>j.id===id);if(!job)throw conflict('Job not found',404);this.controllers.get(id)?.abort();if(job.status==='queued'){job.status='cancelled';this.store.message(job.conversationId,job.replyId,m=>({...m,status:'stopped'}));this.store.changed({type:'jobs',jobs:this.store.state.jobs});}}
  approve(id,allow){const answer=this.approvals.get(id);if(!answer)throw conflict('Approval expired');answer(allow?'allow':'deny');this.approvals.delete(id);}
  close(){this.agent?.close();for(const c of this.controllers.values())c.abort();for(const s of this.summaries.values())s.controller.abort();this.knowledgeState.clear();}
}
