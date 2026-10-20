import { useEffect, useState } from 'react';
import { isSqliteStorage } from '../../services/storage/client';
import { recoverDesktopWorkspace, retryDesktopStorage, useStorageStatus } from '../../services/storage/runtime';

// 打开失败时保留错误与原文件，不把空界面误当成成功打开的新工作区。
export function StorageGate() {
  const { ready, busy, error } = useStorageStatus();
  if (!isSqliteStorage() || (ready && !busy && !error)) return null;
  return <StorageOverlay key={ready && !error ? 'busy' : 'immediate'} ready={ready} error={error} delayed={ready && !error} />;
}

// 操作仍立即锁定，视觉提示延迟半秒，避免文件选择器弹出前的短暂闪屏。
function StorageOverlay({ ready, error, delayed }: { ready: boolean; error: string | null; delayed: boolean }) {
  const [visible, setVisible] = useState(!delayed);
  useEffect(() => {
    if (!delayed) return;
    const timer = window.setTimeout(() => setVisible(true), 500);
    return () => window.clearTimeout(timer);
  }, [delayed]);
  if (!visible) return <div aria-hidden="true" data-storage-pending className="fixed inset-0 z-[3000]" />;
  return <div className="fixed inset-0 z-[3000] flex items-center justify-center bg-surface-950/90 p-8">
    <div className="max-w-lg rounded-xl border border-border bg-surface-900 p-6 text-text-primary">
      <h2 className="mb-3 text-lg font-semibold">{error ? '工作区未保存或打开失败' : ready ? '正在处理工作区…' : '正在打开或迁移工作区…'}</h2>
      {error && <>
        <p role="alert" className="whitespace-pre-wrap text-sm text-red-400">{error}</p>
        <p className="mt-3 text-sm">请确认文件位置和磁盘空间后重试。未保存的修改仍保留在当前界面内。</p>
        <button className="mt-4 rounded border border-border px-3 py-2" onClick={() => void retryDesktopStorage().catch(() => {})}>重试</button>
        {!ready && <div className="mt-3 flex gap-3">
          <button className="rounded border border-border px-3 py-2" onClick={() => void recoverDesktopWorkspace('open')}>重新选择工作区文件</button>
          <button className="rounded border border-border px-3 py-2" onClick={() => void recoverDesktopWorkspace('create')}>新建工作区</button>
        </div>}
      </>}
    </div>
  </div>;
}
