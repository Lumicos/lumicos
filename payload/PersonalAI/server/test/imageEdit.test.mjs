import assert from 'node:assert/strict';
import {test} from 'node:test';
import {mkdtemp,readFile,rm,mkdir,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {createCanvas} from '@napi-rs/canvas';
import {saveInput,readInput,editGraph} from '../comfy/imageInput.mjs';
import {ComfyService,ComputeQueue} from '../comfy/comfyService.mjs';

test('PNG and JPEG are decoded and stored as PNG; originals are not overwritten', async()=>{
  const dir=await mkdtemp(path.join(tmpdir(),'lumicos-image-'));
  try {
    const canvas=createCanvas(400,300);canvas.getContext('2d').fillRect(0,0,400,300);
    for(const type of ['image/png','image/jpeg']) {
      const info=await saveInput(dir,canvas.toBuffer(type));
      assert.equal(info.width,400);assert.equal(info.height,300);
      assert.deepEqual((await readInput(dir,info.id)).bytes.subarray(0,8),Buffer.from([137,80,78,71,13,10,26,10]));
    }
    await assert.rejects(saveInput(dir,Buffer.from('not a PNG')), /PNG/);
    await assert.rejects(readInput(dir,'../../secret'), /Invalid/);
  } finally {await rm(dir,{recursive:true,force:true});}
});

test('image-to-image uses the uploaded pixels; text-to-image still uses an empty latent',async()=>{
  const template=JSON.parse(await readFile(new URL('../comfy/z-image.json',import.meta.url),'utf8'));
  const job={id:'test',prompt:'dog in sunlight',seed:42,width:1024,height:576,denoise:.55};
  const text=editGraph(structuredClone(template),job);
  assert.equal(text['6'].inputs.width,1024);assert.equal(text['6'].inputs.height,576);
  const edit=editGraph(structuredClone(template),job,'Lumicos/input.png');
  assert.equal(edit['20'].inputs.image,'Lumicos/input.png');
  assert.deepEqual(edit['7'].inputs.latent_image,['22',0]);
  assert.deepEqual(edit['22'].inputs.pixels,['21',0]);
  assert.equal(edit['7'].inputs.denoise,.55);assert.equal(edit['6'],undefined);
  assert.equal(edit['21'].inputs.crop,'center');
  assert.equal(editGraph(structuredClone(template),{...job,originalSize:true},'input.png')['21'].inputs.crop,'disabled');
});

test('bad inputs fail before queuing GPU work',async()=>{
  const dir=await mkdtemp(path.join(tmpdir(),'lumicos-service-'));
  try {
    const s=new ComfyService({dataDir:dir});await s.ready;
    await assert.rejects(s.create({prompt:'dog',inputId:'../file'}),/Invalid/);
    await assert.rejects(s.create({prompt:'dog',width:1000}),/multiples/);
    await assert.rejects(s.create({prompt:'dog',denoise:NaN}),/0.1/);
    await assert.rejects(s.create({prompt:'dog',denoise:1.1}),/0.1/);
    assert.equal(s.jobs.size,0);
  } finally {await rm(dir,{recursive:true,force:true});}
});

test('GPU jobs run one at a time and an aborted waiter releases its place',async()=>{
  const q=new ComputeQueue();const a=await q.acquire();
  const abort=new AbortController();abort.abort();
  const waiting=q.acquire(abort.signal);a();await assert.rejects(waiting);
  const next=await q.acquire();next();
});

test('offline ComfyUI fails visibly and a queued cancellation never submits a prompt',async()=>{
  const dir=await mkdtemp(path.join(tmpdir(),'lumicos-offline-'));
  try {
    const s=new ComfyService({dataDir:dir,autoStartComfy:false});await s.ready;
    let calls=0;
    s.api=async()=>{calls++;throw new Error('ComfyUI offline');};
    const failed=await s.create({prompt:'dog'});
    for(let i=0;i<100&&!failed.finishedAt;i++)await new Promise(r=>setTimeout(r,10));
    assert.equal(failed.status,'failed');assert.match(failed.error,/offline/);
    const hold=await s.compute.acquire();const before=calls;
    const cancelled=await s.create({prompt:'dog'});await s.cancel(cancelled.id);hold();
    for(let i=0;i<100&&!cancelled.finishedAt;i++)await new Promise(r=>setTimeout(r,10));
    assert.equal(cancelled.status,'cancelled');assert.equal(calls,before);
    const release=await s.compute.acquire();release();
  } finally {await rm(dir,{recursive:true,force:true});}
});

test('restart with an unfinished image job blocks new work until recovery',async()=>{
  const dir=await mkdtemp(path.join(tmpdir(),'lumicos-restart-'));
  try {
    const images=path.join(dir,'generated-images');await mkdir(images);
    const id='00000000-0000-0000-0000-000000000001';
    await writeFile(path.join(images,id+'.json'),JSON.stringify({id,status:'running',images:[]}));
    const service=new ComfyService({dataDir:dir});await service.ready;
    assert.ok(service.blocked);assert.equal((await service.get(id)).status,'failed');
    await assert.rejects(service.create({prompt:'dog'}),/รีสตาร์ต/);
    assert.ok(await readFile(path.join(images,'recovery.txt'),'utf8'));
  } finally {await rm(dir,{recursive:true,force:true});}
});

test('gallery lists finished pictures newest first and makes cached thumbnails',async()=>{
  const dir=await mkdtemp(path.join(tmpdir(),'gallery-'));
  try {
    const s=new ComfyService({dataDir:dir});await s.ready;
    const {createCanvas}=await import('@napi-rs/canvas');
    const png=createCanvas(800,600).toBuffer('image/png');
    const mk=async(id,task,createdAt,status='done')=>{
      await writeFile(path.join(s.dir,id+'.json'),JSON.stringify({id,task,status,prompt:'p '+task,width:800,height:600,createdAt,images:[{url:'x',alt:'a',width:800,height:600}]}));
      await writeFile(path.join(s.dir,id+'-0.png'),png);
    };
    const a='11111111-1111-4111-8111-111111111111',b='22222222-2222-4222-8222-222222222222',c='33333333-3333-4333-8333-333333333333';
    await mk(a,undefined,'2026-01-01T00:00:00Z');await mk(b,'edit','2026-01-02T00:00:00Z');await mk(c,'edit','2026-01-03T00:00:00Z','failed');
    const list=await s.gallery();
    assert.deepEqual(list.map(x=>[x.id,x.kind]),[[b,'edit'],[a,'generate']]);
    const t=await s.thumb(a,0);
    assert.equal(t[0],0xff);assert.ok(t.length<png.length);
    assert.ok((await s.thumb(a,0)).equals(t));
    await assert.rejects(s.thumb('../x',0),/not found/i);
  } finally {await rm(dir,{recursive:true,force:true});}
});
