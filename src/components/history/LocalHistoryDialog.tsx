import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { clearDesktopHistory, listDesktopHistory, readDesktopHistory, restoreDesktopHistory, useStorageStatus } from '../../services/storage/runtime';
import { buildHistoryView } from '../../services/storage/historyView';
import type { HistoryDetail, HistoryEntry } from '../../services/storage/types';
import { HistoryItemDiff } from './HistoryItemDiff';
import { useCancelLayer } from '../../hooks/useCancelLayer';

const changeNames = { added: '新增', removed: '删除', modified: '修改' };

// 一次操作一条记录；选中后按会话与问答组查看，左右固定比较该操作前后。
export function LocalHistoryDialog({ workspaceId, workspaceName, close }: { workspaceId: string; workspaceName: string; close: () => void }) {
  const [entries, setEntries] = useState<HistoryEntry[] | null>(null);
  const [entryId, setEntryId] = useState('');
  const [refreshId, setRefreshId] = useState(0);
  const [itemId, setItemId] = useState('');
  const [loaded, setLoaded] = useState<{ id: string; data?: HistoryDetail; error?: string } | null>(null);
  const [error, setError] = useState('');
  const [side, setSide] = useState<'before' | 'after'>('before');
  const [scope, setScope] = useState<'item' | 'conversation' | 'workspace'>('item');
  const busy = useStorageStatus((state) => state.busy);
  const dialog = useRef<HTMLDivElement>(null);
  useEffect(() => { const previous = document.body.style.overflow; document.body.style.overflow = 'hidden'; return () => { document.body.style.overflow = previous; }; }, []);
  const refresh = useCallback(async () => {
    try {
      const next = await listDesktopHistory();
      setEntries(next); setEntryId((old) => next.some((entry) => entry.id === old) ? old : next[0]?.id ?? ''); setError('');
      setRefreshId((value) => value + 1);
    } catch (failure) { setError(String(failure)); }
  }, []);
  useEffect(() => { void Promise.resolve().then(refresh); }, [refresh]);
  useEffect(() => {
    if (!entryId) return;
    let active = true;
    void readDesktopHistory(entryId, workspaceId).then((data) => { if (active) setLoaded({ id: entryId, data }); }).catch((failure) => { if (active) setLoaded({ id: entryId, error: String(failure) }); });
    return () => { active = false; };
    // 初始化记录会原地合并，刷新列表后即使 ID 相同也要重新读取正文。
  }, [entryId, workspaceId, refreshId]);
  useCancelLayer(true, () => { if (!busy) close(); }, 2000);
  const detail = loaded?.id === entryId ? loaded.data : undefined;
  const conversations = useMemo(() => detail ? buildHistoryView(detail) : [], [detail]);
  const chosenConversation = conversations.find((conversation) => conversation.items.some((item) => item.id === itemId)) ?? conversations[0];
  const chosenItem = chosenConversation?.items.find((item) => item.id === itemId) ?? chosenConversation?.items.find((item) => item.selection.documentIds) ?? chosenConversation?.items[0];
  const invalidItemScope = scope === 'item' && (!chosenItem || (chosenItem.selection.attributesOnly && chosenConversation?.kind !== 'modified'));
  const restore = async () => {
    if (!detail || invalidItemScope) return;
    const range = scope === 'workspace' ? `整个工作区“${workspaceName}”` : scope === 'conversation' ? `整个会话“${chosenConversation.title}”（包含其他问答及属性）` : `“${chosenConversation.title}”中的“${chosenItem.title}”`;
    if (!window.confirm(`将${range}还原到本次操作${side === 'before' ? '前' : '后'}？\n此操作不能撤销，并会清空当前工作区的撤销／重做队列。`)) return;
    const success = await restoreDesktopHistory(detail.id, side, scope === 'workspace' ? undefined : chosenConversation.id, scope === 'item' ? chosenItem.selection : undefined);
    if (success) close();
  };
  const button = 'rounded border border-border px-3 py-1.5 text-sm hover:bg-surface-800 disabled:opacity-40';
  return createPortal(<div ref={dialog} role="dialog" aria-modal="true" aria-label="本地历史" className="fixed inset-0 z-[2000] flex items-center justify-center bg-black/45 p-3 sm:p-6" onKeyDown={(event) => {
    if (event.key !== 'Tab') return;
    const targets = [...(dialog.current?.querySelectorAll<HTMLElement>('button:not(:disabled),select:not(:disabled),input:not(:disabled)') ?? [])].filter((element) => element.getClientRects().length);
    const first = targets[0]; const last = targets.at(-1);
    if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
    else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
  }}>
    <div className="flex h-[92vh] w-[96vw] max-w-[1800px] flex-col overflow-hidden rounded-xl border border-border bg-surface-900 text-text-primary shadow-2xl">
      <header className="flex shrink-0 items-center gap-3 border-b border-border px-4 py-3"><h2 className="min-w-0 flex-1 truncate font-semibold">本地历史 · {workspaceName}</h2><button className={button} onClick={() => void refresh()} disabled={busy}>刷新记录</button><button className={button} onClick={close} disabled={busy} autoFocus>关闭</button></header>
      <div className="flex min-h-0 flex-1 flex-col md:flex-row">
        <aside className="grid h-56 shrink-0 grid-cols-2 divide-x divide-border border-b border-border md:flex md:h-auto md:w-72 md:flex-col md:divide-x-0 md:border-b-0 md:border-r">
          <section className="min-h-0 flex-1 overflow-auto p-2" aria-label="修改记录"><h3 className="px-2 py-1 text-xs font-medium text-text-muted">修改记录</h3>
            {!entries && !error && <p role="status" className="p-2 text-sm">正在读取记录…</p>}
            {entries?.length === 0 && <p className="p-2 text-sm text-text-muted">暂无历史记录。内容修改后会开始记录。</p>}
            {entries?.map((entry) => <button key={entry.id} aria-pressed={entry.id === entryId} className={`mb-1 block w-full rounded-lg p-2 text-left text-sm ${entry.id === entryId ? 'bg-accent-500/15 text-accent-400' : 'hover:bg-surface-800'}`} onClick={() => setEntryId(entry.id)}><span className="block">{entry.label}</span><time className="text-xs text-text-muted" dateTime={new Date(entry.createdAt).toISOString()}>{new Date(entry.createdAt).toLocaleString()}</time></button>)}
          </section>
          <section className="min-h-0 min-w-0 flex-1 overflow-auto p-2 md:border-t md:border-border" aria-label="涉及内容"><h3 className="px-2 py-1 text-xs font-medium text-text-muted">本次涉及的内容</h3>
            {conversations.map((conversation) => <details key={conversation.id} open className="mb-2 min-w-0">
              <summary className="cursor-pointer whitespace-nowrap rounded px-2 py-1 text-sm">
                <span className="inline-flex w-[calc(100%-1rem)] min-w-0 items-center gap-1 align-middle">
                  <span className="min-w-0 truncate" title={conversation.title}>{conversation.title}</span>
                  <span className="shrink-0 text-xs text-text-muted">{changeNames[conversation.kind]}</span>
                </span>
              </summary>
              {conversation.items.map((item) => <button key={item.id} aria-pressed={item.id === chosenItem?.id} className={`ml-2 flex w-[calc(100%-0.5rem)] min-w-0 items-center gap-1 rounded px-2 py-1.5 text-left text-xs ${item.id === chosenItem?.id ? 'bg-accent-500/15 text-accent-400' : 'hover:bg-surface-800'}`} onClick={() => setItemId(item.id)}>
                <span className="shrink-0 text-text-muted">{changeNames[item.kind]}</span>
                <span className="min-w-0 truncate" title={item.title}>{item.title}</span>
              </button>)}
            </details>)}
            {detail && !conversations.length && <p className="p-2 text-sm text-text-muted">这条记录没有可展示的内容差异。</p>}
          </section>
        </aside>
        <main className="flex min-h-0 min-w-0 flex-1 flex-col" aria-label="原文差异">
          <div className="shrink-0 border-b border-border px-4 py-2 text-sm">{chosenItem ? `${chosenConversation.title} / ${chosenItem.title}` : '选择修改记录和具体内容'}<span className="ml-2 text-xs text-text-muted">Markdown 原文对比</span></div>
          <div className="grid shrink-0 grid-cols-2 divide-x divide-border border-b border-border bg-surface-800 px-4 py-2 text-sm"><span>本次操作前</span><span className="pl-4">本次操作后</span></div>
          <div className="min-h-0 flex-1 overflow-auto">
            {error && <p role="alert" className="p-4 text-red-400">{error}</p>}
            {entryId && !detail && <p role={loaded?.id === entryId && loaded.error ? 'alert' : 'status'} className="p-4 text-sm text-text-muted">{loaded?.id === entryId && loaded.error ? loaded.error : '正在读取这次修改的内容…'}</p>}
            {detail && chosenItem && <HistoryItemDiff key={`${entryId}:${chosenItem.id}`} item={chosenItem} />}
          </div>
        </main>
      </div>
      <footer className="shrink-0 border-t border-border px-4 py-3"><div className="flex flex-wrap items-center gap-2">
        <label className="text-sm">还原范围 <select aria-label="还原范围" value={scope} onChange={(event) => setScope(event.target.value as typeof scope)} className="rounded border border-border bg-surface-800 px-2 py-1.5"><option value="item">选中内容</option><option value="conversation">整个选中会话</option><option value="workspace">整个工作区</option></select></label>
        <label className="text-sm">还原到 <select aria-label="还原版本" value={side} onChange={(event) => setSide(event.target.value as typeof side)} className="rounded border border-border bg-surface-800 px-2 py-1.5"><option value="before">本次操作前</option><option value="after">本次操作后</option></select></label>
        <button className={`${button} bg-accent-500/15 text-accent-400`} disabled={!detail || busy || invalidItemScope || (scope !== 'workspace' && !chosenConversation)} onClick={() => void restore()}>还原</button>
        {invalidItemScope && chosenItem?.selection.attributesOnly && <span className="text-xs text-text-muted">新增或删除会话的属性需通过“整个选中会话”还原。</span>}
        <button className={`${button} ml-auto text-red-400`} disabled={busy || !entries?.length} onClick={async () => { if (window.confirm('永久清空当前工作区在本设备的本地历史？')) { await clearDesktopHistory(); await refresh(); } }}>清空本地历史</button>
      </div><p className="mt-2 text-xs text-text-muted">还原不可撤销，并清空撤销／重做队列。仅保存在本设备；默认保留 30 天、最多 200 次操作或约 64 MiB。</p></footer>
    </div>
  </div>, document.body);
}
