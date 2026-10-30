import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import vm from 'node:vm';
import {createInstallController,registerInstallWorker} from './install.mjs';
test('manifest has standalone identity/scope and real 192/512 icons',()=>{
 const m=JSON.parse(fs.readFileSync('public/manifest.webmanifest'));assert.equal(m.name,'Lumicos');assert.equal(m.display,'standalone');assert.equal(m.scope,'/');assert.equal(m.start_url,'/');assert.equal(m.id,'/');
 for(const i of m.icons){const b=fs.readFileSync('public'+i.src);const width=b.readUInt32BE(16),height=b.readUInt32BE(20);assert.equal(i.sizes,`${width}x${height}`);assert.equal(width,height)}
 assert.ok(m.icons.some(i=>i.sizes==='192x192'));assert.ok(m.icons.some(i=>i.sizes==='512x512'&&i.purpose==='maskable'));
});
test('install event survives menu mount, prompts once and tracks installed state',async()=>{
 const target=new EventTarget(),c=createInstallController(target);let prompts=0;const e=new Event('beforeinstallprompt',{cancelable:true});e.prompt=async()=>{prompts++};e.userChoice=Promise.resolve({outcome:'accepted'});target.dispatchEvent(e);
 assert.equal(e.defaultPrevented,true);assert.equal(c.getState().available,true);assert.equal(await c.install(),'accepted');assert.equal(prompts,1);assert.equal(await c.install(),'menu');target.dispatchEvent(new Event('appinstalled'));assert.equal(c.getState().installed,true);assert.equal(await c.install(),'installed');c.dispose();
});
test('registration requires secure context; failures do not break application',async()=>{
 let call;const n={serviceWorker:{register:async(...args)=>{call=args}}};assert.equal(await registerInstallWorker(n,false),false);assert.equal(call,undefined);assert.equal(await registerInstallWorker(n,true),true);assert.deepEqual(call,['/sw.js',{scope:'/',updateViaCache:'none'}]);assert.equal(await registerInstallWorker({serviceWorker:{register:async()=>{throw Error('offline')}}},true),false);
});
test('worker leaves API/SSE/audio/assets untouched and only gives navigation offline fallback',async()=>{
 const handlers={};const self={location:{origin:'https://lumicos.test.ts.net'},addEventListener:(n,f)=>handlers[n]=f,skipWaiting(){},clients:{claim:async()=>{}}};
 vm.runInNewContext(fs.readFileSync('public/sw.js','utf8'),{self,URL,Response,fetch:async()=>{throw Error('offline')}});
 for(const [path,mode,method] of [['/api/sync/events','navigate','GET'],['/api/voice/speak','cors','POST'],['/avatars/lumicos-v2.vrm','cors','GET'],['/api/images/jobs/id/images/0','cors','GET'],['/assets/app.js','cors','GET']]){let intercepted=false;handlers.fetch({request:{url:self.location.origin+path,mode,method},respondWith(){intercepted=true}});assert.equal(intercepted,false)}
 let response;handlers.fetch({request:{url:self.location.origin+'/',mode:'navigate',method:'GET'},respondWith:p=>response=p});const r=await response;assert.equal(r.status,503);assert.match(await r.text(),/Tailscale/);assert.equal(r.headers.get('Cache-Control'),'no-store');
});
