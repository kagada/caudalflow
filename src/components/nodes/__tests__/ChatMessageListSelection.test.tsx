/** @vitest-environment jsdom */
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Options } from 'react-markdown';
import '../../../i18n';
import { useFlowStore } from '../../../stores/flowStore';
import { useChatStore } from '../../../stores/chatStore';
import { useSettingsStore } from '../../../stores/settingsStore';
import { ChatMessageList } from '../ChatMessageList';

const { markdownRender } = vi.hoisted(() => ({ markdownRender: vi.fn() }));
vi.hoisted(() => {
  window.matchMedia = vi.fn().mockReturnValue({ matches: false, addEventListener: vi.fn() });
});
// 使用真实 Markdown 和代码高亮，统计解析入口，避免只验证组件外壳。
vi.mock('react-markdown', async (importOriginal) => {
  const actual = await importOriginal<typeof import('react-markdown')>();
  return { ...actual, default: (props: Options) => {
    markdownRender(props.children);
    return createElement(actual.default, props);
  } };
});

describe('canvas selection keeps conversation content cached', () => {
  let container: HTMLDivElement;
  let root: Root;
  const explore = vi.fn();

  beforeEach(() => {
    vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
    useFlowStore.setState({ nodes: [{ id: 'a', type: 'chat', position: { x: 0, y: 0 }, data: { topic: 'A' } }], edges: [
      { id: 'ab', source: 'a', target: 'b', data: { label: 'branch' } },
    ] });
    useChatStore.setState({ conversations: { a: { nodeId: 'a', isStreaming: false, messages: [
      { id: 'm', role: 'assistant', content: 'branch and changed\n\n```js\nconst answer = 42;\n```', timestamp: 0 },
    ] } } });
    useSettingsStore.setState({ showSystemPrompts: false });
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
    act(() => root.render(<ChatMessageList nodeId="a" onExplore={explore} />));
    expect(markdownRender).toHaveBeenCalled();
    markdownRender.mockClear();
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    markdownRender.mockClear();
    vi.unstubAllGlobals();
  });

  it('does not parse Markdown on selection, deselection, or an unrelated branch change', () => {
    const before = container.innerHTML;
    act(() => {
      useFlowStore.getState().onNodesChange([{ type: 'select', id: 'a', selected: true }]);
      useFlowStore.getState().onEdgesChange([{ type: 'select', id: 'ab', selected: true }]);
    });
    act(() => root.render(<ChatMessageList nodeId="a" onExplore={explore} />));
    act(() => {
      useFlowStore.getState().onEdgesChange([{ type: 'select', id: 'ab', selected: false }]);
      useFlowStore.getState().addEdge('other', 'b', 'unrelated');
    });
    expect(markdownRender).not.toHaveBeenCalled();
    expect(container.innerHTML).toBe(before);
  });

  it('refreshes highlights when its branch label changes or is removed', () => {
    expect(container.querySelector('mark')?.textContent).toBe('branch');
    act(() => useFlowStore.getState().setEdges([{ id: 'ab', source: 'a', target: 'b', data: { label: 'changed' } }]));
    expect(markdownRender).toHaveBeenCalled();
    expect(container.querySelector('mark')?.textContent).toBe('changed');
    act(() => useFlowStore.getState().setEdges([]));
    expect(container.querySelector('mark')).toBeNull();
  });

  it('renders new message content during streaming', () => {
    act(() => useChatStore.getState().appendToLastMessage('a', '\nnew response'));
    expect(markdownRender).toHaveBeenCalled();
    expect(container.textContent).toContain('new response');
  });
});
