import fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
import {requestedQuality} from '../../src/chat/imageQuality.mjs';
export {requestedQuality};
const fail=message=>Object.assign(new Error(message),{status:400});
export const BACKENDS={
 "portable-zimage":{label:"Z-Image Turbo (portable)",model:"z_image_turbo_bf16.safetensors",workflow:"zimage-portable.json",tasks:["text-to-image","image-to-image"],alignment:16,requires:["../../../ComfyUI-Next/models/text_encoders/qwen_3_4b.safetensors","../../../ComfyUI-Next/models/vae/ae.safetensors"]},
  "ray-zimage": {
    "label": "Ray Z-Image Turbo v1.2",
    "model": "rayZImageTurbo_v12.safetensors",
    "workflow": "zimage-int8.json",
    "tasks": [
      "text-to-image",
      "image-to-image"
    ],
    "alignment": 16
  },
  "zimage-int8": {
    "label": "Z-Image Turbo INT8",
    "model": "zImageINT8_turbo.safetensors",
    "workflow": "zimage-int8.json",
    "tasks": [
      "text-to-image",
      "image-to-image"
    ],
    "alignment": 16
  },
  "moss-image": {
    "label": "Moss Image · 4 step",
    "model": "moss_image_sft_int8_convrot.safetensors",
    "workflow": "moss-image.json",
    "tasks": [
      "text-to-image"
    ],
    "alignment": 16,
    "steps": 4,
    "labOnly": true,
    "tiledAbovePixels": 480000,
    "requires": [
      "../../../ComfyUI-Next/models/loras/moss_image_sft_4step_v2.0.safetensors",
      "../../../ComfyUI-Next/models/text_encoders/qwen3.5_9b_ultra_uncensored_heretic_int8_convrot.safetensors",
      "../../../ComfyUI-Next/models/vae/flux2-vae.safetensors"
    ]
  },
  "djm-zimage": {
    "label": "DJM Z-Image Turbo INT8",
    "model": "zImageTurboDjm_w1rZITVint8.safetensors",
    "workflow": "zimage-int8.json",
    "tasks": [
      "text-to-image",
      "image-to-image"
    ],
    "alignment": 16
  }
};
const modelDirectory=fileURLToPath(new URL("../../../ComfyUI-Next/models/diffusion_models/",import.meta.url));
const AUTO_PREFIX='auto-zimage-';
// Primary image model (owner's choice, 2026-10-16). Used as the default whenever it is installed;
// The CyberRealistic (z-plus) profile was removed 2026-10-16 (file no longer installed). zimage-int8.json is the shared Z-Image INT8 template: the model file is filled in per profile. Other models stay selectable as fallbacks.
export const PRIMARY_IMAGE_MODEL='z_image_turbo_bf16.safetensors';
export const PRESET_STEPS={fast:8,normal:8,high:8};
export const QUALITIES=['fast','normal','high'];
// Pixel budgets are square reference sizes; dimensions preserve the requested ratio.
export const PIXEL_BUDGETS={fast:620**2,normal:720**2,high:1024**2};
export function routeImage({backend,quality,prompt='',inputId}={}){
 if(backend===undefined||['auto','z-image-turbo'].includes(backend)){const primary=primaryImageBackendId();backend=BACKENDS[primary]?primary:Object.keys(BACKENDS)[0];}
 const profile=BACKENDS[backend];if(!profile?.workflow)throw fail(profile?.reason??'Image backend removed or unavailable.');
 quality=quality==='quality'?'normal':quality??requestedQuality(prompt)??'normal';
 if(!QUALITIES.includes(quality))throw fail('Unknown image quality.');
 return {backend,requestedBackend:backend,quality,task:inputId?'image-to-image':'text-to-image',steps:profile.steps??PRESET_STEPS[quality],routingReason:profile.label+' + one 4x upscale pass',qualityPendingReview:true};
}

export const primaryImageBackendId=()=>autoId(PRIMARY_IMAGE_MODEL);
/** Default backend among the installed ones: the primary model, else the first available. */
export const pickDefaultBackend=(all=[])=>{const available=all.filter(p=>!p.labOnly);return (available.find(p=>p.id===primaryImageBackendId())??available[0])?.id};
const autoId=name=>AUTO_PREFIX+name.replace(/\.safetensors$/i,'').toLowerCase().replace(/[^a-z0-9]+/g,'-').replace(/^-|-$/g,'').slice(0,42)+'-'+createHash('sha256').update(name.toLowerCase()).digest('hex').slice(0,8);
const friendly=name=>name.replace(/\.safetensors$/i,'').replace(/[_-]+/g,' ').replace(/\s+/g,' ').trim();
async function inspectSafetensors(file,{open=fs.open}={}){
 const handle=await open(file,'r');
 try{
  const size=Buffer.alloc(8);await handle.read(size,0,8,0);const length=Number(size.readBigUInt64LE());
  if(!Number.isSafeInteger(length)||length<2||length>16*1024*1024)return {compatible:false,reason:'Safetensors header ไม่ถูกต้อง'};
  const bytes=Buffer.alloc(length);const read=await handle.read(bytes,0,length,8);if(read.bytesRead!==length)return {compatible:false,reason:'Safetensors header ไม่สมบูรณ์'};
  const header=JSON.parse(bytes.toString('utf8')),keys=Object.keys(header).filter(k=>k!=='__metadata__');
  const meta=JSON.stringify(header.__metadata__??{}),identity=path.basename(file)+' '+meta;
  const named=/z[\s_.-]?image/i.test(identity);
  const qkv=keys.some(k=>/^layers\.0\.attention\.qkv\.(?:weight|weight_scale)$/i.test(k));
  const ff=keys.some(k=>/^layers\.0\.feed_forward\.w1\.(?:weight|weight_scale)$/i.test(k));
  return named&&qkv&&ff?{compatible:true,metadata:header.__metadata__??{}}:{compatible:false,reason:'ไม่ใช่โมเดล Z-Image ที่ใช้กับ workflow นี้'};
 }catch{return {compatible:false,reason:'อ่าน Safetensors header ไม่ได้'};}finally{await handle.close();}
}

export async function discoverImageModels({directory=modelDirectory,readdir=fs.readdir,access=fs.access,open=fs.open}={}){
 let entries;try{entries=await readdir(directory,{withFileTypes:true});}catch{return [];}
 const known=new Set(Object.values(BACKENDS).filter(p=>!p.auto).map(p=>p.model.toLowerCase()));
 const found=[];
 for(const entry of entries){
  if(!entry.isFile()||!entry.name.toLowerCase().endsWith('.safetensors')||known.has(entry.name.toLowerCase()))continue;
  const inspected=await inspectSafetensors(path.join(directory,entry.name),{open}),id=autoId(entry.name);
  if(inspected.compatible){
   BACKENDS[id]={label:friendly(entry.name),model:entry.name,workflow:'zimage-int8.json',tasks:['text-to-image','image-to-image'],alignment:16,auto:true};
   found.push({id,label:friendly(entry.name),available:true,installed:true,compatible:true,detected:true,tasks:['text-to-image','image-to-image'],file:entry.name});
  }else found.push({id,label:friendly(entry.name),available:false,installed:true,compatible:false,detected:true,tasks:[],file:entry.name,reason:inspected.reason});
 }
 return found;
}
export function nativeResolution(quality,width=768,height=1024){
 if(!QUALITIES.includes(quality))throw fail('Unknown image quality.');
 const gcd=(a,b)=>b?gcd(b,a%b):a;const d=gcd(width,height),a=width/d,b=height/d,budget=PIXEL_BUDGETS[quality];
 // Preserve common ratios exactly, with both dimensions aligned to the Z workflow.
 const unit=16/gcd(a,16)* (16/gcd(b,16))/gcd(16/gcd(a,16),16/gcd(b,16));
 const min=Math.ceil(Math.max(256/a,256/b)/unit),max=Math.floor(Math.min(1536/a,1536/b)/unit);
 if(min<=max){const k=Math.min(max,Math.max(min,Math.round(Math.sqrt(budget/(a*b))/unit)))*unit;return {width:a*k,height:b*k};}
 // Arbitrary uploaded-image ratios can require rounding to the nearest latent pixel grid.
 const scale=Math.sqrt(budget/(width*height));const w=Math.max(256,Math.min(1536,Math.round(width*scale/16)*16)),h=Math.max(256,Math.min(1536,Math.round(height*scale/16)*16));return {width:w,height:h};
}
export async function loadImageGraph(job,{readFile=fs.readFile}={}){
 const profile=BACKENDS[job.backend];if(!profile)throw fail('Image backend removed or unavailable.');
 let text;try{text=await readFile(new URL('./'+(job.edit?'zimage-edit.json':profile.workflow),import.meta.url),'utf8')}catch(e){if(e.code==='ENOENT')throw Object.assign(new Error('Validated CyberRealistic INT8 workflow is required before image generation.'),{status:503});throw e}
 const graph=JSON.parse(text);graph['4'].inputs.unet_name=profile.model;graph['7'].inputs.steps=profile.steps??PRESET_STEPS[job.quality??'normal'];
 // 8 GB cards crash (hipErrorLaunchFailure) on a one-shot VAE decode of large Moss images: decode in tiles above the pixel threshold.
 if(profile.tiledAbovePixels&&job.width*job.height>profile.tiledAbovePixels)graph['12']={class_type:'VAEDecodeTiled',inputs:{...graph['12'].inputs,tile_size:512,overlap:64,temporal_size:64,temporal_overlap:8}};
 return graph;
}
export async function imageProfiles(options={}){
 for(const id of Object.keys(BACKENDS))if(id.startsWith(AUTO_PREFIX))delete BACKENDS[id];
 const detected=await discoverImageModels(options);
 const access=options.access??fs.access,directory=options.directory??modelDirectory;
 const configured=await Promise.all(Object.entries(BACKENDS).map(async([id,p])=>{
 const extras=await Promise.all((p.requires??[]).map(f=>access(fileURLToPath(new URL(f,import.meta.url))).then(()=>true,()=>false)));
 const installed=await access(path.join(directory,p.model)).then(()=>true,()=>false)&&extras.every(Boolean);
 const ready=p.workflow?await fs.access(new URL('./'+p.workflow,import.meta.url)).then(()=>true,()=>false):false;
 return {id,label:p.label,available:installed&&ready,installed,compatible:true,labOnly:!!p.labOnly,detected:!!p.auto,primary:id===primaryImageBackendId(),tasks:p.tasks,file:p.model,reason:!installed?'Model file missing':!ready?(p.reason??'Workflow missing'):undefined};
 }));
 const configuredIds=new Set(configured.map(p=>p.id));
 return [...configured,...detected.filter(p=>!configuredIds.has(p.id))];
}
