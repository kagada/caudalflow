import type { LLMConfig } from '../types/chat';
import { DEFAULT_BUILTIN_PROMPTS, type BuiltinPromptKey } from './builtinPrompts';
import { detectPlatform, type RuntimePlatform } from './platform';

export type Theme = 'light' | 'dark' | 'system';
export interface PromptPreset { id: string; name: string; content: string }
export interface SettingsDefaults {
  builtinPrompts: Record<BuiltinPromptKey, string>;
  promptPresets: PromptPreset[];
  llmConfig: LLMConfig;
  showMinimap: boolean;
  showSystemPrompts: boolean;
  openCompactCardsMaximized: boolean;
  welcomeDismissed: boolean;
  language: string;
  theme: Theme;
  selectMode: boolean;
}

// 平台只列出与共用默认值不同的选项，后续安卓差异继续集中加在这里。
const PLATFORM_DEFAULTS: Partial<Record<RuntimePlatform, Partial<SettingsDefaults>>> = {
  android: { openCompactCardsMaximized: true },
};

// 默认值只负责首次启动和补齐旧配置缺少的选项；已保存的用户选择由设置存储覆盖。
export function getDefaultSettings(platform: RuntimePlatform = detectPlatform()): SettingsDefaults {
  return {
    builtinPrompts: { ...DEFAULT_BUILTIN_PROMPTS },
    promptPresets: [],
    llmConfig: { providerId: '', providerName: '', endpoint: '', apiKey: '', model: '', temperature: 0.7, maxTokens: 2048 },
    showMinimap: true,
    showSystemPrompts: false,
    openCompactCardsMaximized: false,
    welcomeDismissed: false,
    language: 'en',
    theme: 'dark',
    selectMode: false,
    ...PLATFORM_DEFAULTS[platform],
  };
}
