import fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {readJson,writeJson,hash,download,extract,run,safeJoin} from './io.mjs';
import {selectProfile} from './profile.mjs';
import {configure,bindModels} from './configure.mjs';
import {selectedModels,choiceEnables} from './modelChoice.mjs';
const kit=path.resolve(fileURLToPath(new URL('../',import.meta.url)));
const exists=p=>fs.access(p).then(()=>true,()=>false);
export async function detect(){return JSON.parse(await run('powershell.exe',['-NoProfile','-ExecutionPolicy','Bypass','-File',path.join(kit,'src/detect.ps1')],{capture:true,timeout:30000}))}
export async function verifyPayload(){const entries=await readJson(path.join(kit,'catalog/payload.json'));for(const e of entries){if(await hash(safeJoin(path.join(kit,'payload'),e.path))!==e.sha256)throw Error('Payload checksum mismatch: '+e.path)}return entries}
export async function validateRoot(root){
 // Always use win32 semantics: path.parse on Linux does not treat C:\\ as a drive root.
 const normalized=path.win32.normalize(String(root??''));
 const driveRoot=path.win32.parse(normalized).root;
 const isDriveRoot=!driveRoot||normalized===driveRoot||/^[A-Za-z]:[\\/]?$/.test(normalized);
 if(!path.win32.isAbsolute(normalized)||normalized.startsWith('\\\\')||/[\r\n"%&|<>^!]/.test(normalized)||isDriveRoot)throw Error('Choose a local installation subfolder without shell metacharacters.');
 if(await exists(root)){
  if((await fs.lstat(root)).isSymbolicLink())throw Error('Installation root cannot be a junction.');
  const names=await fs.readdir(root);
  if(names.length&&!await exists(path.join(root,'lumicos-install.json')))throw Error('Folder is not empty and is not managed by this installer.');
 }
 for(let p=path.dirname(root);p!==path.dirname(p);p=path.dirname(p))if(await exists(p)&&(await fs.lstat(p)).isSymbolicLink())throw Error('Install path cannot pass through a junction.');
}
async function flatten(dir,expected){
 if(await exists(path.join(dir,expected)))return;
 const rows=await fs.readdir(dir,{withFileTypes:true});
 for(const e of rows)if(e.isDirectory()&&await exists(path.join(dir,e.name,expected))){for(const n of await fs.readdir(path.join(dir,e.name)))await fs.cp(path.join(dir,e.name,n),path.join(dir,n),{recursive:true});return}
 throw Error('Archive is missing '+expected);
}
export async function install(root,profile,{stageOnly=false,acceptFallback=false}={}){
 await validateRoot(root);if(profile.errors.length)throw Error(profile.errors.join('\n'));
 // Belt-and-suspenders: never abort the whole install for optional STT. Skip Whisper instead.
 if(profile.whisper==='whisper-cpu'&&choiceEnables(profile,'stt')&&!acceptFallback&&!stageOnly){
  console.log('CPU Whisper not accepted — skipping STT and continuing install.');
  if(profile.modelChoice){
   profile={...profile,modelChoice:{...profile.modelChoice,stt:false,ids:(profile.modelChoice.ids||[]).filter(id=>id!=='whisper')},voice:Boolean(profile.modelChoice.tts)};
  }else{
   profile={...profile,voice:false,modelChoice:{ids:[profile.chatModel||'call-e2b'],images:!!profile.images,stt:false,tts:false,chatModel:profile.chatModel||'call-e2b'}};
  }
 }
 await fs.mkdir(root,{recursive:true});
 const marker=path.join(root,'lumicos-install.json'),previous=await exists(marker)?await readJson(marker):null;
 if(previous&&previous.version!=='0.2.3')throw Error('Use a fresh folder for the public voice release; private voice installations are never migrated.');
 if(previous&&previous.profile.id!==profile.id)throw Error('Profile changes require a fresh destination; existing environments will not be replaced.');
 const state=previous??{version:'0.2.3',root,profile,steps:{},createdAt:new Date().toISOString(),status:'installing'};
 state.profile=profile;if(profile.modelChoice)state.modelChoice=profile.modelChoice;
 await writeJson(marker,state);
 async function step(name,fn){if(state.steps[name]==='done'){console.log('REUSE '+name);return}console.log('INSTALL '+name);try{await fn();state.steps[name]='done';state.status='installing';await writeJson(marker,state)}catch(e){state.status='failed';state.failedStep=name;state.error=e.message;await writeJson(marker,state);throw e}}
 const catalog=await readJson(path.join(kit,'catalog/downloads.json'));
 const cache=path.join(root,'.downloads');
 async function archive(id,dir,expected){const file=path.join(cache,id+'.zip');await download(catalog[id],file);await extract(file,dir);if(expected)await flatten(dir,expected)}
 await step('payload',async()=>{for(const e of await verifyPayload()){const to=safeJoin(root,e.path);await fs.mkdir(path.dirname(to),{recursive:true});await fs.copyFile(safeJoin(path.join(kit,'payload'),e.path),to)}});
 await step('configuration',()=>configure(root,profile));
 await fs.cp(path.join(kit,'src'),path.join(root,'installer/src'),{recursive:true});
 await fs.cp(path.join(kit,'catalog'),path.join(root,'installer/catalog'),{recursive:true,filter:p=>!p.endsWith('.upstream.json')});
 await fs.cp(path.join(kit,'assets'),path.join(root,'installer/assets'),{recursive:true,filter:p=>!path.basename(p).startsWith('lumen')});
 if(stageOnly){state.status='staged-only';await writeJson(marker,state);return state}
 await step('node',()=>archive('node',path.join(root,'runtime/node'),'node.exe'));
 await step('uv',()=>archive('uv',path.join(root,'runtime/uv'),'uv.exe'));
 await step('llama',async()=>{await archive(profile.llama,path.join(root,'runtime/llama'),'llama-server.exe');if(profile.backend==='cuda')await archive(profile.llama.endsWith('13')?'cudart13':'cudart12',path.join(root,'runtime/llama'))});
 if(choiceEnables(profile,'stt'))await step('whisper',()=>archive(profile.whisper,path.join(root,'runtime/whisper'),'whisper-server.exe'));
 else console.log('SKIP whisper (STT declined)');
 const node=path.join(root,'runtime/node/node.exe'),uv=path.join(root,'runtime/uv/uv.exe');
 const env={PATH:path.join(root,'runtime/node')+';'+process.env.PATH,UV_PYTHON_INSTALL_DIR:path.join(root,'runtime/python'),UV_CACHE_DIR:path.join(root,'.uv-cache')};
 const uvRun=args=>run(uv,args,{env});
 const python=where=>path.join(root,where,'.venv/Scripts/python.exe');
 const constraints=path.join(root,'gpu-constraints.txt');
 const versions=profile.torch==='rocm'?['2.13.0+rocm10.0.0','0.28.0+rocm10.0.0','2.11.0.2+rocm10.0.0']:profile.torch==='cu130'?['2.10.0+cu130','0.25.0+cu130','2.10.0+cu130']:['2.6.0+cu124','0.21.0+cu124','2.6.0+cu124'];
 await fs.writeFile(constraints,['torch','torchvision','torchaudio'].map((n,i)=>`${n}==${versions[i]}`).join('\n'));
 async function gpuEnv(where,requirements){
  if(!await exists(python(where)))await uvRun(['venv','--python',profile.torch==='cu124'?'3.12.10':'3.13.9','--seed',path.join(root,where,'.venv')]);
  const index=profile.torch==='rocm'?'https://stable.repo.amd.com/rocm/whl-next/':'https://download.pytorch.org/whl/'+profile.torch;
  const extra=profile.torch==='rocm'?`[device-${profile.target}]`:'';
  await uvRun(['pip','install','--python',python(where),'--index-url',index,`torch${extra}==${versions[0]}`,`torchvision${extra}==${versions[1]}`,`torchaudio==${versions[2]}`]);
  await uvRun(['pip','install','--python',python(where),'-c',constraints,...requirements]);
  const devices=JSON.parse((await run(python(where),['-c','import torch,json; print(json.dumps([torch.cuda.get_device_name(i) for i in range(torch.cuda.device_count())]))'],{capture:true,timeout:120000})).trim());
  const clean=s=>s.toLowerCase().replace(/[^a-z0-9]/g,'').replace(/advancedmicrodevices|nvidia|amd|graphics/g,'');
  const matches=devices.map((name,index)=>({name,index})).filter(x=>clean(x.name)===clean(profile.gpu.name));
  if(matches.length!==1)throw Error('GPU identity is ambiguous or differs from the plan: '+JSON.stringify(devices));
  const visibility=profile.backend==='cuda'?{CUDA_VISIBLE_DEVICES:String(matches[0].index)}:{HIP_VISIBLE_DEVICES:String(matches[0].index)};
  const environmentFile=path.join(root,'environment.json');await writeJson(environmentFile,{...await readJson(environmentFile),...visibility});
  await run(python(where),['-c','import torch; assert torch.cuda.is_available(), "GPU unavailable"; print(torch.cuda.get_device_name()); x=torch.ones(64,device="cuda"); print((x+x).sum().item())'],{env:visibility,timeout:120000});
  const freeze=await run(uv,['pip','freeze','--python',python(where)],{env,capture:true});await fs.writeFile(path.join(root,where,'installed-requirements.txt'),freeze);
 }
 if(profile.images)await step('comfy',async()=>{
  await archive('comfy',path.join(root,'ComfyUI-Next'),'main.py');
  await archive('gguf',path.join(root,'ComfyUI-Next/custom_nodes/ComfyUI-GGUF'),'nodes.py');
  await fs.cp(path.join(root,'custom_nodes'),path.join(root,'ComfyUI-Next/custom_nodes'),{recursive:true});
  await gpuEnv('ComfyUI-Next',['-r',path.join(root,'ComfyUI-Next/requirements.txt'),'-r',path.join(root,'ComfyUI-Next/custom_nodes/ComfyUI-GGUF/requirements.txt')]);
 });
 // Pattara is provided by Windows; no alternate TTS engine is downloaded.
 await step('sandbox-python',async()=>{
  await archive('python-embed',path.join(root,'Lumicos-Sandbox/python'),'python.exe');
  const embed=path.join(root,'Lumicos-Sandbox/python/python313._pth');await fs.appendFile(embed,'\n../site-packages\nimport site\n');
  await uvRun(['pip','install','--python',path.join(root,'Lumicos-Sandbox/python/python.exe'),'--target',path.join(root,'Lumicos-Sandbox/site-packages'),'-r',path.join(kit,'catalog/locks/sandbox.txt')]);
  await uvRun(['pip','install','--python',path.join(root,'Lumicos-Sandbox/python/python.exe'),'--target',path.join(root,'LumicosSearchMCP/deps'),'-r',path.join(kit,'catalog/locks/search.txt')]);
 });
 await step('sandbox-acl',()=>run('powershell.exe',['-NoProfile','-ExecutionPolicy','Bypass','-File',path.join(kit,'src/sandbox.ps1'),'-Root',root]));
 await step('skills',()=>fs.cp(path.join(root,'skills'),path.join(root,'PersonalAI/workspace/skills'),{recursive:true}));
 await step('app',async()=>{
  await run(node,[path.join(root,'runtime/node/node_modules/npm/bin/npm-cli.js'),'ci','--no-audit','--no-fund'],{cwd:path.join(root,'PersonalAI'),env});
  await run(node,[path.join(root,'runtime/node/node_modules/npm/bin/npm-cli.js'),'run','build'],{cwd:path.join(root,'PersonalAI'),env});
 });
 await writeLaunchers(root);
 state.status='awaiting-models';delete state.error;delete state.failedStep;await writeJson(marker,state);
 await modelPage(root,profile);console.log('Runtime installation complete. Models still required; open MODELS.html.');return state;
}
export async function writeLaunchers(root){
 await fs.writeFile(path.join(root,'Stop Lumicos.cmd'),'@echo off\r\npowershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0installer\\src\\stop.ps1" -Root "%~dp0."\r\nif errorlevel 1 pause\r\n');
 for(const [name,action] of [['Start Lumicos','start'],['Check Installation','doctor'],['Link Downloaded Models','bind'],['Download Recommended Models','download-models']])await fs.writeFile(path.join(root,name+'.cmd'),`@echo off\r\ncd /d "%~dp0"\r\n"%~dp0runtime\\node\\node.exe" "%~dp0installer\\src\\cli.mjs" ${action} --root "%~dp0."\r\nif errorlevel 1 pause\r\n`);
}
const escape=s=>String(s).replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('"','&quot;');
export async function modelPage(root,profile){
 const rows=await readJson(path.join(kit,'catalog/models.json'));let body='';
 for(const m of selectedModels(rows,profile)){
  body+=`<section><h2>${escape(m.id)}</h2><a href="${escape(m.page)}">Hugging Face / model card / license</a><p>Revision: ${escape(m.revision)} · License: ${escape(m.license)}</p><ul>`;
  for(const f of m.files)body+=`<li><a href="${escape(f.url)}">${escape(f.name)}</a> (${((f.bytes??0)/1073741824).toFixed(2)} GiB)<br>Save to: <code>${escape(path.join(root,f.destination))}</code></li>`;
  body+='</ul></section>';
 }
 await fs.writeFile(path.join(root,'MODELS.html'),`<!doctype html><meta charset="utf-8"><title>Lumicos models</title><style>body{font:16px system-ui;max-width:1000px;margin:40px auto;padding:20px;background:#131522;color:#eee}a{color:#bdaaff}section{padding:18px;margin:20px 0;background:#22263a;border-radius:12px}li{margin:15px 0}code{overflow-wrap:anywhere}</style><img src="installer/assets/lumicos-logo.png" alt="Lumicos" style="display:block;width:220px;max-width:100%;border-radius:20px"><h1>Lumicos — download models</h1><p>ไม่มีโมเดลรวมมาในตัวติดตั้ง เลือกลิงก์ด้านล่างและอ่านเงื่อนไขของเจ้าของโมเดล บันทึกไฟล์ตามพาธ แล้วเปิด Link Downloaded Models.cmd</p><p>หรือใช้ Download Recommended Models.cmd เพื่อดาวน์โหลดหลังยอมรับเงื่อนไขด้วยตัวเอง</p>${body}`);
}
