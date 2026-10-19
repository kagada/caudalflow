import { ModelManagement } from './ModelManagement';
import { useTranslation } from 'react-i18next';
import { X, Sun, Moon, Monitor, Eye, EyeOff, RefreshCw, CheckCircle, XCircle, Loader2 } from 'lucide-react';
import { useState, useCallback, useRef, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { BuiltinPromptSettings } from './BuiltinPromptSettings';
import { useSettingsStore } from '../../stores/settingsStore';
import { listProviders } from '../../services/providers/registry';
import { fetchModels, testConnection } from '../../services/providers/api';
import type { LLMConfig } from '../../types/chat';
import { isDeepSeekEndpoint } from '../../services/providers/thinking';
import { isDesktopRuntime } from '../../services/providers/transport';

export function SettingsPanel({ standalone = false }: { standalone?: boolean }) {
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
  const providers = listProviders();
  const [showApiKey, setShowApiKey] = useState(false);
  const [loadingModels, setLoadingModels] = useState(false);
  const [testingConnection, setTestingConnection] = useState(false);
  const [connectionResult, setConnectionResult] = useState<{ success: boolean; message: string } | null>(null);
  const [models, setModels] = useState<{ id: string; name: string }[]>([]);
  const [modelsError, setModelsError] = useState<string | null>(null);
  const requestVersion = useRef(0);
  const isOpenAICompatible = ['custom', 'openai', 'deepseek'].includes(config.providerId);
  const [tab, setTab] = useState(['prompts', 'models'].includes(new URLSearchParams(location.search).get('section') ?? '') ? new URLSearchParams(location.search).get('section')! : useSettingsStore.getState().settingsSection);
  const close = () => standalone ? window.close() : setShowSettings(false);
  useEffect(() => {
    const change = (event: Event) => {
      const section = (event as CustomEvent<string>).detail;
      if (section === 'presets') useSettingsStore.getState().setShowPromptSettings(true);
      else setTab(['prompts', 'models'].includes(section) ? section : 'general');
    };
    window.addEventListener('caudalflow:settings-section', change);
    return () => window.removeEventListener('caudalflow:settings-section', change);
  }, []);

  // 更改接口后旧请求的结果不能写回，避免显示其他服务商的模型或连接状态。
  const handleConfigChange = (changes: Partial<LLMConfig>) => {
    requestVersion.current += 1;
    setConnectionResult(null);
    setModelsError(null);
    if ('endpoint' in changes || 'apiKey' in changes || 'providerId' in changes) setModels([]);
    updateConfig(changes);
  };

  const handleFetchModels = useCallback(async () => {
    if (!config.endpoint.trim()) return;
    const version = requestVersion.current;
    setLoadingModels(true);
    setModelsError(null);
    try {
      const fetchedModels = await fetchModels(config.endpoint, config.apiKey);
      if (version === requestVersion.current) {
        setModels(fetchedModels);
        if (!fetchedModels.length) setModelsError(t('settings.noModels'));
      }
    } catch (error) {
      if (version === requestVersion.current) {
        setModels([]);
        setModelsError(`${t('settings.modelsFailed')} ${error instanceof Error ? error.message : ''}`);
      }
    } finally {
      setLoadingModels(false);
    }
  }, [config.endpoint, config.apiKey, t]);

  const handleTestConnection = useCallback(async () => {
    if (!config.endpoint.trim() || !config.model.trim()) return;
    const version = requestVersion.current;
    setTestingConnection(true);
    setConnectionResult(null);
    try {
      const result = await testConnection(config.endpoint, config.apiKey, config.model, config.thinkingMode);
      if (version === requestVersion.current) setConnectionResult(result);
    } finally {
      setTestingConnection(false);
    }
  }, [config.endpoint, config.apiKey, config.model, config.thinkingMode]);

  if (!standalone && !showSettings) return null;

  const labelClass = 'block text-xs font-medium mb-1';
  const inputClass =
    'w-full bg-surface-800 border border-border rounded-lg px-3 py-2 text-sm text-text-primary focus:border-accent-500/50 focus:outline-none transition-colors';

  const themeOptions = [
    { value: 'light' as const, icon: Sun, label: t('settings.themeLight') },
    { value: 'dark' as const, icon: Moon, label: t('settings.themeDark') },
    { value: 'system' as const, icon: Monitor, label: t('settings.themeSystem') },
  ];

  const panel = (
    <div role="dialog" aria-label="设置" className={`bg-surface-900 border border-border flex flex-col text-text-primary ${standalone ? 'h-screen w-full' : 'h-[85vh] w-full max-w-4xl overflow-hidden rounded-xl shadow-2xl'}`}>
      <div className="flex items-center justify-between px-4 py-3 border-b border-border">
        <h2 className="text-sm font-semibold text-text-primary">{t('settings.title')}</h2>
        <button
          onClick={close}
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

        <details className="rounded-xl border border-border p-3"><summary className="cursor-pointer text-sm">旧版模型配置与生成参数</summary><p className="my-3 text-xs text-text-muted">新模型请前往“模型管理”配置并设为默认；未设新默认时，继续使用这里的旧版配置。生成参数对所有模型生效。</p>
        {/* LLM Provider Section */}
        <div>
          <label htmlFor="llm-provider" className={labelClass}>{t('settings.llmProvider')}</label>
          <select
            id="llm-provider"
            value={config.providerId}
            onChange={(e) => handleConfigChange({ providerId: e.target.value })}
            className={inputClass}
          >
            {providers.map((p) => (
              <option key={p.id} value={p.id}>
                {p.id === 'custom' ? t('settings.customProvider') : p.name}
              </option>
            ))}
          </select>
        </div>

        {/* Provider Name - Editable for custom */}
        {config.providerId === 'custom' && (
          <div>
            <label className={labelClass}>{t('settings.providerName')}</label>
            <input
              type="text"
              value={config.providerName}
              onChange={(e) => updateConfig({ providerName: e.target.value })}
              className={inputClass}
              placeholder="My Custom Provider"
            />
          </div>
        )}

        {/* API Key Input - Show for all providers except mock */}
        {config.providerId !== 'mock' && (
          <div>
            <label htmlFor="api-key" className={labelClass}>{t('settings.apiKey')}</label>
            <div className="relative">
              <input
                id="api-key"
                type={showApiKey ? 'text' : 'password'}
                value={config.apiKey}
                onChange={(e) => handleConfigChange({ apiKey: e.target.value })}
                className={inputClass}
                placeholder={t('settings.apiKeyPlaceholder')}
              />
              <button
                type="button"
                onClick={() => setShowApiKey(!showApiKey)}
                className="absolute right-2 top-1/2 -translate-y-1/2 text-text-muted hover:text-text-primary"
              >
                {showApiKey ? <EyeOff size={14} /> : <Eye size={14} />}
              </button>
            </div>
            <p className="text-[10px] text-text-muted mt-1">
              {t(config.providerId === 'anthropic' ? 'settings.proxyDescription' : isDesktopRuntime() ? 'settings.desktopApiKeyDescription' : 'settings.apiKeyDescription')}
            </p>
          </div>
        )}

        {/* OpenAI 与兼容接口都使用可编辑地址，适合只启动本地界面的用法。 */}
        {isOpenAICompatible && (
          <div>
            <label htmlFor="api-endpoint" className={labelClass}>{t('settings.endpoint')}</label>
            <input
              id="api-endpoint"
              type="text"
              value={config.endpoint}
              onChange={(e) => handleConfigChange({ endpoint: e.target.value })}
              className={inputClass}
              placeholder="https://api.example.com/v1"
            />
            <p className="text-[10px] text-text-muted mt-1">
              {t('settings.endpointDescription')}
            </p>

            {/* Test Connection & Fetch Models */}
            <div className="flex gap-2 mt-2">
              <button
                onClick={handleTestConnection}
                disabled={!config.endpoint.trim() || !config.model.trim() || testingConnection}
                className="flex items-center gap-1.5 px-3 py-1.5 text-xs bg-surface-700 hover:bg-surface-600 rounded-md transition-colors disabled:opacity-50"
              >
                {testingConnection ? (
                  <Loader2 size={12} className="animate-spin" />
                ) : connectionResult?.success ? (
                  <CheckCircle size={12} className="text-green-400" />
                ) : connectionResult?.success === false ? (
                  <XCircle size={12} className="text-red-400" />
                ) : null}
                {t('settings.testConnection')}
              </button>
              <button
                onClick={handleFetchModels}
                disabled={!config.endpoint.trim() || loadingModels}
                className="flex items-center gap-1.5 px-3 py-1.5 text-xs bg-surface-700 hover:bg-surface-600 rounded-md transition-colors disabled:opacity-50"
              >
                {loadingModels ? <Loader2 size={12} className="animate-spin" /> : <RefreshCw size={12} />}
                {t('settings.fetchModels')}
              </button>
            </div>

            {connectionResult && (
              <p className={`text-[10px] mt-1 ${connectionResult.success ? 'text-green-400' : 'text-red-400'}`}>
                {connectionResult.success ? t('settings.connectionSuccess') : connectionResult.message}
              </p>
            )}
            {modelsError && <p role="alert" className="text-[10px] mt-1 text-red-400">{modelsError}</p>}
            <p className="text-[10px] text-text-muted mt-1">{t(isDesktopRuntime() ? 'settings.desktopConnectionHint' : 'settings.connectionHint')}</p>
          </div>
        )}

        {/* Model Config - Show for non-mock providers */}
        {config.providerId !== 'mock' && (
          <>
            <div>
              <label htmlFor="api-model" className={labelClass}>{t('settings.model')}</label>
                <input
                  id="api-model"
                  type="text"
                  list="api-models"
                  value={config.model}
                  onChange={(e) => handleConfigChange({ model: e.target.value })}
                  className={inputClass}
                  placeholder={config.providerId === 'openai' ? 'gpt-4o-mini' : config.providerId === 'anthropic' ? 'claude-sonnet-4-20250514' : 'model-id'}
                />
              <datalist id="api-models">
                {models.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
              </datalist>
              <p className="text-[10px] text-text-muted mt-1">{t('settings.modelDescription')}</p>
            </div>
            <div>
              <label className={labelClass}>{t('settings.temperature')}</label>
              <input
                type="range"
                min="0"
                max="2"
                step="0.1"
                value={config.temperature}
                onChange={(e) =>
                  updateConfig({ temperature: parseFloat(e.target.value) })
                }
                className="w-full accent-accent-500"
              />
              <div className="text-xs text-text-muted text-right">
                {config.temperature}
              </div>
            </div>
            {isOpenAICompatible && isDeepSeekEndpoint(config.endpoint) && (
              <div>
                <label htmlFor="thinking-mode" className={labelClass}>{t('settings.thinkingMode')}</label>
                <select id="thinking-mode" value={config.thinkingMode ?? 'disabled'} onChange={(e) => handleConfigChange({ thinkingMode: e.target.value as LLMConfig['thinkingMode'] })} className={inputClass}>
                  <option value="disabled">{t('settings.thinkingDisabled')}</option>
                  <option value="enabled">{t('settings.thinkingEnabled')}</option>
                  <option value="auto">{t('settings.thinkingAuto')}</option>
                </select>
                <p className="text-[10px] text-text-muted mt-1">{t('settings.thinkingDescription')}</p>
              </div>
            )}
            <div>
              <label className={labelClass}>{t('settings.maxTokens')}</label>
              <input
                type="number"
                value={config.maxTokens}
                onChange={(e) =>
                  updateConfig({ maxTokens: parseInt(e.target.value) || 2048 })
                }
                className={inputClass}
              />
            </div>
          </>
        )}

        {/* Mock Provider Config */}
        {config.providerId === 'mock' && (
          <div>
            <label className={labelClass}>{t('settings.tokenDelay')}</label>
            <input
              type="number"
              value={config.mockDelay}
              onChange={(e) =>
                updateConfig({ mockDelay: parseInt(e.target.value) || 30 })
              }
              className={inputClass}
              min="5"
              max="500"
            />
            <p className="text-xs text-text-muted mt-1">
              {t('settings.tokenDelayDescription')}
            </p>
          </div>
        )}

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

      <div className="px-4 py-3 border-t border-border">
        <p className="text-[10px] text-text-muted text-center">
          {t('settings.savedToLocalStorage')}
        </p>
      </div>
    </div>
  );
  return standalone ? panel : createPortal(<div className="fixed inset-0 z-[11000] flex items-center justify-center bg-black/45 p-6">{panel}</div>, document.body);
}
