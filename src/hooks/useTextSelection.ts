import { useState, useCallback, useEffect } from 'react';
import type { ReferenceSelection } from '../types/chat';

// 在选区仍存在时保存各文档范围，跨消息选区和弹窗输入不会丢失来源。
export function selectionDocuments(container: HTMLElement, range: Range): ReferenceSelection[] {
  return [...container.querySelectorAll<HTMLElement>('[data-message-id]:not([data-reference])')].flatMap((element) => {
    const content = element.querySelector('[data-message-content]') ?? element;
    if (!range.intersectsNode(content)) return [];
    const part = document.createRange(); part.selectNodeContents(content);
    if (content.contains(range.startContainer)) part.setStart(range.startContainer, range.startOffset);
    if (content.contains(range.endContainer)) part.setEnd(range.endContainer, range.endOffset);
    const text = part.toString().trim();
    if (!text) return [];
    // Range 的端点可能落在高亮 mark、粗体或链接内部，使用文字节点的原文映射而非段落边界。
    const walker = document.createTreeWalker(content, NodeFilter.SHOW_TEXT);
    let first: number | undefined, last: number | undefined;
    for (let leaf = walker.nextNode(); leaf; leaf = walker.nextNode()) {
      if (!part.intersectsNode(leaf)) continue;
      const mapped = leaf.parentElement?.closest<HTMLElement>('[data-source-start]');
      if (!mapped || !content.contains(mapped)) continue;
      const begin = leaf === part.startContainer ? part.startOffset : 0;
      const finish = leaf === part.endContainer ? part.endOffset : leaf.textContent!.length;
      if (finish <= begin) continue;
      const prefix = document.createRange(); prefix.selectNodeContents(mapped); prefix.setEnd(leaf, 0);
      const base = prefix.toString().length;
      const offsets: number[] | undefined = mapped.dataset.sourceOffsets ? JSON.parse(mapped.dataset.sourceOffsets) : undefined;
      const origin = Number(mapped.dataset.sourceStart);
      const from = offsets?.[base + begin] ?? origin + base + begin;
      const to = offsets?.[base + finish] ?? origin + base + finish;
      first = first === undefined ? from : Math.min(first, from); last = Math.max(last ?? 0, to);
    }
    if (first === undefined || last === undefined || last <= first) throw new Error('无法定位选中文字，请重新选择原文后引用');
    const start = first, end = last;
    return [{ documentId: element.dataset.messageId!, text, start, ...(end > start ? { length: end - start } : {}) }];
  });
}

interface SelectionState {
  text: string;
  x: number;
  y: number;
  sources: ReferenceSelection[];
}

export function useTextSelection(containerRef: React.RefObject<HTMLDivElement | null>) {
  const [selection, setSelection] = useState<SelectionState | null>(null);

  const handleMouseUp = useCallback(() => {
    const sel = window.getSelection();
    if (!sel || sel.isCollapsed || !sel.toString().trim()) {
      return;
    }

    const text = sel.toString().trim();
    const container = containerRef.current;
    if (!container) return;

    // Check that selection is within our container
    const range = sel.getRangeAt(0);
    if (!container.contains(range.commonAncestorContainer)) {
      return;
    }

    const rect = range.getBoundingClientRect();
    const containerRect = container.getBoundingClientRect();

    setSelection({
      text,
      x: rect.left - containerRect.left + rect.width / 2,
      y: rect.top - containerRect.top - 8,
      sources: selectionDocuments(container, range),
    });
  }, [containerRef]);

  const clearSelection = useCallback(() => {
    setSelection(null);
  }, []);

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (!selection) return;
      const target = e.target as HTMLElement;
      if (target.closest('[data-selection-popup]')) return;
      setSelection(null);
    };

    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [selection]);

  return { selection, handleMouseUp, clearSelection };
}
