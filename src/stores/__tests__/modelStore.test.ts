/** @vitest-environment jsdom */
import { expect, it, vi } from 'vitest';
import { useModelStore } from '../modelStore';

vi.hoisted(() => { window.matchMedia = vi.fn().mockReturnValue({ matches: false, addEventListener: vi.fn() }); });

it('removes saved simulated providers while keeping real models and credentials', async () => {
  const real = { id: 'deepseek', name: 'DeepSeek', enabled: true, endpoint: 'https://api.deepseek.com', apiKey: 'saved-key', models: [{ id: 'real-model', name: 'Real', enabled: true }] };
  localStorage.setItem('caudalflow-local-models', JSON.stringify({ version: 0, state: { providers: [real, { id: 'mock', name: 'Mock', enabled: true, models: [] }], defaultModel: { providerId: 'mock', modelId: 'gpt-4o-mini' } } }));
  await useModelStore.persist.rehydrate();
  expect(useModelStore.getState().defaultModel).toBeNull();
  expect(useModelStore.getState().providers.find((provider) => provider.id === 'deepseek')).toEqual(real);
  expect(useModelStore.getState().providers.some((provider) => provider.id === 'mock')).toBe(false);
});

it('preserves an explicitly unset default rather than restoring an old selection', async () => {
  const provider = useModelStore.getState().providers[0];
  useModelStore.setState({ defaultModel: { providerId: provider.id, providerName: provider.name, modelId: 'old' } });
  localStorage.setItem('caudalflow-local-models', JSON.stringify({ version: 0, state: { providers: [provider], defaultModel: null } }));
  await useModelStore.persist.rehydrate();
  expect(useModelStore.getState().defaultModel).toBeNull();
});

it('adds Bailian to an old local catalog without replacing existing credentials, models or default selection', async () => {
  const deepseek = { id: 'deepseek', name: 'DeepSeek', endpoint: 'https://my-endpoint.test', apiKey: 'existing-key', enabled: false, models: [{ id: 'old-model', name: 'Old model', enabled: true, defaultThinkingEffort: 'max' }] };
  const defaultModel = { providerId: 'deepseek', providerName: 'DeepSeek', modelId: 'old-model' };
  localStorage.setItem('caudalflow-local-models', JSON.stringify({ state: { providers: [deepseek], defaultModel }, version: 0 }));
  await useModelStore.persist.rehydrate();
  expect(useModelStore.getState().providers[0]).toEqual(deepseek);
  expect(useModelStore.getState().defaultModel).toEqual(defaultModel);
  expect(useModelStore.getState().providers[1]).toEqual({ id: 'bailian', name: '阿里云百炼', endpoint: 'https://dashscope.aliyuncs.com/compatible-mode/v1', apiKey: '', enabled: false, models: [] });
  useModelStore.getState().updateProvider('bailian', { apiKey: 'bailian-key', endpoint: 'https://custom.test/v1' });
  await useModelStore.persist.rehydrate();
  expect(useModelStore.getState().providers).toHaveLength(2);
  expect(useModelStore.getState().providers[1]).toMatchObject({ apiKey: 'bailian-key', endpoint: 'https://custom.test/v1' });
});
