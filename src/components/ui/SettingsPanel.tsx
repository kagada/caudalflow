import { ModelManagement } from './ModelManagement';
import { useTranslation } from 'react-i18next';
import { X, Sun, Moon, Monitor } from 'lucide-react';
import { createPortal } from 'react-dom';
import { BuiltinPromptSettings } from './BuiltinPromptSettings';
import { useSettingsStore } from '../../stores/settingsStore';

export function SettingsPanel() {
  const { t } = useTranslation();
  const showSettings = useSettingsStore((s) => s.showSettings);
  const setShowSettings = useSettingsStore((s) => s.setShowSettings);
  const config = useSettingsStore((s) => s.llmConfig);
  const updateConfig = useSettingsStore((s) => s.updateLLMConfig);
  const showSystemPrompts = useSettingsStore((s) => s.showSystemPrompts);
  const toggleSystemPrompts = useSettingsStore((s) => s.toggleSystemPrompts);
  const language = useSettingsStore((s) => s.language);
  const setLanguage = useSettingsStore((s) => s.setLanguage);
  const theme = useSettingsStore((s) => s.theme);
  const setTheme = useSettingsStore((s) => s.setTheme);
  // 页签跟随共享状态，让模型配置入口可以切换已经打开的设置面板。
  const tab = useSettingsStore((s) => s.settingsSection);
  const setTab = (settingsSection: string) => useSettingsStore.setState({ settingsSection });
  const close = () => setShowSettings(false);

  if (!showSettings) return null;

  const labelClass = 'block text-xs font-medium mb-1';
  const inputClass =
    'w-full bg-surface-800 border border-border rounded-lg px-3 py-2 text-sm text-text-primary focus:border-accent-500/50 focus:outline-none transition-colors';

  const themeOptions = [
    { value: 'light' as const, icon: Sun, label: t('settings.themeLight') },
    { value: 'dark' as const, icon: Moon, label: t('settings.themeDark') },
    { value: 'system' as const, icon: Monitor, label: t('settings.themeSystem') },
  ];

  const panel = (
    <div role="dialog" aria-modal="true" aria-label="设置" className="bg-surface-900 border border-border flex flex-col text-text-primary h-[85vh] w-full max-w-4xl overflow-hidden rounded-xl shadow-2xl">
      <div className="flex items-center justify-between px-4 py-3 border-b border-border">
        <h2 className="text-sm font-semibold text-text-primary">{t('settings.title')}</h2>
        <button
          onClick={close}
          autoFocus
          aria-label={t('common.close')}
          className="text-text-secondary hover:text-text-primary transition-colors"
        >
          <X size={18} />
        </button>
      </div>
      <nav className="flex flex-wrap gap-2 border-b border-border px-4 py-2"><button aria-pressed={tab === 'general'} onClick={() => setTab('general')} className="rounded-lg px-3 py-2 hover:bg-surface-800">常规设置</button><button aria-pressed={tab === 'prompts'} onClick={() => setTab('prompts')} className="rounded-lg px-3 py-2 hover:bg-surface-800">内置提示词</button><button aria-pressed={tab === 'models'} onClick={() => setTab('models')} className="rounded-lg px-3 py-2 hover:bg-surface-800">模型管理</button></nav>

      <div className="min-h-0 flex-1 overflow-y-auto">{tab === 'models' ? <ModelManagement /> : tab === 'prompts' ? <BuiltinPromptSettings /> : <div className="mx-auto max-w-3xl p-5 space-y-4">
        <button onClick={() => useSettingsStore.getState().setShowPromptSettings(true)} className="w-full rounded-lg border border-border bg-surface-800 px-3 py-2 text-left text-sm hover:bg-surface-700">{t('menu.managePrompts')}</button>
        {/* Theme Section */}
        <div className="border-b border-border pb-4">
          <h3 className="text-xs font-semibold text-text-secondary mb-3">{t('settings.theme')}</h3>
          <div className="flex gap-2">
            {themeOptions.map((option) => (
              <button
                key={option.value}
                onClick={() => setTheme(option.value)}
                className={`flex-1 flex flex-col items-center gap-1.5 p-3 rounded-lg border transition-all ${
                  theme === option.value
                    ? 'border-accent-500 bg-accent-500/10 text-accent-400'
                    : 'border-border bg-surface-800 text-text-secondary hover:border-border-hover'
                }`}
              >
                <option.icon size={18} />
                <span className="text-[10px] font-medium">{option.label}</span>
              </button>
            ))}
          </div>
        </div>

        <details className="rounded-xl border border-border p-3"><summary className="cursor-pointer text-sm">生成参数</summary>
          <div className="mt-3 space-y-3">
            <label className={labelClass}>{t('settings.temperature')}
              <input aria-label="温度" type="range" min="0" max="2" step="0.1" value={config.temperature} onChange={(event) => updateConfig({ temperature: Number(event.target.value) })} className="mt-2 w-full accent-accent-500" />
              <span className="block text-right text-text-muted">{config.temperature}</span>
            </label>
            <label className={labelClass}>{t('settings.maxTokens')}
              <input aria-label="最大输出令牌数" type="number" value={config.maxTokens} onChange={(event) => updateConfig({ maxTokens: parseInt(event.target.value) || 2048 })} className={inputClass} />
            </label>
          </div>
        </details>
        {/* Display Settings */}
        <div className="border-t border-border pt-4">
          <h3 className="text-xs font-semibold text-text-secondary mb-3">{t('settings.display')}</h3>
          <label className="flex items-center justify-between cursor-pointer">
            <span className="text-xs text-text-secondary">{t('settings.showSystemPrompts')}</span>
            <button
              onClick={toggleSystemPrompts}
              className={`relative w-9 h-5 rounded-full transition-colors ${
                showSystemPrompts ? 'bg-accent-500' : 'bg-surface-700'
              }`}
            >
              <span
                className={`absolute top-0.5 left-0.5 w-4 h-4 rounded-full bg-white transition-transform ${
                  showSystemPrompts ? 'translate-x-4' : ''
                }`}
              />
            </button>
          </label>
          <p className="text-[10px] text-text-muted mt-1">
            {t('settings.showSystemPromptsDescription')}
          </p>
        </div>

        {/* Language Settings */}
        <div className="border-t border-border pt-4">
          <h3 className="text-xs font-semibold text-text-secondary mb-3">Language</h3>
          <select
            value={language}
            onChange={(e) => setLanguage(e.target.value)}
            className={inputClass}
          >
            <option value="en">English</option>
            <option value="zh">中文</option>
          </select>
        </div>
      </div>}</div>

    </div>
  );
  return createPortal(<div className="fixed inset-0 z-[11000] flex items-center justify-center bg-black/45 p-6" onKeyDown={(event) => {
    // 设置内的按键不传到画布；关闭设置不会触发卡片操作。
    event.stopPropagation();
    if (event.key === 'Escape') close();
  }}>{panel}</div>, document.body);
}
