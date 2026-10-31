import fs from 'node:fs/promises';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import {writeJson,readJson} from './io.mjs';
export async function configure(root,profile){
 const app=path.join(root,'PersonalAI'),llama=path.join(root,'runtime/llama'),models=path.join(root,'models/chat');
 for(const dir of ['models/chat','models/whisper','PersonalAI/data','PersonalAI/workspace','ComfyUI-Next/models/diffusion_models','ComfyUI-Next/models/text_encoders','ComfyUI-Next/models/vae'])await fs.mkdir(path.join(root,dir),{recursive:true});
 await writeJson(path.join(app,'personalai.config.json'),{host:'127.0.0.1',port:8787,dataDir:'data',workspaceDir:'workspace'});
 await writeJson(path.join(app,'lumicos-launcher.json'),{llamaDir:llama,modelDir:models,model:path.join(models,'gemma-4-E2B_q4_0-it.gguf'),context:profile.context,comfyDir:path.join(root,'ComfyUI-Next')});
 // SearchV6Service / SandboxService read these from environment.json via Start Lumicos (cli start).
 const env={LUMICOS_GPU_BACKEND:profile.backend,LUMICOS_SKIP_VOICE_PRELOAD:'1',LUMICOS_AUTO_COMFY:'1',LUMICOS_STT_BACKEND:'legacy-cli',LUMICOS_WHISPER_BACKEND:profile.whisper==='whisper-cuda'?'CUDA':'CPU',LUMICOS_WHISPER_CPU:profile.whisper==='whisper-cpu'?'1':'0',LUMICOS_STT_DIR:path.join(root,'models/whisper'),LUMICOS_WHISPER_EXE:path.join(root,'runtime/whisper/whisper-cli.exe'),LUMICOS_WHISPER_MODEL:path.join(root,'models/whisper/ggml-large-v3-turbo-q5_0.bin'),LUMICOS_WHISPER_MULTI_MODEL:path.join(root,'models/whisper/ggml-large-v3-turbo-q5_0.bin'),LUMICOS_SEARCH_DIR:path.join(root,'LumicosSearchMCP'),LUMICOS_SEARCH_PYTHON:path.join(root,'Lumicos-Sandbox/python/python.exe'),LUMICOS_SANDBOX_ROOT:path.join(root,'Lumicos-Sandbox'),HF_HUB_OFFLINE:'1',TRANSFORMERS_OFFLINE:'1'};
 await writeJson(path.join(root,'environment.json'),env);
 // New installations have no chats, owner credentials, memories, model profiles or API keys copied in.
 if(!await fs.access(path.join(app,'data/voice-engines.json')).then(()=>true,()=>false))await writeJson(path.join(app,'data/voice-engines.json'),{tts:'auto',stt:'multi',resident:false});
}
export async function bindModels(root,profile,catalog){
 const models=[];
 for(const id of ['call-e2b','chat-e4b']){
  const entry=catalog.find(m=>m.id===id),file=path.join(root,entry.files[0].destination);
  if(!await fs.access(file).then(()=>true,()=>false))continue;
  const {ModelConfigStore}=await import(pathToFileURL(path.join(root,'PersonalAI/server/llama/modelConfig.mjs')));
  const store=new ModelConfigStore(path.join(root,'PersonalAI/data/models.json'));
  await store.setGeneral({llamaDir:path.join(root,'runtime/llama'),modelDirs:[path.join(root,'models/chat')]});
  const existing=store.get().models.find(m=>m.path===file);
  const model=existing??await store.upsertModel({name:id==='call-e2b'?'Gemma E2B · Call':'Gemma E4B',path:file,mmproj:null,ctx:profile.context,ngl:profile.ngl,capabilities:{text:true,vision:false,tools:id==='chat-e4b'},generation:{temperature:.7,topP:.95,maxTokens:id==='call-e2b'?220:1024},toolFormat:id==='chat-e4b'?'json-block':'none'});
  models.push({...model,role:id});
 }
 if(models.length){const file=path.join(root,'PersonalAI/data/models.json'),data=await readJson(file);const primary=models.find(m=>m.role===profile.chatModel)??models[0];data.primaryId=primary.id;data.selectedId=primary.id;await writeJson(file,data)}
 return models;
}
