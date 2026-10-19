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
