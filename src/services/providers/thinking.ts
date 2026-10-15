import type { LLMConfig } from '../../types/chat';

export function isDeepSeekEndpoint(endpoint: string): boolean {
  try { return new URL(endpoint.trim()).hostname === 'api.deepseek.com'; } catch { return false; }
}

// DeepSeek 默认先思考，普通学习问答默认关闭；其他兼容接口不发送专有参数。
export function thinkingParameters(endpoint: string, mode?: LLMConfig['thinkingMode']) {
  if (!isDeepSeekEndpoint(endpoint) || mode === 'auto') return {};
  return { thinking: { type: mode ?? 'disabled' } };
}
