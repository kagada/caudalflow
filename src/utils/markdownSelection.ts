import { unified } from 'unified';
import remarkParse from 'remark-parse';
import remarkGfm from 'remark-gfm';
import type { Nodes } from 'mdast';

const parser = unified().use(remarkParse).use(remarkGfm);
const inlineWrappers = new Set(['strong', 'emphasis', 'delete', 'link']);
const blockWrappers = new Set(['heading', 'listItem', 'blockquote']);

// 只复制选中的文字，但补齐边界上的格式包装；不能为了拿到 ** 或链接地址而多复制相邻文字。
export function markdownSelection(content: string, start: number, end: number): string {
  const slice = (from: number, to: number) => content.slice(Math.max(start, from), Math.max(Math.max(start, from), Math.min(end, to)));
  const render = (node: Nodes): string => {
    const from = node.position?.start.offset ?? 0;
    const to = node.position?.end.offset ?? content.length;
    if (to <= start || from >= end) return '';
    if (from >= start && to <= end) return content.slice(from, to);
    if (node.type === 'inlineCode') {
      const marker = /^`+/.exec(content.slice(from, to))![0];
      const text = slice(from + marker.length, to - marker.length);
      return text ? `${marker}${text}${marker}` : '';
    }
    if (!('children' in node) || !node.children.length) return slice(from, to);
    const first = node.children[0].position?.start.offset ?? from;
    const last = node.children.at(-1)!.position?.end.offset ?? to;
    // 标题级别、列表编号和任务状态属于所在块，选中字面内容时也要带上这些标记。
    // 只选子列表时从子列表开始，不补出一个没有选中文字的父列表项。
    const onlyNestedList = node.type === 'listItem' && node.children.every((child) => child.type === 'list' ||
      (child.position?.end.offset ?? 0) <= start || (child.position?.start.offset ?? content.length) >= end);
    const wrapped = inlineWrappers.has(node.type) || (blockWrappers.has(node.type) && !onlyNestedList);
    if (wrapped && (end <= first || start >= last)) return '';
    let result = wrapped ? content.slice(from, first) : slice(from, first);
    let cursor = first;
    for (const child of node.children) {
      const childStart = child.position?.start.offset ?? cursor;
      result += slice(cursor, childStart) + render(child);
      cursor = child.position?.end.offset ?? childStart;
    }
    return result + (wrapped ? content.slice(last, to) : slice(last, to));
  };
  return render(parser.parse(content));
}
