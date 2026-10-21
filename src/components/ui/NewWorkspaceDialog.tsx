import { useRef, useState, type FormEvent } from 'react';
import { createPortal } from 'react-dom';
import { FolderPlus, X } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { useCancelLayer } from '../../hooks/useCancelLayer';

// 命名交给应用弹窗，存储层只接收名称；创建期间避免重复提交或返回到背后的画布。
export function NewWorkspaceDialog({ onCreate, onClose }: {
  onCreate: (name: string) => Promise<void>;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const pending = useRef(false);
  const form = useRef<HTMLFormElement>(null);
  const close = () => { if (!pending.current) onClose(); };
  useCancelLayer(true, close, 12000);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    const trimmed = name.trim();
    if (!trimmed || pending.current) return;
    pending.current = true; setBusy(true); setError('');
    try { await onCreate(trimmed); onClose(); }
    catch (failure) {
      setError(failure instanceof Error ? failure.message : String(failure));
      pending.current = false; setBusy(false);
    }
  };

  return createPortal(
    <div className="fixed inset-0 z-[12000] flex items-center justify-center overflow-y-auto bg-black/50 p-5" onPointerDown={(event) => {
      if (event.target === event.currentTarget) close();
    }}>
      <form ref={form} role="dialog" aria-modal="true" aria-labelledby="new-workspace-title"
        className="w-full max-w-md rounded-2xl border border-border bg-surface-900 text-text-primary shadow-2xl"
        onSubmit={(event) => void submit(event)} onKeyDown={(event) => {
          // 输入法确认候选词不能提交；Tab 焦点保持在弹窗内。
          if (event.key === 'Enter' && (event.nativeEvent.isComposing || event.keyCode === 229)) event.preventDefault();
          if (event.key === 'Tab') {
            const targets = [...(form.current?.querySelectorAll<HTMLElement>('input:not(:disabled),button:not(:disabled)') ?? [])];
            const first = targets[0], last = targets[targets.length - 1];
            if (!first || (event.shiftKey && document.activeElement === first) || (!event.shiftKey && document.activeElement === last)) {
              event.preventDefault(); (event.shiftKey ? last : first)?.focus();
            }
          }
          event.stopPropagation();
        }}>
        <div className="flex items-center gap-3 px-5 pt-5">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-accent-500/10 text-accent-400"><FolderPlus size={21} /></div>
          <h2 id="new-workspace-title" className="flex-1 text-base font-semibold">{t('workspace.newWorkspace')}</h2>
          <button type="button" aria-label={t('common.close')} disabled={busy} onClick={close} className="rounded-lg p-2 text-text-muted hover:bg-surface-800 hover:text-text-primary disabled:opacity-40"><X size={18} /></button>
        </div>
        <div className="px-5 py-5">
          <label htmlFor="new-workspace-name" className="mb-2 block text-xs text-text-secondary">{t('workspace.name')}</label>
          <input id="new-workspace-name" autoFocus autoComplete="off" value={name} disabled={busy}
            onChange={(event) => setName(event.target.value)} placeholder={t('workspace.namePlaceholder')}
            className="w-full rounded-lg border border-border bg-surface-800 px-3 py-2.5 text-sm outline-none transition-colors placeholder:text-text-muted focus:border-accent-500 disabled:opacity-50" />
          {error && <p role="alert" className="mt-3 text-xs text-red-400">{error}</p>}
        </div>
        <div className="flex justify-end gap-2 border-t border-border px-5 py-4">
          <button type="button" disabled={busy} onClick={close} className="rounded-lg border border-border px-4 py-2 text-sm text-text-secondary hover:bg-surface-800 disabled:opacity-40">{t('common.cancel')}</button>
          <button type="submit" disabled={busy || !name.trim()} className="rounded-lg bg-accent-600 px-4 py-2 text-sm font-medium text-white hover:bg-accent-500 disabled:cursor-not-allowed disabled:opacity-40">{t(busy ? 'workspace.creating' : 'workspace.create')}</button>
        </div>
      </form>
    </div>, document.body,
  );
}
