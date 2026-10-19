import { useModelStore } from '../stores/modelStore';
import { useSettingsStore } from '../stores/settingsStore';
import { useFlowStore } from '../stores/flowStore';
import type { LLMConfig } from '../types/chat';

// 只有未指定模型的会话才跟随默认值；迁移后配置缺失必须提示，不能悄悄换模型。
export function resolveModelConfig(nodeId?: string): LLMConfig {
  const base = useSettingsStore.getState().llmConfig;
  const catalog = useModelStore.getState();
  const selection = (nodeId ? useFlowStore.getState().nodes.find((node) => node.id === nodeId)?.data.modelSelection : undefined) ?? catalog.defaultModel;
  if (!selection) return base;
  const provider = catalog.providers.find((item) => item.id === selection.providerId);
  const model = provider?.models.find((item) => item.id === selection.modelId);
  if (!provider?.enabled || !provider.endpoint.trim() || !provider.apiKey.trim() || !model?.enabled) {
    throw new Error(`请在模型管理中配置并启用 ${selection.providerName} / ${selection.modelId}（API 地址、密钥及模型）。`);
  }
  return { ...base, providerId: provider.id, providerName: provider.name, endpoint: provider.endpoint.trim(), apiKey: provider.apiKey.trim(), model: model.id };
}
