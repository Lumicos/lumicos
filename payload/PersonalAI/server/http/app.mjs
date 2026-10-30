// HTTP API of the local service (node:http, no framework).
// Security:
//   - listens on 127.0.0.1 only (config.mjs)
//   - Host header must be this machine (blocks DNS-rebinding)
//   - browser Origin must be the PersonalAI UI (blocks other websites)
//   - every request needs the "X-PersonalAI: 1" header (forces a CORS preflight for cross-site calls)
import { runSelfCheck, runHealthCheck } from '../selfcheck/selfcheck.mjs';
import { saveBugReport, listBugReports } from '../selfcheck/bugReport.mjs';
import path from 'node:path';
import { readFileSync } from 'node:fs';
import fsp from 'node:fs/promises';
import { createBackgroundRemover } from '../comfy/removeBg.mjs';
import { sourceBuildId } from '../util/buildInfo.mjs';
import {imageProfiles} from '../comfy/imageProfiles.mjs';
import { URL } from 'node:url';
import { MEMORY_TYPES } from '../memory/memoryStore.mjs';
import { dedupeCandidates, extractCandidates } from '../memory/candidates.mjs';
import { extractText } from '../files/fileContext.mjs';
import { readXlsx } from '../files/formats/xlsx.mjs';
import { readDocx } from '../files/formats/docx.mjs';

const MAX_BODY = 30 * 1024 * 1024;
export const API_VERSION = 3;
// Computed once when the backend starts: which src/ it was started from, and the package version.
const PROJECT_ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')), '..', '..');
const BUILD_INFO = (() => {
  let version = '';
  try { version = JSON.parse(readFileSync(path.join(PROJECT_ROOT, 'package.json'), 'utf8')).version ?? ''; } catch {}
  return { version, src: sourceBuildId(PROJECT_ROOT), startedAt: new Date().toISOString() };
})();

function send(res, status, body, headers = {}) {
  const isBuf = Buffer.isBuffer(body);
  res.writeHead(status, { 'Content-Type': isBuf ? 'application/octet-stream' : 'application/json; charset=utf-8', 'Cache-Control': 'no-store', ...headers });
  res.end(isBuf ? body : JSON.stringify(body));
}

const fail = (res, err) => {
  const status = err.status && err.status >= 400 && err.status < 600 ? err.status : err.code === 'ENOENT' ? 404 : 400;
  send(res, status, { error: { message: err.message ?? String(err), code: err.code ?? 'ERROR' } });
};

async function readBody(req) {
  const chunks = [];
  let size = 0;
  for await (const c of req) {
    size += c.length;
    if (size > MAX_BODY) throw Object.assign(new Error('Request body too large (max 30 MB).'), { status: 413 });
    chunks.push(c);
  }
  return Buffer.concat(chunks);
}

async function readJson(req) {
  const buf = await readBody(req);
  if (!buf.length) return {};
  try {
    return JSON.parse(buf.toString('utf8'));
  } catch {
    throw Object.assign(new Error('Invalid JSON body.'), { status: 400 });
  }
}

export function createApp({ config, files, ws, memory, retriever, tools, attachments, comfy, models, voice, web, conversations, chats, devices, ownerAuth, sandbox, skills, library }) {
  const allowedHosts = new Set([`127.0.0.1:${config.port}`, `localhost:${config.port}`, `[::1]:${config.port}`]);
  const allowedOrigins = new Set(config.allowedOrigins);

  /** @type {[string, RegExp, (req, res, m: RegExpMatchArray, url: URL) => Promise<void>][]} */
  const routes = [];
  const on = (method, pattern, handler) => routes.push([method, new RegExp(`^${pattern}$`), handler]);

  on('POST','/api/session',async(req,res)=>{const {device}=devices.connect(req,res);send(res,200,{device,transport:req.headers['x-lumicos-gateway']===config.internalToken&&req.headers['x-lumicos-transport']==='tailscale'?'tailscale':'local'});});
  on('GET','/api/owner/status',async(req,res)=>{const status=devices.ownerStatus(req);send(res,200,{...status,configured:ownerAuth.configured,challenge:devices.issueOwnerChallenge(req),canEnroll:!ownerAuth.configured&&status.transport==='local'});});
  on('POST','/api/owner/enroll',async(req,res)=>{const body=await readJson(req);devices.consumeOwnerChallenge(req,body.challenge);const principal=devices.principal(req);if(principal.transport!=='local')throw Object.assign(Error('Owner enrollment is available only from the local Desktop UI'),{status:403,code:'LOCAL_ENROLLMENT_REQUIRED'});await ownerAuth.enroll(body.password);send(res,200,{...devices.elevateOwner(req),configured:true});});
  on('POST','/api/owner/login',async(req,res)=>{const body=await readJson(req);devices.consumeOwnerChallenge(req,body.challenge);devices.assertLoginAllowed(req);if(!await ownerAuth.verify(body.password)){devices.loginFailed(req);throw Object.assign(Error('Owner credentials are invalid'),{status:401,code:'OWNER_LOGIN_FAILED'})}send(res,200,{...devices.elevateOwner(req),configured:true});});
  on('POST','/api/owner/logout',async(req,res)=>{const body=await readJson(req);devices.authorizeOwnerMutation(req,'owner.logout',body.nonce);devices.logoutOwner(req);send(res,200,{ok:true,role:'agent'});});
  on('GET','/api/sandbox/status',async(req,res)=>{devices.identify(req);send(res,200,{...sandbox.status(),skills:skills.list()});});
  on('GET','/api/sync',async(req,res)=>{devices.identify(req);send(res,200,{...conversations.snapshot(),callOwner:devices.callOwner});});
  on('POST','/api/sync/migrate',async(req,res)=>{devices.identify(req);send(res,200,await conversations.migrate(await readJson(req)));});
  on('POST','/api/sync/transaction',async(req,res)=>{devices.identify(req);send(res,200,await conversations.transaction(await readJson(req)));});
  on('GET','/api/sync/events',async(req,res)=>{
    devices.identify(req);res.writeHead(200,{'Content-Type':'text/event-stream','Cache-Control':'no-store','X-Accel-Buffering':'no'});
    const emit=e=>{if(res.writableLength>1024*1024){res.destroy();return;}res.write(`data: ${JSON.stringify(e)}\n\n`)};
    const changed=e=>emit(e);conversations.on('change',changed);
    emit({type:'snapshot',state:conversations.snapshot(),revision:conversations.state.revision,callOwner:devices.callOwner});
    const heartbeat=setInterval(()=>res.write(': heartbeat\n\n'),20000);heartbeat.unref();
    res.on('close',()=>{clearInterval(heartbeat);conversations.off('change',changed)});
  });
  on('POST','/api/chat/submit',async(req,res)=>{devices.identify(req);send(res,202,await chats.submit(await readJson(req),devices.principal(req)));});
  on('POST','/api/chat/cancel',async(req,res)=>{devices.identify(req);chats.cancel((await readJson(req)).id);send(res,200,{ok:true});});
  on('POST','/api/chat/approve',async(req,res)=>{devices.identify(req);const b=await readJson(req);chats.approve(b.id,b.allow===true);send(res,200,{ok:true});});

  on('POST','/api/voice/call/start',async(req,res)=>{
    const device=devices.identify(req);devices.assertOwner(device);if(devices.callOwner)throw Object.assign(Error('Call already active'),{status:409});
    devices.callOwner=device;conversations.changed({type:'call',owner:device},false);
    const c=new AbortController();res.on('close',()=>c.abort());
    try{send(res,200,await voice.startCall(c.signal));}catch(e){devices.callOwner=null;conversations.changed({type:'call',owner:null},false);throw e;}
  });
  on('POST','/api/voice/call/timing',async(req,res)=>{await voice.recordCallTiming(await readJson(req));send(res,200,{ok:true});});
  on('POST','/api/voice/call/heartbeat',async(req,res)=>{voice.touchCall((await readJson(req)).id);send(res,200,{ok:true});});
  on('POST','/api/voice/call/end',async(req,res)=>{await voice.endCall((await readJson(req)).id);send(res,200,{ok:true});});
  on('GET','/api/voice/status',async(_req,res)=>send(res,200,await voice.status()));
  on('GET','/api/voice/engines',async(_req,res)=>send(res,200,await voice.engineStatus()));
  on('POST','/api/voice/engines',async(req,res)=>send(res,200,await voice.setEngines(await readJson(req))));
  on('GET','/api/web/status',async(_req,res)=>send(res,200,await web.status()));
  on('GET','/api/voice/fast-status',async(_req,res)=>send(res,200,await voice.fastStatus()));
  on('POST','/api/voice/speak',async(req,res)=>{
    const controller=new AbortController();res.on('close',()=>controller.abort());
    const body=await readJson(req);
    if(body.avatarTest!==undefined&&body.engine)throw Object.assign(Error('Avatar test uses the default voice engine'),{status:400});
    if(body.stream){
      res.writeHead(200,{'Content-Type':'application/x-ndjson','Cache-Control':'no-store'});
      try{const emit=event=>res.write(JSON.stringify(event)+'\n');const result=body.engine==='vachana'?await voice.speakFast(body.text,controller.signal,emit):await voice.task('tts',body.text,controller.signal,emit,body.callId,body.avatarTest);res.end(JSON.stringify({type:'done',elapsedMs:result.elapsedMs,firstAudioMs:result.firstAudioMs,metrics:result.metrics})+'\n');}
      catch(e){if(!controller.signal.aborted)console.error('[voice] speak failed:',e?.message??e);if(!res.destroyed)res.end(JSON.stringify({type:'error',error:e.message})+'\n');}
    }else{
      const result=await voice.task('tts',body.text,controller.signal,undefined,body.callId,body.avatarTest);
      send(res,200,result.audio,{'Content-Type':'audio/wav','X-Lumicos-Voice-Ms':String(result.elapsedMs)});
    }
  });
  on('POST','/api/voice/transcribe',async(req,res)=>{
    const controller=new AbortController();res.on('close',()=>controller.abort());
    send(res,200,await voice.task('stt',await readBody(req),controller.signal,undefined,req.headers['x-lumicos-call']));
  });
  /* ---------------- local image generation ---------------- */
  on('POST', '/api/images/inputs', async (req,res) => send(res,201,await comfy.upload(await readBody(req))));
  on('GET', '/api/images/inputs/([0-9a-f-]{36})', async (_req,res,m) => send(res,200,await comfy.input(m[1]),{'Content-Type':'image/png'}));
  on('GET','/api/images/profiles',async(_req,res)=>send(res,200,await imageProfiles()));
  on('GET','/api/images/preferences',async(_req,res)=>send(res,200,comfy.preferences));
    on('POST','/api/images/preferences',async(req,res)=>send(res,200,await comfy.setPreferences(await readJson(req))));
    on('GET', '/api/images/status', async (_req,res) => send(res,200,await comfy.status()));
  on('POST', '/api/images/jobs', async (req,res) => send(res,202,await comfy.create(await readJson(req))));
  on('GET', '/api/images/jobs/([0-9a-f-]{36})', async (_req,res,m) => send(res,200,await comfy.get(m[1])));
  on('POST','/api/images/upscale',async(req,res)=>{const b=await readJson(req);send(res,202,await comfy.upscaleInput(String(b.inputId??''),Number(b.scale)))});
  on('POST','/api/images/jobs/([0-9a-f-]{36})/upscale',async(req,res,m)=>send(res,202,await comfy.upscaleSaved(m[1],(await readJson(req)).target)));
    // Image Lab keeps ComfyUI started while the page is open (passive: does not count as use for idle auto-stop).
    on('POST', '/api/images/warm', async (_req,res) => send(res,202,comfy.warm()));
    on('POST', '/api/images/jobs/([0-9a-f-]{36})/cancel', async (_req,res,m) => send(res,200,await comfy.cancel(m[1])));
  // Background removal (ISNet on CPU): POST image bytes, get a transparent PNG back.
  const bgRemover = createBackgroundRemover({ dataDir: config.dataDir });
  on('POST', '/api/images/remove-bg', async (req,res) => send(res,200,await bgRemover.remove(await readBody(req)),{'Content-Type':'image/png'}));
  // Image Lab template covers: one small JPEG per template, rendered once and kept in data/lab-covers.
  on('GET', '/api/images/lab-cover/([a-z0-9-]{1,40})', async (_req,res,m) => {
    let buf; try { buf=await fsp.readFile(path.join(config.dataDir,'lab-covers',m[1]+'.jpg')); } catch { return send(res,404,{error:{message:'No cover yet.'}}); }
    send(res,200,buf,{'Content-Type':'image/jpeg','Cache-Control':'private, max-age=600'});
  });
  on('PUT', '/api/images/lab-cover/([a-z0-9-]{1,40})', async (req,res,m) => {
    const buf=await readBody(req);
    if(buf.length<500||buf.length>3_000_000||buf[0]!==0xff||buf[1]!==0xd8) throw Object.assign(new Error('Cover must be a JPEG under 3 MB.'),{status:400});
    await fsp.mkdir(path.join(config.dataDir,'lab-covers'),{recursive:true});
    await fsp.writeFile(path.join(config.dataDir,'lab-covers',m[1]+'.jpg'),buf);
    send(res,200,{ok:true});
  });
  on('GET', '/api/images/gallery', async (_req,res) => send(res,200,await comfy.gallery()));
  on('GET', '/api/images/thumb/([0-9a-f-]{36})/([0-9]+)', async (_req,res,m) => send(res,200,await comfy.thumb(m[1],Number(m[2])),{'Content-Type':'image/jpeg','Cache-Control':'private, max-age=86400'}));
  on('GET', '/api/images/jobs/([0-9a-f-]{36})/images/([0-9]+)', async (_req,res,m) => send(res,200,await comfy.image(m[1],Number(m[2])),{'Content-Type':'image/png'}));
  on('DELETE', '/api/images/jobs/([0-9a-f-]{36})/images/([0-9]+)', async (_req,res,m) => {
    const url=`/api/images/jobs/${m[1]}/images/${m[2]}`;
    await comfy.deleteImage(m[1],Number(m[2]));
    // Remove the picture from every chat that shows it, so gallery and chats stay in sync.
    let removed=0;
    for(const c of conversations.state.conversations){
      if(!c.messages.some(msg=>msg.parts?.some(p=>p.type==='image'&&p.url===url)))continue;
      conversations.patch(c.id,conv=>({...conv,messages:conv.messages.map(msg=>{
        if(!msg.parts?.some(p=>p.type==='image'&&p.url===url))return msg;
        const parts=msg.parts.filter(p=>!(p.type==='image'&&p.url===url));removed++;
        return {...msg,parts:parts.length?parts:[{type:'text',text:'(ลบภาพนี้แล้ว)'}]};
      })}));
    }
    await conversations.persist();
    send(res,200,{ok:true,removed});
  });
  on('POST', '/api/images/recover', async (_req,res) => send(res,200,await comfy.recover()));
  on('POST', '/api/inference', async (req,res) => {const b=await readJson(req);assertTurn(req,b.turnId);return comfy.inference(req,res,b)});

  const owner=req=>req.headers['x-lumicos-internal']===config.internalToken?'internal':devices.identify(req);
  const assertTurn=(req,id)=>{if(models.turns.get(id)?.device!==owner(req))throw Object.assign(Error('Turn belongs to another device'),{status:403});};
  on('GET','/api/models',async(req,res)=>{
    const state=await models.status();
    if(req.headers['x-lumicos-transport']==='tailscale'){
      const profile=p=>p?{id:p.id,name:p.name,ctx:p.ctx,capabilities:p.capabilities,generation:p.generation,path:p.path,available:p.available}:null;
      // Phone/Tailscale gets the same model list as the PC (new .gguf files included); only folder settings stay PC-only.
      return send(res,200,{phase:state.phase,busy:state.busy,activeTurns:state.activeTurns,profile:profile(state.profile),profiles:state.profiles?.map(profile),primaryId:state.primaryId,visionLoaded:state.visionLoaded,
        discovered:(state.discovered??[]).map(f=>({name:f.name,path:f.path,folder:f.folder,size:f.size,architecture:f.architecture})),modelDirs:[]});
    }send(res,200,state);
  });
  on('POST','/api/models/start',async(_req,res)=>send(res,200,await models.start()));
  on('POST','/api/models/switch',async(req,res)=>{
    const body=await readJson(req);
    // {id} = a saved profile, {path} = a .gguf found in a model folder (registered automatically).
    let id=body.id;
    if(!id&&typeof body.path==='string'&&body.path)id=(await models.addFromFile(body.path)).id;
    if(typeof id!=='string'||!id)throw Object.assign(Error('Model id or path is required'),{status:400});
    await models.switch(id,{primary:true});
    send(res,200,await models.status());
  });
  on('POST','/api/models/refresh',async(_req,res)=>send(res,200,await models.refresh()));
  on('POST','/api/models/add',async(req,res)=>{const body=await readJson(req);await models.addFromFile(body.path);send(res,200,await models.refresh());});
  on('POST','/api/models/remove',async(req,res)=>{const body=await readJson(req);if(typeof body.id!=='string')throw Object.assign(Error('Model id is required'),{status:400});await models.remove(body.id);send(res,200,await models.refresh());});
  on('POST','/api/models/profile',async(req,res)=>{devices.assertOwner(devices.identify(req));const b=await readJson(req);const cur=models.store.get().models.find(m=>m.id===b.id);if(!cur)throw Object.assign(Error('Model profile not found'),{status:404});const next={...cur};if(b.ctx!==undefined){const ctx=Number(b.ctx);if(!Number.isInteger(ctx)||ctx<2048||ctx>65536)throw Object.assign(Error('ctx must be an integer between 2048 and 65536'),{status:400});next.ctx=ctx}if(b.name!==undefined){if(typeof b.name!=='string'||!b.name.trim()||b.name.length>80)throw Object.assign(Error('name must be 1-80 characters'),{status:400});next.name=b.name.trim()}await models.save(next);send(res,200,await models.status());});
  // "แจ้งบั๊ก" button on a chat reply: one file in data/bug-reports with the turn's messages, tools and log timeline.
  on('POST','/api/bug-reports',async(req,res)=>{devices.identify(req);const b=await readJson(req);send(res,200,await saveBugReport({dataDir:config.dataDir,replyId:b.replyId,note:typeof b.note==='string'?b.note:'',replyText:typeof b.replyText==='string'?b.replyText.slice(0,8000):'',build:BUILD_INFO}));});
  on('GET','/api/bug-reports',async(req,res)=>{devices.identify(req);send(res,200,{reports:listBugReports(config.dataDir)});});
  on('POST','/api/selfcheck',async(req,res)=>{if(req.headers['x-lumicos-transport']==='tailscale')throw Object.assign(Error('Run the self check on the PC itself'),{status:403});devices.assertOwner(devices.identify(req));const b=await readJson(req).catch(()=>({}));send(res,200,b.mode==='health'?await runHealthCheck({models,logsDir:path.join(config.dataDir,'logs'),modelId:typeof b.modelId==='string'?b.modelId:undefined}):await runSelfCheck({models,root:PROJECT_ROOT,logsDir:path.join(config.dataDir,'logs'),modelId:typeof b.modelId==='string'?b.modelId:undefined,files:Array.isArray(b.files)?b.files.filter(f=>typeof f==='string'):undefined}));});
  on('POST','/api/models/folders',async(req,res)=>{if(req.headers['x-lumicos-transport']==='tailscale')throw Object.assign(Error('Change model folders on the PC itself'),{status:403});const body=await readJson(req);await models.folders(body.modelDirs);send(res,200,await models.refresh());});
  on('POST','/api/models/turn',async(req,res)=>{const b=await readJson(req),device=owner(req);if(b.mode==='call')devices.assertOwner(device);const turn=await models.begin(b.required??[],b.mode??'chat',b.callId);models.turns.get(turn.id).device=device;send(res,200,turn);});
  on('POST','/api/models/turn/heartbeat',async(req,res)=>{const id=(await readJson(req)).id;assertTurn(req,id);models.touch(id);send(res,200,{ok:true});});
  on('POST','/api/models/turn/end',async(req,res)=>{const id=(await readJson(req)).id;assertTurn(req,id);await models.end(id);send(res,200,{ok:true});});
  /* ---------------- knowledge (RAG: files in workspace/knowledge) ---------------- */
  on('GET','/api/knowledge/status',async(_req,res)=>send(res,200,library?library.status():{documents:[]}));
  on('POST','/api/knowledge/sync',async(_req,res)=>{if(!library)throw Object.assign(Error('Knowledge library unavailable'),{status:503});const summary=await library.sync();send(res,200,{...summary,...library.status()});});
  on('POST','/api/knowledge/learn',async(req,res)=>{if(!library)throw Object.assign(Error('Knowledge library unavailable'),{status:503});const b=await readJson(req);send(res,200,await library.learn({question:b.question,answer:b.answer,sources:b.sources,confirmed:b.confirmed!==false}));});
  on('POST','/api/knowledge/search',async(req,res)=>{const b=await readJson(req);if(typeof b.query!=='string'||!b.query.trim())throw Object.assign(Error('query is required'),{status:400});const hits=library?await library.search(b.query,{limit:4}):[];send(res,200,{hits:hits.map(h=>({file:h.displayName,heading:h.heading,similarity:Number(h.similarity.toFixed(3)),keywordScore:Number(h.keywordScore.toFixed(2)),content:h.content}))});});
  /* ---------------- health ---------------- */
  on('GET', '/api/health', async (req, res) => {
    const remote=req.headers['x-lumicos-transport']==='tailscale';
    send(res, 200, { ok: true, version: API_VERSION, build: BUILD_INFO, workspace: remote?'Host workspace':ws.root, dataDir: remote?'Host data':config.dataDir, tools: tools.definitions().length, autoStartComfy: comfy.autoStartComfy });
  });

  /* ---------------- files (user actions from the Workspace UI) ---------------- */
  on('GET', '/api/files/list', async (_req, res, _m, url) => {
    send(res, 200, await files.list(url.searchParams.get('path') ?? '', { recursive: url.searchParams.get('recursive') === '1' }));
  });
  on('GET', '/api/files/stat', async (_req, res, _m, url) => send(res, 200, await files.stat(url.searchParams.get('path') ?? '')));
  on('GET', '/api/files/preview', async (_req, res, _m, url) => {
    const p = url.searchParams.get('path') ?? '';
    const st = await files.stat(p);
    const buf = await files.readBytes(p);
    if (st.type === 'xlsx') return send(res, 200, { stat: st, kind: 'xlsx', workbook: await readXlsx(buf, { maxRows: 300 }) });
    if (st.type === 'docx') return send(res, 200, { stat: st, kind: 'docx', ...(await readDocx(buf)) });
    if (['text', 'markdown', 'csv', 'json'].includes(st.type)) {
      const ex = await extractText(st.name, buf);
      return send(res, 200, { stat: st, kind: ex.kind, text: buf.toString('utf8').slice(0, 400_000), rows: ex.structured?.rows?.slice(0, 500) });
    }
    send(res, 200, { stat: st, kind: 'unsupported' });
  });
  on('GET', '/api/files/download', async (_req, res, _m, url) => {
    const p = url.searchParams.get('path') ?? '';
    const buf = await files.readBytes(p);
    send(res, 200, buf, { 'Content-Disposition': `attachment; filename*=UTF-8''${encodeURIComponent(path.basename(p))}` });
  });
  on('PUT', '/api/files/upload', async (req, res, _m, url) => {
    const p = url.searchParams.get('path') ?? '';
    send(res, 200, await files.write(p, await readBody(req), { mode: 'create' }));
  });
  on('POST', '/api/files/mkdir', async (req, res) => send(res, 200, await files.mkdir((await readJson(req)).path)));
  on('POST', '/api/files/rename', async (req, res) => {
    const b = await readJson(req);
    send(res, 200, await files.rename(b.path, b.newName));
  });
  on('POST', '/api/files/move', async (req, res) => {
    const b = await readJson(req);
    send(res, 200, await files.move(b.path, b.to));
  });
  on('POST', '/api/files/copy', async (req, res) => {
    const b = await readJson(req);
    send(res, 200, await files.copy(b.path, b.to));
  });
  on('POST', '/api/files/delete', async (req, res) => {
    const b = await readJson(req);
    if (b.confirm !== true) throw Object.assign(new Error('Deleting needs { "confirm": true } from the confirmation dialog.'), { status: 400, code: 'CONFIRM_REQUIRED' });
    send(res, 200, await files.remove(b.path));
  });

  /* ---------------- tools (requests coming from the model) ---------------- */
  on('GET', '/api/tools', async (_req, res) => send(res, 200, { tools: tools.definitions() }));
  on('POST', '/api/tools/validate', async (req, res) => {
    const b = await readJson(req);
    send(res, 200, await tools.validate(b.name, b.args ?? {}));
  });
  on('POST', '/api/tools/execute', async (req, res) => {
    const b = await readJson(req);
    const controller=new AbortController();
    const internalTurn=req.headers['x-lumicos-internal']===config.internalToken?req.headers['x-lumicos-turn']:null;
    if(typeof internalTurn==='string'&&models?.turns?.has(internalTurn))controller.signal.lumicosTurnId=internalTurn;
    if(req.headers['x-lumicos-internal']===config.internalToken){
      const subject=req.headers['x-lumicos-principal-subject'],role=req.headers['x-lumicos-principal-role'];
      if(typeof subject==='string'&&subject.length===64&&['owner','agent','developer'].includes(role))controller.signal.lumicosPrincipal={subject,role};
    }
    const disconnect=()=>{if(!res.writableEnded)controller.abort()};
    res.once('close',disconnect);
    try{send(res, 200, await tools.execute(b.name, b.args ?? {}, b.approvalId,controller.signal));}
    finally{res.removeListener('close',disconnect)}
  });

  /* ---------------- memory ---------------- */
  on('GET', '/api/memory', async (_req, res, _m, url) => {
    let list = await memory.list();
    const q = (url.searchParams.get('q') ?? '').toLowerCase().trim();
    const type = url.searchParams.get('type');
    const characterId = url.searchParams.get('characterId');
    if (q) list = list.filter((m) => m.content.toLowerCase().includes(q) || m.tags.some((t) => t.includes(q)));
    if (type) list = list.filter((m) => m.type === type);
    if (characterId === 'shared') list = list.filter((m) => !m.characterId);
    else if (characterId) list = list.filter((m) => m.characterId === characterId);
    list.sort((a, b) => Number(b.pinned) - Number(a.pinned) || b.updatedAt.localeCompare(a.updatedAt));
    send(res, 200, { memories: list, types: MEMORY_TYPES });
  });
  on('POST', '/api/memory', async (req, res) => send(res, 201, await memory.create(await readJson(req))));
  on('PATCH', '/api/memory/([0-9a-f-]{36})', async (req, res, m) => send(res, 200, await memory.update(m[1], await readJson(req))));
  on('DELETE', '/api/memory/([0-9a-f-]{36})', async (_req, res, m) => send(res, 200, await memory.remove(m[1])));
  on('POST', '/api/memory/retrieve', async (req, res) => {
    const b = await readJson(req);
    const found = await retriever.retrieve({ query: b.query ?? '', characterId: b.characterId ?? null, limit: Math.min(12, b.limit ?? 6) });
    if (found.length && b.markUsed !== false) await memory.markUsed(found.map((f) => f.memory.id));
    send(res, 200, { memories: found });
  });
  on('POST', '/api/memory/candidates', async (req, res) => {
    const b = await readJson(req);
    send(res, 200, { candidates: extractCandidates(b.text ?? '', { existing: await memory.list(), pending: b.pending ?? [] }) });
  });
  on('POST', '/api/memory/dedupe', async (req, res) => {
    const b = await readJson(req);
    send(res, 200, { candidates: dedupeCandidates(b.candidates ?? [], { existing: await memory.list() }) });
  });

  /* ---------------- attachments ---------------- */
  on('POST', '/api/attachments', async (req, res, _m, url) => send(res, 201, await attachments.add(url.searchParams.get('name') ?? 'file', await readBody(req))));
  on('GET', '/api/attachments/([0-9a-f-]{36})/pdf/pages/([0-9]+)', async (_req, res, m) => {
    const page = Number(m[2]);
    const result = await attachments.renderPdfPage(m[1], page);

    send(res, 200, {
      page: result.page,
      totalPages: result.totalPages,
      width: result.width,
      height: result.height,
      image: `data:image/png;base64,${result.png.toString('base64')}`,
    });
  });

  on('GET', '/api/attachments/usage', async (_req, res) => send(res, 200, await attachments.usage()));
  on('DELETE', '/api/attachments', async (_req, res) => send(res, 200, await attachments.clear()));

  /* ---------------- dispatcher ---------------- */
  return async function handle(req, res) {
    const origin = req.headers.origin;
    const corsHeaders = origin && allowedOrigins.has(origin)
      ? { 'Access-Control-Allow-Origin': origin, 'Access-Control-Allow-Headers': 'content-type, x-personalai', 'Access-Control-Allow-Methods': 'GET, POST, PUT, PATCH, DELETE', Vary: 'Origin' }
      : {};
    for (const [k, v] of Object.entries(corsHeaders)) res.setHeader(k, v);

    try {
      const internal=req.headers['x-lumicos-internal']===config.internalToken;
      const viaGateway=req.headers['x-lumicos-gateway']===config.internalToken;
      if(!viaGateway){delete req.headers['x-lumicos-transport'];delete req.headers['x-lumicos-remote'];}
      if (!allowedHosts.has(String(req.headers.host ?? ''))) return send(res, 421, { error: { message: 'Unexpected Host header.', code: 'BAD_HOST' } });
      if (origin && !allowedOrigins.has(origin)) return send(res, 403, { error: { message: `Origin ${origin} is not allowed.`, code: 'BAD_ORIGIN' } });
      if (req.method === 'OPTIONS') return send(res, 204, '');
      if (req.headers['x-personalai'] !== '1') return send(res, 403, { error: { message: 'Missing X-PersonalAI header.', code: 'NO_CLIENT_HEADER' } });

      const url = new URL(req.url ?? '/', `http://${req.headers.host}`);
      if(!internal&&url.pathname.startsWith('/api/voice/')&&url.pathname!=='/api/voice/call/start'&&req.method==='POST')devices.assertOwner(devices.identify(req));
      if(viaGateway&&url.pathname!=='/api/session')devices.identify(req);
      for (const [method, re, handler] of routes) {
        const m = url.pathname.match(re);
        if (m && method === req.method) return await handler(req, res, m, url);
      }
      send(res, 404, { error: { message: `No route for ${req.method} ${url.pathname}`, code: 'NOT_FOUND' } });
    } catch (err) {
      if (!(err.status < 500)) console.error('[api]', req.method, req.url, err);
      if (res.headersSent) res.destroy(); else if (!res.destroyed) fail(res, err);
    }
  };
}
