import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import i18n from '../i18n';
import type { LLMConfig } from '../types/chat';
import { DEFAULT_BUILTIN_PROMPTS, type BuiltinPromptKey } from '../services/builtinPrompts';
import { getDefaultSettings, type SettingsDefaults, type Theme, type PromptPreset } from '../services/defaultSettings';

export type { PromptPreset } from '../services/defaultSettings';

interface SettingsState extends SettingsDefaults {
  settingsSection: string;
  setBuiltinPrompt: (key: BuiltinPromptKey, content: string) => void;
  showPromptSettings: boolean;
  setShowPromptSettings: (show: boolean) => void;
  savePromptPreset: (preset: PromptPreset) => void;
  deletePromptPreset: (id: string) => void;
  showSettings: boolean;
  setOpenCompactCardsMaximized: (enabled: boolean) => void;
  updateLLMConfig: (config: Partial<LLMConfig>) => void;
  toggleMinimap: () => void;
  toggleSystemPrompts: () => void;
  toggleSettings: () => void;
  setShowSettings: (show: boolean) => void;
  dismissWelcome: () => void;
  setLanguage: (lang: string) => void;
  setTheme: (theme: Theme) => void;
  setSelectMode: (selectMode: boolean) => void;
  toggleSelectMode: () => void;
}

function getSystemTheme(): 'light' | 'dark' {
  if (typeof window !== 'undefined' && window.matchMedia) {
    return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
  }
  return 'dark';
}

function applyTheme(theme: Theme) {
  const resolvedTheme = theme === 'system' ? getSystemTheme() : theme;
  document.documentElement.setAttribute('data-theme', resolvedTheme);
}

export const useSettingsStore = create<SettingsState>()(
  persist(
    (set, get) => ({
      ...getDefaultSettings(),
      settingsSection: 'general',
      setBuiltinPrompt: (key, content) => set({ builtinPrompts: { ...get().builtinPrompts, [key]: content.trim() || DEFAULT_BUILTIN_PROMPTS[key] } }),
      showPromptSettings: false,
      setShowPromptSettings: (show) => set({ showPromptSettings: show }),
      // 预设与 API 设置一起保存，菜单始终读取最新列表。
      savePromptPreset: (preset) => set({ promptPresets: get().promptPresets.some((item) => item.id === preset.id) ? get().promptPresets.map((item) => item.id === preset.id ? preset : item) : [...get().promptPresets, preset] }),
      deletePromptPreset: (id) => set({ promptPresets: get().promptPresets.filter((item) => item.id !== id) }),
      showSettings: false,
      setOpenCompactCardsMaximized: (enabled) => set({ openCompactCardsMaximized: enabled }),

      updateLLMConfig: (config) => {
        const current = get().llmConfig;
        const merged = { ...current, ...config };

        // 切换服务商时清掉旧密钥，避免把它误发到新的接口；显式传入的配置优先。
        if (config.providerId && config.providerId !== current.providerId) {
          const endpoints: Record<string, string> = {
            openai: 'https://api.openai.com/v1/chat/completions',
            anthropic: 'https://api.anthropic.com/v1/messages',
            custom: '',
            deepseek: 'https://api.deepseek.com',
            bailian: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
          };
          merged.model = config.model ?? '';
          merged.endpoint = config.endpoint ?? endpoints[config.providerId] ?? '';
          merged.apiKey = config.apiKey ?? '';
          merged.providerName = config.providerName ?? config.providerId;
        }

        set({ llmConfig: merged });
      },

      toggleMinimap: () => set({ showMinimap: !get().showMinimap }),

      toggleSystemPrompts: () => set({ showSystemPrompts: !get().showSystemPrompts }),

      toggleSettings: () => get().setShowSettings(!get().showSettings),

      // 桌面与网页共用应用内设置，不再创建独立系统窗口。
      setShowSettings: (show) => set({ showSettings: show }),

      dismissWelcome: () => set({ welcomeDismissed: true }),

      setLanguage: (lang) => {
        set({ language: lang });
        i18n.changeLanguage(lang);
      },

      setTheme: (theme) => {
        set({ theme });
        applyTheme(theme);
      },

      setSelectMode: (selectMode) => set({ selectMode }),

      toggleSelectMode: () => set({ selectMode: !get().selectMode }),
    }),
    {
      name: 'caudalflow-settings',
      partialize: (state) => ({
        builtinPrompts: state.builtinPrompts,
        promptPresets: state.promptPresets,
        llmConfig: state.llmConfig,
        showMinimap: state.showMinimap,
        showSystemPrompts: state.showSystemPrompts,
        openCompactCardsMaximized: state.openCompactCardsMaximized,
        welcomeDismissed: state.welcomeDismissed,
        language: state.language,
        theme: state.theme,
        selectMode: state.selectMode,
      }),
      // 清理已经落盘的模拟服务和延迟参数，升级后也不再出现假默认模型。
      merge: (persisted, current) => {
        const saved = persisted as Partial<SettingsState> | undefined;
        const raw = saved?.llmConfig as (LLMConfig & { mockDelay?: number }) | undefined;
        const config = { ...current.llmConfig, ...raw };
        delete (config as LLMConfig & { mockDelay?: number }).mockDelay;
        if (config.providerId === 'mock') {
          config.providerId = ''; config.providerName = ''; config.model = ''; config.endpoint = ''; config.apiKey = '';
        }
        return { ...current, ...saved, llmConfig: config,
          openCompactCardsMaximized: typeof saved?.openCompactCardsMaximized === 'boolean' ? saved.openCompactCardsMaximized : current.openCompactCardsMaximized,
        };
      },
      onRehydrateStorage: () => (state) => {
        // Apply theme on app load
        if (state?.theme) {
          applyTheme(state.theme);
        }
      },
    }
  )
);

// Listen for system theme changes
if (typeof window !== 'undefined') {
  // 保留浏览器多个标签页之间的设置同步。
  window.addEventListener('storage', (event) => {
    if (event.key !== 'caudalflow-settings') return;
    void Promise.resolve(useSettingsStore.persist.rehydrate()).then(() => { void i18n.changeLanguage(useSettingsStore.getState().language); });
  });
  window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => {
    const currentTheme = useSettingsStore.getState().theme;
    if (currentTheme === 'system') {
      applyTheme('system');
    }
  });
}
