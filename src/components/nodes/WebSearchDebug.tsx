import { WEB_SEARCH_DEBUG, useWebSearchDebug } from '../../services/webSearchDebug';
import { useWorkspaceStore } from '../../stores/workspaceStore';

// 独立渲染临时记录，不把调试文本放入可引用、可回放的聊天正文。
export function WebSearchDebug({ nodeId }: { nodeId: string }) {
  const workspaceId = useWorkspaceStore((state) => state.activeWorkspaceId);
  const runs = useWebSearchDebug((state) => state.runs);
  const current = runs.filter((run) => run.workspaceId === workspaceId && run.nodeId === nodeId);
  if (!WEB_SEARCH_DEBUG || !current.length) return null;
  return <details className="nowheel nodrag nopan mx-4 my-2 rounded-lg border border-amber-500/30 p-3 text-xs text-text-secondary" data-web-search-debug>
    <summary className="cursor-pointer">联网调试（仅内存） · {current.length} 次回复</summary>
    <button type="button" className="my-2 text-text-muted hover:text-text-primary" onClick={() => useWebSearchDebug.setState(({ runs }) => ({ runs: runs.filter((run) => run.workspaceId !== workspaceId || run.nodeId !== nodeId) }))}>清空调试记录</button>
    <div className="max-h-96 space-y-3 overflow-auto select-text" onMouseUp={(event) => event.stopPropagation()} onContextMenu={(event) => event.stopPropagation()}>
      {current.map((run) => <details key={run.id} open className="border-t border-border pt-2">
        <summary className="cursor-pointer">回复 {run.documentId ?? run.id} · {new Date(run.entries[0].time).toLocaleTimeString()}</summary>
        {run.entries.map((entry, index) => <details key={index} className="mt-2">
          <summary className="cursor-pointer">{new Date(entry.time).toLocaleTimeString()} · {entry.stage}</summary>
          <pre className="mt-1 whitespace-pre-wrap break-all rounded bg-surface-900 p-2">{JSON.stringify(entry.data, null, 2)}</pre>
        </details>)}
      </details>)}
    </div>
  </details>;
}
