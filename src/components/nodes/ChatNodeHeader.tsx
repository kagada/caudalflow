import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Menu, Square, Copy, X, Palette, Trash2, CircleCheck, Circle } from 'lucide-react';
import type { PanelPoint } from '../ui/FloatingNodePanel';

interface ChatNodeHeaderProps {
  topic: string;
  maximized: boolean;
  done?: boolean;
  isPanning?: boolean;
  onMinimize: () => void;
  onMaximize: () => void;
  onDelete: (point?: PanelPoint) => void;
  onTogglePalette: (point?: PanelPoint) => void;
  onToggleDone: () => void;
  color?: string;
  label?: string;
}

// X 只收起卡片；删除与标签设置收进左侧菜单，避免被误认为窗口关闭。
export function ChatNodeHeader({ topic, maximized, done, isPanning, onMinimize, onMaximize, onDelete, onTogglePalette, onToggleDone, color, label }: ChatNodeHeaderProps) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const outside = (event: PointerEvent) => { if (!menuRef.current?.contains(event.target as Node)) setOpen(false); };
    const escape = (event: KeyboardEvent) => { if (event.key === 'Escape') { event.stopPropagation(); setOpen(false); } };
    document.addEventListener('pointerdown', outside);
    document.addEventListener('keydown', escape);
    return () => { document.removeEventListener('pointerdown', outside); document.removeEventListener('keydown', escape); };
  }, [open]);
  const perform = (action: () => void) => { setOpen(false); action(); };
  const btnClass = 'nodrag p-1.5 rounded-md hover:bg-surface-700 focus-visible:bg-surface-700 transition-colors';
  const itemClass = 'nodrag flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-left text-sm hover:bg-surface-700 focus-visible:bg-surface-700';
  return (
    <div className={`flex items-center gap-1 px-3 py-2.5 border-b border-border bg-surface-800 rounded-t-xl ${isPanning ? 'cursor-grab' : 'cursor-move'}`}>
      <div ref={menuRef} className="relative">
        <button onClick={() => setOpen(value => !value)} className={`${btnClass} text-text-secondary`} title={t('node.cardMenu')} aria-label={t('node.cardMenu')} aria-haspopup="menu" aria-expanded={open}><Menu size={18} /></button>
        {open && <div role="menu" aria-label={t('node.cardMenu')} className="nodrag nopan absolute left-0 top-full z-50 mt-2 w-56 rounded-xl border border-border bg-surface-900 p-2 shadow-xl">
          <button role="menuitem" className={itemClass} onClick={() => perform(onToggleDone)}>{done ? <Circle size={16} /> : <CircleCheck size={16} />}{t(done ? 'node.markNotDone' : 'node.markDone')}</button>
          <button role="menuitem" className={itemClass} onClick={(event) => perform(() => onTogglePalette(event.detail ? { x: event.clientX, y: event.clientY } : undefined))}><Palette size={16} />{t('node.addLabelAndColor')}</button>
          <button role="menuitem" className={`${itemClass} text-red-400`} onClick={(event) => perform(() => onDelete(event.detail ? { x: event.clientX, y: event.clientY } : undefined))}><Trash2 size={16} />{t('node.deleteConversation')}</button>
          <div role="separator" className="my-2 border-t border-border" />
          <button role="menuitem" className={itemClass} onClick={() => perform(onMinimize)}><X size={16} />{t('node.close')}</button>
        </div>}
      </div>
      <div className="flex-1 min-w-0 px-1">
        <div className="flex items-center gap-1.5 min-w-0">
          <span className="text-[15px] font-semibold text-accent-400 bg-accent-500/10 px-2 py-0.5 rounded-full truncate">{topic}</span>
          {done && <span data-conversation-done className="inline-flex shrink-0 items-center gap-1 rounded-full bg-emerald-500/10 px-1.5 py-0.5 text-xs text-status-done"><CircleCheck size={13} />{t('node.done')}</span>}
          {label && <span className="max-w-24 truncate text-xs px-1.5 py-0.5 rounded-full" title={label} style={{ backgroundColor: color ? `${color}20` : '#262626', color: color ?? '#a3a3a3' }}>{label}</span>}
        </div>
      </div>
      <button onClick={onMaximize} className={`${btnClass} ${maximized ? 'text-accent-400' : 'text-text-muted'} hover:text-text-primary`} title={maximized ? t('node.restoreSize') : t('node.maximize')} aria-label={maximized ? t('node.restoreSize') : t('node.maximize')}>
        {maximized ? <Copy size={16} /> : <Square size={16} />}
      </button>
      <button onClick={onMinimize} className={`${btnClass} text-text-muted hover:text-text-primary`} title={t('node.close')} aria-label={t('node.close')}><X size={18} /></button>
    </div>
  );
}
