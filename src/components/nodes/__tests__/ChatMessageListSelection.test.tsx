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

const { markdownRender, androidPlatform } = vi.hoisted(() => ({ markdownRender: vi.fn(), androidPlatform: vi.fn(() => false) }));
vi.mock('../../../services/platform', async (original) => ({ ...await original<typeof import('../../../services/platform')>(), isAndroid: androidPlatform }));
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
    androidPlatform.mockReturnValue(false);
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

  it.each([true, false])('limits blank-area context menus only on Android (%s)', (android) => {
    androidPlatform.mockReturnValue(android);
    act(() => root.render(<ChatMessageList nodeId="a" onExplore={explore} onRevise={vi.fn()} />));
    act(() => container.querySelector('[data-message-id="m"]')!.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true })));
    expect(!!document.querySelector('[data-message-menu]')).toBe(!android);
    act(() => document.body.dispatchEvent(new Event('pointerdown', { bubbles: true })));
    act(() => container.querySelector('[data-message-content]')!.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true })));
    expect(document.querySelector('[data-message-menu]')).not.toBeNull();
  });

  it('preserves the fixed endpoint when Android remaps it outside the message list', () => {
    androidPlatform.mockReturnValue(true);
    act(() => root.render(<ChatMessageList key="android" nodeId="a" onExplore={explore} />));
    const text = document.createTreeWalker(container.querySelector('[data-message-content]')!, NodeFilter.SHOW_TEXT).nextNode()!;
    const outside = document.createTextNode('outside controls'); document.body.append(outside);
    try {
      const selection = window.getSelection()!;
      selection.setBaseAndExtent(text, 2, text, 8);
      act(() => document.dispatchEvent(new Event('selectionchange')));
      selection.setBaseAndExtent(outside, 5, text, 0);
      act(() => document.dispatchEvent(new Event('selectionchange')));
      const range = selection.getRangeAt(0);
      expect(range.startContainer).toBe(text);
      expect(range.startOffset).toBe(0);
      expect(range.endContainer).toBe(text);
      expect(range.endOffset).toBe(8);
      selection.setBaseAndExtent(text, 0, outside, 5);
      act(() => document.dispatchEvent(new Event('selectionchange')));
      expect(container.querySelector('[data-message-content]')!.contains(selection.getRangeAt(0).endContainer)).toBe(true);
      expect(selection.toString()).not.toContain('outside controls');
    } finally { outside.remove(); }
  });

  afterEach(() => {
    window.getSelection()?.removeAllRanges();
    act(() => root.unmount());
    container.remove();
    markdownRender.mockClear();
    vi.unstubAllGlobals();
  });

  it('follows the endpoint that moved even when the native menu event repeats old coordinates', () => {
    androidPlatform.mockReturnValue(true);
    act(() => root.render(<ChatMessageList key="android" nodeId="a" onExplore={explore} />));
    const body = container.querySelector('[data-message-content]')!;
    const text = document.createTreeWalker(body, NodeFilter.SHOW_TEXT).nextNode()!;
    const range = document.createRange();
    range.setStart(text, 0); range.setEnd(text, 2);
    const cloneRange = range.cloneRange.bind(range);
    vi.spyOn(range, 'cloneRange').mockImplementation(() => {
      const caret = cloneRange();
      Object.defineProperty(caret, 'getBoundingClientRect', { value: () => ({ left: caret.startOffset * 20, top: 80, bottom: 100, height: 20 }) });
      return caret;
    });
    window.getSelection()!.addRange(range);
    const open = () => act(() => body.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, clientX: 700, clientY: 700 })));
    open();
    const menu = () => document.querySelector<HTMLElement>('[data-message-menu]')!;
    expect(menu().style.left).toBe('40px');
    expect(menu().style.top).toBe('148px');
    act(() => document.body.dispatchEvent(new Event('pointerdown', { bubbles: true })));
    range.setEnd(text, 4);
    window.getSelection()!.removeAllRanges(); window.getSelection()!.addRange(range);
    act(() => document.dispatchEvent(new Event('selectionchange')));
    open();
    expect(menu().style.left).toBe('80px');
    expect(menu().style.top).toBe('148px');
    range.setStart(text, 1);
    window.getSelection()!.removeAllRanges(); window.getSelection()!.addRange(range);
    act(() => document.dispatchEvent(new Event('selectionchange')));
    expect(document.querySelector('[data-message-menu]')).toBeNull();
    open();
    expect(menu().style.left).toBe('20px');
    range.setEnd(text, 6);
    window.getSelection()!.removeAllRanges(); window.getSelection()!.addRange(range);
    act(() => document.dispatchEvent(new Event('selectionchange')));
    expect(document.querySelector('[data-message-menu]')).toBeNull();
    open();
    expect(menu().style.left).toBe('120px');
    window.getSelection()!.removeAllRanges();
    act(() => document.body.dispatchEvent(new Event('pointerdown', { bubbles: true })));
    act(() => body.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, clientX: 90, clientY: 120 })));
    expect(menu().style.left).toBe('90px');
    expect(menu().style.top).toBe('120px');
  });

  it('keeps the PC menu at the right-click position instead of the selection endpoint', () => {
    const body = container.querySelector('[data-message-content]')!;
    const text = document.createTreeWalker(body, NodeFilter.SHOW_TEXT).nextNode()!;
    const range = document.createRange(); range.setStart(text, 0); range.setEnd(text, 8);
    const cloneRange = vi.spyOn(range, 'cloneRange');
    window.getSelection()!.addRange(range);
    act(() => body.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, clientX: 200, clientY: 160 })));
    const menu = document.querySelector<HTMLElement>('[data-message-menu]')!;
    expect(menu.style.left).toBe('200px');
    expect(menu.style.top).toBe('160px');
    expect(cloneRange).not.toHaveBeenCalled();
    range.setEnd(text, 10);
    act(() => document.dispatchEvent(new Event('selectionchange')));
    expect(document.querySelector('[data-message-menu]')).toBe(menu);
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
    expect(document.querySelector('[role="menu"]')?.textContent).toContain('选区跨多条消息，无法确定要重答或删除哪一条。');
    act(() => regenerate()!.click());
    expect(revise).toHaveBeenCalledTimes(1);
    expect(document.querySelector<HTMLButtonElement>('[aria-label="重新回答这个问题的更多选项"]')?.disabled).toBe(true);
    window.getSelection()!.removeAllRanges();
  });

  it('copies raw Markdown for a whole message or a cross-message selection without metadata', async () => {
    await act(async () => { await i18n.changeLanguage('zh'); });
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText } });
    const firstText = '开头 **重点** 与 [链接](https://example.com) 结尾';
    const secondText = '另一条 `代码` 尾部';
    act(() => {
      useChatStore.getState().setConversationMessages('a', [
        { id: 'm', role: 'assistant', content: firstText, timestamp: 1000 },
        { id: 'n', role: 'user', content: secondText, timestamp: 2000 },
      ]);
      root.render(<ChatMessageList nodeId="a" onExplore={explore} />);
    });
    const first = container.querySelector('[data-message-id="m"] [data-message-content]')!;
    const second = container.querySelector('[data-message-id="n"] [data-message-content]')!;
    const copyMarkdown = async () => {
      act(() => document.querySelector<HTMLButtonElement>('[aria-label$="的更多选项"][aria-label^="复制"]')!.click());
      await act(async () => [...document.querySelectorAll<HTMLButtonElement>('[role="menuitem"]')].find((button) => button.textContent === '复制 Markdown 原文')!.click());
    };
    window.getSelection()!.removeAllRanges();
    act(() => first.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true })));
    await copyMarkdown();
    expect(writeText).toHaveBeenLastCalledWith(firstText);

    const start = document.createTreeWalker(first, NodeFilter.SHOW_TEXT).nextNode()!;
    const end = document.createTreeWalker(second, NodeFilter.SHOW_TEXT).nextNode()!;
    const range = document.createRange();
    range.setStart(start, 1); range.setEnd(end, secondText.length - 1);
    window.getSelection()!.removeAllRanges(); window.getSelection()!.addRange(range);
    act(() => first.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true })));
    await copyMarkdown();
    expect(writeText).toHaveBeenLastCalledWith(`${firstText.slice(1)}\n\n${secondText.slice(0, -1)}`);
    window.getSelection()!.removeAllRanges();
  });

  it.each([
    ['突然', 0, '突然', 2, '**突然**'],
    ['突然', 0, '想', 1, '**突然**想'],
    ['我', 0, '突然', 2, '我**突然**'],
    ['我', 0, '想', 1, '我**突然**想'],
    ['突然', 0, '突然', 1, '**突**'],
  ])('copies balanced formatting from %s to %s without extending the selected text', async (first, from, last, to, expected) => {
    await act(async () => { await i18n.changeLanguage('zh'); });
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText } });
    act(() => {
      useChatStore.getState().setConversationMessages('a', [{ id: 'm', role: 'assistant', content: '我**突然**想', timestamp: 1000 }]);
      root.render(<ChatMessageList nodeId="a" onExplore={explore} />);
    });
    const content = container.querySelector('[data-message-content]')!;
    const walker = document.createTreeWalker(content, NodeFilter.SHOW_TEXT);
    const leaves: Node[] = [];
    for (let leaf = walker.nextNode(); leaf; leaf = walker.nextNode()) leaves.push(leaf);
    const range = document.createRange();
    range.setStart(leaves.find((leaf) => leaf.textContent === first)!, from);
    range.setEnd(leaves.find((leaf) => leaf.textContent === last)!, to);
    window.getSelection()!.removeAllRanges(); window.getSelection()!.addRange(range);
    act(() => content.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true })));
    act(() => document.querySelector<HTMLButtonElement>('[aria-label="复制选中文字的更多选项"]')!.click());
    await act(async () => [...document.querySelectorAll<HTMLButtonElement>('[role="menuitem"]')].find((button) => button.textContent === '复制 Markdown 原文')!.click());
    expect(writeText).toHaveBeenCalledWith(expected);
    window.getSelection()!.removeAllRanges();
  });

  it.each([
    ['## 摘要（选中文字）', '摘要（选中文字）', '## 摘要（选中文字）'],
    ['- 动作：通宵修理；游丝逐根理顺；齿轮擦洗', '动作：通宵修理；游丝逐根理顺；齿轮擦洗', '- 动作：通宵修理；游丝逐根理顺；齿轮擦洗'],
    ['1. 动作\n2. 结果', '结果', '2. 结果'],
    ['- [x] 完成事项', '完成事项', '- [x] 完成事项'],
  ])('copies block markers when selecting only rendered text in %s', async (markdown, selected, expected) => {
    await act(async () => { await i18n.changeLanguage('zh'); });
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText } });
    act(() => {
      useChatStore.getState().setConversationMessages('a', [{ id: 'm', role: 'assistant', content: markdown, timestamp: 1000 }]);
      root.render(<ChatMessageList nodeId="a" onExplore={explore} />);
    });
    const content = container.querySelector('[data-message-content]')!;
    const walker = document.createTreeWalker(content, NodeFilter.SHOW_TEXT);
    let text: Node | null;
    do { text = walker.nextNode(); } while (text && !text.textContent?.includes(selected));
    const range = document.createRange();
    const start = text!.textContent!.indexOf(selected);
    range.setStart(text!, start); range.setEnd(text!, start + selected.length);
    window.getSelection()!.removeAllRanges(); window.getSelection()!.addRange(range);
    act(() => content.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true })));
    act(() => document.querySelector<HTMLButtonElement>('[aria-label="复制选中文字的更多选项"]')!.click());
    await act(async () => [...document.querySelectorAll<HTMLButtonElement>('[role="menuitem"]')].find((button) => button.textContent === '复制 Markdown 原文')!.click());
    expect(writeText).toHaveBeenCalledWith(expected);
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
    expect(container.querySelectorAll('[data-backlink-count]')).toHaveLength(1);
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
