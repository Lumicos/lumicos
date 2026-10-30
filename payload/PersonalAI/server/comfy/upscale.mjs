export const UPSCALE_MODEL='ClearRealityV1/4x-ClearRealityV1.pth';
export function installedUpscaler(info){
 const definition=info.UpscaleModelLoader?.input?.required?.model_name;
 const options=Array.isArray(definition?.[0])?definition[0]:definition?.[1]?.options??[];
 return options.find(name=>name.replaceAll('\\','/')===UPSCALE_MODEL);
}
export function upscaleGraph(image,model=UPSCALE_MODEL,prefix='Lumicos/Upscaled',target){
 const graph={
  '1':{class_type:'LoadImage',inputs:{image}},
  '2':{class_type:'UpscaleModelLoader',inputs:{model_name:model}},
  '3':{class_type:'ImageUpscaleWithModel',inputs:{upscale_model:['2',0],image:['1',0]}},
  '4':{class_type:'SaveImage',inputs:{images:['3',0],filename_prefix:prefix}},
 };
 if(target){graph['5']={class_type:'ImageScale',inputs:{image:['3',0],upscale_method:'lanczos',width:target.width,height:target.height,crop:'disabled'}};graph['4'].inputs.images=['5',0];}
 return graph;
}
export function retainGenerationGraph(generation,upscale){
 const prefix='lumicos_upscale_';const result=structuredClone(generation);
 // Keep model/conditioning cache identities, but never keep generation output roots.
 // RAM-pressure eviction must not turn an upscale request into another sampler run.
 for(const [id,node]of Object.entries(result))if(['SaveImage','PreviewImage','PreviewAny'].includes(node.class_type))delete result[id];
 for(const [id,node]of Object.entries(upscale)){
  const key=prefix+id;if(key in result)throw new Error('Workflow has a reserved upscale node ID.');
  const copy=structuredClone(node);
  for(const [input,value]of Object.entries(copy.inputs))if(Array.isArray(value)&&typeof value[0]==='string'&&upscale[value[0]])copy.inputs[input]=[prefix+value[0],...value.slice(1)];
  result[key]=copy;
 }
 return {graph:result,output:prefix+'4'};
}
