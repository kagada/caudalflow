import type { LLMConfig, ManagedModel } from '../types/chat';

// 翻译与显示顺序集中维护；这里只统一呈现，不改变不同厂商的实际参数或推理含义。
const effortDefinitions = [
  { label: '默认', rank: -1, aliases: ['auto', 'automatic', 'default'] },
  { label: '关闭', rank: 0, aliases: ['none', 'off', 'disabled'] },
  { label: '最低', rank: 10, aliases: ['minimal', 'minimum', 'min'] },
  { label: '很低', rank: 20, aliases: ['very_low', 'verylow'] },
  { label: '低', rank: 30, aliases: ['low', 'light'] },
  { label: '中', rank: 40, aliases: ['medium', 'moderate', 'mid', 'normal', 'standard', 'balanced'] },
  { label: '高', rank: 50, aliases: ['high', 'higher'] },
  { label: '很高', rank: 60, aliases: ['xhigh', 'extra_high', 'very_high', 'veryhigh'] },
  { label: '极高', rank: 70, aliases: ['ultra', 'extreme'] },
  { label: '最高', rank: 80, aliases: ['max', 'maximum', 'maximal', 'highest'] },
];
const effortDefinition = (effort: string) => effortDefinitions.find((definition) => definition.aliases.includes(effort.trim().toLowerCase().replace(/[\s-]+/g, '_')));

export const thinkingEffortLabel = (effort: string) => effortDefinition(effort)?.label ?? effort;

// 已知名称按显示强度排列；未知名称置后并保持接口原顺序，不能凭字母猜测强弱。
export function sortThinkingEfforts(efforts: string[]): string[] {
  return [...new Set(efforts)].map((value, index) => ({ value, index, rank: effortDefinition(value)?.rank ?? Infinity }))
    .sort((a, b) => a.rank === b.rank ? a.index - b.index : a.rank < b.rank ? -1 : 1)
    .map(({ value }) => value);
}

// 未报告能力的端点不猜测档位；仍允许关闭思考或交给接口默认行为。
export function thinkingEffortOptions(model?: ManagedModel): string[] {
  return [...new Set(['auto', 'none', ...sortThinkingEfforts(model?.effort?.supportedLevels ?? [])])];
}

export function defaultThinkingEffort(model: ManagedModel | undefined, legacy: LLMConfig): string {
  const requested = model?.defaultThinkingEffort ?? model?.effort?.defaultLevel ?? (legacy.thinkingMode === 'enabled' || legacy.thinkingMode === 'auto' ? 'auto' : 'none');
  return thinkingEffortOptions(model).includes(requested) ? requested : model?.effort?.defaultLevel ?? 'auto';
}

// 换模型后不向新模型发送不支持的旧档位；原会话选择仍保存，切回时可以恢复。
export function resolveThinkingEffort(model: ManagedModel, legacy: LLMConfig, override?: string): string {
  const requested = override ?? defaultThinkingEffort(model, legacy);
  return thinkingEffortOptions(model).includes(requested) ? requested : defaultThinkingEffort(model, legacy);
}
