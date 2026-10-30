import type { ConnectionState, GenerationParams, GenerationStats, Role, ServerInfo } from '../types';

/** A message in the format sent to the model (UI-only fields stripped). */
export interface LLMTextPart {
  type: 'text';
  text: string;
}

export interface LLMImagePart {
  type: 'image_url';
  image_url: {
    url: string;
  };
}

export type LLMContent = string | Array<LLMTextPart | LLMImagePart>;

export interface LLMMessage {
  role: Exclude<Role, 'tool'>;
  content: LLMContent;
}

export interface ChatRequest {
  purpose?: 'chat-reply' | 'chat-tool-step' | 'context-summary' | 'image-prompt' | 'call-reply' | 'memory-extract' | 'other';
  correlationId?: string;
  messages: LLMMessage[];
  params: GenerationParams;
  enableThinking?: boolean;
  cachePrompt?: boolean;
}

export interface StreamCallbacks {
  onToken: (text: string) => void;
  onReasoning?: (text: string) => void;
  /** stats is undefined when the backend did not report real numbers. */
  onDone: (result: { stats?: GenerationStats; stopped: boolean; finishReason?: string }) => void;
  onError: (err: Error) => void;
}

export interface ConnectionResult {
  state: ConnectionState;
  info: ServerInfo;
  detail?: string;
}

/**
 * The UI talks to an LLMProvider, never to HTTP directly.
 * Today: llama.cpp. Later a ToolRouter can wrap it (ComfyUI, memory…)
 * by implementing the same interface.
 */
export interface LLMProvider {
  readonly id: string;
  readonly label: string;
  readonly isMock: boolean;
  checkConnection(): Promise<ConnectionResult>;
  streamChat(request: ChatRequest, callbacks: StreamCallbacks, signal: AbortSignal): Promise<void>;
}
