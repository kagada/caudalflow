import { describe, expect, it } from 'vitest';
import { computeRawDiff, foldDiffRows } from '../rawDiff';
import type { DiffCell } from '../rawDiff';

const raw = (cell?: DiffCell) => cell ? cell.text + (cell.ending === 'LF' ? '\n' : cell.ending === 'CRLF' ? '\r\n' : '') : '';

describe('exact raw Markdown diff', () => {
  it.each([
    ['', ''], ['', '新增'], ['删除\n', ''],
    ['[同一标题](https://old.example)', '[同一标题](https://new.example)'],
    ['# 标题\r\n\n```js\n  const x = 1;\n```', '# 标题\n\n```js\n\tconst x = 2;\n```\n'],
    ['一\n二\n三\n', '零\n一\n二·改\n三\n四'],
    ['末尾有空格 \n', '末尾有空格\n'],
  ])('preserves both exact inputs including addresses and line endings', (before, after) => {
    const result = computeRawDiff(before, after);
    expect(result.rows.map((row) => raw(row.before)).join('')).toBe(before);
    expect(result.rows.map((row) => raw(row.after)).join('')).toBe(after);
    if (before !== after) expect(result.rows.some((row) => row.kind === 'changed')).toBe(true);
  });

  it('does not call large identical text a replacement', () => {
    const input = 'x'.repeat(1_000_001);
    expect(computeRawDiff(input, input)).toMatchObject({ coarse: false, rows: [{ kind: 'same' }] });
  });

  it('falls back to complete content without hiding changes when the budget is exceeded', () => {
    const before = 'a'.repeat(600_000); const after = 'b'.repeat(600_000);
    const result = computeRawDiff(before, after);
    expect(result.coarse).toBe(true);
    expect(result.rows.map((row) => raw(row.before)).join('')).toBe(before);
    expect(result.rows.map((row) => raw(row.after)).join('')).toBe(after);
  });

  it('keeps a late change visible while folding long unchanged prefixes', () => {
    const prefix = Array.from({ length: 2500 }, (_, index) => `行 ${index}\n`).join('');
    const result = computeRawDiff(`${prefix}旧链接`, `${prefix}新链接`);
    const blocks = foldDiffRows(result.rows, new Set());
    expect(blocks).toHaveLength(8);
    expect(blocks.some((block) => block.kind === 'row' && block.row.after?.text === '新链接')).toBe(true);
    const gap = blocks.find((block) => block.kind === 'gap')!;
    expect(foldDiffRows(result.rows, new Set([gap.index]))).toHaveLength(2501);
  });
});
