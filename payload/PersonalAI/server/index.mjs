import { stopOwnedComfy } from '../scripts/runtime.mjs';
// PersonalAI local service: memory, workspace files and tools.
// Start with:  npm run service   (or start-personalai.bat)
import http from 'node:http';
import { loadConfig } from './config.mjs';
import { createServices } from './service.mjs';
import { startGateway } from './http/remoteGateway.mjs';
import { PROJECT_ROOT } from './config.mjs';
import { createIdleShutdown, idleMinutesFromEnv, runStopScript } from './idleShutdown.mjs';
import { startDataSnapshots } from './util/dataSnapshot.mjs';

const config = loadConfig();
config.projectRoot=PROJECT_ROOT;
const { handler, ws, memory, models, voice, web,knowledge,conversations,chats,library } = createServices(config);
const gateway=startGateway(config);

// Idle auto-stop (default 30 min, LUMICOS_IDLE_STOP_MINUTES=0 turns it off). Never while a chat turn or image job is running.
const idle = createIdleShutdown({
  minutes: idleMinutesFromEnv(),
  isBusy: () => models.busy || [...models.turns.values()].some(t => Date.now() - t.touched < 120000)
    || !!(models.comfy?.compute?.active || models.comfy?.compute?.waiting)
    || !!chats.agent?.busy?.(), // a background agent job (research, file summary, scheduled run) finishes first
  onIdle: () => runStopScript(PROJECT_ROOT, () => void shutdown()),
});
const server = http.createServer(idle.wrap(handler));
server.on('error', (err) => {
  if (err.code === 'EADDRINUSE') {
    console.error(`\n[PersonalAI service] Port ${config.port} is already in use. Is the service already running?`);
    console.error('Change it with PERSONALAI_PORT or "port" in personalai.config.json (and the Vite proxy in vite.config.ts).\n');
  } else console.error(err);
  process.exit(1);
});

server.listen(config.port, config.host, async () => {
  const count = (await memory.list()).length;
  console.log('');
  console.log('  PersonalAI local service');
  console.log(`  API        http://${config.host}:${config.port}/api  (this PC only)`);
  console.log(`  Workspace  ${ws.root}`);
  console.log(`  Data       ${config.dataDir}  (memory.json, backups, attachments)`);
  console.log(`  Memories   ${count}`);
  idle.start();
  // Daily snapshot of chats/characters/memory/roleplay/knowledge/skills (data/snapshots, newest 14 kept).
  startDataSnapshots({ dataDir: config.dataDir, workspaceDir: ws.root });
  console.log('');
  // Index workspace/knowledge in the background, then keep watching it for new files.
  void library.sync().then(s=>console.log(`[knowledge] ready: ${library.status().documents.length} document(s)${s.failed?`, ${s.failed} failed`:''}`)).catch(e=>console.warn('[knowledge] sync failed:',e.message)).finally(()=>library.watch());
  if(process.env.LUMICOS_SKIP_VOICE_PRELOAD!=='1')void voice.preload().catch(()=>console.warn('Voice preload unavailable; retry when speech is requested.'));
  else setTimeout(()=>void voice.preloadCpu(),15000).unref();
});

const shutdown = async () => {
  chats.close();await conversations.close();gateway.close();
  voice.close();
  await web.close();
  await knowledge.close();
  models.manager.killOwnedSync();
  stopOwnedComfy();
  await memory.flush();
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(0), 1000).unref();
};
process.on('exit',()=>{voice.close();models.manager.killOwnedSync();stopOwnedComfy()});
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
