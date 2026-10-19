import type { LLMProvider } from './types';
import { MockProvider } from './mock';
import { OpenAIProvider } from './openai';
import { AnthropicProvider } from './anthropic';
import { CustomProvider } from './custom';
import { DeepSeekProvider } from './deepseek';
import { BailianProvider } from './bailian';

const providers = new Map<string, LLMProvider>();

function register(provider: LLMProvider) {
  providers.set(provider.id, provider);
}

register(MockProvider);
register(OpenAIProvider);
register(AnthropicProvider);
register(CustomProvider);
register(DeepSeekProvider);
register(BailianProvider);

export function getProvider(id: string): LLMProvider | undefined {
  return providers.get(id);
}

export function listProviders(): LLMProvider[] {
  return Array.from(providers.values());
}
