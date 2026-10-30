import fs from 'node:fs/promises';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {createReadStream,createWriteStream} from 'node:fs';
import {Readable} from 'node:stream';
import {pipeline} from 'node:stream/promises';
import {spawn} from 'node:child_process';
import {fileURLToPath} from 'node:url';
export const readJson=async p=>JSON.parse((await fs.readFile(p,'utf8')).replace(/^\uFEFF/,''));
export async function writeJson(p,value){await fs.mkdir(path.dirname(p),{recursive:true});const temp=p+'.tmp';await fs.writeFile(temp,JSON.stringify(value,null,2));await fs.rename(temp,p)}
export function safeJoin(root,relative){
 if(!relative||relative.includes('\0')||path.isAbsolute(relative)||path.win32.isAbsolute(relative)||relative.split(/[\\/]/).some(s=>s==='..'||s.includes(':')))throw Error('Unsafe package path: '+relative);
 const result=path.resolve(root,relative),rel=path.relative(path.resolve(root),result);
 if(rel.startsWith('..')||path.isAbsolute(rel))throw Error('Path escapes root');return result;
}
export async function hash(file){const h=createHash('sha256');for await(const b of createReadStream(file))h.update(b);return h.digest('hex')}
export function run(exe,args,{cwd,env,timeout=1800000,capture=false}={}){
 return new Promise((resolve,reject)=>{
  const p=spawn(exe,args,{cwd,env:env?{...process.env,...env}:process.env,shell:false,windowsHide:true,stdio:capture?['ignore','pipe','pipe']:'inherit'});let out='',err='';
  p.stdout?.on('data',b=>{out=(out+b).slice(-2000000)});p.stderr?.on('data',b=>{err=(err+b).slice(-10000)});
  const timer=setTimeout(()=>{p.kill();reject(Error('Timed out: '+path.basename(exe)))},timeout);
  p.on('error',e=>{clearTimeout(timer);reject(e)});p.on('close',code=>{clearTimeout(timer);code===0?resolve(out):reject(Error(`${path.basename(exe)} exited ${code}: ${err.slice(-2000)}`))});
 });
}
const hosts=new Set(['github.com','codeload.github.com','nodejs.org','www.python.org','huggingface.co']);
export async function download(item,dest){
 const url=new URL(item.url);if(url.protocol!=='https:'||!hosts.has(url.hostname))throw Error('Unapproved download origin');
 if(!/^[a-f0-9]{64}$/i.test(item.sha256??''))throw Error('Pinned SHA256 required for runtime download');
 if(await fs.access(dest).then(()=>true,()=>false)){if(await hash(dest)===item.sha256)return;throw Error('Cached file checksum mismatch: '+dest)}
 await fs.mkdir(path.dirname(dest),{recursive:true});
 const response=await fetch(url,{signal:AbortSignal.timeout(1200000)});if(!response.ok)throw Error('Download HTTP '+response.status);
 const temp=dest+'.part';await pipeline(Readable.fromWeb(response.body),createWriteStream(temp));
 if(await hash(temp)!==item.sha256)throw Error('SHA256 mismatch: '+item.url);
 await fs.rename(temp,dest);
}
export async function extract(zip,dest){
 await fs.mkdir(dest,{recursive:true});
 // The PowerShell extractor validates every archive member, including rooted Windows paths.
 await run('powershell.exe',['-NoProfile','-ExecutionPolicy','Bypass','-File',fileURLToPath(new URL('./extract.ps1',import.meta.url)),'-Archive',zip,'-Destination',dest]);
}
