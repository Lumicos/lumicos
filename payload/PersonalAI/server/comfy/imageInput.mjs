import fs from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';

const invalid = message => Object.assign(new Error(message), {status:415});
export function imageDimensions(buf) {
  if(buf.length > 20*1024*1024) throw invalid('ภาพต้องไม่เกิน 20 MB');
  if(buf.length >= 24 && buf.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10]))) {
    return [buf.readUInt32BE(16),buf.readUInt32BE(20)];
  }
  if(buf[0]===255 && buf[1]===216) {
    let offset=2;
    while(offset+4<=buf.length) {
      if(buf[offset++]!==255) break;
      while(buf[offset]===255) offset++;
      const marker=buf[offset++];
      if(marker===217 || marker===218) break;
      if(marker===1 || (marker>=208 && marker<=215)) continue;
      if(offset+2>buf.length) break;
      const length=buf.readUInt16BE(offset);
      if(length<2 || offset+length>buf.length) break;
      if([192,193,194,195,197,198,199,201,202,203,205,206,207].includes(marker) && length>=8) return [buf.readUInt16BE(offset+5),buf.readUInt16BE(offset+3)];
      offset+=length;
    }
  }
  throw invalid('ไฟล์ต้องเป็นภาพ PNG หรือ JPEG ที่เปิดอ่านได้');
}

export async function saveInput(dir, buf) {
  const [width,height]=imageDimensions(buf);
  if(!width || !height || width>8192 || height>8192 || width*height>24000000) throw invalid('ภาพใหญ่เกินไป กรุณาลดเหลือไม่เกิน 24 ล้านพิกเซล และด้านละ 8192 พิกเซล');
  const {loadImage,createCanvas}=await import('@napi-rs/canvas');
  let image;
  try {image=await loadImage(buf);} catch {throw invalid('เปิดภาพไม่ได้ ไฟล์อาจเสียหาย');}
  const scale=Math.min(1,2048/Math.max(image.width,image.height));
  const canvas=createCanvas(Math.max(1,Math.round(image.width*scale)),Math.max(1,Math.round(image.height*scale)));
  canvas.getContext('2d').drawImage(image,0,0,canvas.width,canvas.height);
  const id=randomUUID();
  await fs.mkdir(dir,{recursive:true});
  await fs.writeFile(path.join(dir,id+'.png'),canvas.toBuffer('image/png'));
  const info={id,width:canvas.width,height:canvas.height,url:`/api/images/inputs/${id}`};
  await fs.writeFile(path.join(dir,id+'.json'),JSON.stringify(info));
  return info;
}

export async function readInput(dir,id) {
  if(typeof id!=='string'||!/^[a-f0-9-]{36}$/.test(id)) throw invalid('Invalid input image id.');
  try {
    return {info:JSON.parse(await fs.readFile(path.join(dir,id+'.json'),'utf8')),bytes:await fs.readFile(path.join(dir,id+'.png'))};
  } catch {throw Object.assign(new Error('ไม่พบภาพต้นฉบับ กรุณาแนบใหม่'),{status:404});}
}

export function editGraph(graph, job, inputName) {
  graph['5'].inputs.text=job.prompt;
  graph['7'].inputs.seed=job.seed;
  graph['10'].inputs.filename_prefix='Lumicos/'+job.id;
  if(!inputName) {Object.assign(graph['6'].inputs,{width:job.width,height:job.height});return graph;}
  delete graph['6'];
  graph['20']={class_type:'LoadImage',inputs:{image:inputName}};
  graph['21']={class_type:'ImageScale',inputs:{image:['20',0],upscale_method:'lanczos',width:job.width,height:job.height,crop:job.originalSize?'disabled':'center'}};
  graph['22']={class_type:'VAEEncode',inputs:{pixels:['21',0],vae:['3',0]}};
  Object.assign(graph['7'].inputs,{latent_image:['22',0],denoise:job.denoise});
  return graph;
}
