// grok-20261015: final provider payload keeps recent topic under a tight budget.
import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {buildMessages,DEFAULT_CHARACTER} from '../../.runtime/chat.mjs';

const m=(role,text)=>({id:randomUUID(),role,parts:[{type:'text',text}],createdAt:Date.now(),status:'done'});
function history(){
  const h=[];
  for(let i=0;i<6;i++){h.push(m('user',`เรื่องฝนตกบนดาวอังคาร ข้อ ${i} `+'ก'.repeat(200)));h.push(m('assistant',`ตอบเรื่องฝน ${i} `+'ข'.repeat(200)));}
  h.push(m('user','จัดอันดับหนังที่ชอบให้หน่อย'));h.push(m('assistant','1. Spirited Away 2. Your Name 3. Parasite'));
  h.push(m('user','อันดับ 3 แย่ไหม'));h.push(m('assistant','Parasite ไม่แย่เลยนะ'));
  h.push(m('user','ไม่แย่ ๆ'));
  return h;
}
const base={globalPrompt:'',character:DEFAULT_CHARACTER,userName:'U',greetingMode:'none',contextSummary:'- คุยเรื่องฝนบนดาวอังคาร\n'+'- '.concat('ฝน'.repeat(1500)),memories:[]};

test('tight budget: optional summary dropped before recent movie turns',()=>{
  const {messages,info}=buildMessages({...base,history:history(),budget:{contextTokens:4500,replyTokens:1000}});
  const body=messages.map(x=>x.content).join('\n');
  assert.ok(body.includes('Parasite'),'recent movie context must survive');
  assert.ok(info.sentMessages>=5,`sent ${info.sentMessages}`);
  assert.deepEqual(info.droppedContext,['context-summary']);
  assert.equal(messages.at(-1).role,'user');
  assert.ok(messages.at(-1).content.startsWith('ไม่แย่ ๆ'));
  assert.ok(info.estimatedTokens<=4500-1000);
  // role order: system, then user-first alternating
  assert.equal(messages[0].role,'system');assert.equal(messages[1].role,'user');
});

test('roomy budget keeps summary, labelled background',()=>{
  const {messages,info}=buildMessages({...base,history:history(),budget:{contextTokens:60000,replyTokens:1000}});
  assert.equal(info.droppedContext,undefined);
  assert.match(messages.at(-1).content,/background only, not the current topic/);
});

test('evidence and URLs are kept when summary is dropped',()=>{
  const {messages,info}=buildMessages({...base,history:history(),evidenceContext:'[1] https://example.jp/boxoffice Japan Oct 2026',budget:{contextTokens:4500,replyTokens:1000}});
  assert.match(messages.at(-1).content,/https:\/\/example\.jp\/boxoffice/);
  assert.ok(info.droppedContext.includes('context-summary'));
});

test('without budget pressure nothing is dropped',()=>{
  const {info}=buildMessages({...base,contextSummary:'- สั้น',history:history(),budget:{contextTokens:60000,replyTokens:1000}});
  assert.equal(info.droppedMessages,0);
});
