import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import {randomUUID} from 'node:crypto';
import {ConversationStore} from '../chat/conversationStore.mjs';
import {ChatService} from '../chat/chatService.mjs';
import {DeviceSessions} from '../chat/deviceSessions.mjs';
import {ModelService} from '../llama/modelService.mjs';
import {createApp} from '../http/app.mjs';
import * as runtime from '../../.runtime/chat.mjs';

const pause=ms=>new Promise(r=>setTimeout(r,ms));
async function fixture(t){
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'lumicos-sync-'));
 const store=new ConversationStore(path.join(dir,'conversations.json'));const devices=new DeviceSessions();let generations=0,parallel=0,maxParallel=0;
 const models={turns:new Map(),enqueueChat:ModelService.prototype.enqueueChat,async begin(){const id=randomUUID();this.turns.set(id,{});return {id,profile:{ctx:8192,capabilities:{tools:false},generation:{maxTokens:100}}}},touch(){},async end(id){this.turns.delete(id)}};
 const config={port:0,allowedOrigins:[],internalToken:randomUUID(),dataDir:dir}; // createApp needs dataDir (background remover model path)
 const chats=new ChatService({store,models,config,tools:{definitions:()=>[]}});
 chats.runtime=async()=>({...runtime,LlamaCppProvider:class {
  async streamChat(request,cb,signal){generations++;maxParallel=Math.max(maxParallel,++parallel);try{for(const token of ['Hello ','from ','Lumicos']){await pause(25);signal.throwIfAborted();cb.onToken(token)}cb.onDone({stopped:false})}finally{parallel--}}
 },createServiceClient:()=>({})});
 const voice={async startCall(){this.id=randomUUID();return {id:this.id}},touchCall(){},async endCall(){devices.callOwner=null;store.changed({type:'call',owner:null},false)}};
 let handler;const server=http.createServer((req,res)=>handler(req,res));await new Promise(r=>server.listen(0,'127.0.0.1',r));config.port=server.address().port;
 handler=createApp({config,conversations:store,chats,devices,models,voice,ws:{root:dir},tools:{definitions:()=>[]}});
 t.after(async()=>{chats.close();await models.chatTail;server.closeAllConnections();await new Promise(r=>server.close(r));await store.close();if(path.dirname(dir)===os.tmpdir()&&path.basename(dir).startsWith('lumicos-sync-'))fs.rmSync(dir,{recursive:true,force:true})});
 const url=`http://127.0.0.1:${config.port}`;
 async function client(){const id=randomUUID();let cookie='';const headers=()=>({'X-PersonalAI':'1','X-Lumicos-Device':id,'Content-Type':'application/json',Cookie:cookie});
  const raw=async(route,body)=>{const r=await fetch(url+route,{method:body===undefined?'GET':'POST',headers:headers(),body:body===undefined?undefined:JSON.stringify(body)});cookie=r.headers.get('set-cookie')?.split(';')[0]??cookie;return r};
  const call=async(route,body)=>{const r=await raw(route,body);assert.ok(r.ok,await r.clone().text());return r.json()};const session=await call('/api/session',{});return {raw,call,headers,id,owner:session.device};}
 const a=await client(),b=await client();const cid=randomUUID();
 await a.call('/api/sync/migrate',{characters:[runtime.DEFAULT_CHARACTER],conversations:[{id:cid,title:'Chat',characterId:runtime.DEFAULT_CHARACTER.id,messages:[],createdAt:Date.now(),updatedAt:Date.now()}]});
 const submit=(id=randomUUID(),text='Hi')=>({requestId:id,conversationId:cid,user:{id:randomUUID(),role:'user',parts:[{type:'text',text}]},settings:{memory:{enabled:false},tools:{mode:'off'}}});
 return {store,models,chats,a,b,cid,dir,submit,voice,devices,get generations(){return generations},get maxParallel(){return maxParallel}};
}
test('two clients share messages, live partial replies and stable IDs; duplicate POST starts one generation',async t=>{
 const f=await fixture(t);const reader=(await f.b.raw('/api/sync/events')).body.getReader();let events='';const reading=(async()=>{try{for(;;){const r=await reader.read();if(r.done)break;events+=new TextDecoder().decode(r.value)}}catch{}})();
 const request=f.submit();const [one,two]=await Promise.all([f.a.call('/api/chat/submit',request),f.a.call('/api/chat/submit',request)]);assert.equal(one.id,two.id);
 await f.models.chatTail;await pause(15);
 const snapshot=await f.b.call('/api/sync');const msgs=snapshot.conversations[0].messages;
 assert.equal(f.generations,1);assert.equal(msgs.length,2);assert.equal(msgs[1].id,one.replyId);assert.equal(msgs[1].parts[0].text,'Hello from Lumicos');assert.equal(msgs[1].status,'done');
 assert.match(events,/"type":"message"/);assert.match(events,/Hello from /);await reader.cancel();await reading;
});
test('simultaneous sends queue in order without conflicting jobs',async t=>{const f=await fixture(t);await Promise.all([f.a.call('/api/chat/submit',f.submit(undefined,'A')),f.b.call('/api/chat/submit',f.submit(undefined,'B'))]);await f.models.chatTail;assert.equal(f.generations,2);assert.equal(f.maxParallel,1);assert.deepEqual(f.store.state.conversations[0].messages.map(m=>m.role),['user','assistant','user','assistant']);assert.equal(new Set(f.store.state.conversations[0].messages.map(m=>m.id)).size,4)});
test('disconnect observer does not cancel job; reconnect gets authoritative state',async t=>{const f=await fixture(t);const reader=(await f.b.raw('/api/sync/events')).body.getReader();await reader.read();await reader.cancel();await f.a.call('/api/chat/submit',f.submit());await f.models.chatTail;const s=await f.b.call('/api/sync');assert.equal(s.conversations[0].messages.at(-1).status,'done');assert.equal(f.generations,1)});
test('restart persists completed history and marks incomplete jobs interrupted without replay',async t=>{const f=await fixture(t);await f.a.call('/api/chat/submit',f.submit());await f.models.chatTail;const restored=new ConversationStore(path.join(f.dir,'conversations.json'));assert.deepEqual(restored.state.conversations,JSON.parse(JSON.stringify(f.store.state.conversations)));restored.state.jobs[0].status='running';await restored.persist();const again=new ConversationStore(restored.file);assert.equal(again.state.jobs[0].status,'interrupted');assert.equal(again.state.conversations[0].messages.at(-1).status,'error')});
test('stale transactions cannot overwrite another client; private history rejected',async t=>{const f=await fixture(t),s=await f.a.call('/api/sync');await f.b.call('/api/sync/transaction',{revision:s.revision,upsert:[{...s.conversations[0],title:'Phone'}]});assert.equal((await f.a.raw('/api/sync/transaction',{revision:s.revision,upsert:[{...s.conversations[0],title:'Stale PC'}]})).status,409);assert.equal(f.store.conversation(f.cid).title,'Phone');assert.equal((await f.a.raw('/api/sync/migrate',{conversations:[{...s.conversations[0],id:randomUUID(),private:true}]})).status,400)});
test('one call owner; other client cannot start, end or heartbeat that call',async t=>{const f=await fixture(t);const call=await f.a.call('/api/voice/call/start',{});assert.equal(f.devices.callOwner,f.a.owner);for(const route of ['start','end','heartbeat'])assert.equal((await f.b.raw('/api/voice/call/'+route,{id:call.id})).status,409);await f.a.call('/api/voice/call/end',{id:call.id});assert.equal(f.devices.callOwner,null);assert.ok((await f.b.call('/api/voice/call/start',{})).id)});
test('unknown device cookies and cross origin requests are refused',async t=>{const f=await fixture(t);const headers={...f.a.headers(),Cookie:''};const base=`http://127.0.0.1:${f.chats.config.port}`;assert.equal((await fetch(base+'/api/sync',{headers})).status,401);assert.equal((await fetch(base+'/api/sync',{headers:{...f.a.headers(),Origin:'https://evil.example'}})).status,403)});
