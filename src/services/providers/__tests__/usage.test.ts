import { describe, expect, it } from 'vitest';
import { anthropicUsage, openAIUsage } from '../usage';

describe('provider token usage', () => {
  it('preserves reported zero and leaves omitted fields unknown', () => {
    expect(openAIUsage({ prompt_tokens: 0, completion_tokens: 0 })).toEqual({ inputTokens: 0, outputTokens: 0 });
    expect(openAIUsage({ prompt_tokens: -1, completion_tokens: '10', prompt_cache_hit_tokens: NaN })).toBeUndefined();
    expect(openAIUsage(null)).toBeUndefined();
  });

  it('normalizes Anthropic input including both cache categories', () => {
    expect(anthropicUsage({ input_tokens: 10, output_tokens: 1, cache_read_input_tokens: 80, cache_creation_input_tokens: 30 })).toEqual({ inputTokens: 120, outputTokens: 1, cachedInputTokens: 80 });
    expect(anthropicUsage({ output_tokens: 25 })).toEqual({ outputTokens: 25 });
  });
});
