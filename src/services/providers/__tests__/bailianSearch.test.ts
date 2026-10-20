import { afterEach, expect, it, vi } from 'vitest';
import { fetchModels } from '../api';
import { reportedWebSearchSupport } from '../bailianSearch';
import { BailianProvider } from '../bailian';
import { supportsWebSearch } from '../webSearch';
import type { LLMConfig } from '../../../types/chat';

const endpoint = 'https://dashscope.aliyuncs.com/compatible-mode/v1';
const config: LLMConfig = { providerId: 'bailian', providerName: '百炼', endpoint, apiKey: 'test-key', model: 'new-model-without-local-rules', temperature: 0.7, maxTokens: 2048, };
const answer = () => new Response('data:{"choices":[{"delta":{"content":"回答"},"finish_reason":"stop"}]}\ndata:[DONE]\n');
afterEach(() => vi.unstubAllGlobals());

it('reads capabilities from features instead of names, with unknown distinct from unsupported', () => {
  expect(reportedWebSearchSupport(['web-search'])).toBe(true);
  expect(reportedWebSearchSupport([])).toBe(false);
  expect(reportedWebSearchSupport(['function-calling'])).toBe(false);
  expect(reportedWebSearchSupport(undefined)).toBeUndefined();
  expect(reportedWebSearchSupport([null])).toBeUndefined();
  expect(supportsWebSearch({ ...config, webSearchSupported: true })).toBe(true);
  expect(supportsWebSearch({ ...config, webSearchSupported: false })).toBe(false);
  expect(supportsWebSearch({ ...config, model: 'qwen3.8-max' })).toBe(false);
});

it('uses capabilities already returned by the compatible endpoint without an extra request', async () => {
  const fetch = vi.fn().mockResolvedValue(Response.json({ data: [{ id: 'brand-new-model', features: ['web-search'] }, { id: 'plain', features: [] }] }));
  vi.stubGlobal('fetch', fetch);
  expect(await fetchModels(endpoint, 'test')).toEqual([{ id: 'brand-new-model', name: 'brand-new-model', webSearchSupported: true }, { id: 'plain', name: 'plain', webSearchSupported: false }]);
  expect(fetch).toHaveBeenCalledTimes(1);
});

it('queries the same origin catalog with pagination and leaves absent metadata unknown', async () => {
  const fetch = vi.fn().mockResolvedValueOnce(Response.json({ data: [{ id: 'brand-new' }, { id: 'plain' }, { id: 'missing' }] }))
    .mockResolvedValueOnce(Response.json({ output: { total: 2, models: [{ model: 'brand-new', features: ['web-search'] }] } }))
    .mockResolvedValueOnce(Response.json({ output: { total: 2, models: [{ model: 'plain', features: [] }] } }));
  vi.stubGlobal('fetch', fetch);
  const result = await fetchModels(endpoint, 'test');
  expect(result.map((model) => model.webSearchSupported)).toEqual([true, false, undefined]);
  expect(fetch).toHaveBeenCalledTimes(3);
  expect(fetch.mock.calls[1][0]).toContain('https://dashscope.aliyuncs.com/api/v1/models?');
  expect(fetch.mock.calls[2][0]).toContain('page_no=2');
});

it('does not disable ordinary chatting or invent capabilities when metadata lookup fails', async () => {
  const fetch = vi.fn().mockResolvedValueOnce(Response.json({ data: [{ id: 'qwen3.8-max' }] })).mockResolvedValueOnce(new Response('', { status: 404 }));
  vi.stubGlobal('fetch', fetch);
  expect(await fetchModels(endpoint, 'test')).toEqual([{ id: 'qwen3.8-max', name: 'qwen3.8-max' }]);
});

it('does not query other services or rewrite credentials to another host', async () => {
  const fetch = vi.fn().mockResolvedValue(Response.json({ data: [{ id: 'qwen3.8-max' }] }));
  vi.stubGlobal('fetch', fetch);
  await fetchModels('https://example.com/v1', 'test');
  expect(fetch).toHaveBeenCalledTimes(1);
});

it.each([false, true])('sends search permission %s in a single model request without forcing a search', async (webSearch) => {
  const fetch = vi.fn().mockImplementation(answer); vi.stubGlobal('fetch', fetch);
  const callbacks = { onToken: vi.fn(), onDone: vi.fn(), onError: vi.fn(), onDebug: vi.fn() };
  await BailianProvider.streamChat([], { ...config, webSearch, webSearchSupported: true }, callbacks, new AbortController().signal);
  expect(fetch).toHaveBeenCalledTimes(1);
  const body = JSON.parse(fetch.mock.calls[0][1].body);
  expect(body.enable_search).toBe(webSearch);
  expect(body.tools).toBeUndefined();
  expect(body.search_options).toEqual(webSearch ? { forced_search: false } : undefined);
  expect(callbacks.onDone).toHaveBeenCalledTimes(1);
  expect(callbacks.onError).not.toHaveBeenCalled();
  expect(JSON.stringify(callbacks.onDebug.mock.calls)).not.toContain('test-key');
});

it.each([undefined, false])('refuses unconfirmed search capability %s without a paid request', async (webSearchSupported) => {
  const fetch = vi.fn(); vi.stubGlobal('fetch', fetch);
  const callbacks = { onToken: vi.fn(), onDone: vi.fn(), onError: vi.fn() };
  await BailianProvider.streamChat([], { ...config, webSearch: true, webSearchSupported }, callbacks, new AbortController().signal);
  expect(fetch).not.toHaveBeenCalled();
  expect(callbacks.onError).toHaveBeenCalledTimes(1);
});
