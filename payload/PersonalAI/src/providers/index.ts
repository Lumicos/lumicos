import { MOCK_AVAILABLE } from '../config/defaults';
import type { Settings } from '../types';
import { LlamaCppProvider } from './llamaCppProvider';
import { MockProvider } from './mock/mockProvider';
import type { LLMProvider } from './types';

/**
 * Picks the provider for the current settings.
 * When VITE_ENABLE_MOCK is not "true", the mock branch is dead code and
 * Vite drops MockProvider from the bundle. To remove it from the source
 * entirely: delete src/providers/mock/ and the two mock lines below.
 */
export function createProvider(settings: Pick<Settings, 'provider' | 'serverUrl'>): LLMProvider {
  if (MOCK_AVAILABLE && settings.provider === 'mock') return new MockProvider();
  return new LlamaCppProvider('/llama');
}

export type { LLMProvider } from './types';
