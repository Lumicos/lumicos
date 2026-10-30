import type { GenerationStats, ServerInfo } from '../types';
import { modelTurnId } from '../services/models';
import { readSSE } from './sse';
import type { ChatRequest, ConnectionResult, LLMProvider, StreamCallbacks } from './types';

/**
 * Real provider for llama.cpp's llama-server (OpenAI-compatible API).
 *
 *   GET  /health               200 = ready, 503 = still loading the model
 *   GET  /v1/models            model id (the GGUF file name / alias)
 *   GET  /props                n_ctx (context size)
 *   POST /v1/chat/completions  { stream: true } -> Server-Sent Events
 *
 * Streaming is real: each SSE chunk is rendered the moment it arrives.
 * Stop = AbortController; llama-server cancels the task when the client
 * disconnects and keeps the model loaded.
 */
export class LlamaCppProvider implements LLMProvider {
  readonly id = 'llamacpp';
  readonly label = 'llama.cpp';
  readonly isMock = false;
  private readonly baseUrl: string;
  private transport: typeof fetch;
  private turnId: () => string | undefined;

  constructor(baseUrl: string, transport: typeof fetch = fetch, turnId: () => string | undefined = modelTurnId) {
    this.transport=transport;this.turnId=turnId;
    this.baseUrl = baseUrl.trim().replace(/\/+$/, '');
  }

  async checkConnection(): Promise<ConnectionResult> {
    let res: Response;
    try {
      res = await fetch(`${this.baseUrl}/health`, { signal: AbortSignal.timeout(4000) });
    } catch {
      return { state: 'offline', info: {}, detail: `No response from ${this.baseUrl}` };
    }
    if (res.status === 503) return { state: 'loading', info: {}, detail: 'Model is loading' };
    if (!res.ok) return { state: 'offline', info: {}, detail: `/health returned ${res.status}` };
    return { state: 'online', info: await this.fetchInfo() };
  }

  private async fetchInfo(): Promise<ServerInfo> {
    const info: ServerInfo = {};
    const get = async (path: string) => {
      try {
        const r = await fetch(`${this.baseUrl}${path}`, { signal: AbortSignal.timeout(4000) });
        return r.ok ? await r.json() : undefined;
      } catch {
        return undefined;
      }
    };
    const [models, props] = await Promise.all([get('/v1/models'), get('/props')]);
    const id: string | undefined = models?.data?.[0]?.id ?? models?.models?.[0]?.name;
    if (id) info.modelId = id.split(/[\\/]/).pop();
    const nCtx = props?.default_generation_settings?.n_ctx ?? props?.n_ctx;
    if (typeof nCtx === 'number') info.contextSize = nCtx;
    return info;
  }

  async streamChat({ purpose = 'other', correlationId, messages, params, enableThinking, cachePrompt }: ChatRequest, cb: StreamCallbacks, signal: AbortSignal) {
    let stats: GenerationStats | undefined;
    let finishReason: string | undefined;
    const requestStarted=performance.now();
    let firstTokenMs:number|undefined;
    let sleepingBefore:boolean|undefined;

    try {
      try {const props=await this.transport('/llama/props',{headers:{'X-PersonalAI':'1'},signal:AbortSignal.any([signal,AbortSignal.timeout(2000)])});if(props.ok)sleepingBefore=(await props.json()).is_sleeping===true}catch{}
      const res = await this.transport('/api/inference', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-PersonalAI':'1' },
        signal,
        body: JSON.stringify({ serverUrl: this.baseUrl, turnId: this.turnId(), purpose, correlationId, request: {
          messages,
          stream: true,
          temperature: params.temperature,
          top_p: params.topP,
          max_tokens: params.maxTokens,
          ...(cachePrompt === undefined ? {} : {cache_prompt: cachePrompt}),
          ...(enableThinking === undefined ? {} : {chat_template_kwargs: {enable_thinking: enableThinking}}),
        }}),
      });

      if (!res.ok || !res.body) throw new Error(await describeHttpError(res));
      const gpuWaitMs=Number(res.headers.get('x-lumicos-gpu-wait-ms'));
      const slot=Number(res.headers.get('x-lumicos-llama-slot'));

      for await (const data of readSSE(res.body)) {
        if (data === '[DONE]') break;
        let chunk: any;
        try {
          chunk = JSON.parse(data);
        } catch {
          continue;
        }
        if (chunk.error) throw new Error(chunk.error.message ?? JSON.stringify(chunk.error));

        if(chunk.choices?.[0]?.finish_reason)finishReason=chunk.choices[0].finish_reason;
        const delta = chunk.choices?.[0]?.delta;
        if (delta?.reasoning_content) {firstTokenMs??=performance.now()-requestStarted;cb.onReasoning?.(delta.reasoning_content);}
        if (delta?.content) {firstTokenMs??=performance.now()-requestStarted;cb.onToken(delta.content);}

        // Only llama-server's own measurements are used — never estimates.
        const t = chunk.timings;
        if (t && typeof t.predicted_n === 'number' && typeof t.predicted_per_second === 'number') {
          stats = {
            tokensGenerated: t.predicted_n,
            tokensPerSecond: t.predicted_per_second,
            durationMs: t.predicted_ms,
            promptTokens: t.prompt_n,
            ...(typeof t.prompt_ms==='number'?{promptProcessingMs:t.prompt_ms}:{}),
            ...(sleepingBefore===undefined?{}:{sleepingBefore}),
            ...(firstTokenMs===undefined?{}:{firstTokenMs}),
            ...(firstTokenMs!==undefined&&typeof t.prompt_ms==='number'&&t.predicted_per_second>0?{wakeMs:Math.max(0,firstTokenMs-t.prompt_ms-1000/t.predicted_per_second)}:{}),
            ...(Number.isFinite(gpuWaitMs)?{gpuWaitMs}:{}),
            ...(Number.isInteger(slot)?{slot}:{}),
          };
        }
      }
      cb.onDone({ stats, stopped: false, finishReason });
    } catch (err: any) {
      if (err?.name === 'AbortError') return cb.onDone({ stopped: true });
      if (err instanceof TypeError) {
        return cb.onError(
          new Error(
            `Cannot reach llama-server at ${this.baseUrl}. Check that it is running and the URL in Settings is correct. (${err.message})`,
          ),
        );
      }
      cb.onError(err instanceof Error ? err : new Error(String(err)));
    }
  }
}

async function describeHttpError(res: Response): Promise<string> {
  const body = await res.text().catch(() => '');
  let message = body;
  try {
    message = JSON.parse(body)?.error?.message ?? body;
  } catch {
    /* plain text */
  }
  if (res.status === 503) return 'llama-server is still loading the model. Try again in a moment.';
  return `llama-server error ${res.status}: ${message.slice(0, 400) || res.statusText}`;
}
