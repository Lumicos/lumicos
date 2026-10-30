import test from 'node:test';
import assert from 'node:assert/strict';
import {SearchV6Service} from '../web/searchV6Service.mjs';
import {rewriteSearchQuery} from '../knowledge/web/queryRewrite.mjs';
import {UnavailableWebSearchProvider} from '../knowledge/web/unavailableProvider.mjs';
import {legacyWebSearchEnabled} from '../service.mjs';
test('legacy v2 is opt-in and unavailable provider cannot emit web evidence',async()=>{
 assert.equal(legacyWebSearchEnabled({}),true);
 assert.equal(legacyWebSearchEnabled({LUMICOS_WEB_SEARCH:'off'}),false);
 const provider=new UnavailableWebSearchProvider();
 assert.deepEqual(await provider.status(),{ready:false,provider:null,label:'Web search is turned off',reason:'disabled',legacyEnabled:false});
 await assert.rejects(provider.search(),e=>e.code==='WEB_SEARCH_UNAVAILABLE'&&e.status===503);
});
test('Thai rewrite preserves named subjects, official source and exact seven-day bounds',()=>{
 const result=rewriteSearchQuery('ค้นหาโมเดล Local AI ที่เปิดตัวในช่วง 7 วันที่ผ่านมา พร้อมลิงก์ Hugging Face',{now:Date.parse('2026-10-09T00:00:00Z')});
 assert.equal(result.original,'ค้นหาโมเดล Local AI ที่เปิดตัวในช่วง 7 วันที่ผ่านมา พร้อมลิงก์ Hugging Face');
 assert.match(result.providerQuery,/models/);assert.match(result.providerQuery,/local AI/);assert.match(result.providerQuery,/site:huggingface\.co/);
 assert.match(result.providerQuery,/after:2026-10-02/);assert.match(result.providerQuery,/before:2026-10-10/);
});
const stub=(sources,counter={n:0})=>{const s=new SearchV6Service();s.call=async(tool,args)=>{counter.n++;counter.last={tool,args};return {ok:true,sources}};return s};
test('search v6 maps research sources to cited results and drops low-relevance ones',async()=>{
 const s=stub([{n:1,title:'Official',url:'https://example.org/a',passage:'Evidence',read:true},{n:2,title:'Off topic',url:'https://x.example/',passage:'?',lowRelevance:true}]);
 const r=await s.search('ราคาทองวันนี้',4);
 assert.equal(r.results.length,1);assert.equal(r.results[0].url,'https://example.org/a');assert.equal(r.results[0].snippet,'Evidence');assert.equal(r.providerDiagnostics.engine,'search-v6');
});
test('search v6 reuses a recent identical query',async()=>{
 const c={n:0};const s=stub([{n:1,title:'A',url:'https://example.org/',passage:'p'}],c);
 const a=await s.search('test',2),b=await s.search('test',2);assert.equal(c.n,1);assert.equal(a.cacheHit,false);assert.equal(b.cacheHit,true);
});
test('search v6 validates input before contacting the network',async()=>{
 const s=new SearchV6Service();s.call=()=>{throw Error('unexpected network')};
 for(const [q,l] of [['',4],['x',9],['x'.repeat(501),4]])await assert.rejects(s.search(q,l),e=>e.status===400);
});
test('search v6 never fabricates evidence when nothing usable comes back',async()=>{
 await assert.rejects(stub([]).search('nothing'),e=>e.status===502);
});
