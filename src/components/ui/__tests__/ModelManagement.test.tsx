/** @vitest-environment jsdom */
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { beforeEach, afterEach, expect, it, vi } from 'vitest';
import { ModelManagement } from '../ModelManagement';
import { ConversationModelPicker } from '../../nodes/ConversationModelPicker';
import { useModelStore } from '../../../stores/modelStore';
import { useFlowStore } from '../../../stores/flowStore';
import { fetchModels, testConnection } from '../../../services/providers/api';

vi.hoisted(() => { window.matchMedia = vi.fn().mockReturnValue({ matches: false, addEventListener: vi.fn() }); });
vi.mock('../../../services/providers/api', () => ({ fetchModels: vi.fn(), testConnection: vi.fn() }));
let container: HTMLDivElement; let root: Root;
beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true); vi.clearAllMocks();
  useModelStore.setState({ providers: [{ id: 'deepseek', name: 'DeepSeek', endpoint: 'https://example.test', apiKey: 'secret', enabled: true, models: [] }], defaultModel: null });
  container = document.createElement('div'); document.body.append(container); root = createRoot(container);
});
afterEach(async () => { await act(async () => root.unmount()); container.remove(); vi.unstubAllGlobals(); });
async function click(text: string) {
  await act(async () => [...document.querySelectorAll<HTMLButtonElement>('button')].find((button) => button.textContent === text || button.getAttribute('aria-label') === text)!.click());
}
async function input(label: string, value: string) {
  await act(async () => {
    const element = document.querySelector<HTMLInputElement>(`[aria-label="${label}"]`)!;
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(element, value);
    element.dispatchEvent(new Event('input', { bubbles: true }));
  });
}

it('syncs into a cancellable selection and only enables checked models on save', async () => {
  vi.mocked(fetchModels).mockResolvedValue([{ id: 'one', name: 'One' }, { id: 'two', name: 'Two' }]);
  await act(async () => root.render(<ModelManagement />));
  await click('模型列表');
  expect(useModelStore.getState().providers[0].models).toEqual([]);
  await act(async () => document.querySelector<HTMLInputElement>('[role="dialog"][aria-label="模型列表"] input[type="checkbox"]')!.click());
  await click('保存选择');
  expect(useModelStore.getState().providers[0].models.map((model) => model.enabled)).toEqual([true, false]);
  await click('设为默认');
  expect(useModelStore.getState().defaultModel?.modelId).toBe('one');
  await click('模型列表'); await click('取消');
  expect(useModelStore.getState().providers[0].models[0].enabled).toBe(true);
});

it('offers manual entry when synchronization fails, tests the chosen ID, and selects it for a conversation', async () => {
  vi.mocked(fetchModels).mockRejectedValue(new Error('HTTP 404'));
  vi.mocked(testConnection).mockResolvedValue({ success: true, message: 'ok' });
  await act(async () => root.render(<ModelManagement />));
  await click('模型列表'); expect(document.querySelector('[role="status"]')?.textContent).toContain('HTTP 404');
  await click('自定模型');
  expect(document.querySelector('[role="dialog"][aria-label="自定模型"]')).not.toBeNull();
  expect(document.activeElement?.getAttribute('aria-label')).toBe('新模型 ID');
  await input('新模型 ID', 'discarded'); await click('取消');
  expect(document.querySelector('[role="dialog"]')).toBeNull();
  expect(useModelStore.getState().providers[0].models).toEqual([]);
  await click('自定模型');
  expect(document.querySelector<HTMLInputElement>('[aria-label="新模型 ID"]')!.value).toBe('');
  await input('新模型 ID', 'manual-id'); await input('新模型名称', 'Manual Model'); await click('添加并启用');
  await click('测试连接'); expect(testConnection).toHaveBeenCalledWith('https://example.test', 'secret', 'manual-id');
  useFlowStore.setState({ nodes: [{ id: 'a', type: 'chat', position: { x: 0, y: 0 }, data: { topic: 'A' } }] });
  await act(async () => root.render(<ConversationModelPicker nodeId="a" disabled={false} />));
  await click('会话模型设置'); await click('Manual Model');
  expect(useFlowStore.getState().nodes[0].data.modelSelection).toEqual({ providerId: 'deepseek', providerName: 'DeepSeek', modelId: 'manual-id' });
  expect(JSON.stringify(useFlowStore.getState().nodes)).not.toContain('secret');
  await click('会话模型设置'); await click('默认');
  expect(useFlowStore.getState().nodes[0].data.modelSelection).toBeUndefined();
});

it('ignores a synchronization result after credentials are edited', async () => {
  let finish!: (models: { id: string; name: string }[]) => void;
  vi.mocked(fetchModels).mockReturnValue(new Promise((resolve) => { finish = resolve; }));
  await act(async () => root.render(<ModelManagement />));
  await click('模型列表'); await input('供应商 API 密钥', 'changed');
  await act(async () => finish([{ id: 'old', name: 'Old' }]));
  expect(document.querySelector('[role="dialog"][aria-label="模型列表"]')).toBeNull();
  expect(useModelStore.getState().providers[0].models).toEqual([]);
});

it('refreshes existing model capabilities while retaining defaults and allows a conversation to override them', async () => {
  useModelStore.getState().updateProvider('deepseek', { models: [{ id: 'one', name: 'My model', enabled: true, defaultThinkingEffort: 'low' }] });
  useModelStore.getState().setDefaultModel({ providerId: 'deepseek', providerName: 'DeepSeek', modelId: 'one' });
  vi.mocked(fetchModels).mockResolvedValue([{ id: 'one', name: 'API name', effort: { supportedLevels: ['low', 'high', 'max'], defaultLevel: 'high' } }]);
  await act(async () => root.render(<ModelManagement />));
  await click('模型列表'); await click('保存选择');
  const model = useModelStore.getState().providers[0].models[0];
  expect(model).toMatchObject({ name: 'My model', enabled: true, defaultThinkingEffort: 'low', effort: { supportedLevels: ['low', 'high', 'max'] } });
  await act(async () => [...document.querySelectorAll<HTMLButtonElement>('[aria-label="one 默认思考强度"] button')].find((button) => button.textContent === '最高')!.click());
  expect(useModelStore.getState().providers[0].models[0].defaultThinkingEffort).toBe('max');
  expect(JSON.parse(localStorage.getItem('caudalflow-local-models')!).state.providers[0].models[0].defaultThinkingEffort).toBe('max');
  useFlowStore.setState({ nodes: [{ id: 'a', type: 'chat', position: { x: 0, y: 0 }, data: { topic: 'A' } }] });
  await act(async () => root.render(<ConversationModelPicker nodeId="a" disabled={false} />));
  expect(document.querySelector('[aria-label="当前思考强度"]')?.textContent).toBe('最高');
  const inheritedLabel = document.querySelector('[aria-label="会话模型设置"]')!.textContent;
  expect(inheritedLabel).not.toContain('默认');
  await click('会话模型设置');
  await click('My model');
  expect(document.querySelector('[aria-label="会话模型设置"]')?.textContent).toBe(inheritedLabel);
  await click('会话模型设置');
  await act(async () => [...document.querySelectorAll<HTMLButtonElement>('[aria-label="会话思考强度"] button')].find((button) => button.textContent === '低')!.click());
  expect(useFlowStore.getState().nodes[0].data.thinkingEffort).toBe('low');
  expect(document.querySelector('[aria-label="当前思考强度"]')?.textContent).toBe('低');
  expect(useModelStore.getState().providers[0].models[0].defaultThinkingEffort).toBe('max');
  await act(async () => [...document.querySelectorAll<HTMLButtonElement>('[aria-label="会话思考强度"] button')].find((button) => button.textContent === '默认')!.click());
  expect(useFlowStore.getState().nodes[0].data.thinkingEffort).toBeUndefined();
  expect(document.querySelector('[aria-label="当前思考强度"]')?.textContent).toBe('最高');
});
