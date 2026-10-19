import type { LLMConfig } from '../../types/chat';

export function isDeepSeekEndpoint(endpoint: string): boolean {
  try { return new URL(endpoint.trim()).hostname === 'api.deepseek.com'; } catch { return false; }
}

function isBailianEndpoint(endpoint: string): boolean {
  try {
    const hostname = new URL(endpoint.trim()).hostname;
    return hostname === 'dashscope.aliyuncs.com' || /^dashscope-[a-z-]+\.aliyuncs\.com$/.test(hostname) || hostname.endsWith('.maas.aliyuncs.com');
  } catch { return false; }
}

// 开关按供应商协议发送；强度只透传选中的原值，不为任何供应商写死档位。
export function thinkingParameters(endpoint: string, mode?: LLMConfig['thinkingMode'], effort?: string, providerId?: string) {
  if (mode === 'auto') return {};
  const effortParameters = mode === 'enabled' && effort ? { reasoning_effort: effort } : {};
  if (providerId === 'bailian' || isBailianEndpoint(endpoint)) return { enable_thinking: mode === 'enabled', ...effortParameters };
  if (providerId !== 'deepseek' && !isDeepSeekEndpoint(endpoint)) return effortParameters;
  // 辅助请求显式关闭思考时不携带强度，避免继承会话强度后重新开启思考。
  return { thinking: { type: mode ?? 'disabled' }, ...effortParameters };
}
