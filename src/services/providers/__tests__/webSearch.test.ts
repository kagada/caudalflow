import { afterEach, expect, it, vi } from 'vitest';
import { DeepSeekProvider } from '../deepseek';
import { supportsWebSearch } from '../webSearch';
import type { LLMConfig } from '../../../types/chat';
import { readOpenAIStream } from '../openaiStream';

const config: LLMConfig = { providerId: 'deepseek', providerName: 'DeepSeek', endpoint: 'https://api.deepseek.com', model: 'deepseek-flash', apiKey: 'test', temperature: 0.7, maxTokens: 2048, webSearch: true };
const signal = () => new AbortController().signal;
const cb = () => ({ onToken: vi.fn(), onReasoning: vi.fn(), onDone: vi.fn(), onError: vi.fn(), onUsage: vi.fn() });
const stream = (delta: object, finish_reason = 'stop') => new Response(`data:${JSON.stringify({ choices: [{ delta, finish_reason }], usage: { prompt_tokens: 10, completion_tokens: 2 } })}\ndata:[DONE]\n`);
const tool = { index: 0, id: 'call-1', type: 'function', function: { name: 'web_search', arguments: '{"query":"最新消息"}' } };
afterEach(() => vi.unstubAllGlobals());

it('assembles tool arguments split across streaming chunks', async () => {
  const first = { ...tool, function: { name: 'web_search', arguments: '{"query":' } };
  const second = { index: 0, function: { arguments: '"消息"}' } };
  const response = new Response([first, second].map((part, index) => `data:${JSON.stringify({ choices: [{ delta: { tool_calls: [part] }, finish_reason: index ? 'tool_calls' : null }] })}\n`).join('') + 'data:[DONE]\n');
  const result = await readOpenAIStream(response, cb(), signal(), true);
  expect(result?.tool_calls[0].function.arguments).toBe('{"query":"消息"}');
});

it('stops before executing a tool if cancelled after the model request', async () => {
  const controller = new AbortController();
  const fetch = vi.fn().mockImplementation(async () => { controller.abort(); return stream({ tool_calls: [tool] }, 'tool_calls'); });
  vi.stubGlobal('fetch', fetch); const callbacks = cb();
  await DeepSeekProvider.streamChat([], config, callbacks, controller.signal);
  expect(fetch).toHaveBeenCalledTimes(1);
  expect(callbacks.onDone).not.toHaveBeenCalled();
  expect(callbacks.onError).not.toHaveBeenCalled();
});

it('keeps ordinary replies to one request and provides no tools when disabled', async () => {
  for (const webSearch of [false, true]) {
    const fetch = vi.fn().mockResolvedValue(stream({ content: '普通回答' })); vi.stubGlobal('fetch', fetch);
    const callbacks = cb();
    await DeepSeekProvider.streamChat([], { ...config, webSearch }, callbacks, signal());
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(!!JSON.parse(fetch.mock.calls[0][1].body).tools).toBe(webSearch);
    expect(callbacks.onDone).toHaveBeenCalledTimes(1);
  }
});

it('returns tool requests and search results to the model and totals model usage', async () => {
  const fetch = vi.fn().mockResolvedValueOnce(stream({ reasoning_content: '需要查证', tool_calls: [tool] }, 'tool_calls'))
    .mockResolvedValueOnce(Response.json({ results: [{ title: '官方', url: 'https://example.com', summary: '消息' }] }))
    .mockResolvedValueOnce(stream({ content: '查到了 [来源](https://example.com)' }));
  vi.stubGlobal('fetch', fetch); const callbacks = cb();
  await DeepSeekProvider.streamChat([], config, callbacks, signal());
  expect(fetch).toHaveBeenCalledTimes(3);
  expect(fetch.mock.calls[1][0]).toBe('https://api.deepseek.com/v1/tools/search');
  const history = JSON.parse(fetch.mock.calls[2][1].body).messages;
  expect(history[1]).toMatchObject({ role: 'assistant', reasoning_content: '需要查证', tool_calls: [{ id: 'call-1' }] });
  expect(history[2]).toMatchObject({ role: 'tool', tool_call_id: 'call-1' });
  expect(history[2].content).toContain('https://example.com');
  expect(callbacks.onUsage).toHaveBeenLastCalledWith({ inputTokens: 20, outputTokens: 4 });
  expect(callbacks.onDone).toHaveBeenCalledTimes(1);
});

it('reports search failures without pretending to have completed the answer', async () => {
  const fetch = vi.fn().mockResolvedValueOnce(stream({ tool_calls: [tool] }, 'tool_calls')).mockResolvedValueOnce(new Response('', { status: 402 }));
  vi.stubGlobal('fetch', fetch); const callbacks = cb();
  await DeepSeekProvider.streamChat([], config, callbacks, signal());
  expect(callbacks.onError.mock.calls[0][0].message).toContain('402');
  expect(callbacks.onDone).not.toHaveBeenCalled();
});

it('does not enable unsupported providers, models or third party endpoints', () => {
  expect(supportsWebSearch(config)).toBe(true);
  for (const change of [{ providerId: 'bailian' }, { model: 'unknown' }, { endpoint: 'https://example.com' }]) expect(supportsWebSearch({ ...config, ...change })).toBe(false);
});

it('exposes raw search results, model tool requests and returned data without recording credentials', async () => {
  const fetch = vi.fn().mockResolvedValueOnce(stream({ tool_calls: [tool] }, 'tool_calls'))
    .mockResolvedValueOnce(Response.json({ results: [{ title: '来源', url: 'https://example.com', summary: '摘要', authority: 3 }] }))
    .mockResolvedValueOnce(stream({ content: '回答' }));
  vi.stubGlobal('fetch', fetch); const onDebug = vi.fn(); const callbacks = cb();
  await DeepSeekProvider.streamChat([], { ...config, apiKey: 'secret-debug-key' }, { ...callbacks, onDebug }, signal());
  const events = onDebug.mock.calls.map(([event]) => event);
  expect(events.map((event) => event.stage)).toEqual(['模型请求', '模型返回工具请求', '准备执行工具', '联网接口请求', '联网接口原始返回', '回传模型的工具结果', '模型请求', '模型返回回答']);
  expect(events.find((event) => event.stage === '联网接口原始返回').data.body.results[0].authority).toBe(3);
  expect(events[0].data.messages).toHaveLength(1);
  expect(events[6].data.messages).toHaveLength(3);
  expect(JSON.stringify(events)).not.toContain('secret-debug-key');
  expect(callbacks.onReasoning).not.toHaveBeenCalled();
});

it('shows why a proposed URL was blocked before any fetch request was sent', async () => {
  const fetchTool = { ...tool, function: { name: 'web_fetch', arguments: '{"url":"https://time.is"}' } };
  const fetch = vi.fn().mockResolvedValueOnce(stream({ tool_calls: [fetchTool] }, 'tool_calls'));
  vi.stubGlobal('fetch', fetch); const onDebug = vi.fn();
  await DeepSeekProvider.streamChat([], config, { ...cb(), onDebug }, signal());
  expect(fetch).toHaveBeenCalledTimes(1);
  const events = onDebug.mock.calls.map(([event]) => event);
  expect(events.find((event) => event.stage === '准备执行工具').data).toMatchObject({ allowedSourceUrls: [], toolCall: { function: { arguments: '{"url":"https://time.is"}' } } });
  expect(events.at(-1)).toMatchObject({ stage: '流程中断', data: { message: '只能读取本轮搜索返回的网页。' } });
});
