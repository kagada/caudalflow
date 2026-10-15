import { diffLines } from 'diff';

export interface DiffCell { number: number; text: string; ending: 'LF' | 'CRLF' | '无末尾换行' }
export interface DiffRow { kind: 'same' | 'changed'; before?: DiffCell; after?: DiffCell }
export interface RawDiffResult { rows: DiffRow[]; coarse: boolean }
export type DiffBlock = { kind: 'row'; row: DiffRow; index: number } | { kind: 'gap'; index: number; count: number };

function lines(value: string): string[] { return value.match(/[^\n]*\n|[^\n]+$/g) ?? []; }
function cell(value: string, number: number): DiffCell {
  const ending = value.endsWith('\r\n') ? 'CRLF' : value.endsWith('\n') ? 'LF' : '无末尾换行';
  return { number, text: ending === 'CRLF' ? value.slice(0, -2) : ending === 'LF' ? value.slice(0, -1) : value, ending };
}

// 保留空白、链接地址和换行差异；复杂输入超出预算时明确按整段替换显示，不误报相同。
export function computeRawDiff(before: string, after: string): RawDiffResult {
  if (before === after) return { rows: lines(before).map((value, index) => ({ kind: 'same', before: cell(value, index + 1), after: cell(value, index + 1) })), coarse: false };
  const changes = before.length + after.length > 1_000_000 ? undefined : diffLines(before, after, { timeout: 150, maxEditLength: 4096 });
  const coarse = !changes;
  const parts = changes ?? [{ removed: true, added: false, value: before }, { added: true, removed: false, value: after }];
  const rows: DiffRow[] = [];
  let oldNumber = 1; let newNumber = 1;
  let removed: DiffCell[] = []; let added: DiffCell[] = [];
  const flush = () => {
    for (let index = 0; index < Math.max(removed.length, added.length); index++) rows.push({ kind: 'changed', before: removed[index], after: added[index] });
    removed = []; added = [];
  };
  for (const part of parts) {
    if (part.removed) { for (const value of lines(part.value)) removed.push(cell(value, oldNumber++)); }
    else if (part.added) { for (const value of lines(part.value)) added.push(cell(value, newNumber++)); }
    else { flush(); for (const value of lines(part.value)) rows.push({ kind: 'same', before: cell(value, oldNumber++), after: cell(value, newNumber++) }); }
  }
  flush();
  return { rows, coarse };
}

// 折叠长段未变内容，但保留所有变更附近的上下文，避免只渲染开头而藏住后面的差异。
export function foldDiffRows(rows: DiffRow[], expanded: Set<number>): DiffBlock[] {
  const blocks: DiffBlock[] = [];
  for (let index = 0; index < rows.length;) {
    if (rows[index].kind !== 'same') { blocks.push({ kind: 'row', row: rows[index], index }); index++; continue; }
    let end = index; while (end < rows.length && rows[end].kind === 'same') end++;
    if (end - index > 10 && !expanded.has(index)) {
      for (let offset = index; offset < index + 3; offset++) blocks.push({ kind: 'row', row: rows[offset], index: offset });
      blocks.push({ kind: 'gap', index, count: end - index - 6 });
      for (let offset = end - 3; offset < end; offset++) blocks.push({ kind: 'row', row: rows[offset], index: offset });
    } else for (let offset = index; offset < end; offset++) blocks.push({ kind: 'row', row: rows[offset], index: offset });
    index = end;
  }
  return blocks;
}
