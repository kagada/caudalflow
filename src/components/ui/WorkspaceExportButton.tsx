import { useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { ChevronRight, Download } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { useCancelLayer } from '../../hooks/useCancelLayer';

// 导出文字直接执行工作区导出，独立箭头只展开其他格式；弹层不受工具栏滚动区域裁切。
export function WorkspaceExportButton({ onExport, onExportMarkdown }: { onExport: () => void; onExportMarkdown: () => void }) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const group = useRef<HTMLDivElement>(null);
  const arrow = useRef<HTMLButtonElement>(null);
  const menu = useRef<HTMLDivElement>(null);
  const close = () => { setOpen(false); arrow.current?.focus(); };
  useCancelLayer(open, close, 60);

  useLayoutEffect(() => {
    if (!open) return;
    const position = () => {
      if (!arrow.current || !menu.current) return;
      const anchor = arrow.current.getBoundingClientRect();
      const panel = menu.current.getBoundingClientRect();
      menu.current.style.left = `${Math.max(8, Math.min(anchor.right - panel.width, window.innerWidth - panel.width - 8))}px`;
      menu.current.style.top = `${Math.max(8, Math.min(anchor.bottom + 4, window.innerHeight - panel.height - 8))}px`;
    };
    const outside = (event: Event) => {
      if (event.target instanceof Node && !group.current?.contains(event.target) && !menu.current?.contains(event.target)) setOpen(false);
    };
    position();
    menu.current?.querySelector<HTMLButtonElement>('button')?.focus();
    // 画布会阻止事件冒泡，外部关闭在捕获阶段处理。
    document.addEventListener('pointerdown', outside, true);
    document.addEventListener('focusin', outside, true);
    window.addEventListener('resize', position);
    window.addEventListener('scroll', position, true);
    return () => {
      document.removeEventListener('pointerdown', outside, true);
      document.removeEventListener('focusin', outside, true);
      window.removeEventListener('resize', position);
      window.removeEventListener('scroll', position, true);
    };
  }, [open]);

  return <>
    {/* 两个点击区共用圆角边框，分割线只占中间一段，箭头靠近分割线排列。 */}
    <div ref={group} className="inline-flex h-7 shrink-0 items-center overflow-hidden rounded-md border border-border bg-surface-900 text-[11px] text-text-muted">
      <button onClick={() => { setOpen(false); onExport(); }} title={t('workspace.exportWorkspace')}
        className="inline-flex h-full items-center gap-1 whitespace-nowrap pl-2 pr-1.5 hover:bg-surface-800 hover:text-text-primary transition-colors">
        <Download size={15} /><span>{t('workspace.exportShort')}</span>
      </button>
      <button ref={arrow} title={t('workspace.exportFormats')} aria-label={t('workspace.exportFormats')} aria-haspopup="menu" aria-expanded={open}
        onClick={() => setOpen((value) => !value)} onKeyDown={(event) => {
          if (event.key === 'ArrowDown' || event.key === 'ArrowRight') { event.preventDefault(); setOpen(true); }
        }} className="relative flex h-full w-5 items-center justify-center before:absolute before:inset-y-1.5 before:left-0 before:border-l before:border-border before:content-[''] hover:bg-surface-800 hover:text-text-primary focus-visible:bg-surface-800">
        <ChevronRight size={14} />
      </button>
    </div>
    {open && createPortal(<div ref={menu} role="menu" aria-label={t('workspace.exportFormats')}
      className="fixed z-[10000] w-44 rounded-lg border border-border bg-surface-900 p-1 text-text-primary shadow-xl"
      onKeyDown={(event) => {
        if (event.key === 'ArrowLeft') { event.preventDefault(); close(); }
        if (event.key === 'ArrowDown' || event.key === 'ArrowUp') event.preventDefault();
      }}>
      <button role="menuitem" onClick={() => { close(); onExportMarkdown(); }}
        className="w-full rounded-md px-2 py-1.5 text-left text-[13px] hover:bg-surface-700 focus-visible:bg-surface-700 focus:outline-none">
        {t('workspace.markdownFormat')}
      </button>
    </div>, document.body)}
  </>;
}
