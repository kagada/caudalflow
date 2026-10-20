import { create } from 'zustand';

// 临时调试入口：关闭后既不采集也不呈现；此 store 不接入任何持久化路径。
export const WEB_SEARCH_DEBUG = true;
export interface WebSearchDebugEvent { stage: string; data: unknown }
interface DebugEntry extends WebSearchDebugEvent { time: number }
interface DebugRun { id: string; workspaceId: string | null; nodeId: string; documentId?: string; entries: DebugEntry[] }
export const useWebSearchDebug = create<{ runs: DebugRun[] }>(() => ({ runs: [] }));

// 每次生成独立记录，限制数量，避免长期开着页面导致调试数据无限增长。
export function createWebSearchDebugger(workspaceId: string | null, nodeId: string, documentId?: string) {
  if (!WEB_SEARCH_DEBUG) return undefined;
  const id = crypto.randomUUID();
  return (event: WebSearchDebugEvent) => {
    if (!WEB_SEARCH_DEBUG) return;
    useWebSearchDebug.setState(({ runs }) => {
      const existing = runs.find((run) => run.id === id);
      const run: DebugRun = { id, workspaceId, nodeId, documentId, entries: [...(existing?.entries ?? []), { ...event, time: Date.now() }].slice(-100) };
      return { runs: [...runs.filter((item) => item.id !== id), run].slice(-30) };
    });
  };
}
