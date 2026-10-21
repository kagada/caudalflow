/** @vitest-environment jsdom */
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Options } from 'react-markdown';
import i18n from '../../../i18n';
import { useFlowStore } from '../../../stores/flowStore';
import { useChatStore } from '../../../stores/chatStore';
import { useSettingsStore } from '../../../stores/settingsStore';
import { ChatMessageList } from '../ChatMessageList';
import { useWorkspaceStore } from '../../../stores/workspaceStore';
import type { ChatMessage as Message } from '../../../types/chat';

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

  it('resolves a single-answer selection independently of the right-click position and disables revisions across answers', () => {
    void i18n.changeLanguage('zh');
    const revise = vi.fn();
    act(() => {
      useChatStore.getState().setConversationMessages('a', [
        { id: 'm', role: 'assistant', content: '第一条回答', timestamp: 0 },
        { id: 'n', role: 'assistant', content: '第二条回答', timestamp: 1 },
      ]);
      root.render(<ChatMessageList nodeId="a" onExplore={explore} onRevise={revise} />);
    });
    const first = container.querySelector('[data-message-id="m"] [data-message-content]')!;
    const second = container.querySelector('[data-message-id="n"] [data-message-content]')!;
    const walker = document.createTreeWalker(first, NodeFilter.SHOW_TEXT);
    const start = walker.nextNode()!;
    const range = document.createRange();
    range.setStart(start, 0); range.setEnd(start, 2);
    window.getSelection()!.removeAllRanges(); window.getSelection()!.addRange(range);
    act(() => second.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true })));
    const regenerate = () => [...document.querySelectorAll<HTMLButtonElement>('[role="menuitem"]')].find((button) => button.textContent?.startsWith('重新回答这个问题'));
    act(() => regenerate()!.click());
    expect(revise).toHaveBeenCalledWith('m', undefined);
    const end = document.createTreeWalker(second, NodeFilter.SHOW_TEXT).nextNode()!;
    range.setEnd(end, 2);
    window.getSelection()!.removeAllRanges(); window.getSelection()!.addRange(range);
    act(() => first.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true })));
    expect(regenerate()?.disabled).toBe(true);
    expect(regenerate()?.textContent).toContain('（选中多个回答时不可用）');
    act(() => regenerate()!.click());
    expect(revise).toHaveBeenCalledTimes(1);
    expect(document.querySelector('[role="menu"]')?.textContent).toContain('用 prompt 重构回答');
    window.getSelection()!.removeAllRanges();
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

  it('does not turn legacy edge labels into persistent text highlights', () => {
    expect(container.querySelector('mark')).toBeNull();
    act(() => useFlowStore.getState().setEdges([{ id: 'ab', source: 'a', target: 'b', data: { label: 'changed' } }]));
    expect(markdownRender).not.toHaveBeenCalled();
    expect(container.querySelector('mark')).toBeNull();
  });

  it('renders new message content during streaming', () => {
    act(() => useChatStore.getState().appendToLastMessage('a', '\nnew response'));
    expect(markdownRender).toHaveBeenCalled();
    expect(container.textContent).toContain('new response');
  });

  it('marks the same raw range for branch and pasted references, including formatted and repeated text', () => {
    const content = '重复\n\n重复 **重点** 和 [链接](https://example.com)\n\n末段';
    const source = { workspaceId: '', conversationId: 'a', documentId: 'm', versionId: 1, title: 'A',
      documentText: content, start: 4, length: content.length - 4 };
    const ref: Message = { id: 'ref', referenceForId: 'qb', role: 'system', kind: 'reference', timestamp: 0, content: '', reference: {
      id: 'r', snapshotKey: 'k', summary: '摘要', quote: '重复 重点 和 链接\n末段', createdAt: 0, sources: [source],
    } };
    act(() => {
      useWorkspaceStore.setState({ activeWorkspaceId: null });
      useChatStore.setState({ conversations: {
        a: { nodeId: 'a', isStreaming: false, messages: [{ id: 'm', versionId: 1, role: 'assistant', content, timestamp: 0 }] },
        b: { nodeId: 'b', isStreaming: false, messages: [ref, { id: 'qb', role: 'user', content: '为什么', timestamp: 1 }] },
      } });
    });
    const marks = () => [...container.querySelectorAll('mark')].map((mark) => mark.textContent).join('');
    expect(marks()).toBe('');
    expect(container.querySelectorAll('[data-backlink-count]')).toHaveLength(2);
    act(() => container.querySelector<HTMLButtonElement>('[data-backlink-count]')!.click());
    act(() => document.querySelector('[data-backlink-question]')!.dispatchEvent(new MouseEvent('mouseover', { bubbles: true })));
    const branchMarks = marks();
    expect(branchMarks).toBe('重复 重点 和 链接末段');
    expect(container.querySelector('p')?.querySelector('mark')).toBeNull();
    expect(container.querySelector('a mark')?.textContent).toBe('链接');
    expect(container.querySelector('strong mark')?.textContent).toBe('重点');
    expect(container.querySelector('mark mark')).toBeNull();
    act(() => useFlowStore.getState().setEdges([]));
    expect(marks()).toBe(branchMarks);
    markdownRender.mockClear();
    act(() => useChatStore.setState((state) => ({ conversations: { ...state.conversations,
      b: { ...state.conversations.b, messages: [...state.conversations.b.messages, { id: 'other', role: 'assistant', content: 'stream', timestamp: 0 }] },
    } })));
    expect(markdownRender).not.toHaveBeenCalled();
    act(() => useChatStore.setState((state) => ({ conversations: { ...state.conversations,
      a: { ...state.conversations.a, messages: [{ ...state.conversations.a.messages[0], versionId: 2 }] },
    } })));
    expect(container.querySelector('mark')).toBeNull();
  });

  it('does not mark other workspaces and removes marks when the reference is deleted', () => {
    const source = { workspaceId: 'foreign', conversationId: 'a', documentId: 'm', title: 'A',
      documentText: useChatStore.getState().conversations.a.messages[0].content, start: 0, length: 6 };
    act(() => {
      useFlowStore.getState().setEdges([]);
      useChatStore.setState((state) => ({ conversations: { ...state.conversations,
        b: { nodeId: 'b', isStreaming: false, messages: [{ id: 'r', referenceForId: 'qb', role: 'system', kind: 'reference', content: '', timestamp: 0,
          reference: { id: 'r', snapshotKey: 'k', summary: '', quote: 'branch', createdAt: 0, sources: [source] } }, { id: 'qb', role: 'user', content: '为什么', timestamp: 1 }] },
      } }));
    });
    expect(container.querySelector('mark')).toBeNull();
    act(() => useWorkspaceStore.setState({ activeWorkspaceId: 'foreign' }));
    expect(container.querySelector('[data-backlink-count]')).not.toBeNull();
    act(() => container.querySelector<HTMLButtonElement>('[data-backlink-count]')!.click());
    act(() => document.querySelector('[data-backlink-question]')!.dispatchEvent(new MouseEvent('mouseover', { bubbles: true })));
    expect(container.querySelector('mark')?.textContent).toBe('branch');
    act(() => useChatStore.getState().setConversationMessages('b', []));
    expect(container.querySelector('mark')).toBeNull();
    useWorkspaceStore.setState({ activeWorkspaceId: null });
  });
});
