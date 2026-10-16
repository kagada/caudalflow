import type { Root, RootContent, Element, Text } from 'hast';
import { sourceOffsets } from './sourceOffsets';
import type { ReferenceSource, ChatMessage, ContentReference } from '../types/chat';

export interface HighlightRange { start: number; end: number }

// 修正此前已存成整篇范围的单句引用；只在原文唯一匹配时恢复，重复文字不能随意猜位置。
export function effectiveReferenceSources(reference: ContentReference): ReferenceSource[] {
  if (reference.sources.length !== 1) return reference.sources;
  const source = reference.sources[0], quote = reference.quote.trim();
  if (source.start !== 0 || source.length !== source.documentText.length || !quote || quote === source.documentText.trim()) return reference.sources;
  const start = source.documentText.indexOf(quote);
  if (start < 0 || source.documentText.indexOf(quote, start + 1) >= 0) return reference.sources;
  return [{ ...source, start, length: quote.length }];
}

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
        const raw = start !== undefined && end !== undefined ? options.content.slice(start, end) : undefined;
        const offsets = raw !== undefined && raw !== node.value ? sourceOffsets(raw, node.value, start!) : undefined;
        let ranges: HighlightRange[] = [];
        if (start !== undefined && end !== undefined) {
          ranges = options.ranges.filter((range) => range.start < end && range.end > start).flatMap((range) => {
            if (!offsets) return [{ start: Math.max(0, range.start - start), end: Math.min(node.value.length, range.end - start) }];
            const selected = offsets!.slice(0, -1).map((offset, index) => range.start < offsets![index + 1] && range.end > offset);
            const first = selected.indexOf(true), last = selected.lastIndexOf(true);
            return first < 0 ? [] : [{ start: first, end: last + 1 }];
          });
        }
        for (const text of options.legacyTexts.filter(Boolean)) {
          let index = node.value.toLowerCase().indexOf(text.toLowerCase());
          while (index >= 0) {
            ranges.push({ start: index, end: index + text.length });
            index = node.value.toLowerCase().indexOf(text.toLowerCase(), index + text.length);
          }
        }
        if (parent.type === 'element' && parent.tagName === 'code' && start !== undefined) {
          parent.properties.dataSourceStart = start;
          parent.properties.dataSourceEnd = end;
          if (offsets) parent.properties.dataSourceOffsets = JSON.stringify(offsets);
          if (!ranges.length) return [node];
        }
        let cursor = 0;
        return highlightSegments(node.value, ranges).map(({ text, highlighted }): Text | Element => {
          const from = cursor; cursor += text.length;
          if (start === undefined && !highlighted) return { type: 'text', value: text };
          return { type: 'element', tagName: highlighted ? 'mark' : 'span', properties: {
            ...(highlighted ? { className: ['reference-highlight'] } : {}),
            ...(start !== undefined ? { dataSourceStart: offsets?.[from] ?? start + from, dataSourceEnd: offsets?.[cursor] ?? start + cursor,
              ...(offsets ? { dataSourceOffsets: JSON.stringify(offsets.slice(from, cursor + 1)) } : {}) } : {}),
          }, children: [{ type: 'text', value: text }] };
        });
      });
    };
    visit(tree);
  };
}
