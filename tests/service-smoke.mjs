import http from 'node:http';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import {readJson} from '../src/io.mjs';
const root=process.argv[2];if(!root)throw Error('Pass isolated installed root');
Object.assign(process.env,await readJson(path.join(root,'environment.json')));
const {createServices}=await import(pathToFileURL(path.join(root,'PersonalAI/server/service.mjs')));
const {loadConfig}=await import(pathToFileURL(path.join(root,'PersonalAI/server/config.mjs')));
const config=loadConfig({port:18878});const services=createServices(config);const server=http.createServer(services.handler);
try{
 await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(18878,'127.0.0.1',resolve)});
 const r=await fetch('http://127.0.0.1:18878/api/health',{headers:{'X-PersonalAI':'1'}});const data=await r.json();
 if(!r.ok||!data.ok)throw Error(JSON.stringify(data));
 if(process.argv.includes('--voice')){
  for(const engine of ['windows']){
   const select=await fetch('http://127.0.0.1:18878/api/voice/engines',{method:'POST',headers:{'X-PersonalAI':'1','X-Lumicos-Internal':config.internalToken,'Content-Type':'application/json'},body:JSON.stringify({tts:engine})});
   if(!select.ok)throw Error(await select.text());
   const start=Date.now();const voice=await fetch('http://127.0.0.1:18878/api/voice/speak',{method:'POST',headers:{'X-PersonalAI':'1','X-Lumicos-Internal':config.internalToken,'Content-Type':'application/json'},body:JSON.stringify({text:'สวัสดีครับ ลูมิคอสพร้อมช่วยงานคุณแล้ว',stream:true})});
   const events=(await voice.text()).trim().split('\n').map(x=>JSON.parse(x));
   if(!voice.ok||!events.some(x=>x.type==='audio'&&x.sampleRate===24000)||events.some(x=>x.type==='error'))throw Error(JSON.stringify(events));
   console.log(JSON.stringify({engine,api:'pass',elapsedMs:Date.now()-start,metrics:events.find(x=>x.type==='done')?.metrics}));
  }
 }
 console.log(JSON.stringify({health:'pass',dataDir:data.dataDir,port:18878,modelsLoaded:false}));
}finally{
 services.chats.close();await services.conversations?.close?.();services.voice.close();await services.web.close();await services.knowledge.close();await services.memory.flush();await new Promise(resolve=>server.close(resolve));
}
