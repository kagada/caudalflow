import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import i18n from '../i18n';
import type { LLMConfig } from '../types/chat';
import { DEFAULT_BUILTIN_PROMPTS, type BuiltinPromptKey } from '../services/builtinPrompts';
import { isSettingsWindow, openSettingsWindow } from '../services/settingsWindow';

type Theme = 'light' | 'dark' | 'system';
export interface PromptPreset { id: string; name: string; content: string }

interface SettingsState {
  settingsSection: string;
  builtinPrompts: Record<BuiltinPromptKey, string>;
  setBuiltinPrompt: (key: BuiltinPromptKey, content: string) => void;
  promptPresets: PromptPreset[];
  showPromptSettings: boolean;
  setShowPromptSettings: (show: boolean) => void;
  savePromptPreset: (preset: PromptPreset) => void;
  deletePromptPreset: (id: string) => void;
  llmConfig: LLMConfig;
  showMinimap: boolean;
  showSystemPrompts: boolean;
  showSettings: boolean;
  welcomeDismissed: boolean;
  language: string;
  theme: Theme;
  selectMode: boolean;
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
      settingsSection: 'general',
      builtinPrompts: { ...DEFAULT_BUILTIN_PROMPTS },
      setBuiltinPrompt: (key, content) => set({ builtinPrompts: { ...get().builtinPrompts, [key]: content.trim() || DEFAULT_BUILTIN_PROMPTS[key] } }),
      promptPresets: [],
      showPromptSettings: false,
      setShowPromptSettings: (show) => {
        if (show && location.protocol === 'app:' && !isSettingsWindow()) { void openSettingsWindow('presets').catch(() => set({ showPromptSettings: true })); return; }
        set({ showPromptSettings: show });
      },
      // 预设与 API 设置一起保存，菜单始终读取最新列表。
      savePromptPreset: (preset) => set({ promptPresets: get().promptPresets.some((item) => item.id === preset.id) ? get().promptPresets.map((item) => item.id === preset.id ? preset : item) : [...get().promptPresets, preset] }),
      deletePromptPreset: (id) => set({ promptPresets: get().promptPresets.filter((item) => item.id !== id) }),
      llmConfig: {
        providerId: 'mock',
        providerName: 'Mock',
        endpoint: 'https://api.openai.com/v1/chat/completions',
        apiKey: '',
        model: 'gpt-4o-mini',
        temperature: 0.7,
        maxTokens: 2048,
        mockDelay: 30,
      },
      showMinimap: true,
      showSystemPrompts: false,
      showSettings: false,
      welcomeDismissed: false,
      language: 'en',
      theme: 'dark',
      selectMode: false,

      updateLLMConfig: (config) => {
        const current = get().llmConfig;
        const merged = { ...current, ...config };

        // 切换服务商时清掉旧密钥，避免把它误发到新的接口；显式传入的配置优先。
        if (config.providerId && config.providerId !== current.providerId) {
          const defaults: Record<string, { model: string; endpoint?: string }> = {
            openai: { model: 'gpt-4o-mini', endpoint: 'https://api.openai.com/v1/chat/completions' },
            anthropic: { model: 'claude-sonnet-4-5-20250929', endpoint: 'https://api.anthropic.com/v1/messages' },
            custom: { model: '', endpoint: '' },
            deepseek: { model: 'deepseek-flash', endpoint: 'https://api.deepseek.com' },
            bailian: { model: '', endpoint: 'https://dashscope.aliyuncs.com/compatible-mode/v1' },
          };
          const d = defaults[config.providerId];
          if (d) {
            merged.model = config.model ?? d.model;
            merged.endpoint = config.endpoint ?? d.endpoint ?? '';
          }
          merged.apiKey = config.apiKey ?? '';
          merged.providerName = config.providerName ?? config.providerId;
        }

        set({ llmConfig: merged });
      },

      toggleMinimap: () => set({ showMinimap: !get().showMinimap }),

      toggleSystemPrompts: () => set({ showSystemPrompts: !get().showSystemPrompts }),

      toggleSettings: () => get().setShowSettings(!get().showSettings),

      setShowSettings: (show) => {
        if (show && location.protocol === 'app:' && !isSettingsWindow()) { void openSettingsWindow().catch(() => set({ showSettings: true })); return; }
        set({ showSettings: show });
      },

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
        welcomeDismissed: state.welcomeDismissed,
        language: state.language,
        theme: state.theme,
        selectMode: state.selectMode,
      }),
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
  // 独立设置窗口和主窗口共享持久化设置，改完后下一次模型请求立即采用新值。
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
