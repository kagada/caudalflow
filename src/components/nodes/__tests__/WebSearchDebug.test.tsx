/** @vitest-environment jsdom */
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { expect, it, vi } from 'vitest';
import { WebSearchDebug } from '../WebSearchDebug';
import { createWebSearchDebugger, useWebSearchDebug } from '../../../services/webSearchDebug';
import { useWorkspaceStore } from '../../../stores/workspaceStore';

it('shows only the current conversation debug entries and can clear them', async () => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  useWorkspaceStore.setState({ activeWorkspaceId: 'workspace' });
  createWebSearchDebugger('workspace', 'node', 'answer')!({ stage: '联网接口原始返回', data: { url: 'https://example.com' } });
  createWebSearchDebugger('other', 'node')!({ stage: '其他工作区', data: {} });
  createWebSearchDebugger('workspace', 'other')!({ stage: '其他会话', data: {} });
  const container = document.createElement('div'); const root = createRoot(container);
  try {
    await act(async () => root.render(<WebSearchDebug nodeId="node" />));
    expect(container.textContent).toContain('联网调试（仅内存）');
    expect(container.textContent).toContain('https://example.com');
    expect(container.textContent).not.toContain('其他工作区');
    expect(container.textContent).not.toContain('其他会话');
    await act(async () => container.querySelector('button')!.click());
    expect(container.textContent).toBe('');
    expect(useWebSearchDebug.getState().runs).toHaveLength(2);
  } finally {
    await act(async () => root.unmount());
    useWebSearchDebug.setState({ runs: [] }); vi.unstubAllGlobals();
  }
});
