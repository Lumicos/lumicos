// Wires the services together. Used by index.mjs and by the tests.
import fs from 'node:fs';
import { VoiceService } from './voice/voiceService.mjs';
import { SearchV6Service } from './web/searchV6Service.mjs';
import { ModelService } from './llama/modelService.mjs';
import { ComfyService } from './comfy/comfyService.mjs';
import path from 'node:path';
import { AttachmentService } from './attachments/attachmentService.mjs';
import { DEFAULT_FOLDERS } from './config.mjs';
import { FileService } from './files/fileService.mjs';
import { Workspace } from './files/paths.mjs';
import { createApp } from './http/app.mjs';
import { JsonMemoryStore } from './memory/memoryStore.mjs';
import { KeywordMemoryRetriever } from './memory/retriever.mjs';
import { fileTools } from './tools/fileTools.mjs';
import { ToolRegistry } from './tools/registry.mjs';
import { imageTools } from './tools/imageTools.mjs';
import { randomUUID } from 'node:crypto';
import { ConversationStore } from './chat/conversationStore.mjs';
import { ChatService } from './chat/chatService.mjs';
import { DeviceSessions } from './chat/deviceSessions.mjs';
import { createKnowledgeChatIntegration } from './knowledge/chat/factory.mjs';
import { KnowledgeLibrary } from './knowledge/library.mjs';
import { ExistingWebSearchProvider } from './knowledge/web/existingProvider.mjs';
import { KnowledgeWebGateway } from './knowledge/web/gateway.mjs';
import { UnavailableWebSearchProvider } from './knowledge/web/unavailableProvider.mjs';
import { webTools } from './knowledge/web/tool.mjs';
import { OwnerCredentialStore } from './security/ownerAuth.mjs';
import { SandboxService } from './sandbox/sandboxService.mjs';
import { sandboxTools, SkillStore } from './tools/sandboxTools.mjs';
import { AgentService } from './agent/agentService.mjs';

// Web search is ON by default (Lumicos Search v6 beside the install root). Set LUMICOS_WEB_SEARCH=off to disable.
export const legacyWebSearchEnabled = (env=process.env) => env.LUMICOS_WEB_SEARCH !== 'off';
// Image Lab / Z-Image: installer writes LUMICOS_IMAGES=off when the user declines image models (or hardware cannot run them).
export const imagesEnabled = (env=process.env) => env.LUMICOS_IMAGES !== 'off';

export function createServices(config) {
  config.internalToken=randomUUID();
  fs.mkdirSync(config.dataDir, { recursive: true });
  const ws = new Workspace(config.workspaceDir);
  for (const f of DEFAULT_FOLDERS) fs.mkdirSync(path.join(ws.root, f), { recursive: true });

  const files = new FileService(ws, path.join(config.dataDir, 'backups'));
  const memory = new JsonMemoryStore(path.join(config.dataDir, 'memory.json'));
  const retriever = new KeywordMemoryRetriever(memory);
  // Agents split (2026-10-16): every memory that was shared before now belongs to Lumicos; new memories belong to the agent they were made with.
  const splitMarker = path.join(config.dataDir, 'memory-agents-split.done');
  if (!fs.existsSync(splitMarker)) {
    try {
      const file = path.join(config.dataDir, 'memory.json');
      if (fs.existsSync(file)) fs.copyFileSync(file, file + '.before-agent-split');
      void memory.assignUnscoped('default-mina').then((n) => { fs.writeFileSync(splitMarker, new Date().toISOString()); console.info(`[memory] agent split: ${n} shared memories assigned to Lumicos`); })
        .catch((e) => console.error('[memory] agent split failed:', e.message));
    } catch (e) { console.error('[memory] agent split skipped:', e.message); }
  }
  const attachments = new AttachmentService(path.join(config.dataDir, 'attachments'));
  const tools = new ToolRegistry({ files, ws, attachments, memory });
  for (const t of fileTools()) tools.register(t);
  const legacySearch = legacyWebSearchEnabled() ? new SearchV6Service({ logFile: path.join(config.dataDir, 'logs', 'search-v6.log') }) : null;
  const web = legacySearch ? new ExistingWebSearchProvider(legacySearch) : new UnavailableWebSearchProvider();
  // Search v6 performs multi-page research; ten seconds was routinely aborting valid searches.
  const webGateway = new KnowledgeWebGateway(web, { timeoutMs: 25000 });
  if(legacySearch)for(const t of webTools(webGateway))tools.register(t);
  // Sandbox: Lumicos runs her own Python (AppContainer) and keeps reusable skills in workspace/skills.
  const sandbox = new SandboxService({ workspaceRoot: ws.root });
  const skills = new SkillStore(ws.root);
  for (const t of sandboxTools(sandbox, skills)) tools.register(t);

  const comfy = new ComfyService(config);
  if (imagesEnabled()) for (const t of imageTools(comfy)) tools.register(t);
  const models = new ModelService(config,comfy);
  comfy.models = models;
  const voice = new VoiceService(comfy,models);
  comfy.beforeGpu = ()=>voice.releaseGpu();
  comfy.beforeChat = ()=>voice.releaseForChat();
  comfy.beforeModelLoad = ()=>voice.releaseForChat(); // keeps a resident voice; frees a non-resident one
  // Warm the resident voice at boot, before the launcher loads Gemma (both take the GPU lock in turn),
  // so the wait happens during startup instead of stalling the first chat message.
  setTimeout(()=>void voice.warmResident().catch(()=>{}),500).unref?.();
  const conversations=new ConversationStore(path.join(config.dataDir,'conversations.json'));
  const library=new KnowledgeLibrary({dataDir:config.dataDir,folder:path.join(ws.root,'knowledge')});
  const knowledge=createKnowledgeChatIntegration({config,memoryRetriever:retriever,webGateway,library});
  const devices=new DeviceSessions();
  const ownerAuth=new OwnerCredentialStore(path.join(config.dataDir,'owner-auth.json'));
  const chats=new ChatService({store:conversations,models,config,tools,knowledge,web,skills});
  // Agent jobs (research → knowledge library) run in the background between chats; chats and calls go first.
  const agent=new AgentService({store:conversations,models,config,webGateway,webStatus:()=>web.status(),library,attachments,files,runtime:()=>chats.runtime(),callBusy:()=>!!(voice.callStarting||voice.callEnding)});
  chats.agent=agent;models.yieldBackground=()=>agent.yieldNow();
  agent.startSchedules(); // scheduled agent jobs ("ทุกเช้า 7 โมง สรุปข่าว AI ให้หน่อย"): first check 90 s after start, then every 30 s
  voice.onCallEnd=()=>{devices.callOwner=null;conversations.changed({type:'call',owner:null},false)};
  const handler = createApp({ config, files, ws, memory, retriever, tools, attachments, comfy, models, voice, web, conversations, chats, devices, ownerAuth, sandbox, skills, library });
  return { agent, library, ws, files, memory, retriever, attachments, tools, handler, models, voice, web,knowledge,conversations,chats,devices,ownerAuth,sandbox,skills };
}
