import { useEffect, useMemo, useState } from 'react';
import { computeRawDiff, foldDiffRows } from '../../services/storage/rawDiff';
import type { DiffCell, RawDiffResult } from '../../services/storage/rawDiff';

function Cell({ value, changed, side, whitespace }: { value?: DiffCell; changed: boolean; side: 'before' | 'after'; whitespace: boolean }) {
  return <div className={`flex min-w-0 items-start ${changed && value ? side === 'before' ? 'bg-red-500/10' : 'bg-emerald-500/10' : ''}`}>
    <span aria-hidden="true" className="w-12 shrink-0 select-none pr-3 text-right text-text-muted">{value?.number}</span>
    <code className="min-w-0 flex-1 whitespace-pre-wrap [overflow-wrap:anywhere]">{value ? whitespace ? value.text.replace(/\t| /g, (text) => text === '\t' ? '→' : '·') : value.text || ' ' : ' '}{changed && value && <span className="ml-2 select-none rounded border border-border px-1 text-[10px] text-text-muted">{value.ending}</span>}</code>
  </div>;
}

// 始终展示转义后的原文，不解析 Markdown，也不执行原文中的 HTML 或链接。
export function RawTextDiff({ before, after }: { before: string; after: string }) {
  const [result, setResult] = useState<{ before: string; after: string; diff: RawDiffResult } | null>(null);
  const [expanded, setExpanded] = useState<Set<number>>(() => new Set());
  const [limit, setLimit] = useState(1000);
  const [whitespace, setWhitespace] = useState(false);
  useEffect(() => {
    let active = true;
    if (typeof Worker === 'undefined') {
      void Promise.resolve().then(() => { if (active) setResult({ before, after, diff: computeRawDiff(before, after) }); });
      return () => { active = false; };
    }
    let worker: Worker | undefined;
    const fallback = () => { void Promise.resolve().then(() => { if (active) setResult({ before, after, diff: computeRawDiff(before, after) }); }); };
    try {
      worker = new Worker(new URL('../../services/storage/rawDiff.worker.ts', import.meta.url), { type: 'module' });
      worker.onmessage = (event: MessageEvent<RawDiffResult>) => { if (active) setResult({ before, after, diff: event.data }); worker?.terminate(); };
      worker.onerror = (event) => { event.preventDefault(); worker?.terminate(); fallback(); };
      worker.postMessage({ before, after });
    } catch { fallback(); }
    return () => { active = false; worker?.terminate(); };
  }, [before, after]);
  const current = result?.before === before && result.after === after ? result.diff : null;
  const blocks = useMemo(() => current ? foldDiffRows(current.rows, expanded) : [], [current, expanded]);
  if (!current) return <p role="status" className="p-3 text-sm text-text-muted">正在计算原文差异…</p>;
  return <div className="border-t border-border">
    <div className="flex items-center justify-between border-b border-border px-3 py-1 text-xs text-text-muted"><span>{before === after ? '正文未修改' : '红色：修改前 · 绿色：修改后'}</span><label><input type="checkbox" checked={whitespace} onChange={(event) => setWhitespace(event.target.checked)} /> 显示空白</label></div>
    {current.coarse && <p className="p-2 text-xs text-text-secondary">内容较大或差异较多，按完整替换显示原文。</p>}
    {!current.rows.length && <div className="grid grid-cols-2 p-3 text-sm text-text-muted"><span>空内容</span><span>空内容</span></div>}
    <div className="py-2 font-mono text-xs leading-6" data-raw-diff>
      {blocks.slice(0, limit).map((block) => block.kind === 'gap' ? <button key={`gap-${block.index}`} className="block w-full border-y border-dashed border-border bg-surface-800 py-1 text-text-secondary" onClick={() => setExpanded((value) => new Set([...value, block.index]))}>展开 {block.count} 行未修改内容</button> : <div key={block.index} className="grid grid-cols-2 divide-x divide-border" data-diff-kind={block.row.kind}>
        <Cell value={block.row.before} changed={block.row.kind === 'changed'} side="before" whitespace={whitespace} />
        <Cell value={block.row.after} changed={block.row.kind === 'changed'} side="after" whitespace={whitespace} />
      </div>)}
    </div>
    {blocks.length > limit && <button className="w-full border-t border-border p-2 text-sm text-accent-400" onClick={() => setLimit((value) => value + 1000)}>继续显示后面的内容（剩余 {blocks.length - limit} 行／段）</button>}
  </div>;
}
