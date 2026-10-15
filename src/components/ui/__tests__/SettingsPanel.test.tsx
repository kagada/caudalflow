// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SettingsPanel } from '../SettingsPanel';
import { useSettingsStore } from '../../../stores/settingsStore';
import { fetchModels } from '../../../services/providers/api';

vi.hoisted(() => {
  window.matchMedia = vi.fn().mockReturnValue({ matches: false, addEventListener: vi.fn() });
});
vi.mock('../../../services/providers/api', () => ({ fetchModels: vi.fn(), testConnection: vi.fn() }));

let container: HTMLDivElement;
let root: Root;

beforeEach(async () => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  vi.clearAllMocks();
  useSettingsStore.setState({ showSettings: true, llmConfig: { providerId: 'mock', providerName: 'Mock', endpoint: '', apiKey: '', model: '', temperature: 0.7, maxTokens: 2048, mockDelay: 30 } });
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
  await act(async () => root.render(<SettingsPanel />));
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
});

// 模拟真实表单输入，验证设置入口和保存行为连通。
async function change(selector: string, value: string) {
  const input = container.querySelector<HTMLInputElement | HTMLSelectElement>(selector)!;
  const prototype = input instanceof HTMLSelectElement ? HTMLSelectElement.prototype : HTMLInputElement.prototype;
  await act(async () => {
    Object.getOwnPropertyDescriptor(prototype, 'value')!.set!.call(input, value);
    input.dispatchEvent(new Event(input instanceof HTMLSelectElement ? 'change' : 'input', { bubbles: true }));
  });
}

describe('API settings form', () => {
  it('offers a DeepSeek preset with editable URL and thinking mode', async () => {
    await change('#llm-provider', 'deepseek');
    expect(container.querySelector<HTMLInputElement>('#api-endpoint')!.value).toBe('https://api.deepseek.com');
    expect(container.querySelector<HTMLInputElement>('#api-model')!.value).toBe('deepseek-flash');
    expect(container.querySelector('#thinking-mode')).not.toBeNull();
  });
  it('lets the user configure and persist an API from the provider selector', async () => {
    await change('#llm-provider', 'custom');
    await change('#api-endpoint', 'http://localhost:1234/v1');
    await change('#api-key', 'test-key');
    await change('#api-model', 'my-model');
    expect(useSettingsStore.getState().llmConfig).toMatchObject({ providerId: 'custom', endpoint: 'http://localhost:1234/v1', apiKey: 'test-key', model: 'my-model' });
    expect(JSON.parse(localStorage.getItem('caudalflow-settings')!).state.llmConfig.model).toBe('my-model');
    expect(container.querySelector<HTMLInputElement>('#api-key')!.type).toBe('password');
  });

  it('keeps model entry editable after fetching suggestions without an API key', async () => {
    vi.mocked(fetchModels).mockResolvedValue([{ id: 'suggested', name: 'Suggested' }]);
    await change('#llm-provider', 'custom');
    await change('#api-endpoint', 'http://localhost:1234/v1');
    const button = [...container.querySelectorAll('button')].find((element) => element.textContent?.includes('Fetch Models'))!;
    expect(button.disabled).toBe(false);
    await act(async () => button.click());
    expect(container.querySelector('datalist option')?.getAttribute('value')).toBe('suggested');
    await change('#api-model', 'unlisted-model');
    expect(useSettingsStore.getState().llmConfig.model).toBe('unlisted-model');
  });

  it('shows model-list failures and keeps manual model entry available', async () => {
    vi.mocked(fetchModels).mockRejectedValue(new Error('HTTP 401'));
    await change('#llm-provider', 'custom');
    await change('#api-endpoint', 'https://example.com/v1');
    const button = [...container.querySelectorAll('button')].find((element) => element.textContent?.includes('Fetch Models'))!;
    await act(async () => button.click());
    expect(container.querySelector('[role="alert"]')?.textContent).toContain('HTTP 401');
    await change('#api-model', 'manual-model');
    expect(useSettingsStore.getState().llmConfig.model).toBe('manual-model');
  });
});
