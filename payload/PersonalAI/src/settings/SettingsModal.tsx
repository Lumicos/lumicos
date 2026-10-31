import {
  Check,
  Copy,
  Brain,
  Bug,
  Wrench,
  CheckCircle2,
  Download,
  Loader2,
  Palette,
  Plug,
  ScrollText,
  Search,
  SlidersHorizontal,
  Upload,
  UserRound,
  Users,
  XCircle,
} from 'lucide-react';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { previewSystemPrompt } from '../prompt/promptBuilder';
import { Avatar } from '../components/Avatar';
import { Modal } from '../components/Modal';
import { DEFAULT_SERVER_URL, DEFAULT_SYSTEM_PROMPT, MOCK_AVAILABLE } from '../config/defaults';
import { createProvider } from '../providers';
import type { ConnectionResult } from '../providers/types';
import { storage } from '../storage/storageService';
import { localService, type ServiceHealth, type ToolDefinition } from '../services/localService';
import { ModelManager } from './ModelManager';
import type { Character, GreetingMode, ServerInfo, Settings } from '../types';



import {VoiceSettings} from '../voice/Voice';
import {WebSettings} from './WebSettings';
import {OwnerAccess} from './OwnerAccess';
import {SelfCheck} from './SelfCheck';
import {ThemeLibrary} from '../theme/ThemeLibrary';
import {getLang,setLang} from '../i18n';

type Tab = 'voice' | 'general' | 'connection' | 'generation' | 'prompt' | 'character' | 'knowledge' | 'memory' | 'tools' | 'developer';

const TABS: { id: Tab; label: string; icon: typeof Palette }[] = [
  { id: 'voice', label: 'เสียง', icon: Plug },
  { id: 'general', label: 'General', icon: Palette },
  { id: 'connection', label: 'LLM connection', icon: Plug },
  { id: 'generation', label: 'Generation', icon: SlidersHorizontal },
  { id: 'prompt', label: 'System prompt', icon: ScrollText },
  { id: 'character', label: 'Character', icon: UserRound },
  { id: 'knowledge', label: 'Knowledge', icon: Search },
  { id: 'memory', label: 'Memory', icon: Brain },
  { id: 'tools', label: 'Files & tools', icon: Wrench },
  { id: 'developer', label: 'Developer', icon: Bug },
];

interface Props {
  settings: Settings;
  initialTab?: 'general';
  sttEnabled?: boolean;
  ttsEnabled?: boolean;
  service: { online: boolean; health: ServiceHealth | null; tools: ToolDefinition[] };
  info: ServerInfo;
  character?: Character;
  onSave: (s: Settings) => void;
  onManageCharacters: () => void;
  onRoleplay?: () => void;
  roleplayChats?: { id: string; title: string }[];
  onOpenChat?: (id: string) => void;
  onClose: () => void;
}

export function SettingsModal(p: Props) {
  const voiceEnabled = p.sttEnabled !== false || p.ttsEnabled !== false;
  const [tab, setTab] = useState<Tab>(p.initialTab??'general');
  const [draft, setDraft] = useState<Settings>(p.settings);
  const dirty = JSON.stringify(draft) !== JSON.stringify(p.settings);

  const set = (patch: Partial<Settings>) => setDraft((d) => ({ ...d, ...patch }));
  const previewText = previewSystemPrompt({
    globalPrompt: draft.systemPrompt,
    character: p.character,
    userName: draft.userName,
    greetingMode: draft.greetingMode,
  });
  const setUi = (patch: Partial<Settings['ui']>) => setDraft((d) => ({ ...d, ui: { ...d.ui, ...patch } }));
  const setGen = (patch: Partial<Settings['generation']>) =>
    setDraft((d) => ({ ...d, generation: { ...d.generation, ...patch } }));
  const setTools = (patch: Partial<Settings['tools']>) => setDraft((d) => ({ ...d, tools: { ...d.tools, ...patch } }));
  const setMem = (patch: Partial<Settings['memory']>) => setDraft((d) => ({ ...d, memory: { ...d.memory, ...patch } }));
  const setKnowledge = (patch: Partial<Settings['knowledge']>) => setDraft((d) => ({ ...d, knowledge: { ...d.knowledge, ...patch } }));
  const setDev = (patch: Partial<Settings['developer']>) => setDraft((d) => ({ ...d, developer: { ...d.developer, ...patch } }));

  return (
    <Modal
      title="Settings"
      onClose={p.onClose}
      size="lg"
      footer={
        <>
          <span className="muted small grow">{dirty ? 'Unsaved changes' : 'Settings are stored on this computer.'}</span>
          <button className="btn btn-ghost" onClick={p.onClose}>
            Cancel
          </button>
          <button
            className="btn btn-primary"
            disabled={!dirty}
            onClick={() => {
              p.onSave(draft);
              p.onClose();
            }}
          >
            Save
          </button>
        </>
      }
    >
      <div className="settings">
        <nav className="settings-nav">
          {TABS.filter(({ id }) => id !== 'voice' || voiceEnabled).map(({ id, label, icon: Icon }) => (
            <button key={id} className={`settings-tab ${tab === id ? 'active' : ''}`} onClick={() => setTab(id)}>
              <Icon size={16} /> <span>{label}</span>
            </button>
          ))}
        </nav>

        <div className="settings-body">
          {tab === 'voice' && voiceEnabled && <VoiceSettings sttEnabled={p.sttEnabled !== false} ttsEnabled={p.ttsEnabled !== false}/>}
          {tab === 'developer' && <OwnerAccess/>}
          {tab === 'developer' && <SelfCheck/>}
          {tab === 'developer' && (
            <Section title="โรลเพลย์">
              <div className="note">โหมดโรลเพลย์ซ่อนไว้ที่นี่ เลือกตัวละครแล้วกดเริ่มโรลเพลย์ในหน้าจัดการตัวละคร แชตโรลเพลย์ไม่ใช้เว็บ คลังความรู้ หรือความจำ</div>
              <Toggle label="แสดงตัวละครโรลเพลย์ในหน้าเลือก Agent" hint="ปิดไว้: เลือก Agent ได้เฉพาะ Nova" checked={!!draft.developer.showRoleplayAgents} onChange={(showRoleplayAgents) => setDev({ showRoleplayAgents })}/>
              <button className="btn btn-soft" onClick={p.onRoleplay}>เปิดหน้าเลือกตัวละครเพื่อเริ่มโรลเพลย์</button>
              {!!p.roleplayChats?.length && (
                <ul className="ct-list">
                  {p.roleplayChats.map((c) => (
                    <li key={c.id}><span className="ct-name">🎭 {c.title}</span><button className="btn" onClick={() => p.onOpenChat?.(c.id)}>เปิด</button></li>
                  ))}
                </ul>
              )}
            </Section>
          )}
          {tab === 'general' && (
            <>
              <Section title="Appearance">
                <Row label="ภาษา / Language"><Segmented value={getLang()} options={[['th','ไทย'],['en','English']]} onChange={(l) => { setLang(l as 'th' | 'en'); setDraft((d) => ({ ...d })); }}/></Row>
                <Row label="Theme"><Segmented value={draft.appearance?.style ?? 'lumicos'} options={[['lumicos','Lumicos'],['monochrome','Monochrome']]} onChange={(style) => set({appearance:{style,glow:draft.appearance?.glow ?? true,density:draft.appearance?.density ?? 'comfortable'}})}/></Row>
                <Toggle label="แสงเรืองโลโก้" checked={draft.appearance?.glow ?? true} onChange={(glow)=>set({appearance:{style:draft.appearance?.style ?? 'lumicos',density:draft.appearance?.density ?? 'comfortable',glow}})}/>
                <Row label="ความหนาแน่น"><Segmented value={draft.appearance?.density ?? 'comfortable'} options={[['comfortable','สบายตา'],['compact','กระชับ']]} onChange={(density)=>set({appearance:{style:draft.appearance?.style ?? 'lumicos',glow:draft.appearance?.glow ?? true,density}})}/></Row>
                <Row label="Mode">
                  <Segmented
                    value={draft.theme}
                    options={[
                      ['dark', 'Dark'],
                      ['light', 'Light'],
                      ['system', 'Follow system'],
                    ]}
                    onChange={(theme) => set({ theme })}
                  />
                </Row>
                <ThemeLibrary />
                <Row label="Text size">
                  <Segmented
                    value={draft.ui.fontSize}
                    options={[
                      ['small', 'Small'],
                      ['medium', 'Medium'],
                      ['large', 'Large'],
                    ]}
                    onChange={(fontSize) => setUi({ fontSize })}
                  />
                </Row>
                <Row label="Chat width">
                  <Segmented
                    value={draft.ui.chatWidth}
                    options={[
                      ['narrow', 'Narrow'],
                      ['comfortable', 'Comfortable'],
                      ['wide', 'Wide'],
                    ]}
                    onChange={(chatWidth) => setUi({ chatWidth })}
                  />
                </Row>
              </Section>
              <Section title="Interface">
                <Row label="Your name" hint="Used for {{user}} in character prompts.">
                  <input value={draft.userName} onChange={(e) => set({ userName: e.target.value })} maxLength={40} />
                </Row>
                <Toggle
                  label="Enter sends the message"
                  hint="Off: Ctrl+Enter sends, Enter adds a line."
                  checked={draft.ui.enterToSend}
                  onChange={(enterToSend) => setUi({ enterToSend })}
                />
                <Toggle
                  label="Show model thought process"
                  hint="When the server returns reasoning separately."
                  checked={draft.ui.showReasoning}
                  onChange={(showReasoning) => setUi({ showReasoning })}
                />
              </Section>
              <DataSection service={p.service} />
            </>
          )}

          {tab === 'connection' && <ConnectionTab draft={draft} set={set} info={p.info} />}

          {tab === 'generation' && (<>
            <Section title="โมเดล AI"><ModelManager online={p.service.online} /></Section>
            <Section title="Sampling"><div className="note">โมเดลและโหมดคิดเป็นคนละค่า การเลือกโมเดลจะไม่บังคับเปิด DEEP และ DEEP จะไม่สลับโมเดลเอง</div><Row label="Chat reasoning" hint="FAST ตอบไวเป็นค่าเริ่มต้น · AUTO · DEEP คิดละเอียด เฉพาะแชท ไม่เปลี่ยนโหมดโทร"><select aria-label="Chat reasoning" value={draft.chatReasoningMode??'FAST'} onChange={e=>set({chatReasoningMode:e.target.value as Settings['chatReasoningMode']})}><option value="FAST">FAST</option><option value="AUTO">AUTO</option><option value="DEEP">DEEP</option></select></Row>
              <Slider label="Temperature" min={0} max={2} step={0.05} value={draft.generation.temperature}
                onChange={(temperature) => setGen({ temperature })} hint="Higher = more creative, lower = more focused." />
              <Slider label="Top P" min={0.05} max={1} step={0.01} value={draft.generation.topP}
                onChange={(topP) => setGen({ topP })} />
              <Row label="Max tokens" hint="Upper limit for one reply.">
                <input type="number" min={16} max={32768} value={draft.generation.maxTokens}
                  onChange={(e) => setGen({ maxTokens: Math.max(16, Math.min(32768, Number(e.target.value) || 16)) })} />
              </Row>
              <div className="note">
                Context size is set when llama-server starts (<code>-c</code>). Current:{' '}
                <b>{p.info.contextSize ? `${p.info.contextSize.toLocaleString()} tokens` : '--'}</b>
              </div>
            </Section>
          </>)}

          {tab === 'prompt' && (
            <Section
              title="Global system prompt"
              action={
                <button className="btn btn-ghost btn-sm" onClick={() => set({ systemPrompt: DEFAULT_SYSTEM_PROMPT })}>
                  Reset to default
                </button>
              }
            >
              <textarea className="prompt-area" rows={9} value={draft.systemPrompt}
                onChange={(e) => set({ systemPrompt: e.target.value })} />
              <div className="note">
                Sent first on every request as <code>[Global Instructions]</code>. The chat’s character is added after it as{' '}
                <code>[Character]</code> — edit that in the character editor. See the full result in Character → Prompt
                preview.
              </div>
            </Section>
          )}

          {tab === 'character' && (
            <>
              <Section title="Current character">
                <div className="char-summary">
                  <Avatar character={p.character} size={48} />
                  <div>
                    <div className="char-summary-name">
                      {p.character?.name ?? 'None'}
                      {p.character?.nickname && <span className="muted"> “{p.character.nickname}”</span>}
                    </div>
                    <div className="muted small">{p.character?.description}</div>
                  </div>
                  <div className="grow" />
                  <button className="btn btn-soft" onClick={p.onManageCharacters}>
                    <Users size={15} /> Edit characters
                  </button>
                </div>
                <div className="note">
                  The character’s own fields (personality, speaking style, relationship, rules, extra instructions) are
                  kept separate from the global system prompt and edited in the character editor.
                </div>
              </Section>

              <Section title="First message handling">
                <div className="radio-list">
                  {GREETING_OPTIONS.map(([mode, label, hint]) => (
                    <label key={mode} className={`radio-card ${draft.greetingMode === mode ? 'active' : ''}`}>
                      <input
                        type="radio"
                        name="greetingMode"
                        checked={draft.greetingMode === mode}
                        onChange={() => set({ greetingMode: mode })}
                      />
                      <span>
                        <span className="radio-label">{label}</span>
                        <small>{hint}</small>
                      </span>
                    </label>
                  ))}
                </div>
              </Section>

              <Section
                title="Prompt preview"
                action={<CopyButton text={previewText} />}
              >
                <pre className="prompt-preview-box tall">{previewText || '(empty)'}</pre>
                <div className="note">
                  Exactly what a new chat with {p.character?.name ?? 'this character'} sends as the system message, using
                  the settings on this screen. The conversation messages follow it.
                </div>
              </Section>
            </>
          )}

          {tab === 'memory' && (
            <>
              <ServiceStatus service={p.service} />
              <Section title="Long-term memory">
                <Toggle
                  label="Use long-term memory"
                  hint="Before each reply, the few memories relevant to your message are added to the prompt. Never the whole database."
                  checked={draft.memory.enabled}
                  onChange={(enabled) => setMem({ enabled })}
                />
                <Toggle
                  label="Suggest memories from my messages"
                  hint="Shows “Memory suggestion: … Save / Edit / Ignore”. Nothing is saved without you."
                  checked={draft.memory.autoCandidates}
                  onChange={(autoCandidates) => setMem({ autoCandidates })}
                />
                <Row label="Memories per reply" hint="Upper limit. Pinned memories count too.">
                  <Segmented
                    value={String(draft.memory.maxInjected) as '3' | '6' | '10'}
                    options={[
                      ['3', '3'],
                      ['6', '6'],
                      ['10', '10'],
                    ]}
                    onChange={(v) => setMem({ maxInjected: Number(v) })}
                  />
                </Row>
                <div className="note">
                  Memories are stored on this PC in <code>{p.service.health?.dataDir ? `${p.service.health.dataDir}\\memory.json` : 'data/memory.json'}</code>. Manage
                  them on the Memory page.
                </div>
              </Section>
            </>
          )}

          {tab === 'knowledge' && (
            <>
              <ServiceStatus service={p.service} />
              <WebSettings mode={draft.knowledge.searchMode} onChange={(searchMode)=>setKnowledge({searchMode,webEnabled:searchMode!=='OFF'})}/>
              <Section title="Knowledge retrieval">
                <Toggle
                  label="Use Knowledge"
                  hint="Allows Lumicos to route explicit questions to indexed local documents, memory or web. Casual chat remains DIRECT."
                  checked={draft.knowledge.enabled}
                  onChange={(enabled) => setKnowledge({ enabled })}
                />
                <div className={`test-result ${draft.knowledge.enabled ? 'ok' : ''}`} role="status">
                  <span><b>Knowledge {draft.knowledge.enabled?'ON':'OFF'} · Web {draft.knowledge.searchMode}</b><br />Local document retrieval is controlled separately; Web Search follows the single mode selector above.</span>
                </div>
                <Row label="เก็บข้อมูลจากเว็บเข้าคลัง" hint="เมื่อ Lumicos ตอบจากการค้นเว็บ: ถามก่อนเก็บ (แนะนำ), เก็บอัตโนมัติ หรือไม่เก็บ ไฟล์อยู่ที่ workspace\knowledge\learned">
                  <Segmented value={draft.knowledge.learnMode ?? 'ask'} options={[['ask', 'ถามก่อน'], ['auto', 'อัตโนมัติ'], ['off', 'ปิด']]} onChange={(learnMode) => setKnowledge({ learnMode })} />
                </Row>
                <div className="note">
                  วางไฟล์ (.md .txt .pdf .docx .xlsx .csv) ใน workspace\knowledge แล้ว Lumicos จะใช้เป็นคลังความรู้ให้อัตโนมัติ
                  Private Chat ปิดคลังความรู้ เมมโมรี่ และการค้นเว็บเสมอ
                </div>
              </Section>
            </>
          )}

          {tab === 'tools' && (
            <>
              <ServiceStatus service={p.service} />
              <Section title="When can the AI use tools?">
                <Segmented
                  value={draft.tools.mode}
                  options={[
                    ['auto', 'Automatic'],
                    ['always', 'Always'],
                    ['off', 'Off'],
                  ]}
                  onChange={(mode) => setTools({ mode })}
                />
                <div className="note">
                  <b>Automatic</b> adds the tool list only when your message is about files, documents, spreadsheets or an attachment. This
                  saves context (8K) and keeps casual chat natural. <b>Always</b> includes it on every message.
                </div>
              </Section>
              <Section title="Permissions">
                <Toggle
                  label="Ask before changing files"
                  hint="Create, write, rename, move, copy and edit need your OK. Off: they run automatically inside the workspace."
                  checked={draft.tools.confirmWrites}
                  onChange={(confirmWrites) => setTools({ confirmWrites })}
                />
                <div className="note">
                  Reading and listing files inside the workspace never asks. <b>Deleting or overwriting always asks</b>, whatever you choose here,
                  and a backup copy is kept in <code>data/backups</code>.
                </div>
                <Row label="Max tool steps per reply" hint="Stops runaway tool loops.">
                  <Segmented
                    value={String(draft.tools.maxIterations) as '3' | '5' | '8'}
                    options={[
                      ['3', '3'],
                      ['5', '5'],
                      ['8', '8'],
                    ]}
                    onChange={(v) => setTools({ maxIterations: Number(v) })}
                  />
                </Row>
              </Section>
              <Section title="Workspace">
                <div className="kv-box">
                  <span>Folder</span>
                  <code>{p.service.health?.workspace ?? 'C:\\AI\\PersonalAI\\workspace (service offline)'}</code>
                </div>
                <div className="note">
                  The AI can only reach files inside this folder; the service rejects any other path. To use a different folder, set{' '}
                  <code>workspaceDir</code> in <code>personalai.config.json</code> and restart the service.
                </div>
              </Section>
              {p.service.tools.length > 0 && (
                <Section title={`Available tools · ${p.service.tools.length}`}>
                  <div className="tool-table">
                    {p.service.tools.map((t) => (
                      <div key={t.name} className="tool-table-row">
                        <code>{t.name}</code>
                        <span className={`perm perm-${t.permission}`}>{t.permission}</span>
                        <span className="muted small">{t.description}</span>
                      </div>
                    ))}
                  </div>
                </Section>
              )}
            </>
          )}

          {tab === 'developer' && (
            <Section title="Debug views">
              <Toggle
                label="Show “Memories used for this response”"
                hint="Under each reply: which memories were injected, their scores, and how much context was sent."
                checked={draft.developer.memoryDebug}
                onChange={(memoryDebug) => setDev({ memoryDebug })}
              />
              <Toggle
                label="Show raw tool data"
                hint="Tool arguments and the exact result text sent back to the model."
                checked={draft.developer.toolDebug}
                onChange={(toolDebug) => setDev({ toolDebug })}
              />
            </Section>
          )}

        </div>
      </div>
    </Modal>
  );
}

const GREETING_OPTIONS: [GreetingMode, string, string][] = [
  [
    'context-note',
    'Describe it in the system prompt (recommended)',
    'The model knows it greeted you, without pretending it generated the text. Works with strict chat templates such as Gemma’s.',
  ],
  [
    'assistant-turn',
    'Send as the first assistant message',
    'SillyTavern style. Some chat templates (including Gemma’s) reject a conversation that starts with the assistant.',
  ],
  ['ui-only', 'Show only in the chat', 'The model never sees the greeting.'],
];

function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      className="btn btn-ghost btn-sm"
      onClick={async () => {
        await navigator.clipboard.writeText(text).catch(() => {});
        setCopied(true);
        setTimeout(() => setCopied(false), 1500);
      }}
    >
      {copied ? <Check size={14} /> : <Copy size={14} />} {copied ? 'Copied' : 'Copy'}
    </button>
  );
}

/* ---------------- Connection ---------------- */

function ConnectionTab({ draft, set, info }: { draft: Settings; set: (p: Partial<Settings>) => void; info: ServerInfo }) {
  const [test, setTest] = useState<ConnectionResult | 'running'>();
  const run = async () => {
    setTest('running');
    setTest(await createProvider(draft).checkConnection());
  };

  return (
    <>
      {MOCK_AVAILABLE && (
        <Section title="Provider">
          <Segmented
            value={draft.provider}
            options={[
              ['llamacpp', 'llama.cpp (real)'],
              ['mock', 'Demo (mock)'],
            ]}
            onChange={(provider) => set({ provider })}
          />
          <div className="note warn">
            Demo mode is available because this build was started with <code>npm run dev:mock</code>. Normal builds
            only contain the llama.cpp provider.
          </div>
        </Section>
      )}

      <Section title="llama-server">
        <Row label="Server URL" hint="llama-server’s address. No trailing /v1.">
          <div className="input-with-btn">
            <input
              value={draft.serverUrl}
              onChange={(e) => set({ serverUrl: e.target.value })}
              placeholder={DEFAULT_SERVER_URL}
              spellCheck={false}
            />
            <button className="btn btn-soft" onClick={run} disabled={test === 'running'}>
              {test === 'running' ? <Loader2 size={15} className="spin" /> : 'Test'}
            </button>
          </div>
        </Row>
        {test && test !== 'running' && (
          <div className={`test-result ${test.state === 'online' ? 'ok' : 'bad'}`}>
            {test.state === 'online' ? <CheckCircle2 size={16} /> : <XCircle size={16} />}
            <span>
              {test.state === 'online'
                ? `Connected${test.info.modelId ? ` · ${test.info.modelId}` : ''}${
                    test.info.contextSize ? ` · ctx ${test.info.contextSize}` : ''
                  }`
                : test.state === 'loading'
                  ? 'Server is up but still loading the model.'
                  : `${test.detail ?? 'Not reachable'}. Is llama-server running?`}
            </span>
          </div>
        )}
        <div className="note">
          Endpoint used: <code>{draft.serverUrl.replace(/\/+$/, '')}/v1/chat/completions</code> (streaming, OpenAI
          compatible).
          {info.modelId && (
            <>
              {' '}
              Currently loaded: <code>{info.modelId}</code>
            </>
          )}
        </div>
        {draft.serverUrl !== DEFAULT_SERVER_URL && (
          <button className="btn btn-ghost btn-sm" onClick={() => set({ serverUrl: DEFAULT_SERVER_URL })}>
            Reset to {DEFAULT_SERVER_URL}
          </button>
        )}
      </Section>
    </>
  );
}

/* ---------------- Data ---------------- */

function DataSection({ service }: { service: Props['service'] }) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [msg, setMsg] = useState<string>();
  const [cache, setCache] = useState<{ count: number; bytes: number }>();

  useEffect(() => {
    if (service.online) localService.attachments.usage().then(setCache).catch(() => {});
  }, [service.online]);

  const exportData = async () => {
    const data = JSON.parse(storage.exportAll());
    if (service.online) data.memories = await localService.memory.list().catch(() => undefined);
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `personalai-backup-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(a.href);
  };

  const importData = async (file?: File) => {
    if (!file) return;
    try {
      const text = await file.text();
      storage.importAll(text);
      const memories = JSON.parse(text).memories;
      if (Array.isArray(memories) && service.online) {
        const existing = new Set((await localService.memory.list()).map((m) => m.content));
        for (const m of memories) if (!existing.has(m.content)) await localService.memory.create(m).catch(() => {});
      }
      window.location.reload();
    } catch (e: any) {
      setMsg(e.message);
    }
  };

  return (
    <Section title="Data">
      <div className="btn-row">
        <button className="btn btn-soft" onClick={exportData}>
          <Download size={15} /> Export backup
        </button>
        <button className="btn btn-soft" onClick={() => fileRef.current?.click()}>
          <Upload size={15} /> Import backup
        </button>
        <input ref={fileRef} type="file" accept="application/json" hidden onChange={(e) => importData(e.target.files?.[0])} />
      </div>
      {msg && <div className="form-error">{msg}</div>}
      <div className="note">
        Chats, characters and settings live in this browser’s local storage; memories live in the local service. The backup file contains
        both (memories only while the service is running). Import replaces chats/characters/settings and adds memories that are missing.
      </div>
      {service.online && cache && (
        <div className="s-row">
          <div className="s-row-label">
            <span>Attachment cache</span>
            <small>
              Files attached to chats ({cache.count}, {(cache.bytes / 1024 / 1024).toFixed(1)} MB). Clearing it does not touch your workspace.
            </small>
          </div>
          <button
            className="btn btn-ghost btn-sm"
            disabled={!cache.count}
            onClick={async () => {
              await localService.attachments.clear();
              setCache({ count: 0, bytes: 0 });
            }}
          >
            Clear
          </button>
        </div>
      )}
    </Section>
  );
}

/* ---------------- Local service status ---------------- */

function ServiceStatus({ service }: { service: Props['service'] }) {
  return service.online ? (
    <div className="test-result ok">
      <CheckCircle2 size={16} /> Local service is running.
    </div>
  ) : (
    <div className="test-result bad">
      <XCircle size={16} />
      <span>
        The local service is not running, so memory and file tools are off. Start it with <code>start-personalai.bat</code> or{' '}
        <code>npm run service</code>.
      </span>
    </div>
  );
}

/* ---------------- Small form primitives ---------------- */

function Section({ title, action, children }: { title: string; action?: ReactNode; children: ReactNode }) {
  return (
    <section className="s-section">
      <div className="s-section-head">
        <h4>{title}</h4>
        {action}
      </div>
      {children}
    </section>
  );
}

function Row({ label, hint, children }: { label: string; hint?: string; children: ReactNode }) {
  return (
    <div className="s-row">
      <div className="s-row-label">
        <span>{label}</span>
        {hint && <small>{hint}</small>}
      </div>
      <div className="s-row-control">{children}</div>
    </div>
  );
}

function Toggle(props: { label: string; hint?: string; checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <Row label={props.label} hint={props.hint}>
      <button
        role="switch"
        aria-checked={props.checked}
        className={`switch ${props.checked ? 'on' : ''}`}
        onClick={() => props.onChange(!props.checked)}
      >
        <span />
      </button>
    </Row>
  );
}

function Slider(props: { label: string; hint?: string; min: number; max: number; step: number; value: number; onChange: (v: number) => void }) {
  return (
    <Row label={props.label} hint={props.hint}>
      <div className="slider">
        <input type="range" min={props.min} max={props.max} step={props.step} value={props.value}
          onChange={(e) => props.onChange(Number(e.target.value))} />
        <span className="slider-val">{props.value.toFixed(2)}</span>
      </div>
    </Row>
  );
}

function Segmented<T extends string>(props: { value: T; options: [T, string][]; onChange: (v: T) => void }) {
  return (
    <div className="segmented">
      {props.options.map(([v, label]) => (
        <button key={v} className={v === props.value ? 'active' : ''} onClick={() => props.onChange(v)}>
          {label}
        </button>
      ))}
    </div>
  );
}
