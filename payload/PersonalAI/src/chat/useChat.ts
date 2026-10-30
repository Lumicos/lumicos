import {parseReaction} from '../components/avatar-stage/reactionIntent.mjs';
import {publishReaction} from '../components/avatar-stage/reactionSignal.mjs';
import { stripPersonaControlText } from '../prompt/lumicosPersona.mjs';
import {requestedQuality} from './imageQuality.mjs';
import { runChatReply } from './runChatReply';
import {sync} from '../services/sync';
import { useCallback, useEffect, useRef, useState } from 'react';
import { buildExtractionMessages, parseExtraction } from '../prompt/memoryExtraction';
import { applyMacros, buildCallMessages, wantsTools } from '../prompt/promptBuilder';
import type { LLMProvider } from '../providers/types';
import { chatEvents } from '../services/chatEvents';
import { localService, type ToolDefinition } from '../services/localService';
import { withModelTurn, type ModelProfile } from '../services/models';
import { storage } from '../storage/storageService';
import type {
  ChatAttachment,
  Character,
  ChatMessage,
  Conversation,
  GenerationStats,
  InputSource,
  MemoryCandidate,
  Settings,
} from '../types';
import { makeMessage, setText, textOf, titleFrom, uid } from './messageUtils';
import { translateImagePrompt, needsTranslation } from './translateImagePrompt';
import { bindSelfImagePrompt } from '../identity/lumicosIdentity.mjs';
import { IMAGE_SIZES, imagePrompt, requestedSize, needsImageResearch, preserveImageAspect, type ImageOptions } from './imageRequest';
import { imageJobParts, imageReconcilePlan, applyImageJobState, markImageUntrackable, reconcileImageJob } from './imageJob';
import {orderConversationMessages} from './messageOrder.mjs';

interface Deps {
  provider: LLMProvider;
  settings: Settings;
  /** Exact lookup: undefined if the character no longer exists. Never substitutes another one. */
  resolveCharacter: (id?: string) => Character | undefined;
  /** Character used for brand-new chats (the selected one). */
  defaultCharacter: Character;
  /** Local service (memory + tools). When offline, chat still works without them. */
  service: { online: boolean; tools: ToolDefinition[] };
  /** Context window reported by llama-server (tokens). */
  contextTokens?: number;
}

type Approval = 'allow' | 'deny' | 'cancel';

function greetingFor(character: Character | undefined, userName: string): ChatMessage[] {
  const text = character?.firstMessage?.trim();
  if (!text) return [];
  return [makeMessage('assistant', applyMacros(text, character!.name, userName), { isGreeting: true, status: 'done' })];
}

function createConversation(character: Character | undefined, userName: string, mode?: 'assistant' | 'roleplay'): Conversation {
  const now = Date.now();
  return {
    id: uid(),
    title: 'New chat',
    messages: greetingFor(character, userName),
    createdAt: now,
    updatedAt: now,
    characterId: character?.id,
    ...(mode === 'roleplay' ? { mode } : {}),
  };
}

const hasUserMessages = (c: Conversation) => c.messages.some((m) => m.role === 'user');

export function useChat({ provider, settings, resolveCharacter, defaultCharacter, service, contextTokens }: Deps) {
  const [conversations, setLocalConversations] = useState<Conversation[]>(() => {
    const saved = (sync.enabled?sync.state.conversations:storage.loadConversations()).filter(c=>!c.private);
    return saved.length ? saved : [createConversation(defaultCharacter, settings.userName)];
  });
  const [activeId, setLocalActiveId] = useState(() => sync.state.activeId??[...conversations].sort((a, b) => b.updatedAt - a.updatedAt)[0].id);
  const current=useRef(conversations);current.current=conversations;
  const setConversations=useCallback((value:Conversation[]|((list:Conversation[])=>Conversation[]))=>{
    const before=current.current,next=typeof value==='function'?value(before):value;current.current=next;setLocalConversations(next);
    if(!sync.enabled)return;
    const changed=next.filter(c=>!c.private&&JSON.stringify(c)!==JSON.stringify(before.find(x=>x.id===c.id)));
    const removed=before.filter(c=>!c.private&&!next.some(x=>x.id===c.id)).map(c=>c.id);
    if(changed.length||removed.length)void sync.mutate({upsert:changed,remove:removed}).catch(()=>{});
  },[]);
  const setActiveId=useCallback((id:string)=>{setLocalActiveId(id);if(sync.enabled&&!current.current.find(c=>c.id===id)?.private)void sync.mutate({activeId:id}).catch(()=>{});},[]);
  const [generatingId, setGeneratingId] = useState<string | null>(null);
  const [lastStats, setLastStats] = useState<GenerationStats | undefined>();
  const [suggesting, setSuggesting] = useState(false);
  const abortRef = useRef<AbortController | null>(null);
  const imageJobRef = useRef<string | null>(null);
  const approvals = useRef(new Map<string, (a: Approval) => void>());

  const sharedJob=sync.state.jobs.find(j=>j.conversationId===activeId&&['queued','running'].includes(j.status));
  const isGenerating = generatingId !== null || !!sharedJob;
  const active = conversations.find((c) => c.id === activeId) ?? conversations[0];
  const reconciling = useRef(new Map<string, AbortController>());

  // Persist whenever idle — not on every streamed token.
  useEffect(() => {
    if (!sync.enabled&&!isGenerating) storage.saveConversations(conversations.filter(c=>!c.private));
  }, [conversations, isGenerating]);
  useEffect(()=>sync.subscribe(()=>{
    const shared=sync.state.conversations;
    setLocalConversations(old=>[...old.filter(c=>c.private),...(shared.length?shared:old.filter(c=>!c.private).slice(0,1))]);
    setLocalActiveId(old=>current.current.find(c=>c.id===old)?.private||sync.state.callOwner===sync.ownerId?old:sync.state.activeId??old);
  }),[]);

  const patchConversation = useCallback((id: string, fn: (c: Conversation) => Conversation) => {
    const before=current.current;
    const next=before.map(c=>{if(c.id!==id)return c;const changed=fn(c);return {...changed,messages:orderConversationMessages(changed.messages)}});current.current=next;setLocalConversations(next);
    if(sync.enabled&&!before.find(c=>c.id===id)?.private)void sync.mutate(state=>{
      const c=state.conversations.find(c=>c.id===id)??before.find(c=>c.id===id);
      return c?{upsert:[fn(c)]}:{};
    }).catch(()=>{});
  }, []);

  const patchMessage = useCallback(
    (convId: string, msgId: string, fn: (m: ChatMessage) => ChatMessage) =>
      patchConversation(convId, (c) => ({ ...c, messages: c.messages.map((m) => (m.id === msgId ? fn(m) : m)) })),
    [patchConversation],
  );

  // Image placeholders left "streaming" by a reload/another device: follow their server job read-only.
  // Never creates, submits or cancels a job; leaving the chat stops client polling only.
  const streamingKey = active?.messages.filter((m) => m.status === 'streaming').map((m) => m.id).join(',') ?? '';
  useEffect(() => {
    if (!active || !streamingKey) return;
    const convId = active.id;
    const controller = new AbortController();
    active.messages.forEach((m, i) => {
      if (m.id === generatingId || m.id === sharedJob?.replyId) return; // this tab / the server is running it
      const plan = imageReconcilePlan(m, active.messages[i - 1]);
      if (!plan) return;
      if (plan.kind === 'untrackable') { patchMessage(convId, m.id, (x) => markImageUntrackable(x, 'no-job-id') ?? x); return; }
      const key = `${convId}:${m.id}:${plan.jobId}`;
      if (reconciling.current.has(key)) return; // duplicate poll in this tab
      reconciling.current.set(key, controller);
      void reconcileImageJob({
        jobId: plan.jobId, signal: controller.signal, getJob: (id) => localService.images.get(id),
        apply: (job) => patchMessage(convId, m.id, (x) => applyImageJobState(x, plan.jobId, job) ?? x),
        onNotFound: () => patchMessage(convId, m.id, (x) => markImageUntrackable(x, 'not-found', plan.jobId) ?? x),
      }).catch(() => {}).finally(() => { if (reconciling.current.get(key) === controller) reconciling.current.delete(key); });
    });
    return () => {
      controller.abort();
      for (const [key, owner] of reconciling.current) if (owner === controller) reconciling.current.delete(key);
    };
  }, [active?.id, streamingKey, generatingId, sharedJob?.replyId, patchMessage]);

  /**
   * Produces one assistant reply after `history`, running tools when the model asks:
   *   stream → parse tool call → validate → (confirm) → execute → feed result back → stream again …
   * At most settings.tools.maxIterations tool calls; the last step runs without tools.
   */
  const generateCore = useCallback(
    (conv:Conversation,history:ChatMessage[],profile:ModelProfile|null=null,controller=new AbortController()) =>
      runChatReply({provider,settings,resolveCharacter,service,contextTokens,localService,patchConversation,patchMessage,setGeneratingId,setLastStats,abortRef,imageJobRef,approvals,chatEvents},conv,history,profile,controller),
    [provider,settings,resolveCharacter,service,contextTokens,patchConversation,patchMessage],
  );

  const generate = useCallback(async (conv:Conversation, history:ChatMessage[]) => {
    if(sync.enabled&&!conv.private){
      const last=history.at(-1);if(!last||last.role!=='user')return;
      try{
        await sync.flush();
        if(!sync.state.conversations.some(c=>c.id===conv.id))await sync.mutate({upsert:[{...conv,messages:history.slice(0,-1)}]});
        // Edits/regenerations explicitly replace the preceding history before submitting.
        const existing=sync.state.conversations.find(c=>c.id===conv.id)!;
        if(existing.messages.some(m=>m.id===last.id))await sync.mutate({upsert:[{...existing,messages:history.slice(0,-1)}]});
        await sync.submit({requestId:uid(),conversationId:conv.id,user:last,settings});
      }catch(e){console.error('Chat submission failed',e)}
      return;
    }
    const required:string[]=[];
    const last=[...history].reverse().find(m=>m.role==='user');
    if(last?.parts.some(p=>p.type==='image'||(p.type==='attachment' && p.kind==='pdf' && p.context.includes('no text layer on this page'))))required.push('vision');
    if(last?.source!=='voice'&&!conv.private && settings.tools.mode!=='off' && (settings.tools.mode==='always'||wantsTools(history)))required.push('tools');
    const controller=new AbortController();abortRef.current=controller;
    setGeneratingId('model-preparing');
    try {
      await withModelTurn(required, profile=>{controller.signal.throwIfAborted();if(conv.private&&!profile)throw new Error('แชตชั่วคราวต้องใช้ Gemma ที่เปิดผ่าน Lumicos เพื่อควบคุมการบันทึก log');return generateCore(conv,history,profile,controller)},last?.source==='voice'?'call':'chat');
    } catch(e) {
      if(controller.signal.aborted)return;
      const error=makeMessage('assistant','',{replyToId:last?.id,status:'error',error:(e as Error).message});
      patchConversation(conv.id,c=>({...c,messages:[...c.messages,error]}));
      if(!conv.private)chatEvents.emit('error',{conversationId:conv.id,messageId:error.id,error:error.error!});
    } finally {if(abortRef.current===controller)abortRef.current=null;setGeneratingId(null)}
  },[generateCore,settings,patchConversation]);

  /* ---------------- public actions ---------------- */

  const finishCall = useCallback((conversationId:string, turns:ChatMessage[]) => {
    if (!turns.length) return;
    patchConversation(conversationId, c => {
      if (c.private) return c;
      const added=turns.filter(m=>!c.messages.some(existing=>existing.id===m.id));
      if (!added.length) return c;
      return {...c,messages:[...c.messages,...added],updatedAt:Date.now(),
        title:hasUserMessages(c)||c.titleLocked ? c.title : titleFrom(textOf(added[0]))};
    });
  },[patchConversation]);

  const callReply = useCallback(async (text:string, turns:ChatMessage[], signal:AbortSignal, callId:string, onToken?:(text:string)=>void, onTiming?:(stage:string,ms:number)=>void) => {
    const character=resolveCharacter(active.characterId);
    if(!character||active.private)throw Error('โทรคุยไม่พร้อมในแชทนี้');
    // Keep voice context independent of the full chat prompt and memory retrieval.
    const modelStarted=performance.now();
    signal.throwIfAborted();
    return withModelTurn([],async profile=>{
      onTiming?.('model_prepare',performance.now()-modelStarted);
      const promptStarted=performance.now();
      signal.throwIfAborted();
      const defaults=profile?.generation??settings.generation;
      const messages=buildCallMessages(turns,text,new Date());
      onTiming?.('prompt_prepare',performance.now()-promptStarted);
      const inferenceStarted=performance.now();let firstVisible=true,firstReasoning=true;
      let answer='',emittedAnswer='',failure:Error|undefined,stopped=false;
      await provider.streamChat({purpose:'call-reply',correlationId:callId,messages,params:{...defaults,maxTokens:Math.max(600,defaults.maxTokens??0)},enableThinking:false,cachePrompt:true},{onToken:t=>{if(firstVisible){onTiming?.('inference_first_text',performance.now()-inferenceStarted);firstVisible=false;}answer+=t;const safe=stripPersonaControlText(answer);const delta=safe.slice(emittedAnswer.length);emittedAnswer=safe;if(delta)onToken?.(delta)},onReasoning:()=>{if(firstReasoning){onTiming?.('inference_first_reasoning',performance.now()-inferenceStarted);firstReasoning=false;}},onError:e=>{failure=e},onDone:r=>{stopped=r.stopped;onTiming?.('inference_complete',performance.now()-inferenceStarted);if(r.stats)onTiming?.('backend_generation',r.stats.durationMs)}},signal);
      signal.throwIfAborted();if(failure)throw failure;if(stopped)throw Error('หยุดคำตอบแล้ว');
      const safeAnswer=stripPersonaControlText(answer).trim();
      if(!safeAnswer)throw Error('ไม่ได้รับคำตอบสำหรับโทรคุย');
      publishReaction({conversationId:active.id,messageId:uid(),intent:parseReaction(answer).intent});
      return safeAnswer;
    },'call',callId);
  },[active,resolveCharacter,settings,provider]);

  const generateImage = useCallback(async (prompt: string, options: ImageOptions = {}, hidePrompt = true) => {
    if (active.private || !prompt.trim() || isGenerating || !resolveCharacter(active.characterId)) return;
    const convId = active.id;
    const user = makeMessage('user', prompt, {status:'done',imageRequest:{kind:options.inputFile?'edit':'create',prompt,hidePrompt}});
    // Root request correlation id: created before translation, linked to the reply message id and later the job id.
    const requestId = uid();
    let reply = makeMessage('assistant', 'กำลังเข้าคิวสร้างภาพ…', {replyToId:user.id,status:'streaming',imageJob:{requestId}});
    const controller = new AbortController(); abortRef.current = controller;
    setGeneratingId(reply.id);
    patchConversation(convId,c=>({...c,messages:[...c.messages,user,reply],updatedAt:Date.now(),title:hasUserMessages(c)?c.title:titleFrom(prompt)}));
    const commitImage = () => { const snapshot={...reply};patchMessage(convId,reply.id,()=>snapshot); };
    try {
      const size=requestedSize(prompt) ?? options.size ?? (options.inputFile?'original':'portrait');
      let englishPrompt = prompt;
      let referenceNotes = '';
      if (!options.inputFile && settings.knowledge.searchMode !== 'OFF' && needsImageResearch(prompt)) {
        reply=setText(reply,'กำลังค้นข้อมูลอ้างอิงก่อนสร้างภาพ…');commitImage();
        try {
          const v = await localService.tools.validate('web_search', { query: prompt.slice(0, 500), limit: 4 });
          const r = await localService.tools.execute('web_search', { query: prompt.slice(0, 500), limit: 4 }, v.approvalId, controller.signal);
          controller.signal.throwIfAborted();
          referenceNotes = r.content ?? '';
        } catch (e) {
          throw new Error('ค้นข้อมูลอ้างอิงก่อนสร้างภาพไม่สำเร็จ: '+(e as Error).message);
        }
      }
      if((needsTranslation(prompt) || referenceNotes)) {
        reply=setText(reply,'กำลังแปลพรอมต์ภาพเป็นภาษาอังกฤษ…');commitImage();
        englishPrompt=await withModelTurn([],()=>translateImagePrompt(provider,prompt,controller.signal,referenceNotes,requestId));
      }
      controller.signal.throwIfAborted();
      if (!options.inputFile) {
        englishPrompt = bindSelfImagePrompt(englishPrompt, prompt, active.characterId);
        if(size!=='original')englishPrompt=preserveImageAspect(englishPrompt,size);
      }
      patchMessage(convId,user.id,m=>({...m,imageRequest:{kind:options.inputFile?'edit':'create',prompt,translatedPrompt:englishPrompt,hidePrompt}}));
      let inputId: string | undefined;
      if(options.inputFile) {
        reply=setText(reply,'กำลังส่งภาพต้นฉบับ…');commitImage();
        const input=await localService.images.upload(options.inputFile);
        inputId=input.id;
        patchMessage(convId,user.id,m=>({...m,parts:[...m.parts,{type:'image',source:'attachment',url:input.url,alt:options.inputFile!.name}]}));
      }
      if(controller.signal.aborted) {reply={...setText(reply,'ยกเลิกแล้ว'),status:'stopped'};return;}
      let job=await localService.images.create(englishPrompt,{...(size==='original'?{originalSize:true}:IMAGE_SIZES[size]),inputId,denoise:options.denoise,backend:options.backend,quality:requestedQuality(prompt)??options.quality,correlationId:requestId,messageId:reply.id});
      imageJobRef.current=job.id;
      // Persist the job id right away (not only in a ref) so a reload can follow this job.
      reply={...reply,imageJob:{requestId,jobId:job.id}};commitImage();
      if(controller.signal.aborted) await localService.images.cancel(job.id);
      while(!['done','failed','cancelled'].includes(job.status)) {
        reply=setText(reply,job.stage==='upscaling'?'กำลังเพิ่มความละเอียดภาพ 4 เท่า…':job.status==='queued'?'รอคิวสร้างภาพ…':job.status==='preparing'?'กำลังเตรียม GPU สำหรับสร้างภาพ…':'กำลังสร้างภาพ…');
        commitImage();
        await new Promise(r=>setTimeout(r,1000));
        job=await localService.images.get(job.id);
      }
      if(job.status==='failed') throw new Error(job.error??'สร้างภาพไม่สำเร็จ');
      reply={...reply,status:job.status==='cancelled'?'stopped':'done',parts:imageJobParts(job)};
    } catch(e) {reply=controller.signal.aborted?{...setText(reply,'ยกเลิกแล้ว'),status:'stopped'}:{...setText(reply,''),status:'error',error:(e as Error).message};}
    finally {commitImage();imageJobRef.current=null;abortRef.current=null;setGeneratingId(null);}
  },[active,isGenerating,resolveCharacter,patchConversation,patchMessage,provider,settings.knowledge.searchMode]);

  const send = useCallback(
    (text: string, attachments: ChatAttachment[] = [], source: InputSource = 'keyboard') => {
      if ((!text.trim() && !attachments.length) || isGenerating || !resolveCharacter(active.characterId)) return;
      if(active.private && attachments.length)return;
        const imageCommand = active.private||source==='voice' ? undefined : imagePrompt(text);
      if (imageCommand && !attachments.length) { void generateImage(text, {}, false); return; }
      const user = makeMessage('user', text.trim()|| (attachments.some(p=>p.type==='image')?'ช่วยอธิบายภาพที่แนบ':''), { source, status: 'done' });
      user.parts.push(...attachments);
      if (!sync.enabled && !hasUserMessages(active) && !active.titleLocked) {
        patchConversation(active.id, (c) => ({ ...c, title: titleFrom(text || (attachments[0]?.type==='attachment'?attachments[0].name:attachments[0]?.alt) || 'New chat') }));
      }
      generate(active, [...active.messages, user]);
    },
    [active, isGenerating, generate, generateImage, patchConversation, resolveCharacter],
  );

  const stop = useCallback(() => {
    if(sharedJob)void sync.cancel(sharedJob.id).catch(()=>{});
    abortRef.current?.abort();
    if(imageJobRef.current) void localService.images.cancel(imageJobRef.current).catch(e=>{
      patchConversation(active.id,c=>({...c,messages:c.messages.map(m=>m.id===generatingId?{...m,error:'ยกเลิกยังไม่สำเร็จ: '+e.message}:m)}));
    });
  }, [active.id,generatingId,patchConversation,sharedJob]);

  /** The user's answer on a tool confirmation card. */
  const respondToTool = useCallback((runId: string, allow: boolean) => {
    if(sync.enabled&&!approvals.current.has(runId)){void sync.approve(runId,allow).catch(()=>{});return;}
    approvals.current.get(runId)?.(allow ? 'allow' : 'deny');
  }, []);

  /** Re-generates the assistant reply at `messageId` (default: the last one). */
  const regenerate = useCallback(
    async (messageId?: string) => {
      if (isGenerating) return;
      const msgs = active.messages;
      const idx = messageId ? msgs.findIndex((m) => m.id === messageId) : msgs.length - 1;
      if (idx < 0 || msgs[idx].role !== 'assistant' || msgs[idx].isGreeting) return;
      const target=msgs[idx];
      const picture=target.parts.find(p=>p.type==='image'&&p.source==='generated');
      const imageRun=target.toolRuns?.find(r=>r.tool==='generate_image');
      const jobId=picture?.type==='image'?picture.meta?.jobId:(imageRun?.data as {jobId?:string}|undefined)?.jobId;
      if(typeof jobId==='string') {
        const controller=new AbortController();abortRef.current=controller;setGeneratingId(target.id);
        // Keep the previous image until a replacement succeeds.
        patchMessage(active.id,target.id,m=>({...m,status:'streaming',error:undefined}));
        try {
          const original=await localService.images.get(jobId);
          controller.signal.throwIfAborted();
          const {width,height,inputId,denoise,originalSize,backend,quality,edit}=original;
          const requestId=uid();
          let job=await localService.images.create(original.prompt,{width,height,inputId,denoise,originalSize,backend,quality,...(edit?{edit}:{}),correlationId:requestId,messageId:target.id});
          imageJobRef.current=job.id;
          patchMessage(active.id,target.id,m=>({...m,imageJob:{requestId,jobId:job.id}}));
          if(controller.signal.aborted)await localService.images.cancel(job.id);
          while(!['done','failed','cancelled'].includes(job.status)) {
            await new Promise(resolve=>setTimeout(resolve,1000));
            job=await localService.images.get(job.id);
          }
          if(job.status==='failed')throw new Error(job.error??'สร้างภาพไม่สำเร็จ');
          patchMessage(active.id,target.id,m=>job.status==='cancelled'?{...m,status:'stopped'}:{...m,parts:imageJobParts(job),status:'done',toolRuns:undefined,stats:undefined,modelText:undefined});
        } catch(e) {
          patchMessage(active.id,target.id,m=>({...m,status:controller.signal.aborted?'stopped':'error',error:controller.signal.aborted?undefined:(e as Error).message}));
        } finally {imageJobRef.current=null;abortRef.current=null;setGeneratingId(null);}
        return;
      }
      const request=msgs[idx-1]?.imageRequest;
      if(request?.kind==='create') {void generateImage(request.prompt, {}, request.hidePrompt !== false);return;}
      generate(active, msgs.slice(0, idx));
    },
    [active, isGenerating, generate, generateImage, patchMessage],
  );

  /** Edits a user message, drops everything after it and regenerates. */
  const editAndResend = useCallback(
    (messageId: string, text: string) => {
      if (isGenerating || !text.trim()) return;
      const idx = active.messages.findIndex((m) => m.id === messageId);
      if (idx < 0 || active.messages[idx].role !== 'user') return;
      const edited = { ...setText(active.messages[idx], text), editedAt: Date.now() };
      generate(active, [...active.messages.slice(0, idx), edited]);
    },
    [active, isGenerating, generate],
  );

  /** Updates one memory suggestion on a message (after Save / Ignore). */
  const setCandidate = useCallback(
    (convId: string, msgId: string, candidateId: string, patch: Partial<MemoryCandidate>) =>
      patchMessage(convId, msgId, (m) => ({
        ...m,
        memoryCandidates: m.memoryCandidates?.map((c) => (c.id === candidateId ? { ...c, ...patch } : c)),
      })),
    [patchMessage],
  );

  /** Updates the "keep this in the knowledge library?" offer on a message. */
  const setKnowledgeCandidate = useCallback(
    (convId: string, msgId: string, patch: Partial<NonNullable<ChatMessage['knowledgeCandidate']>>) =>
      patchMessage(convId, msgId, (m) => (m.knowledgeCandidate ? { ...m, knowledgeCandidate: { ...m.knowledgeCandidate, ...patch } } : m)),
    [patchMessage],
  );

  /** Marks an attachment as imported into the workspace. */
  const setAttachmentImported = useCallback(
    (convId: string, msgId: string, attachmentId: string, importedPath: string) =>
      patchMessage(convId, msgId, (m) => ({
        ...m,
        parts: m.parts.map((p) => (p.type === 'attachment' && p.id === attachmentId ? { ...p, importedPath } : p)),
      })),
    [patchMessage],
  );

  /** Asks the local model to suggest memories from this chat (the user approves each). */
  const suggestMemoriesCore = useCallback(async (): Promise<number> => {
    if (active.private || isGenerating || suggesting) return 0;
    const target = [...active.messages].reverse().find((m) => m.role === 'assistant' && !m.isGreeting);
    if (!target) return 0;
    setSuggesting(true);
    try {
      let text = '';
      let error: string | undefined;
      await provider.streamChat(
        { purpose:'memory-extract',correlationId:target.id,messages: buildExtractionMessages(active.messages), params: { ...settings.generation, temperature: 0.2, maxTokens: 600 } },
        { onToken: (t) => (text += t), onDone: () => {}, onError: (e) => (error = e.message) },
        new AbortController().signal,
      );
      if (error) throw new Error(error);
      const pending = active.messages.flatMap((m) => m.memoryCandidates?.filter((c) => c.status === 'pending') ?? []);
      const fresh = await localService.memory.dedupe(parseExtraction(text));
      const add: MemoryCandidate[] = fresh
        .filter((c) => !pending.some((p) => p.content === c.content))
        .map((c) => ({ ...c, id: uid(), source: 'model', status: 'pending' }));
      if (add.length) {
        patchMessage(active.id, target.id, (m) => ({ ...m, memoryCandidates: [...(m.memoryCandidates ?? []), ...add] }));
      }
      return add.length;
    } finally {
      setSuggesting(false);
    }
  }, [active, isGenerating, suggesting, provider, settings.generation, patchMessage]);

  const clear = useCallback(() => {
    if (isGenerating) return;
    const character = resolveCharacter(active.characterId);
    patchConversation(active.id, (c) => ({ ...c, messages: greetingFor(character, settings.userName), updatedAt: Date.now() }));
  }, [active, isGenerating, resolveCharacter, patchConversation, settings.userName]);

  const newChat = useCallback(
    (characterId?: string, mode?: 'assistant' | 'roleplay') => {
      if (isGenerating) return;
      const character = (characterId && resolveCharacter(characterId)) || defaultCharacter;
      const c = createConversation(character, settings.userName, mode);
      setConversations((list) => [c, ...list.filter((x) => !x.private && (hasUserMessages(x) || x.titleLocked))]);
      setActiveId(c.id);
    },
    [isGenerating, resolveCharacter, defaultCharacter, settings.userName],
  );

  /**
   * Puts `characterId` on the current chat, but ONLY while it has no user
   * messages yet. A conversation's character never changes mid-conversation.
   */
  const assignCharacterToEmptyChat = useCallback(
    (characterId: string) => {
      if (isGenerating || hasUserMessages(active)) return false;
      const character = resolveCharacter(characterId);
      patchConversation(active.id, (c) => ({ ...c, characterId, messages: greetingFor(character, settings.userName) }));
      return true;
    },
    [active, isGenerating, resolveCharacter, patchConversation, settings.userName],
  );

  const select = useCallback((id: string) => {if(!isGenerating){setConversations(list=>list.filter(c=>!c.private));setActiveId(id)}}, [isGenerating]);

  const rename = useCallback(
    (id: string, title: string) => patchConversation(id, (c) => ({ ...c, title: title.trim() || c.title, titleLocked: true })),
    [patchConversation],
  );

  const remove = useCallback(
    (id: string) => {
      if (isGenerating) return;
      const rest = conversations.filter((c) => c.id !== id);
      const next = rest.length ? rest : [createConversation(defaultCharacter, settings.userName)];
      setConversations(next);
      if (id === activeId) setActiveId([...next].sort((a, b) => b.updatedAt - a.updatedAt)[0].id);
    },
    [conversations, activeId, isGenerating, defaultCharacter, settings.userName],
  );

  const copyText = useCallback((m: ChatMessage) => {
    navigator.clipboard.writeText(textOf(m)).catch(() => {});
  }, []);

  const setFeedback = useCallback((messageId: string, feedback: 'like' | 'dislike') => {
    patchMessage(active.id, messageId, (message) => ({
      ...message,
      feedback: message.feedback === feedback ? undefined : feedback,
    }));
  }, [active.id, patchMessage]);

  const suggestMemories = useCallback(() => withModelTurn([],()=>suggestMemoriesCore()),[suggestMemoriesCore]);

  const togglePrivate = () => {
    if(isGenerating||suggesting)return;
    const normal=conversations.filter(c=>!c.private);
    if(active.private){const next=normal.length?normal:[createConversation(defaultCharacter,settings.userName)];setConversations(next);setActiveId(next[0].id);}
    else {const temp={...createConversation(resolveCharacter(active.characterId)??defaultCharacter,'User'),private:true,title:'Private'};setConversations([temp,...normal]);setActiveId(temp.id);}
  };

  return {
    callReply,
    finishCall,
    togglePrivate,
    conversations: [...conversations].filter(c=>!c.private).sort((a, b) => b.updatedAt - a.updatedAt),
    active,
    generatingId:generatingId??sharedJob?.replyId??null,
    isGenerating,
    lastStats,
    suggesting,
    send,
    generateImage,
    stop,
    respondToTool,
    regenerate,
    editAndResend,
    setCandidate,
    setKnowledgeCandidate,
    setAttachmentImported,
    suggestMemories,
    clear,
    newChat,
    assignCharacterToEmptyChat,
    hasUserMessages: hasUserMessages(active),
    select,
    rename,
    remove,
    copyText,
    setFeedback,
  };
}
