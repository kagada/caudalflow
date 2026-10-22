import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useTranslation } from 'react-i18next';
import type { ChatMessage, ReferenceSelection } from '../../types/chat';
import { useSettingsStore } from '../../stores/settingsStore';
import { useCancelLayer } from '../../hooks/useCancelLayer';
import { isAndroid } from '../../services/platform';

export type MenuTarget = { x: number; y: number; sources?: ReferenceSelection[] } & ({ kind: 'selection'; text: string; message?: ChatMessage } | { kind: 'message'; message: ChatMessage });

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
  const [prompt, setPrompt] = useState(t('menu.defaultPrompt'));
  const [error, setError] = useState('');
  const [submenu, setSubmenu] = useState(false);
  const [copyingReference, setCopyingReference] = useState(false);
  const message = target.message;
  const text = target.kind === 'selection' ? target.text : target.message.content;
  const presets = useSettingsStore((state) => state.promptPresets);
  const ref = useRef<HTMLDivElement>(null);
  useCancelLayer(true, close, 10000);
  useLayoutEffect(() => {
    if (dialog || !ref.current) return;
    // 菜单项数量会变化，按实际高度限制位置，避免用固定高度把底部操作挤出屏幕。
    const menu = ref.current;
    menu.style.top = `${Math.max(8, Math.min(target.y, window.innerHeight - menu.getBoundingClientRect().height - 8))}px`;
  });
  useEffect(() => {
    const outside = (event: PointerEvent) => { if (!ref.current?.contains(event.target as Node)) close(); };
    document.addEventListener('pointerdown', outside);
    // 打开时聚焦菜单容器，首项不再看起来被选中；方向键再进入菜单项。
    ref.current?.focus({ preventScroll: true });
    return () => { document.removeEventListener('pointerdown', outside); };
  }, [close]);
  const perform = (action: () => void) => { action(); close(); };
  const copy = async () => {
    try { await navigator.clipboard.writeText(text); close(); }
    catch { setError(t('menu.copyFailed')); }
  };
  const buttonClass = 'w-full rounded-lg px-3 py-2.5 text-left text-sm hover:bg-surface-700 focus-visible:bg-surface-700 focus:outline-none disabled:opacity-40';
  const submitPrompt = () => {
    if (!prompt.trim() || busy) return;
    perform(() => dialog === 'rewrite' && message ? revise(message.id, prompt.trim()) : explore(text, prompt.trim()));
  };
  return createPortal(
    <div data-message-menu ref={ref} tabIndex={-1} className={`fixed z-[10000] outline-none text-text-primary ${isAndroid() && !dialog ? 'select-none' : ''} ${dialog ? 'inset-0 flex items-center justify-center bg-black/40 p-5' : 'w-64 rounded-xl border border-border bg-surface-900 p-2 shadow-2xl'}`}
      onKeyDown={(event) => {
        if (dialog || !['ArrowDown', 'ArrowUp'].includes(event.key)) return;
        event.preventDefault();
        const buttons = [...ref.current!.querySelectorAll<HTMLButtonElement>('[role="menuitem"]:not(:disabled)')];
        const index = buttons.findIndex((button) => button === document.activeElement);
        buttons[(index + (event.key === 'ArrowDown' ? 1 : buttons.length - 1)) % buttons.length]?.focus();
      }}
      style={dialog ? undefined : { left: Math.max(8, Math.min(target.x, window.innerWidth - 272)), top: Math.max(8, Math.min(target.y, window.innerHeight - 440)) }}
      onContextMenu={(event) => event.preventDefault()} onPointerDown={(event) => event.stopPropagation()} onMouseDown={(event) => { if (!dialog) event.preventDefault(); }}>
      {dialog ? (
        <div role="dialog" aria-modal="true" aria-label={t(dialog === 'delete' ? 'menu.delete' : 'menu.prompt')} className="w-full max-w-lg rounded-xl border border-border bg-surface-900 p-6 shadow-2xl">
          <h2 className="mb-3 text-xl font-semibold">{t(dialog === 'delete' ? 'menu.delete' : 'menu.prompt')}</h2>
          <p className="mb-4 text-sm leading-6 text-text-secondary">{t(dialog === 'delete' ? 'menu.deleteHint' : dialog === 'rewrite' ? 'menu.rewriteHint' : 'menu.selectionPromptHint')}</p>
          {dialog !== 'delete' && <textarea autoFocus aria-label={t('menu.prompt')} value={prompt} onChange={(event) => setPrompt(event.target.value)} className="nodrag nowheel w-full rounded-lg border border-border bg-surface-800 p-3 text-base leading-6" rows={5} />}
          <div className="mt-5 flex justify-end gap-3">
            <button className="rounded-lg px-4 py-2 hover:bg-surface-700" onClick={close}>{t('common.cancel')}</button>
            <button disabled={busy || (dialog !== 'delete' && !prompt.trim())} className="rounded-lg bg-accent-600 px-4 py-2 text-white disabled:opacity-40" onClick={() => dialog === 'delete' && message ? perform(() => remove(message.id)) : submitPrompt()}>{t(dialog === 'delete' ? 'menu.delete' : 'menu.run')}</button>
          </div>
        </div>
      ) : (
        <div role="menu" aria-label={t(target.kind === 'selection' ? 'menu.selection' : 'menu.message')}>
          <div className="px-3 py-2 text-xs text-text-muted">{t(target.kind === 'selection' ? 'menu.selection' : 'menu.message')}</div>
          <button role="menuitem" className={buttonClass} onClick={copy}>{t(target.kind === 'selection' ? 'menu.copySelection' : 'menu.copyMessage')}</button>
          {copyReference && <button role="menuitem" disabled={busy || copyingReference} className={buttonClass} onClick={async () => {
            setCopyingReference(true); setError('');
            try { await copyReference(); close(); } catch (failure) { setError(String(failure)); } finally { setCopyingReference(false); }
          }}>{copyingReference ? '正在整理引用…' : '复制引用'}</button>}
          <button role="menuitem" disabled={busy} className={buttonClass} onClick={() => perform(() => explore(text, ''))}>{t(target.kind === 'selection' ? 'menu.branch' : 'menu.branchMessage')}</button>
          <button role="menuitem" disabled={busy} className={buttonClass} onClick={() => perform(() => explore(text, t('menu.summaryPrompt')))}>{t(target.kind === 'selection' ? 'menu.summarize' : 'menu.summarizeMessage')}</button>
          <div className="relative" onMouseEnter={() => setSubmenu(true)} onMouseLeave={() => setSubmenu(false)}>
            <button role="menuitem" aria-haspopup="menu" aria-expanded={submenu} disabled={busy} className={`${buttonClass} flex justify-between`} onClick={() => setSubmenu(true)} onKeyDown={(event) => { if (event.key === 'ArrowRight') setSubmenu(true); }}>{t(target.kind === 'selection' ? 'menu.askPrompt' : 'menu.askPromptMessage')}<span>›</span></button>
            {submenu && <div role="menu" aria-label={t('menu.promptPresets')} className={`absolute top-0 w-64 rounded-xl border border-border bg-surface-900 p-2 shadow-2xl ${target.x > window.innerWidth - 550 ? 'right-full' : 'left-full'}`}>
              <div className="max-h-[50vh] overflow-y-auto">
                {!presets.length && <p className="px-3 py-2 text-sm text-text-muted">{t('menu.noPrompts')}</p>}
                {presets.map((preset) => <button key={preset.id} role="menuitem" disabled={busy} className={buttonClass} onClick={() => perform(() => explore(text, preset.content))}>{preset.name}</button>)}
                <button role="menuitem" className={buttonClass} onClick={() => { setSubmenu(false); setDialog('prompt'); }}>{t('menu.customPrompt')}</button>
              </div>
              <div className="mt-2 border-t border-border pt-2"><button role="menuitem" className={buttonClass} onClick={() => perform(() => useSettingsStore.getState().setShowPromptSettings(true))}>{t('menu.managePrompts')}</button></div>
            </div>}
          </div>
          {message && versions && <button role="menuitem" disabled={busy} className={buttonClass} onClick={() => perform(() => versions(message.id))}>文档版本</button>}
          {/* 跨回答选区仍显示重答和重构，让用户直接知道不可用的原因。 */}
          <button role="menuitem" disabled={busy || !message || message.role === 'system'} className={buttonClass} onClick={() => message && perform(() => revise(message.id))}>
            {t('menu.regenerate')}{!message && <span className="ml-1 text-xs">{t('menu.multipleAnswersUnavailable')}</span>}
          </button>
          {(!message || message.role === 'assistant') && <button role="menuitem" disabled={busy || !message} className={buttonClass} onClick={() => setDialog('rewrite')}>
            {t('menu.rewrite')}{!message && <span className="ml-1 text-xs">{t('menu.multipleAnswersUnavailable')}</span>}
          </button>}
          {message && <>
            <button role="menuitem" disabled={busy} className={`${buttonClass} text-red-400`} onClick={() => setDialog('delete')}>{t('menu.delete')}</button>
          </>}
          {busy && <p className="px-3 py-2 text-xs text-text-muted">{t('menu.busy')}</p>}
          {error && <p role="alert" className="px-3 py-2 text-xs text-red-400">{error}</p>}
        </div>
      )}
    </div>, document.body,
  );
}
