/**
 * DEMO PROVIDER — for UI work without a running llama-server.
 * It is only compiled in when VITE_ENABLE_MOCK=true (`npm run dev:mock`).
 * It never pretends to be the real model: every reply is labelled as demo,
 * and it reports no statistics.
 * Safe to delete this folder; see src/providers/index.ts.
 */
import type { ChatRequest, ConnectionResult, LLMProvider, StreamCallbacks } from '../types';

export class MockProvider implements LLMProvider {
  readonly id = 'mock';
  readonly label = 'Demo (mock)';
  readonly isMock = true;

  async checkConnection(): Promise<ConnectionResult> {
    return { state: 'online', info: { modelId: 'demo-mock' } };
  }

  async streamChat({ messages }: ChatRequest, cb: StreamCallbacks, signal: AbortSignal) {
    const last = messages.filter((m) => m.role === 'user').at(-1)?.content ?? '';
    const system = messages.find((m) => m.role === 'system')?.content ?? '';
    const reply =
      `*Demo mode — this is not a real model.*\n\n` +
      `You said: **${last}**\n\n` +
      `- Messages in context: ${messages.length}\n` +
      `- System prompt: ${system ? `${system.length} characters` : 'none'}\n\n` +
      '```ts\nconst mode = "mock"; // switch to llama.cpp in Settings → Connection\n```';

    const pieces = reply.match(/\s*\S+|\s+/g) ?? [];
    for (const piece of pieces) {
      if (signal.aborted) return cb.onDone({ stopped: true });
      await new Promise((r) => setTimeout(r, 30));
      cb.onToken(piece);
    }
    cb.onDone({ stopped: false }); // no fake stats
  }
}
