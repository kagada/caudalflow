import type { TokenUsage } from '../../types/chat';

const count = (value: unknown) => typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 ? value : undefined;

// 统一兼容接口的字段名；保留零值，跳过缺失和无效计数。
export function openAIUsage(value: unknown): TokenUsage | undefined {
  if (!value || typeof value !== 'object') return;
  const raw = value as Record<string, unknown>;
  const details = raw.prompt_tokens_details as Record<string, unknown> | undefined;
  const inputTokens = count(raw.prompt_tokens);
  const outputTokens = count(raw.completion_tokens);
  const cachedInputTokens = count(details?.cached_tokens) ?? count(raw.prompt_cache_hit_tokens);
  return usageFields(inputTokens, outputTokens, cachedInputTokens);
}

// Anthropic 的普通输入、缓存读取和缓存写入共同组成总输入。
export function anthropicUsage(value: unknown): TokenUsage | undefined {
  if (!value || typeof value !== 'object') return;
  const raw = value as Record<string, unknown>;
  const input = count(raw.input_tokens);
  const cached = count(raw.cache_read_input_tokens);
  const written = count(raw.cache_creation_input_tokens);
  return usageFields(input === undefined ? undefined : input + (cached ?? 0) + (written ?? 0), count(raw.output_tokens), cached);
}

function usageFields(inputTokens?: number, outputTokens?: number, cachedInputTokens?: number): TokenUsage | undefined {
  const fields = Object.fromEntries(Object.entries({ inputTokens, outputTokens, cachedInputTokens }).filter(([, value]) => value !== undefined));
  if (Object.keys(fields).length) return fields;
}
