import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { ModelSelection, ProviderConfig } from '../types/chat';
import { useSettingsStore } from './settingsStore';

const legacy = useSettingsStore.getState().llmConfig;
const migrated = legacy.providerId === 'deepseek';
const initialProviders: ProviderConfig[] = [
  { id: 'deepseek', name: 'DeepSeek', endpoint: migrated ? legacy.endpoint : 'https://api.deepseek.com', apiKey: migrated ? legacy.apiKey : '', enabled: true,
    models: migrated && legacy.model ? [{ id: legacy.model, name: legacy.model, enabled: true }] : [] },
  { id: 'bailian', name: '阿里云百炼', endpoint: 'https://dashscope.aliyuncs.com/compatible-mode/v1', apiKey: '', enabled: false, models: [] },
];

// 本机模型目录独立于工作区；首次升级保留已有 DeepSeek 配置和默认模型。
export const useModelStore = create<{
  providers: ProviderConfig[];
  defaultModel: ModelSelection | null;
  updateProvider: (id: string, changes: Partial<Omit<ProviderConfig, 'id'>>) => void;
  setDefaultModel: (model: ModelSelection | null) => void;
}>()(persist((set) => ({
  providers: initialProviders,
  defaultModel: migrated ? { providerId: 'deepseek', providerName: 'DeepSeek', modelId: legacy.model } : null,
  updateProvider: (id, changes) => set((state) => ({ providers: state.providers.map((provider) => provider.id === id ? { ...provider, ...changes } : provider) })),
  setDefaultModel: (defaultModel) => set({ defaultModel }),
}), {
  name: 'caudalflow-local-models',
  // 旧目录补齐新增供应商，不能覆盖已有密钥、地址、模型开关和默认模型。
  merge: (persisted, current) => {
    const saved = persisted as Partial<typeof current> | undefined;
    const providers = saved?.providers ?? current.providers;
    return { ...current, ...saved, providers: [...providers, ...initialProviders.filter((preset) => !providers.some((provider) => provider.id === preset.id))] };
  },
}));

// 设置窗口修改目录后，主窗口下一次请求立即使用新的密钥和模型开关。
if (typeof window !== 'undefined') window.addEventListener('storage', (event) => {
  if (event.key === 'caudalflow-local-models') void useModelStore.persist.rehydrate();
});
