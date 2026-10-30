import type { Character, Settings } from '../types';

export const DEFAULT_SERVER_URL = 'http://127.0.0.1:8080';

export const DEFAULT_SYSTEM_PROMPT =
  'You are a local personal AI assistant. Be helpful, intelligent, natural, and concise. Maintain continuity with the conversation.';

/**
 * The in-app demo provider exists only when built with VITE_ENABLE_MOCK=true
 * (`npm run dev:mock`). In a normal build it is compiled out entirely.
 */
export const MOCK_AVAILABLE = import.meta.env.VITE_ENABLE_MOCK === 'true';

/** Keep the persisted ID so existing chats and memories remain connected. */
export const LUMICOS_ID = 'default-mina';
/** The plain assistant (no persona). Phase-1 chats already point at this id; it is now the general-purpose chat agent. */
export const LEGACY_ASSISTANT_ID = 'default-assistant';
export const ASSISTANT_ID = LEGACY_ASSISTANT_ID;

export const DEFAULT_SETTINGS: Settings = {
  version: 3,
  chatReasoningMode: 'FAST',
  userName: 'User',
  theme: 'dark',
  appearance: { style: 'lumicos', glow: true, density: 'comfortable' },
  ui: {
    fontSize: 'medium',
    chatWidth: 'comfortable',
    enterToSend: true,
    showReasoning: true,
  },
  provider: MOCK_AVAILABLE ? 'mock' : 'llamacpp',
  serverUrl: DEFAULT_SERVER_URL,
  generation: {
    temperature: 0.8,
    topP: 0.95,
    maxTokens: 1024,
  },
  systemPrompt: DEFAULT_SYSTEM_PROMPT,
  activeCharacterId: ASSISTANT_ID,
  greetingMode: 'context-note',
  historyFilter: 'character',
  tools: { mode: 'auto', confirmWrites: true, maxIterations: 5 },
  memory: { enabled: true, maxInjected: 6, autoCandidates: true },
  knowledge: { enabled: false, searchMode: 'AUTO', webEnabled: true, route: 'AUTO', learnMode: 'ask', timeoutMs: 25000, limit: 6, maxEvidenceChars: 12000 },
  developer: { memoryDebug: false, toolDebug: false },
  sidebarOpen: true,
  rightPanelOpen: false,
};

/** Every field a Character can have, empty. Used to fill in older saved data. */
export const EMPTY_CHARACTER: Omit<Character, 'id' | 'createdAt' | 'updatedAt'> = {
  name: '',
  nickname: '',
  avatar: '',
  description: '',
  personality: '',
  speakingStyle: '',
  userRelationship: '',
  behaviorRules: '',
  systemPrompt: '',
  firstMessage: '',
};

/** General chat: tools and memory about the user, but no Lumicos identity, persona, voice call or avatar. */
export const DEFAULT_ASSISTANT: Character = {
  ...EMPTY_CHARACTER,
  id: ASSISTANT_ID,
  name: 'Nova',
  nickname: '',
  description: 'ผู้ช่วย AI ส่วนตัวที่ทำงานในเครื่องของผู้ใช้ ตอบตรงประเด็น ชัดเจน และใช้เครื่องมือเมื่อจำเป็น',
  behaviorRules: [
    'ตอบเป็นภาษาเดียวกับที่ผู้ใช้พิมพ์ (ค่าเริ่มต้นเป็นภาษาไทยที่เข้าใจง่าย)',
    'ตอบตรงประเด็น สุภาพ กระชับ ไม่ใช้อีโมจิ ไม่ต้องมีบุคลิกหรืออารมณ์เกินจำเป็น ไม่เล่นบทบาท',
    'ถ้าไม่แน่ใจหรือไม่มีข้อมูล ให้บอกตรง ๆ อย่าเดา',
  ].join('\n'),
  firstMessage: '',
  createdAt: 0,
  updatedAt: 0,
};

// Compatibility alias for consumers of the old default export.
export const DEFAULT_CHARACTER = DEFAULT_ASSISTANT;

/** Status-panel label. The model name itself comes from the server. */
export const BACKEND_LABEL = 'llama.cpp Vulkan';
