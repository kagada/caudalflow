/** @vitest-environment jsdom */
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { StorageGate } from '../StorageGate';
import { useStorageStatus } from '../../../services/storage/runtime';

vi.mock('../../../services/storage/desktop', () => ({ isDesktopStorage: () => true }));
vi.mock('../../../services/storage/runtime', async () => {
  const { create } = await import('zustand');
  return { useStorageStatus: create(() => ({ ready: true, busy: false, error: null })),
    recoverOpenDesktopWorkspace: vi.fn(), retryDesktopStorage: vi.fn() };
});

let container: HTMLDivElement, root: Root;
beforeEach(async () => {
  vi.useFakeTimers(); vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  useStorageStatus.setState({ ready: true, busy: false, error: null });
  container = document.createElement('div'); document.body.append(container); root = createRoot(container);
  await act(async () => root.render(<StorageGate />));
});
afterEach(async () => {
  await act(async () => root.unmount()); container.remove(); vi.useRealTimers(); vi.unstubAllGlobals();
});
async function status(value: Partial<ReturnType<typeof useStorageStatus.getState>>) {
  await act(async () => useStorageStatus.setState(value));
}
async function advance(ms: number) { await act(async () => vi.advanceTimersByTime(ms)); }

// 提示延迟不能放松存储操作期间的交互锁，也不能延后真正的错误。
it('keeps short operations transparent and cancels the pending notice on completion', async () => {
  await status({ busy: true });
  expect(container.querySelector('[data-storage-pending]')).not.toBeNull();
  await advance(499); expect(container.textContent).toBe('');
  await status({ busy: false }); await advance(1000);
  expect(container.childElementCount).toBe(0);
});
it('shows long operations after 500ms and starts a fresh delay for the next operation', async () => {
  await status({ busy: true }); await advance(500);
  expect(container.textContent).toContain('正在处理工作区');
  await status({ busy: false }); expect(container.childElementCount).toBe(0);
  await status({ busy: true }); await advance(499); expect(container.textContent).toBe('');
  await advance(1); expect(container.textContent).toContain('正在处理工作区');
});
it('shows startup and errors immediately, including failures during the delay', async () => {
  await status({ ready: false }); expect(container.textContent).toContain('正在打开或迁移工作区');
  await status({ ready: true, busy: true }); expect(container.textContent).toBe('');
  await status({ error: '磁盘空间不足' });
  expect(container.querySelector('[role="alert"]')?.textContent).toBe('磁盘空间不足');
  expect(container.textContent).toContain('重试');
});
