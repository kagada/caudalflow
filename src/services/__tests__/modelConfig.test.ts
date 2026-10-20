/** @vitest-environment jsdom */
import { beforeEach, expect, it, vi } from 'vitest';
import { useModelStore } from '../../stores/modelStore';
import { useFlowStore } from '../../stores/flowStore';
import { useSettingsStore } from '../../stores/settingsStore';
import { resolveModelConfig } from '../modelConfig';
import { streamChat, generateTitle } from '../llm';

vi.hoisted(() => { window.matchMedia = vi.fn().mockReturnValue({ matches: false, addEventListener: vi.fn() }); });
const provider = vi.hoisted(() => ({ streamChat: vi.fn() }));
vi.mock('../providers/registry', () => ({ getProvider: () => provider }));

beforeEach(() => {
  vi.clearAllMocks();
  useModelStore.setState({ providers: [{ id: 'deepseek', name: 'DeepSeek', endpoint: 'https://example.test', apiKey: 'local-secret', enabled: true, models: [{ id: 'one', name: 'One', enabled: true }, { id: 'two', name: 'Two', enabled: true }] }], defaultModel: { providerId: 'deepseek', providerName: 'DeepSeek', modelId: 'one' } });
  useFlowStore.setState({ nodes: [{ id: 'a', type: 'chat', position: { x: 0, y: 0 }, data: { topic: 'A', modelSelection: { providerId: 'deepseek', providerName: 'DeepSeek', modelId: 'two' } } }, { id: 'b', type: 'chat', position: { x: 1, y: 1 }, data: { topic: 'B' } }] });
});

it('routes answers and titles per conversation while unselected conversations follow the current default', () => {
  streamChat([], { onToken: vi.fn(), onDone: vi.fn(), onError: vi.fn() }, new AbortController().signal, { nodeId: 'a' });
  generateTitle('question', '', vi.fn(), { nodeId: 'a' });
  expect(provider.streamChat.mock.calls.map((call) => call[1].model)).toEqual(['two', 'two']);
  expect(resolveModelConfig('b').model).toBe('one');
  useModelStore.getState().setDefaultModel({ providerId: 'deepseek', providerName: 'DeepSeek', modelId: 'two' });
  expect(resolveModelConfig('b').model).toBe('two');
  expect(JSON.stringify(useFlowStore.getState().nodes)).not.toContain('local-secret');
});

it('inherits each model’s default, applies a portable conversation override and suppresses thinking for titles', () => {
  useModelStore.getState().updateProvider('deepseek', { models: [
    { id: 'one', name: 'One', enabled: true, effort: { supportedLevels: ['low', 'high', 'max'], defaultLevel: 'high' }, defaultThinkingEffort: 'low' },
    { id: 'two', name: 'Two', enabled: true, effort: { supportedLevels: ['high', 'max'], defaultLevel: 'high' }, defaultThinkingEffort: 'max' },
  ] });
  expect(resolveModelConfig('a')).toMatchObject({ thinkingMode: 'enabled', thinkingEffort: 'max' });
  expect(resolveModelConfig('b')).toMatchObject({ thinkingMode: 'enabled', thinkingEffort: 'low' });
  useFlowStore.getState().updateNodeData('a', { thinkingEffort: 'high' });
  expect(resolveModelConfig('a')).toMatchObject({ thinkingMode: 'enabled', thinkingEffort: 'high' });
  generateTitle('question', '', vi.fn(), { nodeId: 'a' });
  expect(provider.streamChat.mock.calls[0][1].thinkingMode).toBe('disabled');
  useFlowStore.getState().updateNodeData('a', { thinkingEffort: 'none' });
  expect(resolveModelConfig('a')).toMatchObject({ thinkingMode: 'disabled', thinkingEffort: undefined });
  useFlowStore.getState().updateNodeData('a', { thinkingEffort: undefined });
  expect(resolveModelConfig('a').thinkingEffort).toBe('max');
  // 不支持的强度使用新模型的默认设置；原选择保留，以便切回原模型后恢复。
  useFlowStore.getState().updateNodeData('a', { thinkingEffort: 'low' });
  expect(resolveModelConfig('a').thinkingEffort).toBe('max');
  expect(useFlowStore.getState().nodes[0].data.thinkingEffort).toBe('low');
});

it('restores a migrated selection by provider and model ID using this computer’s credentials', () => {
  useModelStore.getState().updateProvider('deepseek', { apiKey: '' });
  expect(() => resolveModelConfig('a')).toThrow('未设置模型');
  const error = vi.fn();
  streamChat([], { onToken: vi.fn(), onDone: vi.fn(), onError: error }, new AbortController().signal, { nodeId: 'a' });
  expect(error).toHaveBeenCalled(); expect(provider.streamChat).not.toHaveBeenCalled();
  useModelStore.getState().updateProvider('deepseek', { apiKey: 'new-machine-key' });
  expect(resolveModelConfig('a')).toMatchObject({ model: 'two', apiKey: 'new-machine-key' });
  useModelStore.getState().updateProvider('deepseek', { models: [{ id: 'two', name: 'Two', enabled: false }] });
  expect(() => resolveModelConfig('a')).toThrow('未设置模型');
});

it('keeps the legacy default available until a managed default is selected', () => {
  useModelStore.getState().setDefaultModel(null);
  expect(resolveModelConfig('b')).toEqual(useSettingsStore.getState().llmConfig);
  expect(resolveModelConfig('a').model).toBe('two');
});

it('honors disabled providers for both the managed default and the legacy default', () => {
  useModelStore.getState().updateProvider('deepseek', { enabled: false });
  expect(() => resolveModelConfig('a')).toThrow('未设置模型');
  expect(() => resolveModelConfig('b')).toThrow('未设置模型');
  const original = useSettingsStore.getState().llmConfig;
  try {
    useSettingsStore.setState({ llmConfig: { ...original, providerId: 'deepseek', model: 'one' } });
    useModelStore.getState().setDefaultModel(null);
    expect(() => resolveModelConfig('b')).toThrow('未设置模型');
    useModelStore.getState().updateProvider('deepseek', { enabled: true });
    expect(resolveModelConfig('b').model).toBe('one');
  } finally { useSettingsStore.setState({ llmConfig: original }); }
});

it('inherits search defaults, honors false overrides, blocks unsupported models and keeps titles offline', () => {
  useModelStore.setState({ providers: [{ id: 'deepseek', name: 'DeepSeek', endpoint: 'https://api.deepseek.com', apiKey: 'secret', enabled: true, models: [
    { id: 'deepseek-flash', name: 'Flash', enabled: true, defaultWebSearch: true },
    { id: 'deepseek-pro', name: 'Pro', enabled: true, defaultWebSearch: false },
  ] }], defaultModel: { providerId: 'deepseek', providerName: 'DeepSeek', modelId: 'deepseek-flash' } });
  expect(resolveModelConfig('b').webSearch).toBe(true);
  useFlowStore.getState().updateNodeData('b', { webSearch: false });
  expect(resolveModelConfig('b').webSearch).toBe(false);
  useFlowStore.getState().updateNodeData('b', { webSearch: undefined, modelSelection: { providerId: 'deepseek', providerName: 'DeepSeek', modelId: 'deepseek-pro' } });
  expect(resolveModelConfig('b').webSearch).toBe(false);
  useFlowStore.getState().updateNodeData('b', { webSearch: true });
  expect(resolveModelConfig('b').webSearch).toBe(true);
  generateTitle('question', '', vi.fn(), { nodeId: 'b' });
  expect(provider.streamChat.mock.calls.at(-1)?.[1].webSearch).toBe(false);
  useModelStore.getState().updateProvider('deepseek', { endpoint: 'https://example.com' });
  expect(resolveModelConfig('b').webSearch).toBe(false);
});
