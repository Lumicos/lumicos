import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import {randomUUID} from 'node:crypto';
import {OwnerCredentialStore} from '../security/ownerAuth.mjs';
import {DeviceSessions,OWNER_MUTATION_ACTIONS} from '../chat/deviceSessions.mjs';
import {createApp} from '../http/app.mjs';

const cookieValue=value=>String(value).split(';')[0];
const request=(headers={})=>({headers:{'x-lumicos-device':randomUUID(),...headers}});
const response=()=>{const headers={};return {headers,setHeader(name,value){headers[name]=value}}};

test('credential store persists only a salted scrypt verifier',async t=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'lumicos-owner-')),file=path.join(dir,'owner-auth.json');
 t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));
 const store=new OwnerCredentialStore(file),password='เจ้าของLumicos-2026';
 assert.equal(store.configured,false);await store.enroll(password);assert.equal(store.configured,true);
 const raw=fs.readFileSync(file,'utf8');assert.equal(raw.includes(password),false);assert.equal(raw.includes('เจ้าของLumicos'),false);assert.match(raw,/"algorithm": "scrypt"/);
 const restored=new OwnerCredentialStore(file);assert.equal(await restored.verify(password),true);assert.equal(await restored.verify('incorrect-password-2026'),false);
 await assert.rejects(()=>restored.enroll('different-password-2026'),e=>e.code==='OWNER_ALREADY_CONFIGURED');
});

test('owner principal requires CSRF and one-use nonce while agent and replay are denied',()=>{
 let now=1_000;const devices=new DeviceSessions({now:()=>now,ownerTtlMs:1_000}),req=request(),res=response();
 devices.connect(req,res);req.headers.cookie=cookieValue(res.headers['Set-Cookie']);
 assert.equal(devices.principal(req).role,'agent');
 assert.throws(()=>devices.authorizeOwnerMutation(req,'proposal.approve','0123456789abcdef'),e=>e.code==='OWNER_REQUIRED');
 const owner=devices.elevateOwner(req);req.headers['x-lumicos-csrf']=owner.csrf;
 for(const action of ['proposal.approve','plugin.activate','plugin.rollback','coding-model.select'])assert.ok(OWNER_MUTATION_ACTIONS.has(action));
 assert.equal(devices.authorizeOwnerMutation(req,'proposal.approve','0123456789abcdef').role,'owner');
 assert.throws(()=>devices.authorizeOwnerMutation(req,'proposal.approve','0123456789abcdef'),e=>e.code==='REPLAY_DETECTED');
 assert.throws(()=>devices.authorizeOwnerMutation(req,'not.registered','fedcba9876543210'),e=>e.code==='OWNER_ACTION_INVALID');
 req.headers['x-lumicos-csrf']='wrong';assert.throws(()=>devices.authorizeOwnerMutation(req,'plugin.activate','fedcba9876543210'),e=>e.code==='CSRF_INVALID');
 now=2_001;assert.equal(devices.ownerStatus(req).role,'agent');
});

test('HTTP owner flow supports local enrollment and identity-bound mobile login',async t=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'lumicos-owner-http-')),ownerAuth=new OwnerCredentialStore(path.join(dir,'owner-auth.json'));
 const config={port:0,allowedOrigins:[],internalToken:'internal-test-token',dataDir:os.tmpdir()},devices=new DeviceSessions(); // createApp needs dataDir (background remover model path, since 2026-10)
 let handler;const server=http.createServer((req,res)=>handler(req,res));await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));config.port=server.address().port;
 handler=createApp({config,devices,ownerAuth,tools:{definitions:()=>[]}});
 t.after(async()=>{server.closeAllConnections();await new Promise(resolve=>server.close(resolve));fs.rmSync(dir,{recursive:true,force:true})});
 const base=`http://127.0.0.1:${config.port}`;
 const makeClient=({remote}={})=>{const device=randomUUID();let cookie='';const call=async(route,{method='GET',json,csrf}={})=>{
  const headers={'X-PersonalAI':'1','X-Lumicos-Device':device,'Content-Type':'application/json'};if(cookie)headers.Cookie=cookie;if(csrf)headers['X-Lumicos-CSRF']=csrf;
  if(remote){headers['X-Lumicos-Gateway']=config.internalToken;headers['X-Lumicos-Transport']='tailscale';headers['X-Lumicos-Remote']=remote}
  const res=await fetch(base+route,{method,headers,body:json===undefined?undefined:JSON.stringify(json)});cookie=cookieValue(res.headers.get('set-cookie')??cookie);return {status:res.status,body:await res.json()};};return {call,device};};
 const anonymous=await fetch(base+'/api/owner/status',{headers:{'X-PersonalAI':'1','X-Lumicos-Device':randomUUID()}});assert.equal(anonymous.status,401);
 const local=makeClient();assert.equal((await local.call('/api/session',{method:'POST',json:{}})).status,200);
 let status=(await local.call('/api/owner/status')).body;assert.equal(status.canEnroll,true);assert.equal(status.role,'agent');
 const enrolled=await local.call('/api/owner/enroll',{method:'POST',json:{password:'เจ้าของLumicos-2026',challenge:status.challenge}});assert.equal(enrolled.status,200);assert.equal(enrolled.body.role,'owner');
 const mobile=makeClient({remote:'trusted-user-a'});await mobile.call('/api/session',{method:'POST',json:{}});status=(await mobile.call('/api/owner/status')).body;assert.equal(status.canEnroll,false);assert.equal(status.transport,'tailscale');
 const loggedIn=await mobile.call('/api/owner/login',{method:'POST',json:{password:'เจ้าของLumicos-2026',challenge:status.challenge}});assert.equal(loggedIn.status,200);assert.equal(loggedIn.body.role,'owner');
 const replay=await mobile.call('/api/owner/login',{method:'POST',json:{password:'เจ้าของLumicos-2026',challenge:status.challenge}});assert.equal(replay.status,403);assert.equal(replay.body.error.code,'OWNER_CHALLENGE_INVALID');
});
