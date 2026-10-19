import { useModelStore } from '../stores/modelStore';
import { useSettingsStore } from '../stores/settingsStore';
import { useFlowStore } from '../stores/flowStore';
import type { LLMConfig } from '../types/chat';

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
    return base;
  }
  const provider = catalog.providers.find((item) => item.id === selection.providerId);
  const model = provider?.models.find((item) => item.id === selection.modelId);
  if (!provider?.enabled || !provider.endpoint.trim() || !provider.apiKey.trim() || !model?.enabled) {
    throw new ModelConfigurationError();
  }
  return { ...base, providerId: provider.id, providerName: provider.name, endpoint: provider.endpoint.trim(), apiKey: provider.apiKey.trim(), model: model.id };
}
