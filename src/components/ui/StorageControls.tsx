import { useEffect, useRef, useState } from 'react';
import { FolderOpen, History, Redo2, Undo2 } from 'lucide-react';
import { openDesktopWorkspace, replayDesktopCommand, useStorageStatus } from '../../services/storage/runtime';
import { useWorkspaceStore } from '../../stores/workspaceStore';
import { LocalHistoryDialog } from '../history/LocalHistoryDialog';

// 文字输入继续使用浏览器原生撤销；画布内容操作才交给工作区操作栈。
export function StorageControls() {
  const status = useStorageStatus();
  const activeId = useWorkspaceStore((state) => state.activeWorkspaceId);
  const [owner, setOwner] = useState<{ id: string; name: string } | null>(null);
  const historyButton = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    const keydown = (event: KeyboardEvent) => {
      if (!(event.ctrlKey || event.metaKey) || event.altKey) return;
      const target = event.target as HTMLElement;
      if (target.closest('input,textarea,[contenteditable="true"],[role="dialog"]')) return;
      const key = event.key.toLowerCase();
      if (key !== 'z' && key !== 'y') return;
      event.preventDefault();
      void replayDesktopCommand(key === 'y' || event.shiftKey ? 'redo' : 'undo');
    };
    document.addEventListener('keydown', keydown);
    return () => document.removeEventListener('keydown', keydown);
  }, []);
  const openHistory = () => { const workspace = useWorkspaceStore.getState().getActiveWorkspace(); if (workspace) setOwner({ id: workspace.id, name: workspace.name }); };
  const button = 'p-1.5 text-text-muted hover:text-text-primary disabled:opacity-30';
  return <>
    <button title="打开工作区文件" aria-label="打开工作区文件" className={button} disabled={status.busy} onClick={() => void openDesktopWorkspace()}><FolderOpen size={15} /></button>
    <button title="撤销内容操作 (Ctrl+Z)" aria-label="撤销内容操作" className={button} disabled={!status.canUndo || status.busy} onClick={() => void replayDesktopCommand('undo')}><Undo2 size={15} /></button>
    <button title="重做内容操作 (Ctrl+Shift+Z / Ctrl+Y)" aria-label="重做内容操作" className={button} disabled={!status.canRedo || status.busy} onClick={() => void replayDesktopCommand('redo')}><Redo2 size={15} /></button>
    <button ref={historyButton} title="本地历史" aria-label="本地历史" className={button} disabled={status.busy} onClick={openHistory}><History size={15} /></button>
    {owner && owner.id === activeId && <LocalHistoryDialog key={owner.id} workspaceId={owner.id} workspaceName={owner.name} close={() => { setOwner(null); historyButton.current?.focus(); }} />}
  </>;
}
