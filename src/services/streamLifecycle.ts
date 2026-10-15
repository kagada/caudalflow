const running = new Set<AbortController>();

// 工作区切换、删除或撤销时统一停止请求，丢弃晚到的 token，避免写回另一份内容。
export function trackGeneration(signal: AbortSignal) {
  const controller = new AbortController();
  const abort = () => { controller.abort(); running.delete(controller); };
  signal.addEventListener('abort', abort, { once: true });
  if (signal.aborted) controller.abort();
  running.add(controller);
  return { controller, release: () => { signal.removeEventListener('abort', abort); running.delete(controller); } };
}

export function cancelAllGenerations() {
  for (const controller of running) controller.abort();
  running.clear();
}
