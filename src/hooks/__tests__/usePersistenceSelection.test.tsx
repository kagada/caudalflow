/** @vitest-environment jsdom */
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import '../../i18n';
import { usePersistence } from '../usePersistence';
import { useFlowStore } from '../../stores/flowStore';
import { useChatStore } from '../../stores/chatStore';
import { useWorkspaceStore } from '../../stores/workspaceStore';

function PersistenceHarness() {
  usePersistence();
  return null;
}

describe('selection and workspace autosave', () => {
  let root: Root;
  let container: HTMLDivElement;
  let save: ReturnType<typeof vi.spyOn>;
  const key = 'caudalflow-workspace-selection-test';

  beforeEach(() => {
    vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
    vi.useFakeTimers();
    localStorage.clear();
    useWorkspaceStore.setState({ activeWorkspaceId: 'selection-test', workspaces: [
      { id: 'selection-test', name: 'Test', createdAt: 0, updatedAt: 0 },
    ] });
    localStorage.setItem(key, JSON.stringify({ nodes: [
      { id: 'a', type: 'chat', position: { x: 0, y: 0 }, data: { topic: 'A' } },
    ], edges: [{ id: 'ab', source: 'a', target: 'b', data: { label: 'branch' } }], conversations: {} }));
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
    act(() => root.render(<PersistenceHarness />));
    save = vi.spyOn(Storage.prototype, 'setItem');
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    vi.restoreAllMocks();
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it('does not save selection or automatic measurement changes', () => {
    act(() => {
      useFlowStore.getState().onNodesChange([{ type: 'select', id: 'a', selected: true }]);
      useFlowStore.getState().onEdgesChange([{ type: 'select', id: 'ab', selected: true }]);
      useFlowStore.getState().onNodesChange([{ type: 'dimensions', id: 'a', dimensions: { width: 400, height: 500 } }]);
      vi.advanceTimersByTime(1500);
    });
    expect(save).not.toHaveBeenCalled();
  });

  it('repairs null coordinates on reload while retaining edges and conversations', () => {
    const edges = [{ id: 'ab', source: 'a', target: 'b', type: 'topic', data: { label: 'branch' } }];
    const conversations = { a: { messages: [{ id: 'm', role: 'user', content: 'keep me', timestamp: 0 }] } };
    localStorage.setItem('caudalflow-workspace-damaged', JSON.stringify({ nodes: [
      { id: 'a', type: 'chat', position: { x: 0, y: null }, data: { topic: 'A', minimized: true }, style: { width: 'auto', height: 'auto' } },
      { id: 'b', type: 'chat', position: { x: null, y: null }, data: { topic: 'B' }, style: { width: 400, height: 500 } },
      { id: 'c', type: 'chat', position: { x: null, y: null }, data: { topic: 'C', collapsed: true } },
    ], edges, conversations }));
    act(() => useWorkspaceStore.setState({ activeWorkspaceId: 'damaged' }));
    const nodes = useFlowStore.getState().nodes;
    expect(nodes).toHaveLength(3);
    expect(nodes.every((node) => Number.isFinite(node.position.x) && Number.isFinite(node.position.y))).toBe(true);
    expect(new Set(nodes.map((node) => `${node.position.x},${node.position.y}`)).size).toBe(3);
    expect(nodes[0].data.minimized).toBe(true);
    expect(useFlowStore.getState().edges).toEqual(edges);
    expect(useChatStore.getState().conversations).toEqual(conversations);
    act(() => window.dispatchEvent(new Event('beforeunload')));
    expect(JSON.parse(localStorage.getItem('caudalflow-workspace-damaged')!).nodes).toEqual(nodes);
  });

  it('selection does not delay an already pending content save', () => {
    act(() => useFlowStore.getState().updateNodeData('a', { topic: 'Edited' }));
    act(() => vi.advanceTimersByTime(600));
    act(() => useFlowStore.getState().onNodesChange([{ type: 'select', id: 'a', selected: true }]));
    act(() => vi.advanceTimersByTime(400));
    expect(save).toHaveBeenCalledTimes(1);
    expect(JSON.parse(localStorage.getItem(key)!).nodes[0].data.topic).toBe('Edited');
  });

  it('restores minimized cards without replacing their saved expanded dimensions', () => {
    localStorage.setItem('caudalflow-workspace-compact', JSON.stringify({ nodes: [
      { id: 'sized', type: 'chat', position: { x: 120, y: 80 }, data: { topic: '尺寸', minimized: true }, style: { width: 760, height: 640 } },
    ], edges: [], conversations: {} }));
    act(() => useWorkspaceStore.setState({ activeWorkspaceId: 'compact' }));
    expect(useFlowStore.getState().nodes[0].style).toEqual({ width: 760, height: 640 });
    act(() => useFlowStore.getState().updateNodeData('sized', { minimized: false }));
    expect(useFlowStore.getState().nodes[0].style).toEqual({ width: 760, height: 640 });
  });

  it('persists positions, sizes, branches, messages, and deletions', () => {
    act(() => {
      useFlowStore.getState().onNodesChange([{ type: 'position', id: 'a', position: { x: 100, y: 200 } }]);
      useFlowStore.getState().updateNodeStyle('a', { width: 600, height: 700 });
      useFlowStore.getState().addEdge('a', 'c', 'new branch');
      useChatStore.getState().initConversation('a');
      useChatStore.getState().addMessage('a', 'user', 'saved message');
      vi.advanceTimersByTime(1000);
    });
    const saved = JSON.parse(localStorage.getItem(key)!);
    expect(saved.nodes[0].position).toEqual({ x: 100, y: 200 });
    expect(saved.nodes[0].style).toEqual({ width: 600, height: 700 });
    expect(saved.edges).toHaveLength(2);
    expect(saved.conversations.a.messages[0].content).toBe('saved message');
    act(() => {
      useFlowStore.getState().removeNode('a');
      vi.advanceTimersByTime(1000);
    });
    expect(JSON.parse(localStorage.getItem(key)!).nodes).toHaveLength(0);
  });
});
