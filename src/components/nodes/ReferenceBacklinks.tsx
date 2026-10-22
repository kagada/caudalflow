import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { ArrowUpRight } from 'lucide-react';
import { blockBacklinks, type MessageBacklink } from '../../utils/referenceBacklinks';
import type { HighlightRange } from '../../utils/referenceHighlights';
import { locateReferenceMessage } from '../../services/referenceNavigation';
import { useCancelLayer } from '../../hooks/useCancelLayer';

interface Props {
  backlinks: MessageBacklink[];
  start: number;
  end: number;
  preview: (ranges: HighlightRange[]) => void;
}

// 入口留在段落旁，列表放在画布外，避免被卡片裁切或把问题文字混进复制选区。
export const ReferenceBacklinks = memo(function ReferenceBacklinks({ backlinks, start, end, preview }: Props) {
  const links = useMemo(() => blockBacklinks(backlinks, start, end), [backlinks, start, end]);
  const [open, setOpen] = useState(false);
  const [pinned, setPinned] = useState(false);
  const [position, setPosition] = useState({ left: 0, top: 0, maxHeight: 320, transform: 'none' });
  const anchor = useRef<HTMLButtonElement>(null);
  const menu = useRef<HTMLDivElement>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const close = useCallback(() => { clearTimeout(timer.current); setOpen(false); setPinned(false); preview([]); }, [preview]);
  const show = () => {
    clearTimeout(timer.current);
    const rect = anchor.current?.getBoundingClientRect();
    if (!rect) return;
    const below = innerHeight - rect.bottom - 12, above = rect.top - 12;
    const down = below >= 240 || below >= above;
    setPosition({ left: Math.max(12, Math.min(rect.left, innerWidth - Math.min(360, innerWidth - 24) - 12)),
      top: down ? rect.bottom + 6 : rect.top - 6, maxHeight: Math.max(60, Math.min(320, down ? below : above)), transform: down ? 'none' : 'translateY(-100%)' });
    setOpen(true);
  };
  const leave = () => { if (!pinned) timer.current = setTimeout(close, 160); };
  useCancelLayer(open && links.length > 0, close, 12000);
  useEffect(() => {
    if (!open) return;
    const outside = (event: PointerEvent) => {
      if (event.target instanceof Node && !anchor.current?.contains(event.target) && !menu.current?.contains(event.target)) close();
    };
    const scroll = (event: Event) => { if (!(event.target instanceof Node) || !menu.current?.contains(event.target)) close(); };
    document.addEventListener('pointerdown', outside, true);
    document.addEventListener('scroll', scroll, true);
    window.addEventListener('resize', close); window.addEventListener('blur', close);
    return () => {
      document.removeEventListener('pointerdown', outside, true);
      document.removeEventListener('scroll', scroll, true); window.removeEventListener('resize', close); window.removeEventListener('blur', close);
    };
  }, [open, close]);
  useEffect(() => () => { clearTimeout(timer.current); preview([]); }, [preview]);
  if (!links.length) return null;
  return <>
    <button ref={anchor} type="button" data-reference-controls data-backlink-count={links.length}
      aria-label={`查看引用此处的 ${links.length} 个问题`} aria-expanded={open} aria-haspopup="dialog"
      title={`${links.length} 个问题引用了此处`} className="reference-backlink-button nodrag nopan nowheel"
      onPointerDown={(event) => event.stopPropagation()} onMouseUp={(event) => event.stopPropagation()}
      onMouseEnter={show} onMouseLeave={leave}
      onClick={(event) => { event.stopPropagation(); if (pinned) close(); else { show(); setPinned(true); } }}>
      <ArrowUpRight size={12} aria-hidden="true" />
    </button>
    {open && createPortal(<div ref={menu} role="dialog" aria-label="引用此处的问题" data-reference-controls
      className="fixed z-[12000] w-[360px] max-w-[calc(100vw-24px)] overflow-y-auto rounded-lg border border-border bg-surface-900 p-2 text-text-primary shadow-xl nodrag nopan nowheel"
      style={position} onPointerDown={(event) => event.stopPropagation()} onMouseUp={(event) => event.stopPropagation()}
      onClick={(event) => event.stopPropagation()}
      onMouseEnter={() => clearTimeout(timer.current)} onMouseLeave={() => { preview([]); leave(); }}>
      <p className="px-2 py-1 text-xs text-text-muted">引用此处的问题 · {links.length}</p>
      {links.map((link) => <button key={JSON.stringify([link.nodeId, link.questionId])} type="button" data-backlink-question={link.questionId}
        className="block w-full rounded-md px-2 py-2 text-left hover:bg-surface-800 focus:bg-surface-800 focus:outline-none"
        onMouseEnter={() => preview(link.ranges)} onMouseLeave={() => preview([])} onFocus={() => preview(link.ranges)} onBlur={() => preview([])}
        onClick={(event) => { event.stopPropagation(); close(); locateReferenceMessage(link.nodeId, link.questionId); }}>
        <span className="block whitespace-pre-wrap break-words text-sm leading-5">{link.question}</span>
        <span className="mt-1 block truncate text-xs text-text-muted" title={link.quote}>{link.quote}</span>
      </button>)}
    </div>, document.body)}
  </>;
});
