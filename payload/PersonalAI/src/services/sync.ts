import type { Character, Conversation, Settings } from '../types';
import { readSSE } from '../providers/sse';
import {clientId} from './deviceIdentity';
export {clientId} from './deviceIdentity';
export interface SharedState {revision:number;conversations:Conversation[];activeId:string|null;characters:Character[];jobs:{id:string;conversationId:string;replyId:string;status:string}[];callOwner?:string|null;preferences?:Partial<Settings>}
export const sharedPreferences=(s:Settings)=>({userName:s.userName,systemPrompt:s.systemPrompt,generation:s.generation,chatReasoningMode:s.chatReasoningMode,greetingMode:s.greetingMode,tools:s.tools,memory:s.memory,knowledge:s.knowledge});
const deviceKey='lumicos.device';
export const deviceId=localStorage.getItem(deviceKey)??crypto.randomUUID();localStorage.setItem(deviceKey,deviceId);
// A tab owns a call; two tabs on one device must not both become the microphone owner.
let state:SharedState={revision:0,conversations:[],activeId:null,characters:[],jobs:[]};
let connected=false,transport='local',error='',enabled=false,ownerId='';
const listeners=new Set<()=>void>();const notify=()=>listeners.forEach(f=>f());
const nativeFetch=window.fetch.bind(window);
window.fetch=(input,init={})=>{
 const url=new URL(typeof input==='string'?input:input instanceof URL?input.href:input.url,location.href);
 if(url.origin===location.origin&&url.pathname.startsWith('/api/')){
  const headers=new Headers(input instanceof Request?input.headers:init.headers);new Headers(init.headers).forEach((v,k)=>headers.set(k,v));
  headers.set('X-Lumicos-Device',clientId);headers.set('X-PersonalAI','1');
  return nativeFetch(input,{...init,headers});
 }return nativeFetch(input,init);
};
async function api(path:string,body?:unknown){const r=await fetch('/api/'+path,{method:body===undefined?'GET':'POST',headers:{'Content-Type':'application/json'},body:body===undefined?undefined:JSON.stringify(body)});const d=await r.json();if(!r.ok)throw Error(d.error?.message??'Lumicos connection failed');return d;}
function accept(event:any){
 if(event.type==='snapshot'){state={...event.state,revision:event.revision??event.state.revision,callOwner:event.callOwner===undefined?state.callOwner:event.callOwner};}
 else {if(event.revision<=state.revision)return;
  state={...state,revision:event.revision};
  if(event.type==='conversation')state.conversations=state.conversations.some(c=>c.id===event.conversation.id)?state.conversations.map(c=>c.id===event.conversation.id?event.conversation:c):[...state.conversations,event.conversation];
  if(event.type==='message')state.conversations=state.conversations.map(c=>c.id===event.conversationId?{...c,syncVersion:event.syncVersion,messages:c.messages.map(m=>m.id===event.message.id?event.message:m)}:c);
  if(event.type==='jobs')state.jobs=event.jobs;
  if(event.type==='call')state.callOwner=event.owner;
 }if(event.type==='snapshot')reactionFeed.reset();
 else if(event.type==='message'&&event.conversationId===state.activeId&&state.conversations.find(c=>c.id===state.activeId)?.characterId==='default-mina')reactionFeed.message(event.conversationId,event.message);
 else if(event.type==='conversation')reactionFeed.update();
 if(event.type==='call'&&!event.owner)cancelReactions();
 notify();
}
async function connect(){
 let delay=1000;
 while(enabled){try{
   const session=await api('session',{});transport=session.transport;ownerId=session.device;
   const response=await fetch('/api/sync/events');if(!response.ok||!response.body)throw Error('Disconnected');
   connected=true;error='';notify();delay=1000;
   for await(const data of readSSE(response.body))accept(JSON.parse(data));
  }catch(e){error=(e as Error).message;}
  connected=false;notify();await new Promise(r=>setTimeout(r,delay));delay=Math.min(delay*2,15000);
 }
}
let tail=Promise.resolve();
export const sync={
 get state(){return state},get enabled(){return enabled},
 get ownerId(){return ownerId},
 get status(){return {connected,transport,error,callOwner:state.callOwner}},
 subscribe(fn:()=>void){listeners.add(fn);return()=>{listeners.delete(fn)}},
 async start(legacy:{conversations:Conversation[];characters:Character[];preferences?:Partial<Settings>}){
  await api('session',{});state=await api('sync');
  // Import old browser records once, preserving them as a recovery backup, never a second database.
  if(!localStorage.getItem('lumicos.server-migrated')){state=await api('sync/migrate',legacy);localStorage.setItem('lumicos.server-migrated','1');}
  enabled=true;void connect();
 },
 mutate(patch:object|((s:SharedState)=>object)){
  const expected=typeof patch==='function'?undefined:Object.fromEntries([...(patch as {upsert?:Conversation[]}).upsert??[],...((patch as {remove?:string[]}).remove??[]).map(id=>({id}))].map(c=>[c.id,state.conversations.find(x=>x.id===c.id)?.syncVersion??0]));
  const work=tail.then(async()=>{try{const result=await api('sync/transaction',{revision:state.revision,versions:expected,...(typeof patch==='function'?patch(state):patch)});accept({type:'snapshot',state:result});}catch(e){error=(e as Error).message;state=await api('sync');notify();throw e;}});
  tail=work.catch(()=>{});return work;
 },
 async flush(){await tail},
 async submit(body:object){await tail;try{return await api('chat/submit',body)}catch(e){error=(e as Error).message;notify();throw e}},
 cancel(id:string){return api('chat/cancel',{id})},
 approve(id:string,allow:boolean){return api('chat/approve',{id,allow})},
};
