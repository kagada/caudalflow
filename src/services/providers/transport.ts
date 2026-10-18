export function isDesktopRuntime(): boolean {
  return typeof window !== 'undefined' && window.location.protocol === 'app:' && window.location.hostname === 'caudalflow';
}

// 桌面端由 Electron 内部转发 API 并保留响应流；网页版继续直接请求服务商。
export function apiFetch(url: string, options?: RequestInit): Promise<Response> {
  return fetch(isDesktopRuntime() ? `app://caudalflow/api/proxy?url=${encodeURIComponent(url)}` : url, options);
}

// 部分兼容接口拒绝统计参数；仅在明确的参数校验错误后去掉该参数重试。
export async function usageAwareChatFetch(url: string, options: RequestInit): Promise<Response> {
  const response = await apiFetch(url, options);
  if (![400, 422].includes(response.status) || typeof options.body !== 'string') return response;
  const error = await response.clone().text();
  if (!/\b(stream_options|include_usage)\b/.test(error)) return response;
  const body = JSON.parse(options.body);
  if (!body.stream_options) return response;
  delete body.stream_options;
  return apiFetch(url, { ...options, body: JSON.stringify(body) });
}
