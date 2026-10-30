import {spawn,spawnSync} from 'node:child_process';
import {pythonLaunch} from '../util/hiddenPython.mjs';
import {createInterface} from 'node:readline';
import {fileURLToPath} from 'node:url';
import path from 'node:path';

function stopOwned(child){
 if(!child?.pid||child.exitCode!==null||child.signalCode!==null)return;
 // Windows venv python is a launcher; its child owns the ONNX GPU session.
 if(process.platform==='win32')spawnSync('taskkill.exe',['/PID',String(child.pid),'/T','/F'],{windowsHide:true,stdio:'ignore',timeout:10000});
 else child.kill();
}

export class F5Worker {
 constructor(root,script='f5_worker.py'){this.root=root;this.script=script;this.child=null;this.ready=null;this.pending=null;this.seq=0;this.device=null;}
 preload(){
  if(this.ready)return this.ready;
  const launch=pythonLaunch(path.join(this.root,'venv/Scripts/python.exe'));const child=spawn(launch.command,['-u',fileURLToPath(new URL('./'+this.script,import.meta.url)),this.root],{cwd:this.root,windowsHide:true,stdio:['pipe','pipe','pipe'],env:{...process.env,PYTHONUTF8:'1',HF_HUB_OFFLINE:'1',TRANSFORMERS_OFFLINE:'1',...launch.env}});
  this.child=child;child.stderr.resume();child.stdin.on('error',()=>{});
  this.closed=new Promise(resolve=>child.once('close',resolve));
  this.ready=new Promise((resolve,reject)=>{
   const timer=setTimeout(()=>{reject(Error('เริ่มระบบเสียงไม่สำเร็จภายในเวลาที่กำหนด'));stopOwned(child)},60000);
   createInterface({input:child.stdout}).on('line',line=>{
    let message;try{message=JSON.parse(line)}catch{return}
    if(message.type==='ready'){clearTimeout(timer);this.startup=message;resolve(message);return;}
    if(message.type==='fatal'){clearTimeout(timer);reject(Error(message.error));return;}
    const pending=this.pending;if(!pending||message.id!==pending.id)return;
    if(message.type==='audio'){try{pending.onAudio?.(message)}catch(e){pending.failure=e;stopOwned(child)}}
    if(message.type==='done'){this.pending=null;pending.clean();pending.resolve(message.metrics)}
    if(message.type==='error'){this.pending=null;pending.clean();pending.reject(Error(message.error))}
   });
   child.once('error',e=>{clearTimeout(timer);reject(e)});
   child.once('close',()=>{
    clearTimeout(timer);const error=Error('โปรแกรมเสียงหยุดทำงาน');reject(error);
    const p=this.pending;this.pending=null;if(p){p.clean();p.reject(p.failure??error)}
    if(this.child===child){this.child=null;this.ready=null;this.device=null;}
   });
  });
  return this.ready;
 }
 async request(data,signal,onAudio){
  signal?.throwIfAborted();await this.preload();signal?.throwIfAborted();
  if(this.pending)throw Error('ระบบเสียงกำลังทำงาน');
  return new Promise((resolve,reject)=>{
   const id=++this.seq;const abort=()=>{if(this.pending?.id===id){this.pending.failure=signal.reason;stopOwned(this.child)}};
   const timer=setTimeout(()=>{if(this.pending?.id===id){this.pending.failure=Error('งานเสียงใช้เวลานานเกินกำหนด');stopOwned(this.child)}},240000);
   this.pending={id,resolve,reject,onAudio,clean:()=>{clearTimeout(timer);signal?.removeEventListener('abort',abort)}};
   signal?.addEventListener('abort',abort,{once:true});
   this.child.stdin.write(JSON.stringify({id,...data})+'\n');if(signal?.aborted)abort();
  });
 }
 async release(){if(!this.child||!this.device)return;await this.request({action:'release'});this.device=null;}
 async speak(text,signal,onAudio,stream=false,options){this.device='dml';try{return await this.request({action:'speak',device:'dml',text,stream,...(options?{avatarTest:options}:{})},signal,onAudio)}catch(e){if(this.child)await this.stop();throw e}}
 async stop(){const child=this.child;if(child){stopOwned(child);await this.closed;}this.device=null;}
 kill(){stopOwned(this.child);}
}

export function pcmWav(pcm,rate=24000){
 const b=Buffer.alloc(44+pcm.length);b.write('RIFF');b.writeUInt32LE(36+pcm.length,4);b.write('WAVEfmt ',8);b.writeUInt32LE(16,16);b.writeUInt16LE(1,20);b.writeUInt16LE(1,22);b.writeUInt32LE(rate,24);b.writeUInt32LE(rate*2,28);b.writeUInt16LE(2,32);b.writeUInt16LE(16,34);b.write('data',36);b.writeUInt32LE(pcm.length,40);pcm.copy(b,44);return b;
}
