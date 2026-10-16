/** @vitest-environment jsdom */
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { describe, it, expect, vi } from 'vitest';
import '../../../i18n';
import { ChatMessage } from '../ChatMessage';
import { selectionDocuments } from '../../../hooks/useTextSelection';
import { effectiveReferenceSources } from '../../../utils/referenceHighlights';

describe('rendered selection keeps raw Markdown offsets', () => {
  it('repairs an old whole-answer range only when the saved quote has an unambiguous location', () => {
    const source = { workspaceId: '', conversationId: 'a', documentId: 'm', title: 'A', documentText: '前文，选中一句，后文', start: 0, length: 10 };
    const reference = { id: 'r', snapshotKey: 'k', summary: '', quote: '选中一句', createdAt: 0, sources: [source] };
    source.length = source.documentText.length;
    expect(effectiveReferenceSources(reference)[0]).toMatchObject({ start: 3, length: 4 });
    expect(source.start).toBe(0);
    expect(effectiveReferenceSources({ ...reference, quote: source.documentText })[0]).toBe(source);
    const repeated = { ...source, documentText: '重复 重复', length: 5 };
    expect(effectiveReferenceSources({ ...reference, quote: '重复', sources: [repeated] })[0]).toBe(repeated);
  });

  it('keeps a small quote precise before and after highlighting, including Markdown and entities', () => {
    vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
    const container = document.createElement('div'); document.body.append(container);
    const root = createRoot(container);
    const content = '# 标题\n\n重复 **重点** 与 [链接](https://example.com) &amp; 尾巴。\n\n| 列 |\n| -- |\n| 值 |';
    const message = { id: 'm', role: 'assistant' as const, content, timestamp: 0 };
    const source = { workspaceId: '', conversationId: 'a', documentId: 'm', title: 'A', documentText: content,
      start: content.indexOf('重点'), length: 2 };
    const select = (start: string, end: string) => {
      const walker = document.createTreeWalker(container.querySelector('[data-message-content]')!, NodeFilter.SHOW_TEXT);
      const leaves: Node[] = []; for (let leaf = walker.nextNode(); leaf; leaf = walker.nextNode()) leaves.push(leaf);
      const first = leaves.find((leaf) => leaf.textContent!.includes(start))!;
      const last = leaves.find((leaf) => leaf.textContent!.includes(end))!;
      const range = document.createRange();
      range.setStart(first, first.textContent!.indexOf(start)); range.setEnd(last, last.textContent!.indexOf(end) + end.length);
      return selectionDocuments(container, range)[0];
    };
    for (const sources of [[], [source]]) {
      act(() => root.render(<ChatMessage message={message} backlinks={[{ nodeId: 'target', questionId: 'q', question: '为什么', sources }]} />));
      if (sources.length) {
        act(() => container.querySelector<HTMLButtonElement>('[data-backlink-count]')!.click());
        act(() => document.querySelector('[data-backlink-question]')!.dispatchEvent(new MouseEvent('mouseover', { bubbles: true })));
      }
      const selected = select('重点', '链接');
      expect(content.slice(selected.start, selected.start! + selected.length!)).toBe('重点** 与 [链接');
      expect(selected.length).toBeLessThan(20);
      const heading = select('标题', '标题');
      expect(content.slice(heading.start, heading.start! + heading.length!)).toBe('标题');
      const entity = select('&', '尾巴');
      expect(content.slice(entity.start, entity.start! + entity.length!)).toBe('&amp; 尾巴');
      const cell = select('值', '值');
      expect(content.slice(cell.start, cell.start! + cell.length!)).toBe('值');
    }
    act(() => root.unmount()); container.remove(); vi.unstubAllGlobals();
  });
});
