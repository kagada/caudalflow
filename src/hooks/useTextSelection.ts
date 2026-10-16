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
    const startElement = part.startContainer.nodeType === Node.ELEMENT_NODE ? part.startContainer as Element : part.startContainer.parentElement;
    const endElement = part.endContainer.nodeType === Node.ELEMENT_NODE ? part.endContainer as Element : part.endContainer.parentElement;
    const start = Number(startElement?.closest('[data-source-start]')?.getAttribute('data-source-start') ?? 0);
    const end = Number(endElement?.closest('[data-source-end]')?.getAttribute('data-source-end') ?? 0);
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
