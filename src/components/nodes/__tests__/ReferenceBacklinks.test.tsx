/** @vitest-environment jsdom */
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import '../../../i18n';
import { ChatMessageList } from '../ChatMessageList';
import { useChatStore } from '../../../stores/chatStore';
import { useFlowStore } from '../../../stores/flowStore';
import { useWorkspaceStore } from '../../../stores/workspaceStore';
import type { ChatMessage, ReferenceSource } from '../../../types/chat';
import { selectionDocuments } from '../../../hooks/useTextSelection';

vi.hoisted(() => { window.matchMedia = vi.fn().mockReturnValue({ matches: false, addEventListener: vi.fn() }); });
const content = '前文 **共同片段** 后文。\n\n没有引用的段落。';
let root: Root, container: HTMLDivElement;
const scroll = vi.fn();
const bubbleClick = vi.fn();

function reference(id: string, questionId: string, start: number, length: number): ChatMessage {
  const source: ReferenceSource = { workspaceId: 'w', conversationId: 'a', documentId: 'answer', versionId: 1, title: '原会话标题', documentText: content, start, length };
  return { id, role: 'system', kind: 'reference', referenceForId: questionId, content: '摘要', timestamp: 0,
    reference: { id, snapshotKey: 'k', summary: '摘要', quote: content.slice(start, start + length), sources: [source], createdAt: 0 } };
}
beforeEach(async () => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true); vi.useFakeTimers(); scroll.mockClear(); bubbleClick.mockClear();
  Object.defineProperty(HTMLElement.prototype, 'scrollIntoView', { configurable: true, value: scroll });
  useWorkspaceStore.setState({ activeWorkspaceId: 'w' });
  useFlowStore.setState({ nodes: ['a', 'b', 'c'].map((id) => ({ id, type: 'chat', position: { x: 0, y: 0 }, data: { topic: id, collapsed: id !== 'a' } })), edges: [] });
  useChatStore.setState({ conversations: {
    a: { nodeId: 'a', isStreaming: false, messages: [{ id: 'answer', role: 'assistant', content, versionId: 1, timestamp: 0 }] },
    b: { nodeId: 'b', isStreaming: false, messages: [reference('r1', 'qb', 0, content.indexOf('\n\n')), reference('r2', 'qb', content.indexOf('共同'), 2), { id: 'qb', role: 'user', content: '完整段落是什么意思？', timestamp: 0 }] },
    c: { nodeId: 'c', isStreaming: false, messages: [reference('r3', 'qc', content.indexOf('共同'), 4), { id: 'qc', role: 'user', content: '共同片段为什么成立？', timestamp: 0 }] },
  } });
  container = document.createElement('div'); document.body.append(container); root = createRoot(container);
  await act(async () => root.render(<div onClick={bubbleClick}>{['a', 'b', 'c'].map((nodeId) => <div key={nodeId} className="react-flow__node" data-id={nodeId}><ChatMessageList nodeId={nodeId} onExplore={vi.fn()} /></div>)}</div>));
});
afterEach(async () => {
  await act(async () => root.unmount()); container.remove();
  delete (HTMLElement.prototype as { scrollIntoView?: unknown }).scrollIntoView;
  vi.useRealTimers(); vi.unstubAllGlobals();
});
function button() { return container.querySelector<HTMLButtonElement>('[data-backlink-count]')!; }
async function preview(questionId: string) {
  await act(async () => document.querySelector(`[data-backlink-question="${questionId}"]`)!.dispatchEvent(new MouseEvent('mouseover', { bubbles: true })));
}
const marks = () => [...container.querySelectorAll('mark')].map((mark) => mark.textContent).join('');

describe('forward reference navigation', () => {
  it.each([
    ['三段正文', '第一段。\n\n第二段 **重点**。\n\n第三段。\n\n', 'p:last-of-type', '第一段。第二段 重点。第三段。'],
    ['嵌套列表', '- 第一项\n  - 第二项\n  - 第三项', 'li:last-child', '第一项第二项第三项'],
    ['表格', '| 列 |\n| -- |\n| 第一行 |\n| 第二行 |\n', 'td:last-child', '列第一行第二行'],
  ])('keeps one button at the end of a reference spanning %s and previews the full quote', async (_label, text, lastBlock, highlighted) => {
    const ref = reference('multi', 'qb', 0, text.length);
    ref.reference!.quote = text;
    ref.reference!.sources[0].documentText = text;
    await act(async () => {
      useChatStore.getState().setConversationMessages('a', [{ id: 'answer', role: 'assistant', content: text, versionId: 1, timestamp: 0 }]);
      useChatStore.getState().setConversationMessages('b', [ref, { id: 'qb', role: 'user', content: '解释这份引用', timestamp: 0 }]);
    });
    expect(container.querySelectorAll('[data-backlink-count]')).toHaveLength(1);
    const source = container.querySelector('[data-id="a"]')!;
    expect([...source.querySelectorAll(lastBlock)].at(-1)?.contains(button())).toBe(true);
    await act(async () => button().click());
    expect(document.querySelectorAll('[data-backlink-question]')).toHaveLength(1);
    await preview('qb');
    expect(marks()).toBe(highlighted);
    expect(container.querySelectorAll('[data-backlink-count]')).toHaveLength(1);
  });

  it('groups overlapping references by question and previews each range without persistent highlights', async () => {
    expect(container.querySelectorAll('[data-backlink-count]')).toHaveLength(1);
    expect(button().dataset.backlinkCount).toBe('2'); expect(marks()).toBe('');
    await act(async () => button().dispatchEvent(new MouseEvent('mouseover', { bubbles: true })));
    expect(document.querySelectorAll('[data-backlink-question]')).toHaveLength(2);
    expect(document.querySelector('[data-backlink-question="qb"]')?.textContent).toContain('完整段落是什么意思？');
    await preview('qc'); expect(marks()).toBe('共同片段');
    expect(document.querySelector('[aria-label="引用此处的问题"]')).not.toBeNull();
    await preview('qb'); expect(marks()).toBe('前文 共同片段 后文。');
    expect(container.querySelector('mark mark')).toBeNull();
    await act(async () => document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })));
    expect(marks()).toBe(''); expect(document.querySelector('[aria-label="引用此处的问题"]')).toBeNull();
  });

  it('does not add button counts or menu questions to a copied source selection', async () => {
    await act(async () => button().click()); await preview('qc');
    const paragraph = container.querySelector('[data-id="a"] p')!;
    const range = document.createRange(); range.selectNodeContents(paragraph);
    const selection = selectionDocuments(container.querySelector('[data-id="a"]')!, range)[0];
    expect(selection.text).toBe('前文 共同片段 后文。');
    expect(content.slice(selection.start, selection.start! + selection.length!)).toBe('前文 **共同片段** 后文。');
  });

  it('opens the exact target question and does not bubble back to the source card', async () => {
    const located = vi.fn(); window.addEventListener('caudalflow:locate-reference', located);
    await act(async () => button().click()); bubbleClick.mockClear();
    await act(async () => document.querySelector<HTMLButtonElement>('[data-backlink-question="qb"]')!.click());
    expect(bubbleClick).not.toHaveBeenCalled();
    expect(located.mock.calls[0][0].detail).toBe('b');
    expect(useFlowStore.getState().nodes.find((node) => node.id === 'b')?.data.collapsed).toBe(false);
    await act(async () => vi.advanceTimersByTime(120));
    const scrolled = scroll.mock.instances[0] as HTMLElement;
    expect(scrolled.closest('[data-message-id]')?.getAttribute('data-message-id')).toBe('qb');
    expect(document.querySelector('[aria-label="引用此处的问题"]')).toBeNull();
    window.removeEventListener('caudalflow:locate-reference', located);
  });

  it('closes on outside pointer events even when the canvas stops propagation', async () => {
    await act(async () => button().click()); await preview('qc');
    const outside = document.createElement('div'); document.body.append(outside);
    outside.addEventListener('pointerdown', (event) => { event.preventDefault(); event.stopPropagation(); });
    await act(async () => outside.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true, cancelable: true })));
    expect(marks()).toBe(''); expect(document.querySelector('[aria-label="引用此处的问题"]')).toBeNull();
    outside.remove();
  });

  it('drops deleted questions and does not attach old version references to new answers', async () => {
    await act(async () => useChatStore.getState().setConversationMessages('c', []));
    expect(button().dataset.backlinkCount).toBe('1');
    await act(async () => useChatStore.getState().setConversationMessages('a', [{ ...useChatStore.getState().getMessages('a')[0], versionId: 2 }]));
    expect(container.querySelector('[data-backlink-count]')).toBeNull(); expect(marks()).toBe('');
  });
});
