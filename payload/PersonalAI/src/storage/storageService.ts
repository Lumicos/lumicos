import {
  DEFAULT_CHARACTER,
  DEFAULT_SETTINGS,
  EMPTY_CHARACTER,
  LEGACY_ASSISTANT_ID,
  ASSISTANT_ID,
  DEFAULT_ASSISTANT,
  LUMICOS_ID,
  MOCK_AVAILABLE,
} from '../config/defaults';
import type { Character, ChatMessage, Conversation, Settings } from '../types';

/**
 * Every read/write of persistent data goes through this interface.
 * Today: browser localStorage. Later: SQLite / a local backend with
 * long-term memory — replace `localStorageService`, nothing else changes.
 */
export interface StorageService {
  /** Upgrades older saved data in place. Safe to call on every start. */
  migrate(): void;
  loadSettings(): Settings;
  saveSettings(settings: Settings): void;
  loadConversations(): Conversation[];
  saveConversations(conversations: Conversation[]): void;
  loadCharacters(): Character[];
  saveCharacters(characters: Character[]): void;
  exportAll(): string;
  importAll(json: string): void;
}

const KEYS = {
  meta: 'personalai.meta',
  settings: 'personalai.settings.v2',
  conversations: 'personalai.conversations.v2',
  characters: 'personalai.characters.v1',
  // Phase-1 keys, read once during migration.
  legacySettings: 'personalai.settings.v1',
  legacyConversations: 'personalai.conversations.v1',
};

/** Bump when a migration step is added below. */
const SCHEMA = 5;

function read<T>(key: string): T | undefined {
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : undefined;
  } catch {
    return undefined;
  }
}

function write(key: string, value: unknown) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch (e) {
    // Usually the ~5 MB quota (large avatar images).
    console.warn('[storage] write failed', key, e);
  }
}

/* ------------------------------------------------------------------ */
/* Normalizers: accept any older / partial shape, never throw          */
/* ------------------------------------------------------------------ */

const str = (v: unknown) => (typeof v === 'string' ? v : '');

export function normalizeCharacter(raw: any): Character {
  const now = Date.now();
  return {
    ...EMPTY_CHARACTER,
    id: str(raw?.id) || crypto.randomUUID(),
    name: str(raw?.name) || 'Unnamed',
    nickname: str(raw?.nickname),
    avatar: str(raw?.avatar),
    description: str(raw?.description),
    personality: str(raw?.personality),
    speakingStyle: str(raw?.speakingStyle),
    userRelationship: str(raw?.userRelationship),
    behaviorRules: str(raw?.behaviorRules),
    systemPrompt: str(raw?.systemPrompt),
    firstMessage: str(raw?.firstMessage),
    createdAt: typeof raw?.createdAt === 'number' ? raw.createdAt : now,
    updatedAt: typeof raw?.updatedAt === 'number' ? raw.updatedAt : now,
    ...(raw?.extensions ? { extensions: raw.extensions } : {}),
  };
}

/** Phase-1 messages had `content: string`; convert to `parts`. */
function normalizeMessage(m: any): ChatMessage {
  if (Array.isArray(m?.parts)) return m as ChatMessage;
  const { content, ...rest } = m ?? {};
  return {
    id: rest.id ?? crypto.randomUUID(),
    role: rest.role ?? 'user',
    createdAt: rest.createdAt ?? Date.now(),
    ...rest,
    parts: [{ type: 'text', text: String(content ?? '') }],
    status: m?.status === 'stopped' || m?.status === 'error' ? m.status : 'done',
  };
}

function normalizeConversation(c: any): Conversation {
  const now = Date.now();
  return {
    ...c,
    id: c?.id ?? crypto.randomUUID(),
    title: str(c?.title) || 'Chat',
    messages: Array.isArray(c?.messages) ? c.messages.map(normalizeMessage) : [],
    createdAt: c?.createdAt ?? now,
    updatedAt: c?.updatedAt ?? now,
    // Chats from before characters existed belong to the plain Assistant.
    characterId: str(c?.characterId) || LEGACY_ASSISTANT_ID,
  };
}

function normalizeSettings(saved: any): Settings {
  const s: Settings = {
    ...DEFAULT_SETTINGS,
    ...saved,
    version: 3,
    ui: { ...DEFAULT_SETTINGS.ui, ...saved?.ui },
    generation: { ...DEFAULT_SETTINGS.generation, ...saved?.generation },
    tools: { ...DEFAULT_SETTINGS.tools, ...saved?.tools },
    memory: { ...DEFAULT_SETTINGS.memory, ...saved?.memory },
    knowledge: { ...DEFAULT_SETTINGS.knowledge, ...saved?.knowledge },
    developer: { ...DEFAULT_SETTINGS.developer, ...saved?.developer },
  };
  if (!['FAST','AUTO','DEEP'].includes(s.chatReasoningMode)) s.chatReasoningMode='FAST';
  if (!['auto', 'always', 'off'].includes(s.tools.mode)) s.tools.mode = 'auto';
  s.tools.maxIterations = Math.min(10, Math.max(1, Math.round(Number(s.tools.maxIterations) || 5)));
  s.memory.maxInjected = Math.min(12, Math.max(1, Math.round(Number(s.memory.maxInjected) || 6)));
  s.knowledge.enabled = saved?.knowledge?.enabled === true;
  const savedSearchMode = saved?.knowledge?.searchMode;
  s.knowledge.searchMode = ['AUTO', 'ON', 'OFF'].includes(savedSearchMode)
    ? savedSearchMode
    : saved?.knowledge
      ? (saved.knowledge.webEnabled === true ? 'AUTO' : 'OFF')
      : 'AUTO';
  s.knowledge.webEnabled = s.knowledge.searchMode !== 'OFF';
  if (typeof saved?.statusPanelOpen === 'boolean' && saved?.rightPanelOpen === undefined) {
    s.rightPanelOpen = saved.statusPanelOpen;
  }
  if (!['context-note', 'assistant-turn', 'ui-only'].includes(s.greetingMode)) s.greetingMode = 'context-note';
  if (s.historyFilter !== 'all') s.historyFilter = 'character';
  // A saved "mock" choice must never leak into a real build.
  if (!MOCK_AVAILABLE) s.provider = 'llamacpp';
  return s;
}

const LEGACY_ASSISTANT: Character = normalizeCharacter(DEFAULT_ASSISTANT);

/** Both built-in agents must exist. An untouched Phase-1 "Assistant" card is upgraded to the general assistant; edited cards are left alone. */
export function ensureBuiltinCharacters(list: Character[]): Character[] {
  const existing=list.find(c=>c.id===ASSISTANT_ID);
  return [{...DEFAULT_ASSISTANT,...existing,id:ASSISTANT_ID,name:'Nova'}];
}

/* ------------------------------------------------------------------ */

export const localStorageService: StorageService = {
  migrate() {
    const meta = read<{ schema?: number }>(KEYS.meta) ?? {};
    const from = meta.schema ?? 1;
    if (from >= SCHEMA) return;

    if (from < 2) {
      // Phase 1 -> 2. Conversations: v1 key -> v2 key, message parts, characterId.
      const rawConvs = read<any[]>(KEYS.conversations) ?? read<any[]>(KEYS.legacyConversations) ?? [];
      const convs = (Array.isArray(rawConvs) ? rawConvs : []).map(normalizeConversation);
      write(KEYS.conversations, convs);

      // Characters: fill new fields and keep the old Assistant if chats use it.
      const rawChars = read<any[]>(KEYS.characters);
      let chars = (Array.isArray(rawChars) ? rawChars : []).map(normalizeCharacter);
      const usesLegacy = convs.some((c) => c.characterId === LEGACY_ASSISTANT_ID);
      if (usesLegacy && !chars.some((c) => c.id === LEGACY_ASSISTANT_ID)) chars.push(LEGACY_ASSISTANT);
      chars = ensureBuiltinCharacters(chars);
      write(KEYS.characters, chars);

      // Settings: v1 key -> v2; use the default companion for new chats.
      const settings = normalizeSettings(read<any>(KEYS.settings) ?? read<any>(KEYS.legacySettings) ?? {});
      if (!settings.activeCharacterId || settings.activeCharacterId === LEGACY_ASSISTANT_ID) {
        settings.activeCharacterId = ASSISTANT_ID;
      }
      write(KEYS.settings, settings);
    }

    if (from < 3) {
      // Phase 2 -> 3: new settings groups (tools, memory, developer) get their defaults.
      // Conversations/messages need no change: the new message fields are optional.
      write(KEYS.settings, normalizeSettings(read<any>(KEYS.settings) ?? {}));
    }

    if (from < 4) {
      const saved = read<any[]>(KEYS.characters);
      if (Array.isArray(saved) && saved.some((c) => c.id === LUMICOS_ID && c.name === 'Mina')) {
        // Save before changing persona. Abort migration if storage is full.
        const backupKey = 'personalai.backup.before-lumicos.v4';
        if (!localStorage.getItem(backupKey)) localStorage.setItem(backupKey, JSON.stringify(saved));
        const updated = saved.map((c) => c.id === LUMICOS_ID && c.name === 'Mina'
          ? { ...c, name: DEFAULT_CHARACTER.name, nickname: DEFAULT_CHARACTER.nickname,
              description: DEFAULT_CHARACTER.description, personality: DEFAULT_CHARACTER.personality,
              speakingStyle: DEFAULT_CHARACTER.speakingStyle, userRelationship: DEFAULT_CHARACTER.userRelationship,
              behaviorRules: DEFAULT_CHARACTER.behaviorRules, firstMessage: DEFAULT_CHARACTER.firstMessage,
              systemPrompt: DEFAULT_CHARACTER.systemPrompt, updatedAt: Date.now() }
          : c);
        localStorage.setItem(KEYS.characters, JSON.stringify(updated));
      }
    }

    if (from < 5) {
      // Both built-in agents (general assistant + Lumicos) must exist.
      const chars = ensureBuiltinCharacters((read<any[]>(KEYS.characters) ?? []).map(normalizeCharacter));
      write(KEYS.characters, chars);
    }

    write(KEYS.meta, { ...meta, schema: SCHEMA, migratedAt: new Date().toISOString() });
  },

  loadSettings() {
    return normalizeSettings(read<any>(KEYS.settings) ?? {});
  },
  saveSettings(settings) {
    write(KEYS.settings, settings);
  },

  loadConversations() {
    const saved = read<any[]>(KEYS.conversations);
    return Array.isArray(saved) ? saved.map(normalizeConversation).filter(c=>!c.private) : [];
  },
  saveConversations(conversations) {
    write(KEYS.conversations, conversations.filter(c=>!c.private));
  },

  loadCharacters() {
    const saved = read<any[]>(KEYS.characters);
    const list = Array.isArray(saved) ? saved.map(normalizeCharacter) : [];
    return ensureBuiltinCharacters(list);
  },
  saveCharacters(characters) {
    write(KEYS.characters, characters);
  },

  exportAll() {
    return JSON.stringify(
      {
        app: 'PersonalAI',
        schema: SCHEMA,
        exportedAt: new Date().toISOString(),
        settings: this.loadSettings(),
        characters: this.loadCharacters(),
        conversations: this.loadConversations(),
      },
      null,
      2,
    );
  },
  importAll(json) {
    const data = JSON.parse(json);
    if (data?.app !== 'PersonalAI') throw new Error('Not a PersonalAI backup file.');
    if (data.settings) write(KEYS.settings, normalizeSettings(data.settings));
    if (Array.isArray(data.characters)) write(KEYS.characters, data.characters.map(normalizeCharacter));
    if (Array.isArray(data.conversations)) write(KEYS.conversations, data.conversations.map(normalizeConversation).filter((c: Conversation)=>!c.private));
    // Re-run migrations on the next start in case the backup is older.
    write(KEYS.meta, { schema: 1 });
  },
};

export const storage: StorageService = localStorageService;
