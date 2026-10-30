import { randomUUID, createHash, timingSafeEqual } from 'node:crypto';
import { conflict, validId } from './conversationStore.mjs';
const authError=(message,status,code)=>Object.assign(Error(message),{status,code});
const equal=(a,b)=>{const x=Buffer.from(String(a??'')),y=Buffer.from(String(b??''));return x.length===y.length&&timingSafeEqual(x,y)};
export const OWNER_MUTATION_ACTIONS=Object.freeze(new Set(['proposal.approve','plugin.install-enable','plugin.activate','plugin.deactivate','plugin.delete','plugin.rollback','coding-model.select','owner.logout']));
export class DeviceSessions {
 constructor({now=()=>Date.now(),ownerTtlMs=8*60*60*1000}={}){this.sessions=new Map();this.callOwner=null;this.now=now;this.ownerTtlMs=ownerTtlMs;}
 connect(req,res){
  const device=req.headers['x-lumicos-device'];if(!validId(device))throw conflict('Device ID required',400);
  let token=String(req.headers.cookie??'').split(';').map(s=>s.trim()).find(s=>s.startsWith('lumicos_session='))?.slice(16);
  let session=this.sessions.get(token);
  const transport=req.headers['x-lumicos-transport']==='tailscale'?'tailscale':'local';
  const remote=transport==='tailscale'?String(req.headers['x-lumicos-remote']??''):'';
  if(!session||session.device!==device||session.transport!==transport||session.remote!==remote){token=randomUUID();session={device,transport,remote,createdAt:this.now(),role:'agent',loginFailures:[]};this.sessions.set(token,session);res.setHeader('Set-Cookie',`lumicos_session=${token}; Path=/; HttpOnly; SameSite=Strict${transport==='tailscale'?'; Secure':''}`);}
  session.touched=this.now();return {device:this.owner(token,device),session};
 }
 session(req){
  const token=String(req.headers.cookie??'').split(';').map(s=>s.trim()).find(s=>s.startsWith('lumicos_session='))?.slice(16);
  const session=this.sessions.get(token),device=req.headers['x-lumicos-device'];
  if(!session||!validId(device)||session.device!==device)throw conflict('Reconnect to Lumicos',401);
  const transport=req.headers['x-lumicos-transport']==='tailscale'?'tailscale':'local',remote=transport==='tailscale'?String(req.headers['x-lumicos-remote']??''):'';
  if(session.transport!==transport||session.remote!==remote)throw authError('Session transport changed',401,'SESSION_BOUNDARY_MISMATCH');
  session.touched=this.now();if(session.ownerExpiresAt<=this.now()){session.role='agent';delete session.ownerExpiresAt;delete session.csrf;session.usedNonces?.clear()}
  return {token,device,session};
 }
 identify(req){const {token,device}=this.session(req);return this.owner(token,device)}
 principal(req){const {token,device,session}=this.session(req);return {subject:this.owner(token,device),role:session.role==='owner'?'owner':'agent',transport:session.transport}}
 issueOwnerChallenge(req){const {session}=this.session(req);session.ownerChallenge=randomUUID();session.ownerChallengeExpiresAt=this.now()+5*60*1000;return session.ownerChallenge}
 consumeOwnerChallenge(req,value){const {session}=this.session(req);const valid=session.ownerChallengeExpiresAt>this.now()&&equal(session.ownerChallenge,value);delete session.ownerChallenge;delete session.ownerChallengeExpiresAt;if(!valid)throw authError('Owner login challenge is invalid or expired',403,'OWNER_CHALLENGE_INVALID')}
 assertLoginAllowed(req){const {session}=this.session(req),cutoff=this.now()-10*60*1000;session.loginFailures=session.loginFailures.filter(at=>at>cutoff);if(session.loginFailures.length>=5)throw authError('Too many owner login attempts',429,'OWNER_LOGIN_RATE_LIMITED')}
 loginFailed(req){this.session(req).session.loginFailures.push(this.now())}
 elevateOwner(req){const {token,device,session}=this.session(req);session.role='owner';session.ownerExpiresAt=this.now()+this.ownerTtlMs;session.csrf=randomUUID()+randomUUID();session.usedNonces=new Map();session.loginFailures=[];return {subject:this.owner(token,device),role:'owner',expiresAt:new Date(session.ownerExpiresAt).toISOString(),csrf:session.csrf,transport:session.transport}}
 ownerStatus(req){const p=this.principal(req),session=this.session(req).session;return {...p,authenticated:p.role==='owner',expiresAt:p.role==='owner'?new Date(session.ownerExpiresAt).toISOString():null,csrf:p.role==='owner'?session.csrf:undefined}}
 authorizeOwnerMutation(req,action,nonce){
  if(!OWNER_MUTATION_ACTIONS.has(action))throw authError('Owner mutation action is not registered',400,'OWNER_ACTION_INVALID');
  const {session}=this.session(req);if(session.role!=='owner')throw authError('Owner authentication required',403,'OWNER_REQUIRED');
  if(!equal(req.headers['x-lumicos-csrf'],session.csrf))throw authError('Owner CSRF token is invalid',403,'CSRF_INVALID');
  if(typeof nonce!=='string'||!/^[A-Za-z0-9_-]{16,128}$/.test(nonce))throw authError('Mutation nonce is required',400,'NONCE_REQUIRED');
  const now=this.now();for(const [key,at]of session.usedNonces)if(at<now-10*60*1000)session.usedNonces.delete(key);
  const key=createHash('sha256').update(nonce).digest('hex');if(session.usedNonces.has(key))throw authError('Owner mutation was already submitted',409,'REPLAY_DETECTED');
  session.usedNonces.set(key,now);return this.principal(req);
 }
 logoutOwner(req){const {session}=this.session(req);session.role='agent';delete session.ownerExpiresAt;delete session.csrf;session.usedNonces?.clear()}
 owner(token,device){return createHash('sha256').update(token+':'+device).digest('hex')}
 assertOwner(device){if(this.callOwner&&this.callOwner!==device)throw conflict('Call active on another device');}
}
