import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import {stripTypeScriptTypes} from 'node:module';
const source=await fs.readFile(new URL('../payload/PersonalAI/src/config/defaults.ts',import.meta.url),'utf8');
const js=stripTypeScriptTypes(source).replace('import.meta.env.VITE_ENABLE_MOCK','false');
const defaults=await import('data:text/javascript;base64,'+Buffer.from(js).toString('base64'));
test('Nova is the sole seeded assistant and legacy default resolves to Nova',()=>{
 assert.equal(defaults.DEFAULT_ASSISTANT.name,'Nova');assert.equal(defaults.DEFAULT_CHARACTER.id,defaults.ASSISTANT_ID);
 assert.equal(defaults.DEFAULT_SETTINGS.activeCharacterId,defaults.ASSISTANT_ID);
});
test('loading old character state always resolves to Nova',async()=>{
 const text=(await fs.readFile(new URL('../payload/PersonalAI/src/storage/storageService.ts',import.meta.url),'utf8')).replaceAll('\r\n','\n');
 const fn=text.slice(text.indexOf('export function ensureBuiltinCharacters'),text.indexOf('\n}\n',text.indexOf('export function ensureBuiltinCharacters'))+2);
 const load=new Function('ASSISTANT_ID','DEFAULT_ASSISTANT',stripTypeScriptTypes(fn).replace('export ','')+';return ensureBuiltinCharacters;')(defaults.ASSISTANT_ID,defaults.DEFAULT_ASSISTANT);
 const result=load([{id:'default-mina',name:'Old assistant'},{id:'old-character',name:'Old character'}]);
 assert.deepEqual(result.map(c=>c.name),['Nova']);assert.deepEqual(load([]).map(c=>c.name),['Nova']);
});
test('private avatar, physical identity and persona are absent from public payload',async()=>{
 const files=JSON.parse(await fs.readFile(new URL('../catalog/payload.json',import.meta.url)));
 for(const f of files)assert.doesNotMatch(f.path,/public\/avatar\/|AvatarPage\.tsx|lumicos-master-identity\.json/);
 const identity=await import('../payload/PersonalAI/src/identity/lumicosIdentity.mjs');assert.equal(identity.canonicalIdentityContext(),'');assert.equal(identity.isLumicosCharacter({id:'default-mina'}),false);
 const persona=await import('../payload/PersonalAI/src/prompt/lumicosPersona.mjs');assert.equal(persona.LUMICOS_PERSONA,'');assert.match(persona.PHONE_STYLE,/Nova/);
});
