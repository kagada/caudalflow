import type { Root, RootContent, Element, Text } from 'hast';
import type { ReferenceSource, ChatMessage } from '../types/chat';

export interface HighlightRange { start: number; end: number }

// 只标记被引用的同一文档版本；重生成后的回答不能继承旧快照的标记。
export function referenceRanges(message: ChatMessage, sources: ReferenceSource[]): HighlightRange[] {
  return sources.filter((source) => source.documentId === message.id && source.documentText === message.content &&
    (!source.versionId || source.versionId === message.versionId))
    .map((source) => ({ start: source.start, end: source.start + source.length }));
}

export function highlightSegments(text: string, ranges: HighlightRange[], offset = 0) {
  const cuts = [...new Set([0, text.length, ...ranges.flatMap(({ start, end }) =>
    [Math.max(0, Math.min(text.length, start - offset)), Math.max(0, Math.min(text.length, end - offset))])])].sort((a, b) => a - b);
  return cuts.slice(0, -1).map((start, index) => ({ text: text.slice(start, cuts[index + 1]),
    highlighted: ranges.some((range) => range.start < offset + cuts[index + 1] && range.end > offset + start) }));
}

// 在 Markdown 解析后的文字节点上使用原文位置，可跨段落、粗体、链接，不把 Markdown 标记画到页面上。
export function rehypeReferenceHighlights(options: { ranges: HighlightRange[]; legacyTexts: string[]; content: string }) {
  return (tree: Root) => {
    const visit = (parent: Root | Element) => {
      parent.children = parent.children.flatMap((node): RootContent[] => {
        if (node.type === 'element') { visit(node); return [node]; }
        if (node.type !== 'text') return [node];
        let start = node.position?.start.offset;
        let end = node.position?.end.offset;
        // 代码文字没有单独的解析位置，从代码元素的原文范围内恢复位置。
        if (start === undefined && parent.type === 'element' && parent.tagName === 'code' && parent.position) {
          const found = options.content.indexOf(node.value.replace(/\n$/, ''), parent.position.start.offset ?? 0);
          if (found >= 0 && found < (parent.position.end.offset ?? 0)) { start = found; end = found + node.value.length; }
        }
        let ranges: HighlightRange[] = [];
        if (start !== undefined && end !== undefined) {
          ranges = options.ranges.filter((range) => range.start < end && range.end > start)
            // 转义或实体与显示文字长度不同时，保守标记相交的文字节点，避免偏移到相邻文字。
            .map((range) => end - start === node.value.length ? { start: range.start - start, end: range.end - start } : { start: 0, end: node.value.length });
        }
        for (const text of options.legacyTexts.filter(Boolean)) {
          let index = node.value.toLowerCase().indexOf(text.toLowerCase());
          while (index >= 0) {
            ranges.push({ start: index, end: index + text.length });
            index = node.value.toLowerCase().indexOf(text.toLowerCase(), index + text.length);
          }
        }
        if (!ranges.length) return [node];
        return highlightSegments(node.value, ranges).map(({ text, highlighted }): Text | Element => highlighted ? {
          type: 'element', tagName: 'mark', properties: { className: ['reference-highlight'] }, children: [{ type: 'text', value: text }],
        } : { type: 'text', value: text });
      });
    };
    visit(tree);
  };
}
