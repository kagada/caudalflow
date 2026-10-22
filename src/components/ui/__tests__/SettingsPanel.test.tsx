// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SettingsPanel } from '../SettingsPanel';
import { useSettingsStore } from '../../../stores/settingsStore';
import { DEFAULT_BUILTIN_PROMPTS } from '../../../services/builtinPrompts';

vi.hoisted(() => {
  window.matchMedia = vi.fn().mockReturnValue({ matches: false, addEventListener: vi.fn() });
});
vi.mock('../../../services/providers/api', () => ({ fetchModels: vi.fn(), testConnection: vi.fn() }));

let container: HTMLDivElement;
let root: Root;

beforeEach(async () => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  vi.clearAllMocks();
  useSettingsStore.setState({ showSettings: true, settingsSection: 'general', openCompactCardsMaximized: false, llmConfig: { providerId: 'mock', providerName: 'Mock', endpoint: '', apiKey: '', model: '', temperature: 0.7, maxTokens: 2048, } });
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
  const input = document.querySelector<HTMLInputElement | HTMLSelectElement>(selector)!;
  const prototype = input instanceof HTMLSelectElement ? HTMLSelectElement.prototype : HTMLInputElement.prototype;
  await act(async () => {
    Object.getOwnPropertyDescriptor(prototype, 'value')!.set!.call(input, value);
    input.dispatchEvent(new Event(input instanceof HTMLSelectElement ? 'change' : 'input', { bubbles: true }));
  });
}

describe('API settings form', () => {
  it('lets the user change and persist the compact-card reading preference', async () => {
    const toggle = document.querySelector<HTMLButtonElement>('button[role="switch"]')!;
    expect(toggle.getAttribute('aria-checked')).toBe('false');
    await act(async () => toggle.click());
    expect(useSettingsStore.getState().openCompactCardsMaximized).toBe(true);
    expect(JSON.parse(localStorage.getItem('caudalflow-settings')!).state.openCompactCardsMaximized).toBe(true);
    await act(async () => toggle.click());
    expect(useSettingsStore.getState().openCompactCardsMaximized).toBe(false);
  });
  it('exposes the actual built-in summary prompt and persists edits with a restore-default action', async () => {
    await act(async () => [...document.querySelectorAll('nav button')].find((button) => button.textContent === '内置提示词')!.dispatchEvent(new MouseEvent('click', { bubbles: true })));
    const input = document.querySelector<HTMLTextAreaElement>('[aria-label="内置提示词内容"]')!;
    expect(input.value).toContain('{{maxChars}}');
    await act(async () => { Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!.call(input, '新的摘要规则 {{maxChars}}'); input.dispatchEvent(new Event('input', { bubbles: true })); });
    await act(async () => [...document.querySelectorAll<HTMLButtonElement>('button')].find((button) => button.textContent === '保存提示词')!.click());
    expect(useSettingsStore.getState().builtinPrompts.referenceSummary).toBe('新的摘要规则 {{maxChars}}');
    expect(JSON.parse(localStorage.getItem('caudalflow-settings')!).state.builtinPrompts.referenceSummary).toBe('新的摘要规则 {{maxChars}}');
    await act(async () => [...document.querySelectorAll<HTMLButtonElement>('button')].find((button) => button.textContent === '恢复默认')!.click());
    expect(useSettingsStore.getState().builtinPrompts.referenceSummary).toBe(DEFAULT_BUILTIN_PROMPTS.referenceSummary);
  });
  it('exposes generation settings without legacy providers, mock delays or preset model names', async () => {
    expect(document.querySelector('#llm-provider')).toBeNull();
    expect(document.querySelector('#api-model')).toBeNull();
    expect(document.body.textContent).not.toContain('gpt-4o-mini');
    expect(document.body.textContent).not.toContain('旧版模型');
    await change('[aria-label="最大输出令牌数"]', '4096');
    expect(useSettingsStore.getState().llmConfig.maxTokens).toBe(4096);
  });

});
