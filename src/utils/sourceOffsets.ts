import { parseEntities } from 'parse-entities';

// 显示文字中的转义、实体仍指向原 Markdown 的范围，选择几个字不能回退成整篇文档。
export function sourceOffsets(raw: string, rendered: string, start: number): number[] {
  let decoded = '';
  const offsets = [start];
  for (let index = 0; index < raw.length;) {
    let length = 1;
    let value = raw[index];
    if (value === '\\' && /[!-/:-@[-`{-~]/.test(raw[index + 1] ?? '')) { length = 2; value = raw[index + 1]; }
    else if (value === '&') {
      const entity = /^&(?:#(?:[xX][\da-fA-F]+|\d+)|[A-Za-z][A-Za-z\d]+);/.exec(raw.slice(index))?.[0];
      if (entity) { length = entity.length; value = parseEntities(entity); }
    } else if (value === '\r' && raw[index + 1] === '\n') { length = 2; value = '\n'; }
    decoded += value;
    for (let part = 0; part < value.length; part++) offsets.push(start + index + (part === value.length - 1 ? length : 0));
    index += length;
  }
  if (decoded === rendered) return offsets;
  // 代码缩进等解析归一化只在当前文字节点内匹配，绝不扩大到整个回答。
  let cursor = 0;
  return [start, ...Array.from({ length: rendered.length }, (_, index) => {
    const found = raw.indexOf(rendered[index], cursor);
    if (found >= 0) cursor = found + 1;
    return start + cursor;
  })];
}
