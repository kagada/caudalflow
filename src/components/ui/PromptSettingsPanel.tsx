import { useState } from 'react';
import { createPortal } from 'react-dom';
import { useTranslation } from 'react-i18next';
import { useSettingsStore, type PromptPreset } from '../../stores/settingsStore';
import { useCancelLayer } from '../../hooks/useCancelLayer';

// 同一编辑面板可从设置和菜单打开，预设保存后立即供选区追问使用。
export function PromptSettingsPanel() {
  const { t } = useTranslation();
  const presets = useSettingsStore((state) => state.promptPresets);
  const close = useSettingsStore((state) => state.setShowPromptSettings);
  useCancelLayer(true, () => close(false), 11000);
  const [draft, setDraft] = useState({ id: '', name: '', content: '' });
  const [saved, setSaved] = useState(false);
  const edit = (preset: PromptPreset) => { setDraft(preset); setSaved(false); };
  const save = () => {
    if (!draft.name.trim() || !draft.content.trim()) return;
    const preset = { id: draft.id || crypto.randomUUID(), name: draft.name.trim(), content: draft.content.trim() };
    useSettingsStore.getState().savePromptPreset(preset); setDraft(preset); setSaved(true);
  };
  return createPortal(<div className="fixed inset-0 z-[11000] flex items-center justify-center bg-black/40 p-6">
    <div role="dialog" aria-modal="true" aria-label={t('menu.managePrompts')} className="flex max-h-[90vh] w-full max-w-3xl flex-col overflow-hidden rounded-xl border border-border bg-surface-900 text-text-primary shadow-2xl">
      <div className="flex items-center justify-between border-b border-border p-5"><h2 className="text-xl font-semibold">{t('menu.managePrompts')}</h2><button onClick={() => close(false)} className="rounded-lg px-3 py-2 hover:bg-surface-700">{t('common.close')}</button></div>
      <div className="grid min-h-0 grid-cols-[200px_1fr] overflow-y-auto">
        <div className="border-r border-border p-4"><button onClick={() => { setDraft({ id: '', name: '', content: '' }); setSaved(false); }} className="mb-3 w-full rounded-lg bg-accent-600 p-2 text-white">{t('menu.newPrompt')}</button>
          {!presets.length && <p className="text-sm text-text-muted">{t('menu.managerEmpty')}</p>}
          {presets.map((preset) => <button key={preset.id} onClick={() => edit(preset)} className={`mb-1 w-full rounded-lg p-2 text-left text-sm ${draft.id === preset.id ? 'bg-accent-500/10' : 'hover:bg-surface-700'}`}>{preset.name}</button>)}
        </div>
        <div className="space-y-4 p-5"><label className="block text-sm">{t('menu.promptName')}<input autoFocus value={draft.name} onChange={(event) => { setDraft({ ...draft, name: event.target.value }); setSaved(false); }} className="mt-2 w-full rounded-lg border border-border bg-surface-800 p-3 text-base" /></label>
          <label className="block text-sm">{t('menu.promptContent')}<textarea rows={8} value={draft.content} onChange={(event) => { setDraft({ ...draft, content: event.target.value }); setSaved(false); }} className="mt-2 w-full rounded-lg border border-border bg-surface-800 p-3 text-base leading-6" /></label>
          <p className="text-sm text-text-muted">{t('menu.presetHint')}</p>
          <div className="flex items-center gap-3"><button onClick={save} disabled={!draft.name.trim() || !draft.content.trim()} className="rounded-lg bg-accent-600 px-4 py-2 text-white disabled:opacity-40">{t('common.save')}</button>
            {draft.id && <button onClick={() => { useSettingsStore.getState().deletePromptPreset(draft.id); setDraft({ id: '', name: '', content: '' }); setSaved(false); }} className="rounded-lg px-4 py-2 text-red-400 hover:bg-surface-700">{t('common.delete')}</button>}
            {saved && <span role="status" className="text-sm text-green-500">{t('common.saved')}</span>}
          </div>
        </div>
      </div>
    </div>
  </div>, document.body);
}
