import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { FolderOpen, History, Redo2, Undo2 } from 'lucide-react';
import { clearDesktopHistory, listDesktopHistory, openDesktopWorkspace, replayDesktopCommand, restoreDesktopHistory, useStorageStatus } from '../../services/storage/runtime';
import type { HistoryEntry } from '../../services/storage/types';

// 文字输入继续使用浏览器原生撤销；画布内容操作才交给工作区操作栈。
export function StorageControls() {
  const status = useStorageStatus();
  const [entries, setEntries] = useState<HistoryEntry[] | null>(null);
  const [error, setError] = useState('');
  useEffect(() => {
    const keydown = (event: KeyboardEvent) => {
      if (!(event.ctrlKey || event.metaKey) || event.altKey) return;
      const target = event.target as HTMLElement;
      if (target.closest('input,textarea,[contenteditable="true"]')) return;
      const key = event.key.toLowerCase();
      if (key !== 'z' && key !== 'y') return;
      event.preventDefault();
      void replayDesktopCommand(key === 'y' || event.shiftKey ? 'redo' : 'undo');
    };
    document.addEventListener('keydown', keydown);
    return () => document.removeEventListener('keydown', keydown);
  }, []);
  const openHistory = async () => {
    try { setEntries(await listDesktopHistory()); setError(''); }
    catch (failure) { setError(String(failure)); }
  };
  const button = 'p-1.5 text-text-muted hover:text-text-primary disabled:opacity-30';
  return <>
    <button title="打开工作区文件" aria-label="打开工作区文件" className={button} disabled={status.busy} onClick={() => void openDesktopWorkspace()}><FolderOpen size={15} /></button>
    <button title="撤销内容操作 (Ctrl+Z)" aria-label="撤销内容操作" className={button} disabled={!status.canUndo || status.busy} onClick={() => void replayDesktopCommand('undo')}><Undo2 size={15} /></button>
    <button title="重做内容操作 (Ctrl+Shift+Z / Ctrl+Y)" aria-label="重做内容操作" className={button} disabled={!status.canRedo || status.busy} onClick={() => void replayDesktopCommand('redo')}><Redo2 size={15} /></button>
    <button title="本地历史" aria-label="本地历史" className={button} disabled={status.busy} onClick={() => void openHistory()}><History size={15} /></button>
    {error && <span role="alert" className="text-xs text-red-400">{error}</span>}
    {entries && createPortal(<div role="dialog" aria-modal="true" aria-label="本地历史" className="fixed inset-0 z-[2000] flex items-center justify-center bg-black/40 p-6">
      <div className="max-h-[80vh] w-[640px] overflow-auto rounded-xl border border-border bg-surface-900 p-5 text-text-primary shadow-xl">
        <div className="mb-3 flex items-center justify-between"><h2 className="text-lg font-semibold">本地历史</h2><button onClick={() => setEntries(null)}>关闭</button></div>
        <p className="mb-4 text-sm text-text-secondary">仅保存在本设备，保留最近 30 天，最多 200 条或约 64 MiB 的记录。还原不可撤销，并会清空撤销／重做队列。</p>
        {!entries.length && <p className="text-sm text-text-muted">暂无历史记录</p>}
        {entries.map((entry) => <div key={`${entry.id}-${entry.side}`} className="mb-2 flex items-center gap-3 rounded-lg border border-border p-3 text-sm">
          <div className="flex-1"><div>{entry.label} · {entry.side === 'before' ? '操作前' : '操作后'}</div><div className="text-xs text-text-muted">{new Date(entry.createdAt).toLocaleString()}</div></div>
          <select aria-label="选择还原范围" defaultValue="" className="max-w-36 bg-surface-800 text-text-primary" onChange={async (event) => {
            const value = event.target.value;
            if (!value) return;
            if (!window.confirm('还原所选内容？此操作不能撤销，已有撤销／重做队列将清空。')) { event.target.value = ''; return; }
            await restoreDesktopHistory(entry.id, entry.side, value === '__workspace__' ? undefined : value); setEntries(null);
          }} disabled={status.busy}>
            <option value="">还原…</option><option value="__workspace__">整个工作区</option>
            {entry.conversations.map((conversation) => <option key={conversation.id} value={conversation.id}>会话：{conversation.topic}</option>)}
          </select>
        </div>)}
        <button className="mt-4 text-sm text-red-400" disabled={status.busy || !entries.length} onClick={async () => {
          if (!window.confirm('永久清空此工作区在本设备的历史记录？')) return;
          await clearDesktopHistory(); await openHistory();
        }}>清空本地历史</button>
      </div>
    </div>, document.body)}
  </>;
}
