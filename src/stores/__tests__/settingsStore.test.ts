// @vitest-environment jsdom
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { useSettingsStore } from '../settingsStore';

// 持久化测试使用浏览器存储；jsdom 未提供的系统主题接口只需最小替身。
vi.hoisted(() => {
  window.matchMedia = vi.fn().mockReturnValue({ matches: false, addEventListener: vi.fn() });
});

const INITIAL_CONFIG = {
  providerId: '',
    providerName: '',
  endpoint: 'https://api.openai.com/v1',
  apiKey: '',
  model: '',
  temperature: 0.7,
  maxTokens: 2048,
};

beforeEach(() => {
  useSettingsStore.setState({
    llmConfig: { ...INITIAL_CONFIG },
    showMinimap: true,
    showSystemPrompts: false,
    showSettings: false,
  });
});

describe('settingsStore', () => {
  it('clears persisted simulated model settings without losing generation parameters', async () => {
    localStorage.setItem('caudalflow-settings', JSON.stringify({ version: 0, state: { llmConfig: { ...INITIAL_CONFIG, providerId: 'mock', providerName: 'Mock', endpoint: 'https://api.openai.com/v1', model: 'gpt-4o-mini', mockDelay: 30, temperature: 0.9, maxTokens: 4096 } } }));
    await useSettingsStore.persist.rehydrate();
    expect(useSettingsStore.getState().llmConfig).toMatchObject({ providerId: '', providerName: '', endpoint: '', model: '', apiKey: '', temperature: 0.9, maxTokens: 4096 });
    expect(useSettingsStore.getState().llmConfig).not.toHaveProperty('mockDelay');
  });

  it('preserves real persisted credentials and explicit model choices', async () => {
    const real = { ...INITIAL_CONFIG, providerId: 'deepseek', endpoint: 'https://api.deepseek.com', apiKey: 'saved-key', model: 'explicit-model' };
    localStorage.setItem('caudalflow-settings', JSON.stringify({ version: 0, state: { llmConfig: real } }));
    await useSettingsStore.persist.rehydrate();
    expect(useSettingsStore.getState().llmConfig).toEqual(real);
  });

  it('persists, edits and deletes prompt presets without duplicating them', () => {
    useSettingsStore.setState({ promptPresets: [] });
    const store = useSettingsStore.getState();
    store.savePromptPreset({ id: 'prompt', name: '解释', content: '请举例说明' });
    store.savePromptPreset({ id: 'prompt', name: '总结', content: '请总结' });
    expect(useSettingsStore.getState().promptPresets).toEqual([{ id: 'prompt', name: '总结', content: '请总结' }]);
    expect(JSON.parse(localStorage.getItem('caudalflow-settings')!).state.promptPresets).toEqual(useSettingsStore.getState().promptPresets);
    store.deletePromptPreset('prompt');
    expect(useSettingsStore.getState().promptPresets).toEqual([]);
  });
  describe('updateLLMConfig', () => {
    it('selects a provider endpoint without inventing a default model', () => {
      useSettingsStore.getState().updateLLMConfig({ providerId: 'deepseek' });
      expect(useSettingsStore.getState().llmConfig).toMatchObject({ providerId: 'deepseek', endpoint: 'https://api.deepseek.com', model: '', apiKey: '' });
    });
    it('clears the old endpoint and key when choosing a custom API', () => {
      useSettingsStore.getState().updateLLMConfig({ providerId: 'openai', apiKey: 'old-key' });
      useSettingsStore.getState().updateLLMConfig({ providerId: 'custom' });
      expect(useSettingsStore.getState().llmConfig).toMatchObject({ endpoint: '', apiKey: '', model: '' });
    });

    it('keeps explicit API settings when selecting a provider and persists them', () => {
      useSettingsStore.getState().updateLLMConfig({ providerId: 'custom', endpoint: 'http://localhost:1234/v1', model: 'local-model', apiKey: 'test-key' });
      const config = useSettingsStore.getState().llmConfig;
      expect(config).toMatchObject({ endpoint: 'http://localhost:1234/v1', model: 'local-model', apiKey: 'test-key' });
      expect(JSON.parse(localStorage.getItem('caudalflow-settings')!).state.llmConfig).toEqual(config);
    });

    it('merges partial config updates', () => {
      useSettingsStore.getState().updateLLMConfig({ temperature: 0.9 });
      const config = useSettingsStore.getState().llmConfig;
      expect(config.temperature).toBe(0.9);
      expect(config.providerId).toBe(''); // unchanged
      expect(config.model).toBe(''); // unchanged
    });

    it('sets OpenAI defaults when switching to openai provider', () => {
      useSettingsStore.getState().updateLLMConfig({ providerId: 'openai' });
      const config = useSettingsStore.getState().llmConfig;
      expect(config.providerId).toBe('openai');
      expect(config.model).toBe('');
    });

    it('sets Anthropic defaults when switching to anthropic provider', () => {
      useSettingsStore.getState().updateLLMConfig({ providerId: 'anthropic' });
      const config = useSettingsStore.getState().llmConfig;
      expect(config.providerId).toBe('anthropic');
      expect(config.model).toBe('');
    });

    it('does not override model when staying on the same provider', () => {
      useSettingsStore.getState().updateLLMConfig({ providerId: 'openai' });
      useSettingsStore.getState().updateLLMConfig({ model: 'gpt-4o' });

      // Updating non-provider fields should not reset model
      useSettingsStore.getState().updateLLMConfig({ temperature: 0.5 });
      const config = useSettingsStore.getState().llmConfig;
      expect(config.model).toBe('gpt-4o');
    });

    it('does not apply provider defaults for unknown providers', () => {
      useSettingsStore.getState().updateLLMConfig({
        providerId: 'custom-provider',
        model: 'custom-model',
      });
      const config = useSettingsStore.getState().llmConfig;
      expect(config.providerId).toBe('custom-provider');
      expect(config.model).toBe('custom-model');
    });
  });

  describe('toggleMinimap', () => {
    it('toggles minimap from true to false', () => {
      expect(useSettingsStore.getState().showMinimap).toBe(true);
      useSettingsStore.getState().toggleMinimap();
      expect(useSettingsStore.getState().showMinimap).toBe(false);
    });

    it('toggles minimap from false to true', () => {
      useSettingsStore.getState().toggleMinimap(); // true → false
      useSettingsStore.getState().toggleMinimap(); // false → true
      expect(useSettingsStore.getState().showMinimap).toBe(true);
    });
  });

  describe('toggleSystemPrompts', () => {
    it('toggles system prompts visibility', () => {
      expect(useSettingsStore.getState().showSystemPrompts).toBe(false);
      useSettingsStore.getState().toggleSystemPrompts();
      expect(useSettingsStore.getState().showSystemPrompts).toBe(true);
      useSettingsStore.getState().toggleSystemPrompts();
      expect(useSettingsStore.getState().showSystemPrompts).toBe(false);
    });
  });

  describe('toggleSettings', () => {
    it('toggles settings panel visibility', () => {
      expect(useSettingsStore.getState().showSettings).toBe(false);
      useSettingsStore.getState().toggleSettings();
      expect(useSettingsStore.getState().showSettings).toBe(true);
    });
  });

  describe('setShowSettings', () => {
    it('sets settings visibility explicitly', () => {
      useSettingsStore.getState().setShowSettings(true);
      expect(useSettingsStore.getState().showSettings).toBe(true);
      useSettingsStore.getState().setShowSettings(false);
      expect(useSettingsStore.getState().showSettings).toBe(false);
    });
  });
});
