/** @vitest-environment jsdom */
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { HistoryDetail } from '../../../services/storage/types';
import { LocalHistoryDialog } from '../LocalHistoryDialog';

const fake = vi.hoisted(() => ({ list: vi.fn(), read: vi.fn(), restore: vi.fn(), clear: vi.fn() }));
vi.mock('../../../services/storage/runtime', () => ({ listDesktopHistory: fake.list, readDesktopHistory: fake.read, restoreDesktopHistory: fake.restore, clearDesktopHistory: fake.clear, useStorageStatus: (select: (value: { busy: boolean }) => unknown) => select({ busy: false }) }));

function detail(id: string): HistoryDetail {
  const data = { nodes: [{ id: 'c1', type: 'chat' as const, position: { x: 0, y: 0 }, data: { topic: '测试会话' } }], edges: [], conversations: { c1: { nodeId: 'c1', messages: [{ id: 'q1', role: 'user' as const, content: '为什么？', timestamp: 1 }, { id: 'a1', role: 'assistant' as const, content: `[同一标题](https://old-${id}.example)\n<script>alert(1)</script>`, replyToId: 'q1', timestamp: 2 }], isStreaming: false } } };
  const after = structuredClone(data); after.conversations.c1.messages[1].content = `[同一标题](https://new-${id}.example)\n<script>alert(1)</script>`;
  return { id, label: id === 'h1' ? '第一次修改' : '第二次修改', createdAt: 1, bytes: 100, before: data, after };
}

let root: Root; let container: HTMLDivElement; let close: () => void;
beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true); vi.clearAllMocks();
  fake.list.mockResolvedValue([detail('h1'), detail('h2')].map(({ id, label, bytes, createdAt }) => ({ id, label, bytes, createdAt })));
  fake.read.mockImplementation(async (id) => detail(id)); fake.restore.mockResolvedValue(true);
  vi.spyOn(window, 'confirm').mockReturnValue(true); close = vi.fn();
  container = document.createElement('div'); document.body.append(container); root = createRoot(container);
});
afterEach(async () => { await act(async () => root.unmount()); container.remove(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });
async function render() { await act(async () => root.render(<LocalHistoryDialog workspaceId="w1" workspaceName="当前工作区" close={close} />)); }
const button = (text: string) => [...document.querySelectorAll<HTMLButtonElement>('button')].find((element) => element.textContent === text)!;

describe('three-part local history dialog', () => {
  it('refreshes the selected detail when initialization extends the same history ID', async () => {
    await render();
    const updated = detail('h1'); updated.after.conversations.c1.messages[1].content = '初始化完成后的回复';
    fake.read.mockResolvedValue(updated);
    await act(async () => button('刷新记录').click());
    expect(document.querySelector('[aria-label="原文差异"]')?.textContent).toContain('初始化完成后的回复');
    expect(fake.read.mock.calls.filter(([id]) => id === 'h1')).toHaveLength(2);
  });
  it('lists an operation once and shows affected question/reply with exact link addresses', async () => {
    await render();
    expect([...document.querySelectorAll('[aria-label="修改记录"] button')]).toHaveLength(2);
    expect(document.querySelector('[aria-label="涉及内容"]')?.textContent).toContain('测试会话');
    expect(document.querySelector('[aria-label="原文差异"]')?.textContent).toContain('https://old-h1.example');
    expect(document.querySelector('[aria-label="原文差异"]')?.textContent).toContain('https://new-h1.example');
    expect(document.querySelector('script')).toBeNull(); expect(document.querySelector('a')).toBeNull();
    expect(fake.read).toHaveBeenCalledWith('h1', 'w1');
  });

  it('restores the explicitly selected question group rather than the whole conversation', async () => {
    await render(); await act(async () => button('还原').click());
    expect(fake.restore).toHaveBeenCalledWith('h1', 'before', 'c1', { documentIds: ['q1', 'a1'] });
    expect(window.confirm).toHaveBeenCalledWith(expect.stringContaining('不能撤销'));
    expect(close).toHaveBeenCalled();
  });

  it('ignores a late result from the previously selected history record', async () => {
    let resolve!: (value: HistoryDetail) => void;
    const pending = new Promise<HistoryDetail>((complete) => { resolve = complete; });
    fake.read.mockImplementation((id) => id === 'h1' ? pending : Promise.resolve(detail(id)));
    await render();
    const second = [...document.querySelectorAll<HTMLButtonElement>('[aria-label="修改记录"] button')].find((element) => element.textContent?.includes('第二次修改'))!;
    await act(async () => second.click());
    expect(document.querySelector('[aria-label="原文差异"]')?.textContent).toContain('new-h2.example');
    await act(async () => resolve(detail('h1')));
    expect(document.querySelector('[aria-label="原文差异"]')?.textContent).not.toContain('new-h1.example');
  });

  it('shows missing-history errors and disables restoration instead of reusing an old preview', async () => {
    fake.read.mockRejectedValue(new Error('历史已被清理'));
    await render();
    expect(document.querySelector('[role="alert"]')?.textContent).toContain('历史已被清理');
    expect(button('还原').disabled).toBe(true);
  });
});
