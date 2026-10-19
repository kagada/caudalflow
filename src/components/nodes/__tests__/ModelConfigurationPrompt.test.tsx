/** @vitest-environment jsdom */
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { ChatInput } from '../ChatInput';
import { SettingsPanel } from '../../ui/SettingsPanel';
import { useModelStore } from '../../../stores/modelStore';
import { useFlowStore } from '../../../stores/flowStore';
import { useSettingsStore } from '../../../stores/settingsStore';

vi.hoisted(() => { window.matchMedia = vi.fn().mockReturnValue({ matches: false, addEventListener: vi.fn() }); });
let container: HTMLDivElement; let root: Root;
beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  useSettingsStore.setState({ showSettings: false, settingsSection: 'general' });
  useModelStore.setState({ providers: [{ id: 'deepseek', name: 'DeepSeek', endpoint: 'https://example.test', apiKey: 'secret', enabled: true, models: [{ id: 'deepseek-flash', name: 'DeepSeek Flash', enabled: true }] }], defaultModel: { providerId: 'deepseek', providerName: 'DeepSeek', modelId: 'deepseek-flash' } });
  useFlowStore.setState({ nodes: [{ id: 'a', type: 'chat', position: { x: 0, y: 0 }, data: { topic: 'A' } }] });
  container = document.createElement('div'); document.body.append(container); root = createRoot(container);
});
afterEach(async () => { await act(async () => root.unmount()); container.remove(); vi.unstubAllGlobals(); });

it.each(['http:', 'app:'])('keeps the draft and opens in-app model management from the configuration prompt on %s', async (protocol) => {
  vi.stubGlobal('location', { protocol });
  const send = vi.fn();
  await act(async () => root.render(<><ChatInput nodeId="a" onSend={send} onCancel={vi.fn()} /><SettingsPanel /></>));
  expect(document.querySelector('[aria-label="会话模型设置"]')?.textContent).toContain('DeepSeek Flash');
  await act(async () => useModelStore.getState().updateProvider('deepseek', { enabled: false }));
  expect(document.querySelector('[aria-label="会话模型设置"]')?.textContent).toBe('未设置模型');
  const draft = document.querySelector('textarea')!;
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!.call(draft, '保留这个问题');
    draft.dispatchEvent(new Event('input', { bubbles: true }));
  });
  await act(async () => draft.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })));
  expect(send).not.toHaveBeenCalled();
  expect(draft.value).toBe('保留这个问题');
  expect(document.querySelector('[role="alertdialog"]')?.textContent).toContain('未设置模型');
  expect(document.querySelector('[role="alert"]')).toBeNull();
  await act(async () => [...document.querySelectorAll<HTMLButtonElement>('button')].find((button) => button.textContent === '去配置')!.click());
  expect(document.querySelector('[role="alertdialog"]')).toBeNull();
  expect(document.querySelector('nav button[aria-pressed="true"]')?.textContent).toBe('模型管理');
  expect(document.querySelector('[aria-label="供应商 API 密钥"]')).not.toBeNull();
  expect(draft.value).toBe('保留这个问题');
});

it.each(['key', 'model', 'provider'] as const)('shows an unconfigured explicit selection when its %s is unavailable and restores it when enabled', async (missing) => {
  await act(async () => {
    useFlowStore.getState().updateNodeData('a', { modelSelection: { providerId: 'deepseek', providerName: 'DeepSeek', modelId: 'deepseek-flash' } });
    root.render(<ChatInput nodeId="a" onSend={vi.fn()} onCancel={vi.fn()} />);
  });
  const original = useModelStore.getState().providers[0];
  await act(async () => useModelStore.getState().updateProvider('deepseek', missing === 'key' ? { apiKey: '' } : missing === 'model' ? { models: [] } : { enabled: false }));
  expect(document.querySelector('[aria-label="会话模型设置"]')?.textContent).toBe('未设置模型');
  await act(async () => useModelStore.getState().updateProvider('deepseek', original));
  expect(document.querySelector('[aria-label="会话模型设置"]')?.textContent).toContain('DeepSeek Flash');
  expect(useFlowStore.getState().nodes[0].data.modelSelection?.modelId).toBe('deepseek-flash');
});
