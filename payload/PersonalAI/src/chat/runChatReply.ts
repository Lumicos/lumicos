import { keepExactOutput, printedBySkill } from './skillOutput';
import { runThemeTool } from '../theme/customTheme';
import {resolveImageIntent,requestedSize,preserveImageAspect,IMAGE_SIZES,imagePromptFromModelText,imagePrompt,SELFIE_REQUEST} from './imageRequest';
import {existingImageReply} from './existingImage.mjs';
import {routeChatReasoning} from './reasoningRouter.mjs';
import { computeCloseness } from './closeness.mjs';
import { SCENE_REQUEST_RE, composeScenePrompt } from './roleplayScenePrompt.mjs';
import { bindSelfImagePrompt } from '../identity/lumicosIdentity.mjs';
import { stripPersonaControlText } from '../prompt/lumicosPersona.mjs';
import { buildMessages, isOocText, wantsTools, SELF_ASK } from '../prompt/promptBuilder';
import { classifyReplyLength, REPLY_TOKEN_CAP, formatLimitRule } from '../prompt/replyLength';
import { repeatsEarlierReply, REPEAT_NOTE } from './repeatGuard';
import { finishedNotes, clipLines, fitNotes } from './foldNotes';
import { lastRunFailed, ranScript, CLAIMS_TOOL, RETRY_NOTES } from './replyChecks';
import { makeMessage, setText, textOf, uid } from './messageUtils';
import { parseToolCall, visibleText } from '../tools/toolCallParser';
import { imageJobParts } from './imageJob';
import type { LLMProvider } from '../providers/types';
import type { localService as ServiceClient, ToolDefinition } from '../services/localService';
import type { ModelProfile } from '../services/models';
import type { AttachmentPart, Character, ChatMessage, Conversation, ChatLatency, EvidenceCitation, GenerationStats, MemoryCandidate, Settings, ToolRun, UsedMemory } from '../types';
type Approval = 'allow' | 'deny' | 'cancel';
interface Runtime {
 provider: LLMProvider; settings: Settings; resolveCharacter:(id?:string)=>Character|undefined;
 service:{online:boolean;tools:ToolDefinition[]}; contextTokens?:number;
 localService: typeof ServiceClient;
 patchConversation:(id:string, fn:(c:Conversation)=>Conversation)=>void;
 patchMessage:(id:string,mid:string,fn:(m:ChatMessage)=>ChatMessage)=>void;
 setGeneratingId:(id:string|null)=>void; setLastStats:(s?:GenerationStats)=>void;
 abortRef:{current:AbortController|null}; imageJobRef:{current:string|null};
 approvals:{current:Map<string,(a:Approval)=>void>};
 chatEvents:{emit:(event:'start'|'token'|'end'|'error',payload:any)=>void}; replyId?:string;
 knowledgeContext?:{decision?:{route?:string;reason?:string};evidence?:string;citations?:EvidenceCitation[];diagnostics?:Record<string,unknown>;compatibility?:Record<string,unknown>}|null;
 /** The caller folds the context summary after the reply (server/shared path); skip the pre-reply fold. */
 deferContextSummary?:boolean;
 /** Steps of a saved skill the server matched to this message (server/tools/skillMatch.mjs); goes into this turn's context. */
 skillGuide?:string;
 /** Script of a matched "output: exact" skill: its printed result must reach the user unchanged (see skillOutput.ts). */
 skillExactOutput?:string;
 /** Script of the matched skill (any skill with a .py): a reply that never runs it gets one reminder (replyChecks.ts). */
 skillScript?:string;
 /** Roleplay chats (server path): files read from data/roleplay/<id>/ for this turn. */
 roleplay?:{card:string;story:string;appearance:string;looks?:string;recall:(query:string,excludeIds:string[])=>string};
}
export function confirmedKnowledgeSave(text:string):boolean {
  const value=String(text??'').trim();
  if (/ไม่ถูก|ผิด|ไม่ต้อง|ไม่ใช่|อย่า(?:เก็บ|บันทึก|เพิ่ม)/i.test(value)) return false;
  const confirms=/(?:ถูก(?:ต้อง)?|ใช่|ยืนยัน|ข้อมูล(?:นี้)?โอเค|correct|confirmed?)/i.test(value);
  const saves=/(?:เก็บ(?:ไว้|เข้า|ลง)?|บันทึก|เพิ่ม|ใส่|เซฟ|save).{0,20}(?:คลังความรู้|ฐานความรู้|\bRAG\b)?/i.test(value);
  return confirms&&saves;
}
// Retrieve against the current turn. Including the previous user turn caused
// memories from the old topic to leak into the first message after a topic change.
function memoryQuery(history:ChatMessage[]){return textOf(history.filter(m=>m.role==='user').at(-1)!).trim()}
/*
 * Rolling chat memory. Messages after the summary boundary are sent word for word (8–16 of them);
 * once more than 16 are pending, the oldest 8 are folded into a written summary by the model. The
 * boundary moves in blocks of 8, so the history prefix stays identical between folds (prompt cache).
 */
const KEEP_MAX=16, FOLD=8;
const lineOf=(m:ChatMessage,max=600)=>{const t=textOf(m).replace(/\s+/g,' ').trim();const img=m.parts?.some(p=>p.type==='image')?' [ส่งภาพให้ผู้ใช้]':'';return `${m.role==='user'?'User':'Lumicos'}: ${t.length>max?t.slice(0,max)+'…':t}${img}`};
/**
 * Fingerprint of the history a summary was written from. Ids alone are not enough: an edit keeps the id.
 * Error turns are skipped because the server path drops them from history before replying.
 */
export function contextSummarySignature(messages:ChatMessage[]):string{
  const kept=messages.filter(m=>m.status!=='error');
  const s=kept.map(m=>`${m.id}\u0001${m.role}\u0001${textOf(m)}\u0001${m.editedAt??''}`).join('\u0002');
  let h=2166136261;for(let i=0;i<s.length;i++){h^=s.charCodeAt(i);h=Math.imul(h,16777619)}
  return `${kept.length}:${(h>>>0).toString(36)}`;
}
/** Local/client path: summaries still being written after a reply, by conversation. A newer message cancels them. */
const pendingFolds=new Map<string,AbortController>();
export function compactContext(conv:Conversation,history:ChatMessage[]) {
  let marked=conv.contextSummaryUpTo?history.findIndex(m=>m.id===conv.contextSummaryUpTo):-1;
  let invalidated=!!conv.contextSummaryUpTo&&marked<0;
  if(marked>=0){
    // The summarised prefix changed (edit/delete/regenerate with the same ids): never reuse that summary.
    // Legacy summaries without a fingerprint are trusted unless a message in their prefix was edited.
    const prefix=history.slice(0,marked+1);
    const stale=conv.contextSummarySig?conv.contextSummarySig!==contextSummarySignature(prefix):prefix.some(m=>m.editedAt);
    if(stale){marked=-1;invalidated=true;}
  }
  const start=marked>=0?marked+1:0;
  const summary=marked>=0?conv.contextSummary:undefined;
  const pending=history.slice(start);
  // `base` is the still-valid written summary (no raw tail): the only thing a new fold may build on.
  if(pending.length<=KEEP_MAX)return {history:pending,summary,base:summary,fold:undefined as ChatMessage[]|undefined,start,invalidated};
  // Due: fold the oldest block. Until the fold is written, anything beyond 16 goes in as a raw tail (old behaviour).
  // The kept window starts with a user message: 16 kept messages ending with the user's latest one used to start with
  // an assistant reply whose question was cut away, and Gemma copied that reply word for word (claude-20261023:
  // roleplay turns 14/18/20 repeated turns 6/10/12).
  let keep=KEEP_MAX;
  while(keep>1&&pending[pending.length-keep]?.role!=='user')keep--;
  const overflow=pending.slice(0,pending.length-keep);
  const raw=overflow.map(m=>lineOf(m,400)).join('\n').slice(-2000);
  return {history:pending.slice(-keep),summary:[summary,raw].filter(Boolean).join('\n'),base:summary,fold:pending.slice(0,FOLD),start,invalidated};
}
// Token room for the summaries: Thai takes about one token per 2–3 characters, so 300/480 tokens cut the notes
// short (claude-20261024). The prompts ask for under 1,200 characters; the limit is only a backstop.
const NOTES_TOKENS=1000;
export async function foldContext(provider:LLMProvider,previous:string|undefined,block:ChatMessage[],signal:AbortSignal,correlationId?:string):Promise<string|undefined>{
  let text='',failed=false,finish:string|undefined;
  const bounded=AbortSignal.any([signal,AbortSignal.timeout(45000)]);
  try{
    await provider.streamChat({purpose:'context-summary',correlationId,enableThinking:false,params:{temperature:0.2,topP:0.9,maxTokens:NOTES_TOKENS},messages:[
      {role:'system',content:'You keep the running memory of one conversation between the user and the assistant. Merge the new messages into the existing summary. Keep: topics discussed and how they ended, facts the user shared about themselves or their things, names given (pets, characters, files), decisions and agreements, preferences stated in this chat, open questions or promises Lumicos made, pictures that were made. Drop small talk and greetings. Record what Lumicos said as Lumicos\'s claim (e.g. "Lumicos บอกว่า…"), never as a verified fact, and keep any uncertainty. Write in Thai as short "- " bullet points, at most 14 bullets, oldest first, concrete (names, numbers, dates). Keep the whole summary under 1,200 characters: when it would be longer, merge the oldest points into one bullet instead of dropping the newest. Output only the bullets.'},
      {role:'user',content:`Existing summary:\n${previous?.trim()||'(none yet)'}\n\nNew messages:\n${block.map(m=>lineOf(m)).join('\n')}`},
    ]} as any,{onToken:t=>{text+=t},onError:()=>{failed=true},onDone:r=>{finish=r?.finishReason}},bounded);
  }catch{failed=true}
  const out=finishedNotes(stripPersonaControlText(text).replace(/<think>[\s\S]*?<\/think>/g,'').trim(),finish);
  if(failed||!out||!/^\s*[-•*]/m.test(out))return undefined;
  return clipLines(out,2000);
}
/** Rewrites the roleplay "story so far" (story.md) from the existing notes plus the newest messages. */
export async function foldStory(provider:LLMProvider,previous:string|undefined,block:ChatMessage[],names:{character:string;user:string},signal:AbortSignal,correlationId?:string):Promise<string|undefined>{
  let text='',failed=false,finish:string|undefined;
  const bounded=AbortSignal.any([signal,AbortSignal.timeout(60000)]);
  const line=(m:ChatMessage)=>{const t=textOf(m).replace(/\s+/g,' ').trim();return `${m.role==='user'?names.user:names.character}: ${t.length>700?t.slice(0,700)+'…':t}`};
  try{
    await provider.streamChat({purpose:'context-summary',correlationId,enableThinking:false,params:{temperature:0.2,topP:0.9,maxTokens:NOTES_TOKENS},messages:[
      {role:'system',content:`You keep the "story so far" notes of an interactive roleplay between ${names.user} (the user) and ${names.character}. Everything is fiction. Merge the new messages into the existing notes. Keep: where and when the scene is and who is present, what happened in order (key events only), promises, decisions and secrets, changes in how the characters feel about each other, names, items and facts that were established, threads that are still open. Begin with one bullet "- ข้อเท็จจริง: …" (in the story's language) listing lasting facts about each person: name, where they come from, what they do, what they ordered, own or carry, each with whose it is. Copy every fact from the existing notes' facts bullet and add the new ones; never drop or change an old fact unless the story changed it. Keep who-did-what straight: ${names.user} is the user's character, ${names.character} is the other character. Drop filler, small talk and wording. Write in the language the story is told in as short "- " bullet points, in this order: the facts bullet; one bullet for the scene (where, when, who is there); the key events, oldest first, one short line each, without labels such as การกระทำ/ความรู้สึก/สิ่งที่เกิดขึ้น; last, one bullet "- ค้างอยู่: …" for promises, deals, plans and open threads. Keep the whole notes under 1,200 characters: when they would be longer, merge the oldest events into one bullet instead of dropping the newest. If the existing notes were edited by the user, keep their content. Output only the bullets.`},
      {role:'user',content:`Existing notes:\n${previous?.trim()||'(none yet)'}\n\nNew messages:\n${block.map(line).join('\n')}`},
    ]} as any,{onToken:t=>{text+=t},onError:()=>{failed=true},onDone:r=>{finish=r?.finishReason}},bounded);
  }catch{failed=true}
  const out=finishedNotes(stripPersonaControlText(text).replace(/<think>[\s\S]*?<\/think>/g,'').trim(),finish);
  if(failed||!out||!/^\s*[-•*]/m.test(out))return undefined;
  return fitNotes(out,1800);
}
export async function runChatReply(runtime:Runtime,conv:Conversation,history:ChatMessage[],profile:ModelProfile|null=null,controller=new AbortController()) {
 const {provider,settings,resolveCharacter,service,contextTokens,localService,patchConversation,patchMessage,setGeneratingId,setLastStats,abortRef,imageJobRef,approvals,chatEvents,replyId,knowledgeContext,deferContextSummary}=runtime;
 const roleplayMode=conv.mode==='roleplay';
 pendingFolds.get(conv.id)?.abort();
      const defaults = profile?.generation ?? settings.generation;
      const generation = {...defaults,maxTokens:Math.min(defaults.maxTokens, Math.floor((profile?.ctx ?? contextTokens ?? 8192)/2))};
      const contextLimit = profile?.ctx ?? contextTokens;
      const character = resolveCharacter(conv.characterId);
      // A chat whose character was deleted is read-only (never silently re-personalised).
      if (!character) return;

      abortRef.current = controller;
      const signal = controller.signal;

      // Local copy of the reply; commit() pushes a snapshot into React state.
      const triggeringUser=[...history].reverse().find(m=>m.role==='user');
      let msg: ChatMessage = makeMessage('assistant', '', { id: replyId ?? uid(), replyToId:triggeringUser?.id, status: 'streaming', toolRuns: [] });
      let persistenceMs=0;
      const commit = () => {
        const started=performance.now();
        const snapshot: ChatMessage = { ...msg, toolRuns: msg.toolRuns?.map((r) => ({ ...r })) };
        patchMessage(conv.id, snapshot.id, () => snapshot);
        persistenceMs+=performance.now()-started;
      };
      patchConversation(conv.id, (c) => ({ ...c, messages: [...history, msg], updatedAt: Date.now() }));
      setGeneratingId(msg.id);
      if(!conv.private) chatEvents.emit('start', { conversationId: conv.id, messageId: msg.id });

      const lastUser = [...history].reverse().find((m) => m.role === 'user');
      const existingImage = existingImageReply(history);
      if (existingImage) {
        msg = {...msg, ...setText(msg, existingImage.text), parts: [{type:'text', text: existingImage.text}, ...existingImage.images], status:'done', toolRuns:undefined, modelText:existingImage.text};
        commit();
        if (!conv.private) chatEvents.emit('end', {conversationId:conv.id, message:msg, stopped:false});
        setGeneratingId(null); approvals.current.clear(); abortRef.current = null;
        return;
      }
      if (knowledgeContext?.evidence && knowledgeContext.citations?.length) {
        msg = { ...msg, citations: knowledgeContext.citations };
        commit();
      }
      // Never let the model role-play a search. An explicit web request must have real
      // web evidence before inference; otherwise return a transparent failure.
      // "ไม่ต้องค้นเว็บ" also contains "ค้นเว็บ": a request NOT to search is never a web request (same NO_WEB as the router),
      // so it gets no "could not check online" note either.
      const noWebAsked = (!!lastUser && /(ห้ามค้น(?:หา)?เว็บ|ไม่ต้องค้น(?:หา)?เว็บ|อย่าค้น(?:หา)?เว็บ|ไม่ใช้อินเทอร์เน็ต|do not (?:search|browse)|don'?t (?:search|browse)|without web|no web)/iu.test(textOf(lastUser)))
        || (knowledgeContext?.decision as {reason?:string}|undefined)?.reason === 'explicit-no-web';
      const explicitWebRequest = !!lastUser && !noWebAsked && /((?:ค้น|หา|เช็ก|เช็ค|ดู|เสิร์ช)\S{0,8}?(?:ใน|จาก|บน|ทาง)?\s*(?:เว็บ|เน็ต(?!ฟลิกซ์|ฟลิก)|อินเทอร์เน็ต|อินเตอร์เน็ต|ออนไลน์|กูเกิล|google)|เว็บ\s*เสิร์ช|เสิร์ช(?:เว็บ|หา|ดู|ให้)|ใช้\s*(?:web_search|เว็บ)|web\s*search|search\s+(?:the\s+)?(?:web|internet|online)|look\s+(?:it\s+)?up\s+online|google\s+it|browse\s+(?:the\s+)?web)/iu.test(textOf(lastUser));
      const hasWebEvidence = !!knowledgeContext?.citations?.some((citation) => citation.kind === 'web' && citation.url);
      const routedToWeb = ['WEB', 'HYBRID'].includes(knowledgeContext?.decision?.route ?? '');
      // Search ran but produced nothing usable: do not stonewall. Let the model answer from what it
      // knows, with a short honest note that it could not verify online (see webSearchNote in the prompt).
      let webSearchNote: string | undefined;
      // Roleplay never searches; a note about the web would only make the character talk about websites.
      if (!roleplayMode && (explicitWebRequest || routedToWeb) && !hasWebEvidence) {
        const validation = (knowledgeContext?.diagnostics as {validation?:{status?:string}}|undefined)?.validation;
        const status = knowledgeContext?.diagnostics?.status;
        // Keep "search failed", "nothing found" and "found, but about something else" apart.
        const why = status === 'timeout' ? 'the web search timed out'
          : status === 'offline' || status === 'error' || status === 'cancelled' ? 'the web search could not run'
          : validation?.status === 'mismatch_only' ? 'the web search found sources, but none were about the market/period the user asked for (they were removed)'
          : 'the web search returned no usable sources';
        webSearchNote = `For this turn ${why}. Answer from your own general knowledge anyway, as helpfully as you can. Start with one short, natural sentence saying you could not check online right now so details may be out of date (in the user's language; in Thai for example \"ตอนนี้เช็กข้อมูลออนไลน์ไม่ได้ ข้อมูลอาจไม่ใช่ล่าสุดนะ\"), then answer. Never say or imply that you checked, looked up or found anything this turn. Do not claim you searched successfully, do not invent URLs, sources, quotes, or exact live figures (prices, scores, weather) — give typical ranges or how to check instead. If the question cannot be answered at all without live data, say so briefly and suggest asking again in a moment or sending a link.`;
      }
      // "ถูกต้อง เก็บไว้เลย" answers the previous reply's offer to save web findings.
      const offered = [...history].reverse().find((m) => m.role === 'assistant');
      if (offered?.knowledgeCandidate?.status === 'pending' && lastUser && !conv.private) {
        const said = textOf(lastUser).trim();
        const yes = confirmedKnowledgeSave(said);
        const no = /^(?:ไม่ถูก|ผิด|ไม่ใช่|ไม่ต้อง)|อย่าเก็บ|ไม่ต้องเก็บ/i.test(said);
        if (yes || no) {
          let patch: Partial<NonNullable<ChatMessage['knowledgeCandidate']>> = { status: 'dismissed' };
          if (yes) try {
            const saved = await localService.knowledge.learn({ question: offered.knowledgeCandidate.question, answer: textOf(offered), sources: offered.knowledgeCandidate.sources, confirmed: true });
            patch = { status: 'saved', file: saved.file };
          } catch (e) { patch = { status: 'pending', error: (e as Error).message }; }
          patchMessage(conv.id, offered.id, (m) => m.knowledgeCandidate ? { ...m, knowledgeCandidate: { ...m.knowledgeCandidate, ...patch } } : m);
        }
      }
      // Image tools require permission from THIS user turn, never previous history or the model.
      const imageIntent = resolveImageIntent(history);
      const imageRequested = imageIntent.kind !== 'none';
      // "ไม่ต้องค้นเว็บ" also takes web_search off this turn's tool list (claude-20261023: with unanswered gold-price questions
      // earlier in the chat, the model searched the web anyway and answered those instead of the chemistry question).
      const permittedTools = service.tools.filter(tool => conv.mode === 'roleplay' ? tool.name === 'generate_image' : (tool.name !== 'generate_image' || imageRequested) && !(noWebAsked && tool.name === 'web_search'));
      const phone=lastUser?.source==='voice';
      const responseStarted=performance.now();
      const routed=phone?undefined:routeChatReasoning(settings.chatReasoningMode,lastUser?textOf(lastUser):'');
      const searchMs=Number(knowledgeContext?.diagnostics?.elapsedMs??0);
      const latency:ChatLatency|undefined=routed?{...routed,routingMs:performance.now()-responseStarted,contextPreparationMs:0,toolExecutionMs:0,totalMs:0,searchMs,totalResponseMs:0,inferenceRounds:0,reasoningObserved:false}:undefined;
      const compact=compactContext(conv,history);
      let contextSummaryMs=0;
      // The fold (~2–4 s, every 8 messages) is never done before the reply: this turn sends the raw tail, and the
      // summary is written after the reply is shown (see the end of this function). The server path does the same itself.
      const foldAfter=compact.fold&&!conv.private&&!deferContextSummary&&!roleplayMode?{fold:compact.fold,base:compact.base,start:compact.start}:undefined;
      const prepareStarted=performance.now();
      if(phone)generation.maxTokens=Math.min(generation.maxTokens,220);
      const replyLength=phone||!lastUser||roleplayMode?undefined:classifyReplyLength(textOf(lastUser),{hasAttachment:lastUser.parts.some(p=>p.type!=='text')});
      const lengthCap=replyLength?REPLY_TOKEN_CAP[replyLength]:undefined;
      const formatRule=phone||!lastUser||roleplayMode?'':formatLimitRule(textOf(lastUser));
      if(lengthCap)generation.maxTokens=Math.min(generation.maxTokens,lengthCap);
      // Roleplay: the scene sets the length (the prompt says so); this cap only stops a runaway reply.
      if(roleplayMode)generation.maxTokens=Math.min(generation.maxTokens,700);
      const online = service.online && !conv.private;
      const lastUserText = lastUser ? textOf(lastUser) : '';
      const oocTurn = roleplayMode && isOocText(lastUserText);
      // Roleplay: scene facts must never reach the user's real memories, and real memories never reach the scene.
      const useMemory = online && !roleplayMode;

      // Memory suggestions from the user's message (rule-based on the service; nothing is saved).
      const candidatesPromise: Promise<MemoryCandidate[]> =
        useMemory && settings.memory.enabled && settings.memory.autoCandidates && lastUser
          ? localService.memory
              .candidates(
                textOf(lastUser),
                conv.messages.flatMap((m) => m.memoryCandidates?.filter((c) => c.status === 'pending').map((c) => c.content) ?? []),
              )
              .then((list) => list.map((c) => ({ ...c, id: uid(), source: 'rules' as const, status: 'pending' as const })))
              .catch(() => [])
          : Promise.resolve([]);

      // Relevant long-term memories for this message (never the whole database).
      let memories: UsedMemory[] = [];
      if (useMemory && settings.memory.enabled && lastUser) {
        try {
          const found = await localService.memory.retrieve(memoryQuery(history), character.id, settings.memory.maxInjected);
          memories = found.map((f) => ({ id: f.memory.id, type: f.memory.type, content: f.memory.content, score: f.score, reason: f.reason }));
        } catch {
          /* service hiccup: answer without memory */
        }
      }
      msg = { ...msg, memoriesUsed: memories };
      if(latency)latency.contextPreparationMs+=performance.now()-prepareStarted;

      const toolsWanted =
        !phone && !oocTurn && (profile?.capabilities.tools ?? false) && online && service.tools.length > 0 && settings.tools.mode !== 'off' && (settings.tools.mode === 'always' || imageRequested || wantsTools(history));
      const max = settings.tools.maxIterations;

      let committedVisible = '';
      let stats: GenerationStats | undefined;
      let stopped = false;
      let failed: string | undefined;
      let webSearchCalls = 0;

      let scannedPdfImage: Awaited<ReturnType<typeof localService.attachments.pdfPage>> | undefined;

      // Roleplay context for this turn: card + story so far + log pieces that match the latest message.
      // Messages already in the prompt are skipped by the recall.
      const roleplayFiles = roleplayMode && runtime.roleplay ? runtime.roleplay : undefined;
      const roleplayRecall = roleplayFiles && !oocTurn ? roleplayFiles.recall(lastUserText, [...compact.history.map(m => m.id), msg.id]) : '';
      // Same date/time for every step of this reply, so the turn context does not change between tool rounds.
      const turnTime = new Date();
      // One more try per reply when the draft has a known problem (see replyChecks.ts / repeatGuard.ts).
      let retried = false;
      let turnNote: string | undefined;
      for (let step = 0; step <= max; step++) {
        const roundPreparationStarted=performance.now();
        const toolsThisStep = toolsWanted && step < max;
        const { messages, info } = buildMessages({
          globalPrompt: settings.systemPrompt,
          replyLength,
          anonymous: !!conv.private,
          phone,
          character,
          userName: settings.userName,
          greetingMode: settings.greetingMode,
          // The reply-in-progress carries this turn's tool calls/results so far.
          history: [...compact.history, { ...msg, parts: [{ type: 'text', text: '' }], status: 'streaming' }],
          contextSummary: roleplayFiles?.story ? undefined : compact.summary,
          roleplay: roleplayFiles ? { characterName: character.name, card: roleplayFiles.card, story: roleplayFiles.story, recall: roleplayRecall, ooc: oocTurn, thai: /[\u0E00-\u0E7F]/.test(lastUserText), closeness: computeCloseness(conv.messages), looks: roleplayFiles.looks, playerChars: lastUserText.trim().length, selfAsk: SELF_ASK.test(lastUserText) } : undefined,
          memories,
          evidenceContext: knowledgeContext?.evidence,
          skillGuide: oocTurn ? undefined : runtime.skillGuide,
          now: turnTime,
          formatRule,
          retryNote: turnNote,
          webSearchNote,
          tools: toolsThisStep ? permittedTools : undefined,
          budget: contextLimit ? { contextTokens: contextLimit, replyTokens: Math.min(generation.maxTokens, Math.floor(contextLimit/2)) } : undefined,
        });
        msg = { ...msg, contextInfo: info };
        if (info.overBudget) {
          // Sending would cut the user's own message or a tool call mid-way; say so instead of a broken prompt.
          failed = 'ข้อความหรือไฟล์ล่าสุดยาวเกินพื้นที่ context ของโมเดล จึงยังไม่ได้ส่งให้โมเดลตอบ กรุณาย่อข้อความหรือแนบไฟล์ที่สั้นลง';
          break;
        }

        // ---- stream one model turn ----
        let raw = '';
        let emittedText = '';
        const cleanOutput = (text:string) => character.id==='default-mina' ? stripPersonaControlText(text) : text;
        let reasoning = msg.reasoning ?? '';
        let frame: ReturnType<typeof setTimeout> | undefined;
        const render = () => {
          frame = undefined;
          const shown = cleanOutput(toolsWanted ? visibleText(raw) : raw);
          msg = setText({ ...msg, reasoning: reasoning || undefined }, shown || committedVisible);
          commit();
        };
        const schedule = () => {
          if (!frame) frame = setTimeout(render, 32);
        };

        let stepError: string | undefined;

        // Load scanned PDF images only for the current model request.
        // Never store Base64 images in conversation history.
        if (lastUser && online) {
          const pictures=lastUser.parts.filter(p=>p.type==='image');
          if(pictures.length){
            try{
              const turn=[...messages].reverse().find(m=>m.role==='user');
              if(turn){
                const content=typeof turn.content==='string'?turn.content:'ช่วยอธิบายภาพที่แนบ';
                const images=await Promise.all(pictures.map(async picture=>{
                  const blob=await localService.images.download(picture.url);
                  const bytes = new Uint8Array(await blob.arrayBuffer());
                  let binary=''; for(const byte of bytes) binary+=String.fromCharCode(byte);
                  const url='data:'+blob.type+';base64,'+btoa(binary);
                  return {type:'image_url' as const,image_url:{url}};
                }));
                signal.throwIfAborted();turn.content=[{type:'text',text:content||'ช่วยอธิบายภาพที่แนบ'},...images];
              }
            }catch(e){stepError=(e as Error).message;}
          }
          const scannedPdf = lastUser.parts.find(
            (part): part is AttachmentPart =>
              part.type === 'attachment' &&
              part.kind === 'pdf' &&
              part.context.includes('no text layer on this page'),
          );

          if (scannedPdf) {
            try {
              const page = scannedPdfImage ??= await localService.attachments.pdfPage(scannedPdf.id, 1);
              if (signal.aborted) {
                stopped = true;
                break;
              }

              const lastUserMessage = [...messages].reverse().find(
                (message) => message.role === 'user' &&
                  typeof message.content === 'string' &&
                  message.content.includes(`attachment_id: ${scannedPdf.id}`),
              );

              if (lastUserMessage) {
                const text = typeof lastUserMessage.content === 'string'
                  ? lastUserMessage.content
                  : lastUserMessage.content
                      .filter((part) => part.type === 'text')
                      .map((part) => part.text)
                      .join('\n');

                lastUserMessage.content = [
                  { type: 'text', text: text + '\n[Image: scanned PDF, page 1. Read the attached image directly; text extraction cannot read this scanned page. Only this page is shown.]' },
                  { type: 'image_url', image_url: { url: page.image } },
                ];
              }
            } catch (error) {
              stepError = error instanceof Error ? error.message : String(error);
            }
          }
        }

        if (stepError) {
          failed = `Could not prepare PDF image: ${stepError}`;
          break;
        }

        if(latency){latency.contextPreparationMs+=performance.now()-roundPreparationStarted;latency.inferenceRounds++;}
        const inferenceStarted=performance.now();
        let firstReasoningAt:number|undefined;
        let reasoningEndedAt:number|undefined;
        await provider.streamChat(
          { purpose:step===0?'chat-reply':'chat-tool-step',correlationId:msg.id,messages, params: generation,enableThinking:phone?false:routed?.effective==='DEEP' },
          {
            onToken: (t) => {
              if(latency){latency.firstTokenMs??=performance.now()-inferenceStarted;latency.firstTextMs??=performance.now()-inferenceStarted;}
              if(firstReasoningAt!==undefined)reasoningEndedAt??=performance.now();
              raw += t;
              schedule();
              if(!conv.private) { const safe=cleanOutput(toolsWanted?visibleText(raw):raw);const delta=safe.slice(emittedText.length);emittedText=safe;if(delta)chatEvents.emit('token', { conversationId: conv.id, messageId: msg.id, text: delta }); }
            },
            onReasoning: (t) => {
              firstReasoningAt??=performance.now();
              if(latency){latency.reasoningObserved=true;latency.firstTokenMs??=performance.now()-inferenceStarted;}
              reasoning += t;
              schedule();
            },
            onDone: (r) => {
              stats = r.stats;
              if(latency&&r.stats?.promptProcessingMs!==undefined)latency.promptProcessingMs=(latency.promptProcessingMs??0)+r.stats.promptProcessingMs;
              if(latency&&r.stats){latency.sleepingBefore??=r.stats.sleepingBefore;latency.wakeMs=(latency.wakeMs??0)+(r.stats.wakeMs??0)}
              stopped = r.stopped;
            },
            onError: (err) => {
              stepError = err.message;
            },
          },
          signal,
        );
        if(latency&&firstReasoningAt!==undefined)latency.reasoningMs=(latency.reasoningMs??0)+(reasoningEndedAt??performance.now())-firstReasoningAt;
        clearTimeout(frame);
        render();

        if (stepError) {
          failed = stepError;
          break;
        }
        if (stopped) {
          msg = { ...msg, modelText: cleanOutput(raw), promptText: raw };
          break;
        }

        let parsed: ReturnType<typeof parseToolCall> = toolsThisStep ? parseToolCall(raw) : ({ kind: 'none' } as const);
        // The user asked for a picture but the model only described one: generate it anyway.
        const roleplaying = roleplayMode || history.slice(-20).some((m) => m.role === 'user' && /(roleplay|โรลเพลย์|โรล|สวมบทบาท|บทบาทสมมติ|แสดงเป็น|เล่นเป็น|pretend to be)/i.test(textOf(m)));
        if (parsed.kind === 'none' && imageRequested && toolsThisStep && !msg.toolRuns?.some((r) => r.tool === 'generate_image')) {
          const userText = lastUser ? textOf(lastUser) : '';
          const prompt = imagePromptFromModelText(raw) ?? (imageIntent.prompt && imageIntent.prompt !== userText ? imagePrompt(imageIntent.prompt) ?? imageIntent.prompt : undefined) ?? (imagePrompt(userText) ?? userText);
          if (prompt.trim()) parsed = { kind: 'call', call: { tool: 'generate_image', args: { prompt: prompt.trim().slice(0, 1500), ...(SELFIE_REQUEST.test(userText) ? (roleplaying ? { subject: 'roleplay' } : {}) : { subject: roleplaying ? 'roleplay' : 'other' }) } } as any, before: '', raw: '' };
        }
        if (parsed.kind === 'none') {
          // The final answer replaces any "let me check…" lead-in shown while tools ran.
          let finalShown = cleanOutput(toolsWanted ? visibleText(raw) : raw.trim());
          const exactShown = runtime.skillExactOutput ? keepExactOutput(finalShown, printedBySkill(msg.toolRuns, runtime.skillExactOutput)) : finalShown;
          if (exactShown !== finalShown) {
            msg = setText({ ...msg, modelText: exactShown, promptText: exactShown }, exactShown);
            break;
          }
          // One more try (at most once per reply): a failed run_python call the draft did not redo, a matched skill whose
          // script never ran, a claim of tool use with no tool run, or an earlier reply copied word for word.
          if (!retried && step < max) {
            const runs = msg.toolRuns ?? [];
            const script = !oocTurn && !roleplayMode && toolsWanted ? runtime.skillScript : undefined;
            const note = lastRunFailed(runs) ? RETRY_NOTES.failed
              : script && !ranScript(runs, script) ? RETRY_NOTES.notRun(script)
              : !runs.length && CLAIMS_TOOL.test(finalShown) ? RETRY_NOTES.claim
              : !runs.length && repeatsEarlierReply(finalShown, history, lastUserText) ? REPEAT_NOTE
              : undefined;
            if (note) { retried = true; turnNote = note; continue; }
          }
          msg = setText({ ...msg, modelText: cleanOutput(raw), promptText: raw }, finalShown || committedVisible);
          break;
        }

        // ---- the model asked for a tool ----
        // Show only the latest lead-in ("Sure, opening the file…") while the tool runs.
        if (parsed.before) committedVisible = cleanOutput(parsed.before);
        const blockAt = raw.indexOf(parsed.raw);
        const run: ToolRun = {
          id: uid(),
          tool: parsed.kind === 'call' ? parsed.call.tool : '(invalid)',
          args: parsed.kind === 'call' ? parsed.call.args : {},
          status: 'validating',
          callText: blockAt >= 0 ? raw.slice(0, blockAt + parsed.raw.length) : raw,
        };
        if (run.tool === 'generate_image' && !imageRequested && !/(ภาพ|รูป|เซลฟี|image|photo|picture|pic|selfie)/i.test(lastUser ? textOf(lastUser) : '')) {
          failed = 'ไม่ได้สั่งสร้างภาพในข้อความนี้ กรุณาส่งข้อความอีกครั้งค่ะ';
          msg = setText({ ...msg, modelText: failed }, failed);
          break;
        }
        if (run.tool === 'generate_image' && typeof run.args.prompt === 'string') {
          const requestText=lastUser?textOf(lastUser):'';
          let prompt=run.args.subject==='roleplay'||run.args.subject==='other'?run.args.prompt:bindSelfImagePrompt(run.args.prompt,requestText,character.id);
          const aspect=requestedSize(requestText);
          if(aspect&&!run.args.inputId){prompt=preserveImageAspect(prompt,aspect);run.args={...run.args,width:IMAGE_SIZES[aspect].width,height:IMAGE_SIZES[aspect].height};}
          // Roleplay scene button: the picture comes from the story (card + story notes + latest narration), not from whatever the model wrote.
          if(roleplayMode&&runtime.roleplay&&SCENE_REQUEST_RE.test(requestText)){
            const lastReply=[...history].reverse().find(m=>m.role==='assistant'&&!m.isGreeting&&textOf(m).trim());
            const composed=composeScenePrompt({appearance:runtime.roleplay.appearance,card:runtime.roleplay.card,story:runtime.roleplay.story,lastReply:lastReply?textOf(lastReply):''});
            if(composed)prompt=composed;
          }
          // Roleplay: the card's appearance line goes first so the character looks the same in every picture.
          if(roleplayMode&&runtime.roleplay?.appearance&&!prompt.includes(runtime.roleplay.appearance))prompt=`${runtime.roleplay.appearance}. ${prompt}`.slice(0,1500);
          run.args = {...run.args,prompt};
        }
        const update = (patch: Partial<ToolRun>) => {
          Object.assign(run, patch);
          const others = (msg.toolRuns ?? []).filter((r) => r.id !== run.id);
          msg = setText({ ...msg, toolRuns: [...others, { ...run }] }, committedVisible);
          commit();
        };
        update({});

        // Roleplay: the model was told it only has generate_image; refuse anything else instead of running it.
        if (roleplayMode && run.tool !== 'generate_image') {
          update({ status: 'error', error: 'This tool is not available in a roleplay chat. Only generate_image exists here; continue the scene without it.' });
          continue;
        }

        if (parsed.kind === 'malformed') {
          update({ status: 'error', error: `Invalid tool request: ${parsed.error} Use exactly one \`\`\`tool block with {"tool": "...", "arguments": {...}}.` });
          continue;
        }

        if (run.tool === 'set_theme') {
          const r = runThemeTool(run.args);
          update(r.ok ? { status: 'done', summary: r.message, resultForModel: r.message } : { status: 'error', error: r.message });
          continue;
        }

        if (run.tool === 'web_search' && webSearchCalls >= 1) {
          update({ status: 'error', error: 'Web Search is limited to one call per reply to prevent search loops.' });
          continue;
        }
        if (run.tool === 'web_search') webSearchCalls++;

        let toolExecutionStarted:number|undefined;
        try {
          const v = await localService.tools.validate(run.tool, run.args);
          update({ permission: v.permission, preview: v.preview });
          const mustAsk = v.permission === 'destructive' || (v.permission === 'write' && settings.tools.confirmWrites);

          let decision: Approval = 'allow';
          if (mustAsk) {
            update({ status: 'awaiting' });
            decision = await new Promise<Approval>((resolve) => {
              approvals.current.set(run.id, resolve);
              if (signal.aborted) resolve('cancel');
              else signal.addEventListener('abort', () => resolve('cancel'), { once: true });
            });
            approvals.current.delete(run.id);
          }
          if (decision === 'cancel') {
            update({ status: 'cancelled' });
            stopped = true;
            break;
          }
          if (decision === 'deny') {
            update({ status: 'denied', summary: `Declined: ${v.preview.action} ${v.preview.target ?? ''}`.trim() });
            continue;
          }

          update({ status: 'running' });
          toolExecutionStarted=performance.now();
          const r = await localService.tools.execute(run.tool, run.args, v.approvalId);
          update({ status: 'done', summary: r.summary, resultForModel: r.content, data: r.data });
          const imageData = r.data as {jobId?:string} | undefined;
          if (run.tool === 'generate_image' && imageData?.jobId) {
            imageJobRef.current=imageData.jobId;
            let job=await localService.images.get(imageData.jobId);
            if(signal.aborted)await localService.images.cancel(job.id);
            while(!['done','failed','cancelled'].includes(job.status)) {
              msg=setText(msg,job.stage==='upscaling'?'กำลังเพิ่มความละเอียดภาพ…':'กำลังสร้างภาพ…');commit();
              await new Promise(resolve=>setTimeout(resolve,1000));
              job=await localService.images.get(job.id);
            }
            imageJobRef.current=null;
            if(job.status==='failed')throw new Error(job.error??'สร้างภาพไม่สำเร็จ');
            stopped=job.status==='cancelled';
            update({status:stopped?'cancelled':'done',summary:stopped?'ยกเลิกแล้ว':'สร้างภาพแล้ว'});
            msg={...msg,parts:[...(committedVisible.trim()?[{type:'text' as const,text:committedVisible.trim()}]:[]),...imageJobParts(job)]};commit();
            break;
          }
          if (r.candidate) {
            const c = r.candidate;
            msg = {
              ...msg,
              memoryCandidates: [
                ...(msg.memoryCandidates ?? []),
                { id: uid(), type: c.type, content: c.content, tags: c.tags ?? [], importance: c.importance ?? 3, source: 'model', status: 'pending' },
              ],
            };
            commit();
          }
        } catch (e) {
          update({ status: 'error', error: (e as Error).message });
          if(run.tool==='generate_image') {imageJobRef.current=null;failed=(e as Error).message;break;}
          if ((e as { code?: string }).code === 'OFFLINE') {
            failed = (e as Error).message;
            break;
          }
        } finally {
          if(latency&&toolExecutionStarted!==undefined)latency.toolExecutionMs+=performance.now()-toolExecutionStarted;
        }
      }

      // ---- finish ----
      const candidateWaitStarted=performance.now();
      const ruleCandidates = await candidatesPromise;
      if(latency){latency.contextPreparationMs+=performance.now()-candidateWaitStarted;latency.contextSummaryMs=contextSummaryMs;latency.persistenceMs=persistenceMs;latency.totalMs=performance.now()-responseStarted;latency.totalResponseMs=latency.totalMs+(latency.searchMs??0);}
      const known = new Set((msg.memoryCandidates ?? []).map((c) => c.content));
      const candidates = [...(msg.memoryCandidates ?? []), ...ruleCandidates.filter((c) => !known.has(c.content))];
      // Answers built from the web: offer to keep them in the knowledge library (or keep them automatically).
      const learnMode = settings.knowledge?.learnMode ?? 'ask';
      if (!failed && !stopped && !conv.private && learnMode !== 'off' && lastUser && textOf(msg).trim().length >= 40) {
        const webSources = [
          ...(msg.citations ?? []).filter((c: any) => c.kind === 'web' && c.url).map((c: any) => ({ title: c.title, url: c.url })),
          ...(msg.toolRuns ?? []).filter((r) => r.tool === 'web_search' && r.status === 'done')
            .flatMap((r: any) => (r.data?.results ?? []).map((x: any) => ({ title: x.title, url: x.url }))),
        ].filter((s, i, all) => s.url && all.findIndex((o) => o.url === s.url) === i).slice(0, 6);
        if (webSources.length) {
          const question = textOf(lastUser).trim().slice(0, 300);
          let candidate: NonNullable<ChatMessage['knowledgeCandidate']> = { status: 'pending', question, sources: webSources };
          if (learnMode === 'auto') try {
            const saved = await localService.knowledge.learn({ question, answer: textOf(msg), sources: webSources, confirmed: false });
            candidate = { ...candidate, status: 'saved', file: saved.file, auto: true };
          } catch { /* keep the offer instead */ }
          msg = { ...msg, knowledgeCandidate: candidate };
        }
      }
      msg = {
        ...msg,
        stats: failed ? undefined : stats,
        ...(latency?{chatLatency:{...latency,knowledgeMs:latency.searchMs}}:{}),
        status: failed ? 'error' : stopped ? 'stopped' : 'done',
        error: failed,
        toolRuns: msg.toolRuns?.length ? msg.toolRuns : undefined,
        memoryCandidates: candidates.length ? candidates : undefined,
      };
      commit();

      setLastStats(failed ? undefined : stats); // undefined -> UI shows "--", never a guess
      if (failed && !conv.private) chatEvents.emit('error', { conversationId: conv.id, messageId: msg.id, error: failed });
      else if(!conv.private) {const eventStarted=performance.now();chatEvents.emit('end', { conversationId: conv.id, message: msg, stats, stopped });if(latency&&msg.chatLatency){latency.eventDispatchMs=performance.now()-eventStarted;msg.chatLatency.eventDispatchMs=latency.eventDispatchMs;msg.chatLatency.persistenceMs=persistenceMs;commit();}}

      approvals.current.clear();
      abortRef.current = null;

      // Summary after the reply, while the model is still awake. Not after an image turn (the model slept, ComfyUI holds the GPU),
      // never fails the finished reply, and is dropped if the summary or the summarised messages changed meanwhile.
      if(foldAfter&&!failed&&!stopped&&!msg.toolRuns?.some(r=>r.tool==='generate_image')&&!msg.parts?.some(p=>p.type==='image')){
        const ctl=new AbortController();pendingFolds.set(conv.id,ctl);
        const upTo=foldAfter.fold.at(-1)!.id;
        const sig=contextSummarySignature(history.slice(0,foldAfter.start+foldAfter.fold.length));
        void foldContext(provider,foldAfter.base,foldAfter.fold,ctl.signal,msg.id).then(folded=>{
          if(!folded||ctl.signal.aborted)return;
          patchConversation(conv.id,c=>{
            if(c.contextSummaryUpTo!==conv.contextSummaryUpTo||c.contextSummarySig!==conv.contextSummarySig||c.contextSummary!==conv.contextSummary)return c;
            const end=c.messages.findIndex(m=>m.id===upTo);
            if(end<0||contextSummarySignature(c.messages.slice(0,end+1))!==sig)return c;
            return {...c,contextSummary:folded,contextSummaryUpTo:upTo,contextSummarySig:sig};
          });
        }).catch(()=>{}).finally(()=>{if(pendingFolds.get(conv.id)===ctl)pendingFolds.delete(conv.id)});
      }
}
