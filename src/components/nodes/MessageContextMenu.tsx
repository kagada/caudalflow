import { useEffect, useId, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { useTranslation } from 'react-i18next';
import { ChevronRight } from 'lucide-react';
import type { ChatMessage, ReferenceSelection } from '../../types/chat';
import { useSettingsStore } from '../../stores/settingsStore';
import { useCancelLayer } from '../../hooks/useCancelLayer';
import { isAndroid } from '../../services/platform';
import { selectionMenuPosition, type SelectionMenuBounds } from '../../utils/selectionMenuPosition';

export type MenuTarget = { x: number; y: number; sources?: ReferenceSelection[]; markdownText?: string; selectionBounds?: SelectionMenuBounds } & ({ kind: 'selection'; text: string; message?: ChatMessage } | { kind: 'message'; message: ChatMessage });

interface Props {
  target: MenuTarget;
  busy: boolean;
  close: () => void;
  explore: (text: string, prompt: string) => void;
  revise: (id: string, prompt?: string) => void;
  remove: (id: string) => void;
  versions?: (id: string) => void;
  copyReference?: () => Promise<void>;
}

// 两种入口共用操作列表；选区文字用于追问，单条消息用于重答，跨消息选区保留重答入口并说明不可用原因。
export function MessageContextMenu({ target, busy, close, explore, revise, remove, versions, copyReference }: Props) {
  const { t } = useTranslation();
  const [dialog, setDialog] = useState<'prompt' | 'rewrite' | 'delete' | null>(null);
  const [prompt, setPrompt] = useState('');
  const [error, setError] = useState('');
  const [submenu, setSubmenu] = useState<'copy' | 'branch' | 'revise' | null>(null);
  const submenuId = useId();
  const [copyingReference, setCopyingReference] = useState(false);
  const message = target.message;
  const text = target.kind === 'selection' ? target.text : target.message.content;
  const markdownText = target.kind === 'message' ? target.message.content : target.markdownText;
  const presets = useSettingsStore((state) => state.promptPresets);
  const ref = useRef<HTMLDivElement>(null);
  useCancelLayer(true, close, 10000);
  useLayoutEffect(() => {
    if (dialog || !ref.current) return;
    // 菜单项数量会变化，按实际高度限制位置，避免用固定高度把底部操作挤出屏幕。
    const menu = ref.current;
    if (isAndroid() && target.kind === 'selection' && target.selectionBounds) {
      const point = selectionMenuPosition(target.selectionBounds, menu.getBoundingClientRect(), { width: window.innerWidth, height: window.innerHeight });
      menu.style.left = `${point.x}px`; menu.style.top = `${point.y}px`;
      return;
    }
    menu.style.top = `${Math.max(8, Math.min(target.y, window.innerHeight - menu.getBoundingClientRect().height - 8))}px`;
  });
  useLayoutEffect(() => {
    const panel = ref.current?.querySelector<HTMLElement>('[data-submenu]');
    if (!panel) return;
    // 子菜单独立避让屏幕底部，主菜单缩短后也不能让最后一组操作越界。
    panel.style.top = '0px';
    // 手机放不下两列时在原菜单位置展开，并提供返回入口，避免子菜单跑到屏幕外。
    if (window.innerWidth < 416) {
      panel.style.right = 'auto';
      panel.style.left = `${Math.max(8, Math.min(ref.current!.getBoundingClientRect().left, window.innerWidth - panel.getBoundingClientRect().width - 8)) - panel.parentElement!.getBoundingClientRect().left}px`;
    }
    const bounds = panel.getBoundingClientRect();
    panel.style.top = `${Math.max(8 - bounds.top, Math.min(0, window.innerHeight - 8 - bounds.bottom))}px`;
    panel.querySelector<HTMLButtonElement>('[role="menuitem"]:not(:disabled)')?.focus({ preventScroll: true });
  }, [submenu]);
  useEffect(() => {
    const outside = (event: PointerEvent) => { if (!ref.current?.contains(event.target as Node)) close(); };
    document.addEventListener('pointerdown', outside);
    // 打开时聚焦菜单容器，首项不再看起来被选中；方向键再进入菜单项。
    ref.current?.focus({ preventScroll: true });
    return () => { document.removeEventListener('pointerdown', outside); };
  }, [close]);
  const perform = (action: () => void) => { action(); close(); };
  const copy = async (value: string) => {
    try { await navigator.clipboard.writeText(value); close(); }
    catch { setError(t('menu.copyFailed')); }
  };
  // 底色独立绘制，避免加宽左右留白时透明边框吃掉圆角。
  const buttonClass = 'relative isolate w-full px-3 py-1.5 text-left text-[13px] leading-5 before:pointer-events-none before:absolute before:inset-x-1.5 before:inset-y-0.5 before:-z-10 before:rounded-md before:content-[\'\'] hover:before:bg-surface-700 focus-visible:before:bg-surface-700 focus:outline-none disabled:opacity-40';
  // 安卓长按会自动选字，始终保留统一菜单；文字执行默认动作，只有独立箭头展开其他操作。
  const splitItem = (kind: 'copy' | 'branch' | 'revise', label: string, action: () => void, disabled: boolean, children: ReactNode, arrowDisabled = disabled) => (
    <div className="relative" onKeyDown={(event) => {
      if (event.key === 'ArrowRight' && !arrowDisabled) {
        event.preventDefault(); event.stopPropagation(); setSubmenu(kind);
      }
      if (event.key === 'ArrowLeft') {
        event.preventDefault(); event.stopPropagation(); setSubmenu(null);
        event.currentTarget.querySelector<HTMLButtonElement>('[aria-haspopup]')?.focus();
      }
    }}>
      {/* 竖线独立缩短，箭头底色固定为正方形，不再随行高拉成长条。 */}
      <div className="flex">
        <button role="menuitem" disabled={disabled} className={`${buttonClass} min-w-0 flex-1`} onClick={action}>{label}</button>
        <div className="relative flex w-10 shrink-0 items-center justify-center before:absolute before:inset-y-2 before:left-0 before:border-l before:border-border before:content-['']">
          <button role="menuitem" aria-label={t('menu.moreOptions', { action: label })} aria-haspopup="menu" aria-expanded={submenu === kind} aria-controls={submenu === kind ? `${submenuId}-${kind}` : undefined}
            disabled={arrowDisabled} className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md hover:bg-surface-700 focus-visible:bg-surface-700 focus:outline-none disabled:opacity-40"
            onClick={() => setSubmenu(submenu === kind ? null : kind)}><ChevronRight size={14} aria-hidden="true" /></button>
        </div>
      </div>
      {submenu === kind && <div id={`${submenuId}-${kind}`} data-submenu role="menu" aria-label={label}
        className={`absolute top-0 z-10 max-h-[calc(100dvh-16px)] w-48 overflow-y-auto rounded-lg border border-border bg-surface-900 py-1 shadow-2xl ${target.x > window.innerWidth - 416 ? 'right-full' : 'left-full'}`}>
        {window.innerWidth < 416 && <><button role="menuitem" className={buttonClass} onClick={(event) => {
          setSubmenu(null);
          event.currentTarget.closest('[data-submenu]')?.parentElement?.querySelector<HTMLButtonElement>('[aria-haspopup]')?.focus();
        }}>‹ {t('menu.back')}</button><div role="separator" className="my-1 border-t border-border" /></>}
        {children}
      </div>}
    </div>
  );
  const submitPrompt = () => {
    if (!prompt.trim() || busy) return;
    perform(() => dialog === 'rewrite' && message ? revise(message.id, prompt.trim()) : explore(text, prompt.trim()));
  };
  return createPortal(
    <div data-message-menu ref={ref} tabIndex={-1} className={`fixed z-[10000] outline-none text-text-primary ${isAndroid() && !dialog ? 'select-none' : ''} ${dialog ? 'inset-0 flex items-center justify-center bg-black/40 p-5' : 'w-48 rounded-lg border border-border bg-surface-900 py-1 shadow-2xl'}`}
      onKeyDown={(event) => {
        if (dialog || !['ArrowDown', 'ArrowUp'].includes(event.key)) return;
        event.preventDefault();
        const scope = (event.target as HTMLElement).closest('[role="menu"]') ?? ref.current!.querySelector('[role="menu"]')!;
        const buttons = [...scope.querySelectorAll<HTMLButtonElement>('[role="menuitem"]:not(:disabled)')].filter((button) => button.closest('[role="menu"]') === scope);
        const index = buttons.findIndex((button) => button === document.activeElement);
        buttons[(index + (event.key === 'ArrowDown' ? 1 : buttons.length - 1)) % buttons.length]?.focus();
      }}
      style={dialog ? undefined : { left: Math.max(8, Math.min(target.x, window.innerWidth - 208)), top: Math.max(8, Math.min(target.y, window.innerHeight - 440)) }}
      onContextMenu={(event) => event.preventDefault()} onPointerDown={(event) => event.stopPropagation()} onMouseDown={(event) => { if (!dialog) event.preventDefault(); }}>
      {dialog ? (
        <div role="dialog" aria-modal="true" aria-label={t(dialog === 'delete' ? 'menu.delete' : dialog === 'rewrite' ? 'menu.rewrite' : 'menu.customPrompt')} className="w-full max-w-lg rounded-xl border border-border bg-surface-900 p-6 shadow-2xl">
          <h2 className="mb-3 text-xl font-semibold">{t(dialog === 'delete' ? 'menu.delete' : dialog === 'rewrite' ? 'menu.rewrite' : 'menu.customPrompt')}</h2>
          <p className="mb-4 text-sm leading-6 text-text-secondary">{t(dialog === 'delete' ? 'menu.deleteHint' : dialog === 'rewrite' ? 'menu.rewriteHint' : 'menu.selectionPromptHint')}</p>
          {dialog !== 'delete' && <textarea autoFocus aria-label={t(dialog === 'rewrite' ? 'menu.rewriteQuestion' : 'menu.prompt')} placeholder={t(dialog === 'rewrite' ? 'menu.rewritePlaceholder' : 'menu.prompt')} value={prompt} onChange={(event) => setPrompt(event.target.value)} className="nodrag nowheel w-full rounded-lg border border-border bg-surface-800 p-3 text-base leading-6" rows={5} />}
          <div className="mt-5 flex justify-end gap-3">
            <button className="rounded-lg px-4 py-2 hover:bg-surface-700" onClick={close}>{t('common.cancel')}</button>
            <button disabled={busy || (dialog !== 'delete' && !prompt.trim())} className="rounded-lg bg-accent-600 px-4 py-2 text-white disabled:opacity-40" onClick={() => dialog === 'delete' && message ? perform(() => remove(message.id)) : submitPrompt()}>{t(dialog === 'delete' ? 'menu.delete' : 'menu.run')}</button>
          </div>
        </div>
      ) : (
        <div role="menu" aria-label={t(target.kind === 'selection' ? 'menu.selection' : 'menu.message')}>
          <div className="px-3 py-1 text-[11px] text-text-muted">{t(target.kind === 'selection' ? 'menu.selection' : 'menu.message')}</div>
          {splitItem('copy', t(target.kind === 'selection' ? 'menu.copySelection' : 'menu.copyMessage'), () => void copy(text), false, <>
            <button role="menuitem" disabled={markdownText === undefined} className={buttonClass} onClick={() => { if (markdownText !== undefined) void copy(markdownText); }}>{t('menu.copyMarkdown')}</button>
            {copyReference && <button role="menuitem" disabled={busy || copyingReference} className={buttonClass} onClick={async () => {
            setCopyingReference(true); setError('');
            try { await copyReference(); close(); } catch (failure) { setError(String(failure)); } finally { setCopyingReference(false); }
          }}>{copyingReference ? t('menu.copyingReference') : t('menu.copyReference')}</button>}
          </>, false)}
          {splitItem('branch', t(target.kind === 'selection' ? 'menu.branch' : 'menu.branchMessage'), () => perform(() => explore(text, '')), busy, <>
                <button role="menuitem" disabled={busy} className={buttonClass} onClick={() => perform(() => explore(text, t('menu.summaryPrompt')))}>{t('menu.summaryAction')}</button>
                {presets.map((preset) => <button key={preset.id} role="menuitem" disabled={busy} className={buttonClass} onClick={() => perform(() => explore(text, preset.content))}>{preset.name}</button>)}
                <div role="separator" className="my-1 border-t border-border" />
                <button role="menuitem" disabled={busy} className={buttonClass} onClick={() => { setSubmenu(null); setPrompt(''); setDialog('prompt'); }}>{t('menu.customPrompt')}</button>
                <button role="menuitem" className={buttonClass} onClick={() => perform(() => useSettingsStore.getState().setShowPromptSettings(true))}>{t('menu.managePrompts')}</button>
          </>)}
          <div role="separator" className="my-1 border-t border-border" />
          {splitItem('revise', t('menu.regenerate'), () => message && perform(() => revise(message.id)), busy || !message || message.role === 'system', <>
            {(!message || message.role === 'assistant') && <button role="menuitem" disabled={busy || !message} className={buttonClass} onClick={() => { setSubmenu(null); setPrompt(''); setDialog('rewrite'); }}>{t('menu.rewrite')}</button>}
            {message && versions && <button role="menuitem" disabled={busy} className={buttonClass} onClick={() => perform(() => versions(message.id))}>{t('menu.versions')}</button>}
          </>, busy || !message || (message.role !== 'assistant' && !versions))}
          <button role="menuitem" disabled={busy || !message} className={`${buttonClass} text-red-400`} onClick={() => { setSubmenu(null); setDialog('delete'); }}>{t('menu.delete')}</button>
          {!message && <p className="px-3 py-2 text-xs text-text-muted">{t('menu.multipleAnswersUnavailable')}</p>}
          {busy && <p className="px-3 py-2 text-xs text-text-muted">{t('menu.busy')}</p>}
          {error && <p role="alert" className="px-3 py-2 text-xs text-red-400">{error}</p>}
        </div>
      )}
    </div>, document.body,
  );
}
