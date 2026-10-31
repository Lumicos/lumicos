import fs from 'node:fs/promises';
import path from 'node:path';
import net from 'node:net';
import {spawn} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {detect,install,modelPage,writeLaunchers} from './install.mjs';
import {bindModels} from './configure.mjs';
import {selectedModels,choiceEnables} from './modelChoice.mjs';
import {listBackendOptions} from './backendChoice.mjs';
import {resolveInstallRoot} from './installRoot.mjs';
import {runTwoScreenChoices} from './installWizard.mjs';
import {confirmMenu} from './terminalMenu.mjs';
import {readJson,writeJson,hash,run,safeJoin,download} from './io.mjs';
const kit=fileURLToPath(new URL('../',import.meta.url));
const argv=process.argv.slice(2),command=argv[0]??'plan';
const arg=name=>{const i=argv.indexOf(name);return i<0?undefined:argv[i+1]};
let root=path.resolve(arg('--root')??process.env.LUMICOS_ROOT??'C:/Lumicos');
const exists=p=>fs.access(p).then(()=>true,()=>false);
const portBusy=port=>new Promise(resolve=>{const s=net.connect({host:'127.0.0.1',port});s.setTimeout(500);s.once('connect',()=>{s.destroy();resolve(true)});s.once('error',()=>resolve(false));s.once('timeout',()=>{s.destroy();resolve(false)})});
const statePath=()=>path.join(root,'lumicos-install.json');
async function models(){return readJson(path.join(kit,'catalog/models.json'))}
function selected(catalog,p){return selectedModels(catalog,p)}
async function checkModels(catalog,p){const issues=[];for(const m of selected(catalog,p))for(const f of m.files){const file=safeJoin(root,f.destination);if(!await exists(file)){issues.push('Missing: '+f.destination);continue}if(f.bytes&&(await fs.stat(file)).size!==f.bytes){issues.push('Size mismatch: '+f.destination);continue}if(f.sha256&&await hash(file)!==f.sha256)issues.push('Checksum mismatch: '+f.destination)}return issues}
async function main(){
 if(['plan','install','stage'].includes(command)){
  // Default C:\Lumicos (flag/env override); fall back to %LOCALAPPDATA%\Lumicos if unwritable.
  const resolved=await resolveInstallRoot(argv,process.env,{tryCreate:command!=='plan'});
  root=resolved.root;
  if(resolved.message)console.log(resolved.message);
  const hw=arg('--hardware')?await readJson(arg('--hardware')):await detect();
  const gpuIndex=arg('--gpu-index')===undefined?undefined:Number(arg('--gpu-index'));
  const auto=argv.includes('--yes')||process.env.LUMICOS_AUTO_MODELS==='1'||command==='stage'||command==='plan';
  // Only the install command shows the two screens; plan/stage stay unattended.
  const interactive=command==='install'&&Boolean(process.stdin.isTTY)&&!argv.includes('--yes')&&process.env.LUMICOS_AUTO_MODELS!=='1';
  const catalog=await models();

  // Exactly two interactive screens (backend + models); then unattended.
  const wizard=await runTwoScreenChoices(hw,catalog,{
   gpuIndex,argv,env:process.env,auto,interactive,
  });
  let {profile,choice,backendId,acceptFallback}=wizard;

  const disk=hw.drives?.find(d=>String(root).toLowerCase().startsWith(String(d.drive).toLowerCase()));
  const required=profile.images?80:15;
  if(disk&&disk.freeGiB<required)profile.errors.push(`Need at least ${required} GiB free on installation drive (estimate including downloads/models).`);

  console.log(JSON.stringify({destination:root,hardware:hw,profile,backendOptions:listBackendOptions(hw,{gpuIndex}).map(o=>({id:o.id,recommended:!!o.recommended})),offeredModels:(wizard.offered||[]).map(m=>({id:m.id,group:m.group,recommended:!!m.recommended})),modelChoice:choice},null,2));
  await writeJson(path.join(kit,'last-plan.json'),{destination:root,hardware:hw,profile,modelChoice:choice});
  if(command==='plan')return;

  console.log('Selected backend: '+backendId+' · models: '+choice.ids.join(', ')+(choice.images?' · Image Lab on':' · Image Lab off')+(choice.stt?' · STT on':' · STT off')+(choice.tts?' · TTS on':' · TTS off'));
  await install(root,profile,{stageOnly:command==='stage',acceptFallback});
  return;
 }
 const state=await readJson(statePath()),p=state.profile,catalog=await models();
 if(command==='download-models'){
  console.log('Read model licenses at:');for(const m of selected(catalog,p))console.log(m.id,m.page,m.license);
  if(!argv.includes('--accept-model-licenses')){
   const ok=await confirmMenu({question:'Accept upstream model terms and download? / ยอมรับเงื่อนไขแล้วดาวน์โหลด?',defaultYes:false,yesLabel:'Download / ดาวน์โหลด',noLabel:'Cancel / ยกเลิก'});
   if(!ok)return;
  }
  for(const m of selected(catalog,p))for(const f of m.files){console.log('MODEL '+m.id+'/'+f.name);if(!f.sha256)throw Error('Model metadata missing SHA256: '+f.name);await download(f,safeJoin(root,f.destination))}
  const bound=await bindModels(root,p,catalog);state.status='models-linked';state.models=bound.map(x=>x.id);await writeJson(statePath(),state);console.log('Models downloaded and linked. Run Check Installation, then Start Lumicos.');return;
 }
 if(command==='bind'){
  const issues=await checkModels(catalog,p);if(issues.length)throw Error(issues.join('\n'));
  await bindModels(root,p,catalog);state.status='models-linked';await writeJson(statePath(),state);console.log('Models linked.');return;
 }
 if(command==='doctor'){
  const report={at:new Date().toISOString(),profile:p,checks:[],modelIssues:await checkModels(catalog,p),inferenceTest:'not-run',voiceTest:'not-run',imageTest:'not-run'};
  const doctorBins=[['llama','runtime/llama/llama-server.exe',['--version']],['app','runtime/node/node.exe',['--version']]];
  if(choiceEnables(p,'stt'))doctorBins.splice(1,0,['whisper','runtime/whisper/whisper-cli.exe',['--help']]);
  for(const [name,file,args] of doctorBins){
   try{await run(path.join(root,file),args,{capture:true,timeout:20000});report.checks.push({name,status:'pass'})}catch(e){report.checks.push({name,status:'fail',error:e.message})}
  }
  for(const where of [...(p.images?['ComfyUI-Next']:[])]){
   try{const evidence=await run(path.join(root,where,'.venv/Scripts/python.exe'),['-c','import torch,json; assert torch.cuda.is_available(); x=torch.ones(16,device="cuda"); print(json.dumps({"gpu":torch.cuda.get_device_name(),"vram":torch.cuda.get_device_properties(0).total_memory,"sum":(x+x).sum().item()}))'],{capture:true,timeout:120000});report.checks.push({name:where+' GPU',status:'pass',evidence})}catch(e){report.checks.push({name:where+' GPU',status:'fail',error:e.message})}
  }
  if(argv.includes('--smoke')&&!report.modelIssues.length){
   if(await portBusy(8080)||await portBusy(8188)||await portBusy(8767))throw Error('Stop AI services before isolated model smoke test.');
   const file=catalog.find(m=>m.id==='call-e2b').files[0];
   try{const evidence=await run(path.join(root,'runtime/llama/llama-cli.exe'),['-m',safeJoin(root,file.destination),'-ngl',String(p.ngl),'-c','2048','-n','16','-p','Reply briefly: hello','--no-display-prompt'],{capture:true,timeout:180000});report.inferenceTest={status:'pass',evidence:evidence.slice(-1000)}}catch(e){report.inferenceTest={status:'fail',error:e.message}}
  }
  report.status=report.modelIssues.length||report.checks.some(x=>x.status==='fail')?'needs-attention':'runtime-checks-pass';
  await writeJson(path.join(root,'installation-report.json'),report);console.log(JSON.stringify(report,null,2));if(report.status==='needs-attention')process.exitCode=2;return;
 }
 if(command==='start'){
  for(const port of [8787,8790,5173,8080,8188,8767,8178])if(await portBusy(port))throw Error(`Port ${port} already occupied. Existing services are left untouched.`);
  const missing=await checkModels(catalog.filter(m=>m.group==='chat'),p);if(missing.length)throw Error(missing.join('\n')+'\nOpen MODELS.html, then Link Downloaded Models.cmd.');
  await bindModels(root,p,catalog);
  const env={...process.env,...await readJson(path.join(root,'environment.json')),PATH:path.join(root,'runtime/node')+';'+process.env.PATH};
  await fs.mkdir(path.join(root,'PersonalAI/logs'),{recursive:true});
  const node=path.join(root,'runtime/node/node.exe'),app=path.join(root,'PersonalAI');
  const owned=[];
  for(const [name,args] of [['service',['server/index.mjs']],['web',['node_modules/vite/bin/vite.js','--host','127.0.0.1','--port','5173','--strictPort']]]){
   const fd=await fs.open(path.join(app,'logs',name+'.log'),'a');const child=spawn(node,args,{cwd:app,env,detached:true,windowsHide:true,stdio:['ignore',fd.fd,fd.fd]});await new Promise((resolve,reject)=>{child.once('spawn',resolve);child.once('error',reject)});child.unref();await fd.close();
   const ticks=(await run('powershell.exe',['-NoProfile','-Command',`(Get-CimInstance Win32_Process -Filter "ProcessId=${child.pid}").CreationDate.ToUniversalTime().Ticks.ToString()`],{capture:true,timeout:10000})).trim();
   owned.push({name,pid:child.pid,createdTicks:ticks});await writeJson(path.join(root,'run-state.json'),{processes:owned});
  }
  let ready=false;for(let i=0;i<30;i++){await new Promise(r=>setTimeout(r,1000));try{const r=await fetch('http://127.0.0.1:5173/api/health',{headers:{'X-PersonalAI':'1'},signal:AbortSignal.timeout(1000)});if(r.ok){ready=true;break}}catch{}}
  if(!ready)throw Error('Startup did not become healthy. Read PersonalAI/logs/service.log.');
  const loaded=await fetch('http://127.0.0.1:8787/api/models/start',{method:'POST',headers:{'X-PersonalAI':'1','Content-Type':'application/json'},body:'{}',signal:AbortSignal.timeout(360000)});
  if(!loaded.ok)throw Error('App is running but model startup failed: '+(await loaded.text()).slice(0,500));
  console.log('Lumicos ready: http://127.0.0.1:5173');spawn('rundll32.exe',['url.dll,FileProtocolHandler','http://127.0.0.1:5173'],{windowsHide:true,detached:true,stdio:'ignore'}).unref();return;
 }
 throw Error('Unknown command: '+command);
}
main().catch(e=>{console.error('LUMICOS INSTALLER: '+e.message);process.exitCode=1});
