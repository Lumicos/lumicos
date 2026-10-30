import fs from 'node:fs';
import { EventEmitter } from 'node:events';
import { WriteQueue, writeAtomic } from '../util/atomicWrite.mjs';
import {orderConversationMessages} from '../../src/chat/messageOrder.mjs';

export const conflict = (message, status=409) => Object.assign(new Error(message), {status});
export const validId = value => typeof value === 'string' && /^[a-zA-Z0-9_-]{1,100}$/.test(value);
export class ConversationStore extends EventEmitter {
  constructor(file) {
    super(); this.file=file; this.writes=new WriteQueue(); this.setMaxListeners(100);
    this.state=fs.existsSync(file)?JSON.parse(fs.readFileSync(file,'utf8')):{revision:0,conversations:[],activeId:null,characters:[],jobs:[]};
    this.on('storage-error',e=>console.error('[conversations] Persistence failed:',e.message));
    for(const job of this.state.jobs) if(['queued','running'].includes(job.status)) {
      job.status='interrupted';
      const msg=this.state.conversations.find(c=>c.id===job.conversationId)?.messages.find(m=>m.id===job.replyId);
      if(msg){msg.status='error';msg.error='เซิร์ฟเวอร์เริ่มใหม่ งานนี้หยุดแล้ว กรุณาส่งใหม่';}
    }
    this.normalizeAll();
  }
  replyLinks(conversationId){return new Map(this.state.jobs.filter(j=>j.conversationId===conversationId).map(j=>[j.replyId,j.userId]))}
  normalize(c){return {...c,messages:orderConversationMessages(c.messages,this.replyLinks(c.id))}}
  normalizeAll(){this.state.conversations=this.state.conversations.map(c=>this.normalize(c))}
  snapshot(){return structuredClone(this.state)}
  persist(){const data=JSON.stringify(this.state);return this.writes.run(()=>writeAtomic(this.file,data,{backup:true}))}
  changed(event, durable=true){this.state.revision++;if(event.type==='snapshot')event.state=this.snapshot();this.emit('change',{revision:this.state.revision,...event});if(durable)void this.persist().catch(e=>this.emit('storage-error',e));else if(!this.checkpoint){this.checkpoint=setTimeout(()=>{this.checkpoint=null;void this.persist().catch(e=>this.emit('storage-error',e))},1000);this.checkpoint.unref();}}
  async close(){clearTimeout(this.checkpoint);await this.persist();await this.writes.idle();}
  conversation(id){const c=this.state.conversations.find(c=>c.id===id);if(!c)throw conflict('Conversation not found',404);return c}
  busy(id){return this.state.jobs.some(j=>j.conversationId===id&&['queued','running'].includes(j.status))}
  validateConversation(c){
    if(!c||!validId(c.id)||c.private||!Array.isArray(c.messages)||c.messages.length>50000)throw conflict('Invalid conversation',400);
    const ids=new Set();for(const m of c.messages){if(!validId(m.id)||ids.has(m.id)||!['user','assistant','tool','system'].includes(m.role)||!Array.isArray(m.parts))throw conflict('Invalid message',400);ids.add(m.id)}
  }
  async migrate(data){
    for(const c of data.conversations??[]){this.validateConversation(c);if(!this.state.conversations.some(x=>x.id===c.id))this.state.conversations.push(this.normalize(structuredClone(c)))}
    if(!this.state.characters.length&&Array.isArray(data.characters))this.state.characters=data.characters;
    if(!this.state.preferences&&data.preferences)this.state.preferences=data.preferences;
    this.state.activeId??=this.state.conversations[0]?.id??null;
    this.changed({type:'snapshot',state:this.snapshot()},false);await this.persist();return this.snapshot();
  }
  async transaction({revision,upsert=[],remove=[],activeId,characters,versions,preferences}){
    if(revision!==this.state.revision)throw conflict('State changed on another device. Synced latest state; retry this edit.');
    for(const [id,v] of Object.entries(versions??{}))if((this.state.conversations.find(c=>c.id===id)?.syncVersion??0)!==v)throw conflict('Conversation changed on another device; retry this edit.');
    for(const c of upsert){this.validateConversation(c);if(this.busy(c.id))throw conflict('Conversation is generating; wait before editing.')}
    for(const id of remove)if(this.busy(id))throw conflict('Conversation is generating; wait before deleting.');
    if(activeId!==undefined&&activeId!==null&&![...this.state.conversations,...upsert].some(c=>c.id===activeId&&!remove.includes(c.id)))throw conflict('Unknown active conversation',400);
    if(characters!==undefined&&(!Array.isArray(characters)||!characters.length))throw conflict('Invalid characters',400);
    for(const c of upsert){const i=this.state.conversations.findIndex(x=>x.id===c.id);const next=this.normalize({...c,syncVersion:(this.state.conversations[i]?.syncVersion??0)+1,updatedAt:Date.now()});if(i<0)this.state.conversations.push(next);else this.state.conversations[i]=next}
    this.state.conversations=this.state.conversations.filter(c=>!remove.includes(c.id));
    if(activeId!==undefined){if(activeId!==null&&!this.state.conversations.some(c=>c.id===activeId))throw conflict('Unknown active conversation',400);this.state.activeId=activeId;}
    if(characters!==undefined){if(!Array.isArray(characters)||!characters.length)throw conflict('Invalid characters',400);this.state.characters=characters;}
    if(preferences)this.state.preferences=preferences;
    if(!this.state.conversations.some(c=>c.id===this.state.activeId))this.state.activeId=this.state.conversations[0]?.id??null;
    this.changed({type:'snapshot',state:this.snapshot()},false);await this.persist();return this.snapshot();
  }
  patch(id,fn){const c=this.conversation(id);const next=this.normalize({...fn(structuredClone(c)),syncVersion:(c.syncVersion??0)+1});this.state.conversations[this.state.conversations.indexOf(c)]=next;this.changed({type:'conversation',conversation:next},false)}
  message(id,mid,fn){const c=this.conversation(id),i=c.messages.findIndex(m=>m.id===mid);if(i<0)return;c.messages[i]=fn(structuredClone(c.messages[i]));c.syncVersion=(c.syncVersion??0)+1;this.changed({type:'message',conversationId:id,syncVersion:c.syncVersion,message:c.messages[i]},false)}
}
