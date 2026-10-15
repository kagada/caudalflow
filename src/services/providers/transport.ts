export function isDesktopRuntime(): boolean {
  return typeof window !== 'undefined' && window.location.protocol === 'app:' && window.location.hostname === 'caudalflow';
}

// 桌面端由 Electron 内部转发 API 并保留响应流；网页版继续直接请求服务商。
export function apiFetch(url: string, options?: RequestInit): Promise<Response> {
  return fetch(isDesktopRuntime() ? `app://caudalflow/api/proxy?url=${encodeURIComponent(url)}` : url, options);
}
