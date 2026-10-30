import fs from 'node:fs/promises';
import path from 'node:path';
import {tmpdir} from 'node:os';
import {fileURLToPath} from 'node:url';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
const exec=promisify(execFile);
const bridge=fileURLToPath(new URL('./windowsTts.ps1',import.meta.url));
export function pcm24k(wav){
 if(wav.toString('ascii',0,4)!=='RIFF'||wav.toString('ascii',8,12)!=='WAVE')throw Error('TTS returned invalid WAV');
 let rate,channels,data;
 for(let i=12;i+8<=wav.length;){const n=wav.toString('ascii',i,i+4),size=wav.readUInt32LE(i+4),start=i+8;if(start+size>wav.length)throw Error('Truncated TTS WAV');
  if(n==='fmt '){if(size<16||wav.readUInt16LE(start)!==1||wav.readUInt16LE(start+14)!==16)throw Error('TTS requires PCM16');channels=wav.readUInt16LE(start+2);rate=wav.readUInt32LE(start+4)}
  if(n==='data')data=wav.subarray(start,start+size);i=start+size+(size%2);
 }
 if(!data?.length||![1,2].includes(channels)||rate<8000||rate>192000)throw Error('Unsupported TTS WAV');
 const frames=Math.floor(data.length/(channels*2));if(!frames)throw Error('Empty TTS WAV');
 const sample=i=>{let v=0;for(let c=0;c<channels;c++)v+=data.readInt16LE((i*channels+c)*2);return v/channels};
 const out=Buffer.alloc(Math.floor(frames*24000/rate)*2);
 for(let i=0;i<out.length/2;i++){const p=i*rate/24000,a=Math.min(frames-1,Math.floor(p)),b=Math.min(frames-1,a+1);out.writeInt16LE(Math.round(sample(a)+(sample(b)-sample(a))*(p-a)),i*2)}
 return out;
}
export class LocalTtsClient{
 constructor({engine='windows'}={}){this.engine=engine;this.controllers=new Set();}
 async run(exe,args,signal){return exec(exe,args,{windowsHide:true,shell:false,timeout:60000,maxBuffer:1024*1024,encoding:'utf8',signal})}
 async status(engine=this.engine){
  if(engine!=='windows')return {ready:false,reason:'Only Microsoft Pattara is supported'};
  try{const {stdout}=await this.run('powershell.exe',['-NoProfile','-NonInteractive','-ExecutionPolicy','Bypass','-File',bridge,'-Mode','probe']);const s=JSON.parse(stdout.replace(/^\uFEFF/,''));return {...s,engine:'windows'}}catch(e){return {ready:false,reason:e.message}}
 }
 async available(){return (await this.status()).ready}
 async preload(signal){signal?.throwIfAborted();const s=await this.status();if(!s.ready)throw Error(s.reason);this.selected=s.engine;return {ready:true,engine:s.engine,backend:'cpu',on_gpu:false}}
 async health(){return {ready:await this.available(),engine:this.selected||this.engine,backend:'cpu',on_gpu:false}}
 async release(){}
 async stop(){this.kill()}
 kill(){for(const c of this.controllers)c.abort();this.controllers.clear()}
 async speak(text,signal,onAudio,_stream,options={}){
  if(typeof text!=='string'||!text.trim()||text.length>1500)throw Error('TTS accepts 1–1500 characters');
  const speed=options.speed??0.92;if(!Number.isFinite(speed)||speed<0.75||speed>1.25)throw Error('Invalid TTS speed');
  signal?.throwIfAborted();const controller=new AbortController();this.controllers.add(controller);const combined=signal?AbortSignal.any([signal,controller.signal]):controller.signal;
  let dir;const start=Date.now();try{
   await this.preload(combined);combined.throwIfAborted();dir=await fs.mkdtemp(path.join(tmpdir(),'lumicos-tts-'));
   const out=path.join(dir,'out.wav');
   {const input=path.join(dir,'request.json');await fs.writeFile(input,JSON.stringify({text,speed}));await this.run('powershell.exe',['-NoProfile','-NonInteractive','-ExecutionPolicy','Bypass','-File',bridge,'-Mode','speak','-InputPath',input,'-OutputPath',out],combined)}
   combined.throwIfAborted();const pcm=pcm24k(await fs.readFile(out));onAudio?.({type:'audio',pcm:pcm.toString('base64'),sampleRate:24000});
   return {backend:'cpu',engine:this.selected,inferenceSeconds:(Date.now()-start)/1000,audioSeconds:pcm.length/48000};
  }finally{this.controllers.delete(controller);if(dir){for(const n of ['request.json','text.txt','out.wav'])await fs.rm(path.join(dir,n),{force:true}).catch(()=>{});await fs.rmdir(dir).catch(()=>{})}}
 }
}
