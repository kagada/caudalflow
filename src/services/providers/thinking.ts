import type { LLMConfig } from '../../types/chat';

export function isDeepSeekEndpoint(endpoint: string): boolean {
  try { return new URL(endpoint.trim()).hostname === 'api.deepseek.com'; } catch { return false; }
}

// 仅向 DeepSeek 发送其专有思考参数，未提供模式的旧配置继续默认关闭。
export function thinkingParameters(endpoint: string, mode?: LLMConfig['thinkingMode'], effort?: string, providerId?: string) {
  if ((providerId !== 'deepseek' && !isDeepSeekEndpoint(endpoint)) || mode === 'auto') return {};
  // 辅助请求显式关闭思考时不携带强度，避免继承会话强度后重新开启思考。
  return { thinking: { type: mode ?? 'disabled' }, ...(mode === 'enabled' && effort ? { reasoning_effort: effort } : {}) };
}
