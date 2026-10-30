export function selectProfile(hardware,{gpuIndex}={}){
 const errors=[],warnings=[];
 if(hardware.arch?.toLowerCase()!=='x64'||hardware.build<22000)errors.push('This installer requires Windows 11 x64.');
 if(hardware.ramGiB<15)warnings.push('Less than 16 GiB RAM: use the small chat model; image/voice workloads may be slow.');
 const gpus=hardware.gpus??[];
 if(gpuIndex!==undefined&&(!Number.isInteger(gpuIndex)||!gpus[gpuIndex]))throw Error('Invalid GPU index');
 const index=gpuIndex??gpus.map((g,i)=>({i,score:(g.vramGiB??0)+(/NVIDIA|Radeon RX/i.test(g.name)?100:0)})).sort((a,b)=>b.score-a.score)[0]?.i;
 const gpu=gpus[index]??{name:'CPU',vramGiB:0};
 let backend='cpu',llama='llama-cpu',torch='cpu',target=null,whisper='whisper-cpu';
 if(/NVIDIA/i.test(gpu.name)){
  const cuda=Number(hardware.cudaMax);
  if(cuda>=13.4){backend='cuda';llama='llama-cuda13';torch='cu130';}
  else if(cuda>=12.4&&!/RTX\s*50\d\d/i.test(gpu.name)){backend='cuda';llama='llama-cuda12';torch='cu124';}
  else{backend='vulkan';llama='llama-vulkan';warnings.push('CUDA driver support is unverified/too old for the pinned binaries. Update the NVIDIA driver to enable GPU images.');}
  if(backend==='cuda'&&!/RTX\s*50\d\d/i.test(gpu.name))whisper='whisper-cuda';
 }else if(/Radeon.*(?:RX\s*(?:6\d\d\d|7\d\d\d|9\d\d\d)|AI PRO R9700)/i.test(gpu.name)){
  backend='rocm';llama='llama-rocm';torch='rocm';
  const map=[[/RX\s*9070|R9700/i,'gfx1201'],[/RX\s*9060/i,'gfx1200'],[/RX\s*7900/i,'gfx1100'],[/RX\s*(7700|7800)/i,'gfx1101'],[/RX\s*7600/i,'gfx1102'],[/RX\s*(6600|6650)/i,'gfx1032'],[/RX\s*(6700|6750)/i,'gfx1031'],[/RX\s*(6800|6900|6950)/i,'gfx1030']];
  target=map.find(([re])=>re.test(gpu.name))?.[1]??null;
  if(!target){backend='vulkan';llama='llama-vulkan';torch='cpu';warnings.push('Unknown AMD architecture: Vulkan chat only; no unverified ROCm install.');}
 }else if(gpus.length){backend='vulkan';llama='llama-vulkan';warnings.push('Intel/integrated GPU: Vulkan chat profile; GPU images not certified by this installer.');}
 const vram=gpu.vramGiB;
 const gpuFeatures=['cuda','rocm'].includes(backend)&&Number.isFinite(vram)&&vram>=7.5;
 if(vram==null)warnings.push('VRAM could not be measured reliably. GPU image generation is disabled until capacity is verified; TTS uses CPU.');
 if(!gpuFeatures)warnings.push('Image generation needs a verified GPU with at least 8 GiB dedicated memory. Public TTS uses CPU; CPU Whisper may be slow.');
 if(whisper==='whisper-cpu')warnings.push('Whisper uses the explicit CPU profile: this pinned release has no compatible Windows GPU binary for this selection.');
 if(gpus.length>1)warnings.push('Multiple GPUs detected: backend device enumeration must confirm the selected adapter.');
 return {schema:1,id:`windows-${backend}-${target??torch}`,gpuIndex:index??null,gpu,backend,llama,torch,target,whisper,voice:true,images:gpuFeatures,context:vram>=12?8192:4096,chatModel:vram>=12?'chat-e4b':'call-e2b',ngl:backend==='cpu'?0:99,errors,warnings,validation:'Requires target-machine smoke tests; vendor detection is not certification.'};
}
