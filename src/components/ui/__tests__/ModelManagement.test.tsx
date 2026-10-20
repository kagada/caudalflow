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

it('saves the search switch per conversation and disables it for unsupported models', async () => {
  useModelStore.setState({ providers: [{ id: 'deepseek', name: 'DeepSeek', endpoint: 'https://api.deepseek.com', apiKey: 'secret', enabled: true, models: [{ id: 'deepseek-flash', name: 'Flash', enabled: true }] }], defaultModel: { providerId: 'deepseek', providerName: 'DeepSeek', modelId: 'deepseek-flash' } });
  useFlowStore.setState({ nodes: [{ id: 'search', type: 'chat', position: { x: 0, y: 0 }, data: { topic: '搜索' } }] });
  await act(async () => root.render(<ConversationModelPicker nodeId="search" disabled={false} />));
  await click('会话模型设置');
  const toggle = () => document.querySelector<HTMLInputElement>('[aria-label="联网搜索"]')!;
  expect(toggle().checked).toBe(false);
  expect(toggle().disabled).toBe(false);
  await act(async () => toggle().click());
  expect(useFlowStore.getState().nodes[0].data.webSearch).toBe(true);
  expect(document.body.textContent).not.toContain('可能产生额外费用');
  expect(toggle().parentElement?.className).toContain('w-11');
  await act(async () => useModelStore.getState().updateProvider('deepseek', { endpoint: 'https://example.com' }));
  expect(toggle()).toBeNull();
  expect(document.body.textContent).toContain('不支持');
});

it('edits each model search default and lets conversations inherit until explicitly changed', async () => {
  useModelStore.setState({ providers: [{ id: 'deepseek', name: 'DeepSeek', endpoint: 'https://api.deepseek.com', apiKey: 'secret', enabled: true, models: [{ id: 'deepseek-flash', name: 'Flash', enabled: true }] }], defaultModel: { providerId: 'deepseek', providerName: 'DeepSeek', modelId: 'deepseek-flash' } });
  useFlowStore.setState({ nodes: [{ id: 'defaults', type: 'chat', position: { x: 0, y: 0 }, data: { topic: '默认设置' } }] });
  await act(async () => root.render(<ModelManagement />));
  const modelToggle = document.querySelector<HTMLInputElement>('[aria-label="deepseek-flash 默认联网搜索"]')!;
  expect(modelToggle.checked).toBe(false);
  await act(async () => modelToggle.click());
  expect(useModelStore.getState().providers[0].models[0].defaultWebSearch).toBe(true);
  await act(async () => root.render(<ConversationModelPicker nodeId="defaults" disabled={false} />));
  await click('会话模型设置');
  const conversationToggle = () => document.querySelector<HTMLInputElement>('[aria-label="联网搜索"]')!;
  expect(conversationToggle().checked).toBe(true);
  expect(useFlowStore.getState().nodes[0].data.webSearch).toBeUndefined();
  await act(async () => conversationToggle().click());
  expect(conversationToggle().checked).toBe(false);
  expect(useFlowStore.getState().nodes[0].data.webSearch).toBe(false);
});

it('adds only selected models to the outer list on save', async () => {
  vi.mocked(fetchModels).mockResolvedValue([{ id: 'one', name: 'One' }, { id: 'two', name: 'Two' }]);
  await act(async () => root.render(<ModelManagement />));
  await click('模型列表');
  expect(useModelStore.getState().providers[0].models).toEqual([]);
  await act(async () => document.querySelector<HTMLInputElement>('[role="dialog"][aria-label="模型列表"] input[type="checkbox"]')!.click());
  await click('保存选择');
  expect(useModelStore.getState().providers[0].models.map((model) => model.id)).toEqual(['one']);
  expect(document.querySelector('[aria-label="启用 two"]')).toBeNull();
  await click('设为默认');
  expect(useModelStore.getState().defaultModel?.modelId).toBe('one');
  await click('模型列表'); await click('取消');
  expect(useModelStore.getState().providers[0].models[0].enabled).toBe(true);
});

it('keeps membership separate from enablement and deletes a model immediately without changing conversation references', async () => {
  useModelStore.getState().updateProvider('deepseek', { models: [{ id: 'one', name: 'One', enabled: false, defaultThinkingEffort: 'none' }] });
  useFlowStore.setState({ nodes: [{ id: 'a', type: 'chat', position: { x: 0, y: 0 }, data: { topic: 'A', modelSelection: { providerId: 'deepseek', providerName: 'DeepSeek', modelId: 'one' } } }] });
  vi.mocked(fetchModels).mockResolvedValue([{ id: 'one', name: 'One' }, { id: 'two', name: 'Two' }]);
  await act(async () => root.render(<ModelManagement />));
  await click('模型列表');
  expect(document.querySelector<HTMLInputElement>('[role="dialog"] input[type="checkbox"]')!.checked).toBe(true);
  await click('保存选择');
  expect(useModelStore.getState().providers[0].models).toMatchObject([{ id: 'one', enabled: false }]);
  await act(async () => document.querySelector<HTMLInputElement>('[aria-label="启用 one"]')!.click());
  expect(useModelStore.getState().providers[0].models[0].enabled).toBe(true);
  await click('删除模型 one');
  expect(useModelStore.getState().providers[0].models).toEqual([]);
  expect(document.querySelector('[role="dialog"]')).toBeNull();
  expect(useFlowStore.getState().nodes[0].data.modelSelection?.modelId).toBe('one');
});

it('can remove old unwanted entries from a filtered list without retaining hidden selections', async () => {
  useModelStore.getState().updateProvider('deepseek', { models: [{ id: 'one', name: 'One', enabled: false }, { id: 'two', name: 'Two', enabled: true }] });
  vi.mocked(fetchModels).mockResolvedValue([{ id: 'one', name: 'One' }, { id: 'two', name: 'Two' }]);
  await act(async () => root.render(<ModelManagement />));
  await click('模型列表'); await input('搜索模型', 'Two'); await click('清空选择');
  await act(async () => document.querySelector<HTMLInputElement>('[role="dialog"] input[type="checkbox"]')!.click());
  await click('保存选择');
  expect(useModelStore.getState().providers[0].models.map((model) => model.id)).toEqual(['two']);
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

it('keeps supplier settings separate and makes a Bailian model available to conversations', async () => {
  const endpoint = 'https://dashscope.aliyuncs.com/compatible-mode/v1';
  useModelStore.setState({ providers: [...useModelStore.getState().providers, { id: 'bailian', name: '阿里云百炼', endpoint, apiKey: '', enabled: false, models: [] }] });
  vi.mocked(fetchModels).mockResolvedValue([{ id: 'qwen-test', name: 'Qwen Test' }]);
  await act(async () => root.render(<ModelManagement />));
  await click('供应商 阿里云百炼');
  expect(document.querySelector<HTMLInputElement>('[aria-label="供应商 API 地址"]')!.value).toBe(endpoint);
  expect(document.querySelector<HTMLInputElement>('[aria-label="供应商 API 密钥"]')!.value).toBe('');
  await input('供应商 API 密钥', 'bailian-key');
  await act(async () => document.querySelector<HTMLInputElement>('header input[type="checkbox"]')!.click());
  await click('模型列表');
  expect(fetchModels).toHaveBeenCalledWith(endpoint, 'bailian-key');
  expect(document.querySelector('[role="dialog"] header')?.textContent).toContain('阿里云百炼');
  await act(async () => document.querySelector<HTMLInputElement>('[role="dialog"] input[type="checkbox"]')!.click());
  await click('保存选择'); await click('设为默认');
  expect(useModelStore.getState().providers[1].models[0].defaultThinkingEffort).toBeUndefined();
  expect(useModelStore.getState().defaultModel).toMatchObject({ providerId: 'bailian', modelId: 'qwen-test' });
  await click('供应商 DeepSeek');
  expect(document.querySelector<HTMLInputElement>('[aria-label="供应商 API 密钥"]')!.value).toBe('secret');
  expect(useModelStore.getState().providers[0].models).toEqual([]);
  useFlowStore.setState({ nodes: [{ id: 'a', type: 'chat', position: { x: 0, y: 0 }, data: { topic: 'A' } }] });
  await act(async () => root.render(<ConversationModelPicker nodeId="a" disabled={false} />));
  expect(document.querySelector('[aria-label="会话模型设置"]')?.textContent).toContain('Qwen Test');
  await click('会话模型设置');
  await act(async () => [...document.querySelectorAll<HTMLButtonElement>('[aria-label="选择会话模型"] button')].find((button) => button.textContent === 'Qwen Test')!.click());
  expect(useFlowStore.getState().nodes[0].data.modelSelection).toEqual({ providerId: 'bailian', providerName: '阿里云百炼', modelId: 'qwen-test' });
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
