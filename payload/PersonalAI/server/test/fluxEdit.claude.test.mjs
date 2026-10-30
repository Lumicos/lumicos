import {test} from 'node:test';
import assert from 'node:assert/strict';
import {fluxEditGraph,fluxEditInstruction,fluxEditInstalled,fluxMergeInstruction,fluxRefInstruction,fluxMergeOrder,fluxMergeSize,fluxMergeRefMegapixels,FLUX_EDIT_FILES} from '../comfy/fluxEdit.mjs';

test('Flux edit graph wires the uploaded photo as a reference latent with 4 default steps',()=>{
 const g=fluxEditGraph({inputName:'Lumicos/a.png',prompt:'Edit this photo: anime',seed:5});
 assert.equal(g['11'].inputs.image,'Lumicos/a.png');
 assert.deepEqual(g['17'].inputs['images.image0'],['11',0]);
 assert.equal(g['17'].inputs.resolution,'resize');
 assert.deepEqual(g['7'].inputs.latent_image,['17',2]);
 assert.equal(g['7'].inputs.steps,4);assert.equal(g['7'].inputs.cfg,1);assert.equal(g['7'].inputs.seed,5);
 assert.equal(g['45'].inputs.unet_name,FLUX_EDIT_FILES.unet);
 assert.throws(()=>fluxEditGraph({inputName:'',prompt:'x',seed:1}));
});
test('Template prompt becomes a keep-the-face instruction without the img2img suffix',()=>{
 const s=fluxEditInstruction('anime illustration, clean line art, same subject, same pose and composition as the original photo');
 assert.match(s,/^Edit this photo: anime illustration, clean line art\. Keep the same person/);
 assert.doesNotMatch(s,/original photo/);
 assert.throws(()=>fluxEditInstruction('  '));
});
test('Install check reports missing files',async()=>{
 const r=await fluxEditInstalled({access:async p=>{if(p.includes('vae'))throw new Error('missing')},dir:'X/'});
 assert.equal(r.ready,false);assert.deepEqual(r.missing,[FLUX_EDIT_FILES.vae]);
});
test('Merge graph wires every reference photo (smaller when 3+) and keeps the single-photo ids',()=>{
 const g=fluxEditGraph({inputNames:['Lumicos/a.png','Lumicos/b.png'],prompt:'x',seed:1});
 assert.equal(g['11'].inputs.image,'Lumicos/a.png');assert.equal(g.img1.inputs.image,'Lumicos/b.png');
 assert.deepEqual(g['17'].inputs['images.image0'],['11',0]);assert.deepEqual(g['17'].inputs['images.image1'],['img1',0]);
 assert.equal(g['17'].inputs['resolution.megapixels'],0.45);
 const g3=fluxEditGraph({inputNames:['a','b','c'],prompt:'x',seed:1});
 assert.equal(g3['17'].inputs['resolution.megapixels'],0.3);assert.deepEqual(g3['17'].inputs['images.image2'],['img2',0]);
 assert.throws(()=>fluxEditGraph({inputNames:['a','b','c','d','e'],prompt:'x',seed:1}));
});
test('Merge instruction keeps identities and needs a request',()=>{
 assert.match(fluxMergeInstruction('ให้คนในภาพ 1 ถือสินค้าในภาพ 2'),/^Combine the reference images.*ให้คนในภาพ 1.*Keep each person's face/);
 assert.throws(()=>fluxMergeInstruction(' '));
 assert.match(fluxMergeInstruction('เพื่อน 4 คน',4),/waist up.*all 4 references/);
 assert.doesNotMatch(fluxMergeInstruction('x',2),/waist up/);
 assert.deepEqual(fluxMergeSize(4,3),{width:640,height:480});
});
test('Reference graph uses a free-size empty latent instead of the first reference size',()=>{
 const g=fluxEditGraph({inputNames:['a'],size:{width:768,height:576},prompt:'x',seed:1});
 assert.deepEqual(g['7'].inputs.latent_image,['5',0]);assert.equal(g['5'].inputs.width,768);assert.equal(g['5'].inputs.height,576);
 assert.deepEqual(fluxEditGraph({inputNames:['a'],prompt:'x',seed:1})['7'].inputs.latent_image,['17',2]);
 assert.throws(()=>fluxEditGraph({inputNames:['a'],size:{width:770,height:576},prompt:'x',seed:1}));
 assert.match(fluxRefInstruction('คนในภาพ 1 ที่ชายหาด'),/^Create a new photo using the reference images/);
 assert.throws(()=>fluxRefInstruction(''));
});

test('Merge puts the named place/background image first and renumbers the request',()=>{
 const a=fluxMergeOrder('หญิงสาวในภาพ 1 ยืนอยู่ในสถานที่ภาพ 2',2);
 assert.deepEqual(a.order,[1,0]);assert.equal(a.prompt,'หญิงสาวในภาพ 2 ยืนอยู่ในสถานที่ภาพ 1');
 const b=fluxMergeOrder('ให้คนในรูปที่ 1 และรูปที่ 2 ไปอยู่ในฉากของภาพที่ 3',3);
 assert.deepEqual(b.order,[2,0,1]);assert.equal(b.prompt,'ให้คนในรูปที่ 3 และรูปที่ 2 ไปอยู่ในฉากของภาพที่ 1');
 const c=fluxMergeOrder('put the man from image 1 in the background of image 2',2);
 assert.deepEqual(c.order,[1,0]);assert.equal(c.prompt,'put the man from image 2 in the background of image 1');
 for(const p of ['ให้คนในภาพ 1 ถือสินค้าในภาพ 2','คนในภาพ 2 อยู่ในสถานที่ภาพ 1','ฉากภาพ 5 กับคนภาพ 1']) assert.deepEqual(fluxMergeOrder(p,2),{order:[0,1],prompt:p});
});
test('Merge output frame is small (about 0.3 MP, multiples of 16) whatever the input size',()=>{
 assert.deepEqual(fluxMergeSize(1536,2048),{width:480,height:640});
 assert.deepEqual(fluxMergeSize(6000,4000),{width:688,height:464});
 const s=fluxMergeSize(4000,4000);assert.equal(s.width%16,0);assert.ok(s.width*s.height<=0.31*1048576);
 assert.equal(fluxMergeRefMegapixels(2),0.2);assert.equal(fluxMergeRefMegapixels(4),0.15);
 const g=fluxEditGraph({inputNames:['a.jpg','b.jpg'],size:{width:480,height:640},keepRefSize:true,prompt:'x',seed:1});
 assert.equal(g['17'].inputs.resolution,'keep resolution');assert.equal(g['17'].inputs['resolution.megapixels'],undefined);
 assert.deepEqual(g['7'].inputs.latent_image,['5',0]);
});
