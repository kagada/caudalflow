import { afterEach, expect, it, vi } from 'vitest';
import { createWebSearchDebugger, useWebSearchDebug } from '../webSearchDebug';
import { useChatStore } from '../../stores/chatStore';

afterEach(() => useWebSearchDebug.setState({ runs: [] }));

it('keeps debug events isolated from the persisted conversation store', () => {
  const before = useChatStore.getState().conversations;
  const changed = vi.fn(); const unsubscribe = useChatStore.subscribe(changed);
  const debug = createWebSearchDebugger('workspace', 'node', 'answer')!;
  debug({ stage: '搜索结果', data: { results: ['temporary'] } });
  expect(useWebSearchDebug.getState().runs[0]).toMatchObject({ workspaceId: 'workspace', nodeId: 'node', documentId: 'answer' });
  expect(useChatStore.getState().conversations).toBe(before);
  expect(changed).not.toHaveBeenCalled(); unsubscribe();
});

it('limits retained runs and events', () => {
  for (let index = 0; index < 35; index++) createWebSearchDebugger('workspace', 'node')!({ stage: '请求', data: index });
  expect(useWebSearchDebug.getState().runs).toHaveLength(30);
  const debug = createWebSearchDebugger('workspace', 'node')!;
  for (let index = 0; index < 105; index++) debug({ stage: '步骤', data: index });
  expect(useWebSearchDebug.getState().runs.at(-1)?.entries).toHaveLength(100);
});
