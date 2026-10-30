import fs from 'node:fs/promises';
import path from 'node:path';
import {createCanvas} from '@napi-rs/canvas';
export const CASES={
 thai:{prompt:'ตอบภาษาไทยหนึ่งประโยค: ทำไมควรสำรองไฟล์ก่อนแก้ไข',check:a=>/[ก-๙]/.test(a)},
 instruction:{prompt:'ตอบเพียงคำว่า READY ไม่มีคำอื่น',check:a=>a.trim()==='READY'},
 tools:{prompt:'Return exactly this tool request as a JSON object with keys tool and arguments: tool read_file, arguments path notes/test.txt. Do not claim execution.',check:a=>{try{const j=JSON.parse(a.slice(a.indexOf('{'),a.lastIndexOf('}')+1));return j.tool==='read_file'&&j.arguments?.path==='notes/test.txt'}catch{return false}}},
 vision:{prompt:'Read the characters shown in the image. Reply only with those characters.',check:a=>a.trim()==='LUMICOS 42'}
};
export async function runBenchmark(models,kind){
 const spec=CASES[kind];if(!spec)throw new Error('Unknown benchmark case');
 const turn=await models.begin(kind==='vision'?['vision']:kind==='tools'?['tools']:[]);
 let release;
 try{
  release=await models.comfy.compute.acquire();await models.releaseComfy();
  let content=spec.prompt;
  if(kind==='vision'){const c=createCanvas(480,160),x=c.getContext('2d');x.fillStyle='white';x.fillRect(0,0,480,160);x.fillStyle='black';x.font='48px sans-serif';x.fillText('LUMICOS 42',32,98);content=[{type:'text',text:spec.prompt},{type:'image_url',image_url:{url:'data:image/png;base64,'+c.toBuffer('image/png').toString('base64')}}]}
  const start=performance.now();let firstTokenMs=null,answer='',buffer='',timings=null;
  const response=await fetch('http://127.0.0.1:8080/v1/chat/completions',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({messages:[{role:'user',content}],temperature:0,max_tokens:256,stream:true,chat_template_kwargs:{enable_thinking:false}}),signal:AbortSignal.timeout(90000)});
  if(!response.ok)throw new Error(await response.text());
  const decoder=new TextDecoder();
  for await(const bytes of response.body){buffer+=decoder.decode(bytes,{stream:true});const lines=buffer.split('\n');buffer=lines.pop();for(const line of lines){if(!line.startsWith('data: ')||line.includes('[DONE]'))continue;const d=JSON.parse(line.slice(6));const text=d.choices?.[0]?.delta?.content;if(text){if(firstTokenMs===null)firstTokenMs=performance.now()-start;answer+=text}if(d.timings)timings=d.timings;}}
  const result={kind,at:new Date().toISOString(),profile:turn.profile,parameters:{temperature:0,maxTokens:256},answer,pass:spec.check(answer),firstTokenMs,totalMs:performance.now()-start,tokensPerSecond:timings?.predicted_per_second??null,ramBytes:null,vramBytes:null,measurementNote:'RAM/VRAM unavailable; tool case validates format only, never executes files.'};
  const dir=path.join(models.dir,'benchmarks');await fs.mkdir(dir,{recursive:true});await fs.writeFile(path.join(dir,Date.now()+'-'+kind+'.json'),JSON.stringify(result,null,2));return result;
 }finally{release?.();await models.end(turn.id)}
}

