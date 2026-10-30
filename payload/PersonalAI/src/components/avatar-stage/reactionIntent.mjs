import {stripPersonaControlText} from '../../prompt/lumicosPersona.mjs';
export const EMOTIONS=Object.freeze(['neutral','happy','gentle','sad','concerned','surprised','thinking','playful']);
export const GESTURES=Object.freeze(['none','nod','tilt','look_aside','wave']);
export const REACTION_CONFIG=Object.freeze({maximum:0.45,attack:0.25,hold:1.5,decay:2.5,gestureCooldown:8,sameGestureCooldown:20,gestureDuration:1.4});
export const NEUTRAL=Object.freeze({version:1,emotion:'neutral',intensity:0,gesture:'none'});
export function validateReaction(value){
 if(!value||value.version!==1||!EMOTIONS.includes(value.emotion)||!GESTURES.includes(value.gesture)||typeof value.intensity!=='number'||!Number.isFinite(value.intensity)||value.intensity<0||value.intensity>1)return {...NEUTRAL};
 return value.emotion==='neutral'?{...NEUTRAL}:{version:1,emotion:value.emotion,intensity:Math.min(REACTION_CONFIG.maximum,value.intensity),gesture:value.gesture};
}
export function parseReaction(value){
 const raw=String(value??''),text=stripPersonaControlText(raw).trimEnd();
 const markers=raw.match(/\[\[lumicos\b/gi)??[];
 const match=raw.match(/(?:^|\n)[ \t]*\[\[lumicos e=([a-z_]+) i=((?:0(?:\.\d+)?|1(?:\.0+)?)) g=([a-z_]+)\]\][ \t]*(?:\r?\n)?$/);
 const intent=markers.length===1&&match?validateReaction({version:1,emotion:match[1],intensity:Number(match[2]),gesture:match[3]}):{...NEUTRAL};
 return {text,intent};
}
/** Snapshot establishes a baseline: reconnect/history must not replay gestures. */
export function createReactionFeed(read,accept,cancel){
 let last=new Map(),closed=false;
 const remember=()=>new Map(read().flatMap(c=>c.messages.map(m=>[c.id+':'+m.id,m.status])));
 last=remember();
 const message=(conversationId,m)=>{if(closed)return;const key=conversationId+':'+m.id,previous=last.get(key);last.set(key,m.status);
  if(previous==='streaming'&&m.status==='done'&&m.role==='assistant'&&m.reaction)accept({conversationId,messageId:m.id,intent:validateReaction(m.reaction)});
  if(previous==='streaming'&&['error','stopped'].includes(m.status))cancel();
 };
 return {message,reset(){if(!closed){last=remember();cancel();}},update(){
  if(closed)return;const next=remember();
  for(const c of read())for(const m of c.messages){const key=c.id+':'+m.id;
   if(last.get(key)==='streaming'&&m.status==='done'&&m.role==='assistant'&&m.reaction)accept({conversationId:c.id,messageId:m.id,intent:validateReaction(m.reaction)});
   if(last.get(key)==='streaming'&&['error','stopped'].includes(m.status))cancel();
  }last=next;
 },dispose(){closed=true;last.clear();}};
}
