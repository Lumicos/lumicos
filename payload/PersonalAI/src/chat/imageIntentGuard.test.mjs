import test from 'node:test';
import assert from 'node:assert/strict';
import {runChatReply,DEFAULT_CHARACTER,DEFAULT_SETTINGS} from '../../.runtime/chat.mjs';
test('ordinary chat cannot launch an image even when the model emits a tool call',async()=>{
 let executed=0;const conv={id:'intent-test',characterId:DEFAULT_CHARACTER.id,messages:[]};
 const user={id:'u',role:'user',parts:[{type:'text',text:'วันนี้เป็นยังไงบ้าง'}]};
 await runChatReply({provider:{async streamChat(req,cb){assert.ok(!JSON.stringify(req.messages).includes('image-tool-description'));cb.onToken('```tool\n{"tool":"generate_image","arguments":{"prompt":"cat"}}\n```');cb.onDone({stopped:false})}},settings:{...DEFAULT_SETTINGS,tools:{...DEFAULT_SETTINGS.tools,mode:'always'},memory:{enabled:false}},resolveCharacter:()=>DEFAULT_CHARACTER,service:{online:true,tools:[{name:'generate_image',description:'image-tool-description',parameters:{}}]},localService:{tools:{async validate(){executed++;throw Error('must not execute')}}},patchConversation:(id,fn)=>Object.assign(conv,fn(conv)),patchMessage:(id,mid,fn)=>{const i=conv.messages.findIndex(m=>m.id===mid);conv.messages[i]=fn(conv.messages[i])},setGeneratingId(){},setLastStats(){},abortRef:{current:null},imageJobRef:{current:null},approvals:{current:new Map()},chatEvents:{emit(){}}},conv,[user],{ctx:8192,capabilities:{tools:true},generation:DEFAULT_SETTINGS.generation});
 assert.equal(executed,0);assert.equal(conv.messages.at(-1).status,'error');
});
