import { useModelStore } from '../stores/modelStore';
import { useSettingsStore } from '../stores/settingsStore';
import { useFlowStore } from '../stores/flowStore';
import type { LLMConfig } from '../types/chat';
import { resolveThinkingEffort } from './modelThinking';
import { supportsWebSearch } from './providers/webSearch';

// 配置缺失单独标识，界面可引导配置，网络等其他错误仍保留原有提示。
export class ModelConfigurationError extends Error {
  constructor() { super('未设置模型'); this.name = 'ModelConfigurationError'; }
}

// 只有未指定模型的会话才跟随默认值；迁移后配置缺失必须提示，不能悄悄换模型。
export function resolveModelConfig(nodeId?: string): LLMConfig {
  const base = useSettingsStore.getState().llmConfig;
  const catalog = useModelStore.getState();
  // 旧版默认值也必须遵守供应商开关，不能绕过模型管理重新启用已关闭的供应商。
  const selection = (nodeId ? useFlowStore.getState().nodes.find((node) => node.id === nodeId)?.data.modelSelection : undefined) ?? catalog.defaultModel
    ?? (catalog.providers.some((provider) => provider.id === base.providerId) ? { providerId: base.providerId, modelId: base.model } : null);
  if (!selection) {
    if (!catalog.providers.some((provider) => provider.enabled)) throw new ModelConfigurationError();
    if (!supportsWebSearch(base)) return base.webSearch ? { ...base, webSearch: false } : base;
    const override = nodeId ? useFlowStore.getState().nodes.find((node) => node.id === nodeId)?.data.webSearch : undefined;
    return { ...base, webSearch: override ?? base.webSearch ?? false };
  }
  const provider = catalog.providers.find((item) => item.id === selection.providerId);
  const model = provider?.models.find((item) => item.id === selection.modelId);
  if (!provider?.enabled || !provider.endpoint.trim() || !provider.apiKey.trim() || !model?.enabled) {
    throw new ModelConfigurationError();
  }
  const override = nodeId ? useFlowStore.getState().nodes.find((node) => node.id === nodeId)?.data.thinkingEffort : undefined;
  const effort = resolveThinkingEffort(model, base, override);
  // 会话显式关闭也必须保留；未选择时才继承模型默认联网设置。
  const searchOverride = nodeId ? useFlowStore.getState().nodes.find((node) => node.id === nodeId)?.data.webSearch : undefined;
  const webSearch = (searchOverride ?? model.defaultWebSearch ?? false)
    && supportsWebSearch({ providerId: provider.id, endpoint: provider.endpoint, model: model.id, webSearchSupported: model.webSearchSupported });
  return { ...base, providerId: provider.id, providerName: provider.name, endpoint: provider.endpoint.trim(), apiKey: provider.apiKey.trim(), model: model.id,
    webSearch, webSearchSupported: model.webSearchSupported, thinkingMode: effort === 'none' ? 'disabled' : effort === 'auto' ? 'auto' : 'enabled', thinkingEffort: ['none', 'auto'].includes(effort) ? undefined : effort };
}
