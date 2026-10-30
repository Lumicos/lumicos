// Shared data model. Backend-agnostic on purpose: the same shapes will carry
// images (ComfyUI), tool results, voice input and memory later.

export type Role = 'system' | 'user' | 'assistant' | 'tool';

/* ------------------------------------------------------------------ */
/* Messages                                                            */
/* ------------------------------------------------------------------ */

export interface TextPart {
  type: 'text';
  text: string;
}

/** Future: ComfyUI output (source 'generated') or a user upload ('attachment'). */
export interface ImagePart {
  type: 'image';
  source: 'generated' | 'attachment';
  url: string;
  alt?: string;
  /** e.g. { workflow: 'z-image', seed: 123, prompt: '...' } */
  meta?: Record<string, unknown>;
}

/** Future: result returned by a tool call (image gen, notes, accounting…). */
export interface ToolResultPart {
  type: 'tool_result';
  toolName: string;
  summary?: string;
  data?: unknown;
}

/** A file attached to a user message (kept in the service's attachment cache, not the workspace). */
export interface AttachmentPart {
  type: 'attachment';
  id: string;
  name: string;
  size: number;
  kind: string;
  /** Text given to the model (whole file, or the first parts of a long one). */
  context: string;
  complete: boolean;
  totalChunks: number;
  /** Workspace path once the user imported it. */
  importedPath?: string;
}

export type MessagePart = TextPart | ImagePart | ToolResultPart | AttachmentPart;
export type ChatAttachment = AttachmentPart | ImagePart;

export type MessageStatus = 'streaming' | 'done' | 'stopped' | 'error';

/** Where a user message came from. 'voice' is reserved for STT. */
export type InputSource = 'keyboard' | 'voice';

export interface EvidenceCitation {
  contractVersion: 1;
  id: string;
  kind: 'local' | 'web' | 'memory';
  sourceId?: string;
  title?: string;
  url?: string;
  file?: string;
  page?: number;
  chunk?: number;
  retrievedAt?: string;
  /** Local library only: date (YYYY-MM-DD) the source file was last modified. */
  updatedAt?: string;
  source?: string;
  publishedAt?: string | null;
  /** Web only: 'match' = snippet states the requested market/period; 'unverified' = it does not say. */
  fit?: 'match' | 'unverified';
}

export interface ChatMessage {
  /** Optional user feedback for an assistant response. */
  feedback?: 'like' | 'dislike';
  reaction?: import('../components/avatar-stage/reactionIntent.mjs').ReactionIntent;
  imageRequest?: {kind:'create'|'edit';prompt:string;translatedPrompt?:string;hidePrompt?:boolean};
  /** Image-job tracking persisted with the reply: root request correlation id and the server job id once created. */
  imageJob?: {requestId?:string;jobId?:string};
  id: string;
  /** Stable relation used to keep a response after the user turn that caused it. */
  replyToId?: string;
  role: Role;
  parts: MessagePart[];
  createdAt: number;
  /** Model "thinking" text, if the server returns it separately. */
  reasoning?: string;
  status?: MessageStatus;
  error?: string;
  /** Real statistics reported by the server. Never estimated. */
  stats?: GenerationStats;
  /** Measured Chat-only latency; absent for Call. */
  chatLatency?: ChatLatency;
  source?: InputSource;
  /** Marks the character's greeting (firstMessage). */
  isGreeting?: boolean;
  editedAt?: number;
  /** Tool calls made while producing this reply, in order. */
  toolRuns?: ToolRun[];
  /** Clean model text retained for tool/history compatibility. */
  modelText?: string;
  /** Exact final assistant bytes returned by the model, including trailing whitespace/control metadata. Never render or speak this. */
  promptText?: string;
  /** Long-term memories injected into the prompt for this reply (debug view). */
  memoriesUsed?: UsedMemory[];
  /** Suggested memories waiting for the user's decision. */
  memoryCandidates?: MemoryCandidate[];
  /** What was actually sent (debug view). */
  contextInfo?: ContextInfo;
  /** Verified retrieval metadata, stored separately from model-generated text. */
  citations?: EvidenceCitation[];
  /** Web findings Lumicos offers to keep in the knowledge library (RAG). */
  knowledgeCandidate?: KnowledgeCandidate;
}

export interface KnowledgeCandidate {
  status: 'pending' | 'saved' | 'dismissed';
  question: string;
  sources: { title?: string; url: string }[];
  file?: string;
  auto?: boolean;
  error?: string;
}

/* ------------------------------------------------------------------ */
/* Tools                                                               */
/* ------------------------------------------------------------------ */

export type ToolPermission = 'read' | 'write' | 'destructive';
export type ToolRunStatus = 'validating' | 'awaiting' | 'running' | 'done' | 'error' | 'denied' | 'cancelled';

export interface ToolPreview {
  action: string;
  target?: string;
  details?: string;
  warning?: string;
}

export interface ToolRun {
  id: string;
  tool: string;
  args: Record<string, unknown>;
  status: ToolRunStatus;
  permission?: ToolPermission;
  preview?: ToolPreview;
  /** Short human summary ("Read notes/a.md"). */
  summary?: string;
  /** What the model gets back (already size-limited by the service). */
  resultForModel?: string;
  error?: string;
  /** The model turn that requested this tool (sent back as context). */
  callText: string;
  data?: unknown;
}

/* ------------------------------------------------------------------ */
/* Memory                                                              */
/* ------------------------------------------------------------------ */

export const MEMORY_TYPES = ['user_fact', 'preference', 'project', 'decision', 'instruction', 'relationship', 'general'] as const;
export type MemoryType = (typeof MEMORY_TYPES)[number];

export interface Memory {
  id: string;
  type: MemoryType;
  content: string;
  tags: string[];
  importance: number;
  pinned: boolean;
  createdAt: string;
  updatedAt: string;
  sourceConversationId: string | null;
  sourceConversationTitle: string | null;
  /** null = shared by all characters */
  characterId: string | null;
  useCount: number;
  lastUsedAt: string | null;
}

export interface UsedMemory {
  id: string;
  type: MemoryType;
  content: string;
  score: number;
  reason: 'match' | 'pinned';
}

export interface MemoryCandidate {
  id: string;
  type: MemoryType;
  content: string;
  tags: string[];
  importance: number;
  source: 'rules' | 'model';
  status: 'pending' | 'saved' | 'ignored';
  memoryId?: string;
}

export interface ContextInfo {
  sentMessages: number;
  /** Optional context sections dropped to fit the window (e.g. context-summary, memory). */
  droppedContext?: string[];
  /** Material shortened (not dropped) to fit: older-turn, tool-result, evidence-excerpts, attachment. */
  shortened?: string[];
  /** The latest user turn and tool protocol could not fit even after trimming; the request is not sent. */
  overBudget?: boolean;
  droppedMessages: number;
  estimatedTokens: number;
  toolsIncluded: boolean;
}

export interface Conversation {
  syncVersion?: number;
  private?: boolean;
  /** Chosen when the chat is created: 'assistant' (default; tools + knowledge) or 'roleplay' (no web/library/file tools; image only). */
  mode?: 'assistant' | 'roleplay';
  /** Roleplay only: id of the last message folded into story.md (the "story so far" file). */
  roleplayStoryUpTo?: string;
  id: string;
  title: string;
  messages: ChatMessage[];
  /** Compact context for older turns; original messages remain intact. */
  contextSummary?: string;
  /** Id of the last message folded into contextSummary (rolling chat memory). */
  contextSummaryUpTo?: string;
  /** Fingerprint of the messages folded into contextSummary; a mismatch (edit/delete with the same ids) invalidates it. */
  contextSummarySig?: string;
  createdAt: number;
  updatedAt: number;
  characterId?: string;
  /** true once the user renamed it; stops auto-titling. */
  titleLocked?: boolean;
}

export interface GenerationStats {
  tokensGenerated: number;
  tokensPerSecond: number;
  durationMs: number;
  promptTokens?: number;
  /** Backend-reported prompt processing, never estimated. */
  promptProcessingMs?: number;
  /** True when llama.cpp reported a sleeping model immediately before this request. */
  sleepingBefore?: boolean;
  /** Measured request-to-first generated token time. */
  firstTokenMs?: number;
  /** Derived from real timings: firstToken - prompt eval - one decode token. */
  wakeMs?: number;
  gpuWaitMs?: number;
  slot?: number;
}

/* ------------------------------------------------------------------ */
/* Characters                                                          */
/* ------------------------------------------------------------------ */

export interface Character {
  id: string;
  name: string;
  /** Optional short name the character may go by. */
  nickname?: string;
  /** Data URL (uploaded & resized) or empty for the generated monogram. */
  avatar?: string;
  /** Short one-liner shown in the UI (and sent as "Description"). */
  description: string;
  personality: string;
  speakingStyle: string;
  /** How the character relates to the user, e.g. "Personal AI companion". */
  userRelationship?: string;
  /** One rule per line; leading "-" is optional. */
  behaviorRules?: string;
  /** Extra character-specific instructions, separate from the global system prompt. */
  systemPrompt: string;
  /** Greeting shown when a new chat starts (UI content; see Settings.greetingMode). */
  firstMessage: string;
  createdAt: number;
  updatedAt: number;
  /** Reserved for SillyTavern-style cards: lorebook ids, tags, creator notes… */
  extensions?: Record<string, unknown>;
}

/* ------------------------------------------------------------------ */
/* Settings                                                            */
/* ------------------------------------------------------------------ */

export type ThemeName = 'dark' | 'midnight' | 'light' | 'system';

/**
 * How a character's First Message reaches the model.
 * - 'context-note': described inside the system prompt (default; safe for strict chat templates)
 * - 'assistant-turn': sent as the first assistant message (SillyTavern style)
 * - 'ui-only': shown in the chat but never sent
 */
export type GreetingMode = 'context-note' | 'assistant-turn' | 'ui-only';
export type ProviderMode = 'llamacpp' | 'mock';

export interface GenerationParams {
  temperature: number;
  topP: number;
  maxTokens: number;
}

export interface InterfacePrefs {
  fontSize: 'small' | 'medium' | 'large';
  chatWidth: 'narrow' | 'comfortable' | 'wide';
  enterToSend: boolean;
  showReasoning: boolean;
}

export interface ToolSettings {
  /** 'auto' adds the tool list only when a message looks file-related (saves context). */
  mode: 'auto' | 'always' | 'off';
  /** Ask before WRITE actions. DESTRUCTIVE actions always ask. */
  confirmWrites: boolean;
  maxIterations: number;
}

export interface MemorySettings {
  enabled: boolean;
  maxInjected: number;
  /** Suggest memories from your messages (you approve each one). */
  autoCandidates: boolean;
}

export interface DeveloperSettings {
  memoryDebug: boolean;
  toolDebug: boolean;
  /** Show user-made (roleplay) characters in the agent picker. */
  showRoleplayAgents?: boolean;
}

export interface KnowledgeSettings {
  enabled: boolean;
  /** Unified web-search policy. webEnabled is retained only for saved-settings compatibility. */
  searchMode: 'AUTO' | 'ON' | 'OFF';
  webEnabled?: boolean;
  route: 'AUTO' | 'DIRECT' | 'LOCAL' | 'WEB' | 'HYBRID' | 'MEMORY';
  /** What to do with answers found on the web: ask before saving to the library, save automatically, or never. */
  learnMode?: 'ask' | 'auto' | 'off';
  timeoutMs: number;
  limit: number;
  maxEvidenceChars: number;
}

export type ChatReasoningMode = 'FAST' | 'AUTO' | 'DEEP';
export interface ChatLatency {
 selected:ChatReasoningMode; effective:'FAST'|'DEEP'; reason:string;
 routingMs:number; contextPreparationMs:number; toolExecutionMs:number; totalMs:number;
 firstTokenMs?:number; firstTextMs?:number; reasoningMs?:number; promptProcessingMs?:number;
 sleepingBefore?:boolean; wakeMs?:number; knowledgeMs?:number;
  contextSummaryMs?:number; persistenceMs?:number; eventDispatchMs?:number;
 inferenceRounds:number; reasoningObserved:boolean;
 searchMs?:number; totalResponseMs?:number;
}

export interface Settings {
  version: 3;
  userName: string;
  theme: ThemeName;
  appearance?: { style: 'lumicos' | 'monochrome'; glow: boolean; density: 'comfortable' | 'compact' };
  ui: InterfacePrefs;
  provider: ProviderMode;
  serverUrl: string;
  generation: GenerationParams;
  chatReasoningMode: ChatReasoningMode;
  /** Global system prompt, applied to every character. */
  systemPrompt: string;
  activeCharacterId?: string;
  greetingMode: GreetingMode;
  /** Sidebar history filter: only the current character's chats, or all. */
  historyFilter: 'character' | 'all';
  tools: ToolSettings;
  memory: MemorySettings;
  knowledge: KnowledgeSettings;
  developer: DeveloperSettings;
  sidebarOpen: boolean;
  rightPanelOpen: boolean;
}

/* ------------------------------------------------------------------ */
/* Backend                                                             */
/* ------------------------------------------------------------------ */

export type ConnectionState = 'checking' | 'online' | 'loading' | 'offline';
export type ServiceState = 'checking' | 'online' | 'offline';
export type AIState = ConnectionState | 'generating';

export interface ServerInfo {
  modelId?: string;
  contextSize?: number;
}
