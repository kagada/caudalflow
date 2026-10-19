import { afterEach, describe, expect, it, vi } from 'vitest';
import { resolveOpenAIEndpoint } from '../endpoints';
import { fetchModels, testConnection } from '../api';
import { CustomProvider } from '../custom';
import { OpenAIProvider } from '../openai';
import type { LLMConfig } from '../../../types/chat';

afterEach(() => vi.unstubAllGlobals());

describe('custom API configuration', () => {
  it('reads effort capabilities from the actual model-list response without inventing missing levels', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(Response.json({ data: [
      { id: 'deepseek-flash', name: 'DeepSeek Flash', effort: { supported_levels: ['low', 'high', 'max', 'high', null], default_level: 'high' } },
      { id: 'manual' },
      { id: 'limited', effort: { supported_levels: ['low'], default_level: 'max' } },
    ] })));
    expect(await fetchModels('https://api.deepseek.com', 'test-key')).toEqual([
      { id: 'deepseek-flash', name: 'DeepSeek Flash', effort: { supportedLevels: ['low', 'high', 'max'], defaultLevel: 'high' } },
      { id: 'manual', name: 'manual' },
      { id: 'limited', name: 'limited', effort: { supportedLevels: ['low'] } },
    ]);
  });

  it.each(['low', 'high', 'max'])('sends the selected %s effort with thinking enabled and omits it when disabled', async (effort) => {
    const request = vi.fn().mockImplementation(() => Promise.resolve(new Response('data:{"choices":[{"delta":{"content":"答案"}}]}\ndata:[DONE]\n')));
    vi.stubGlobal('fetch', request);
    const config = { providerId: 'deepseek', endpoint: 'https://example.com/v1', model: 'deepseek-flash', apiKey: 'test-key', temperature: 0.7, maxTokens: 2048, thinkingMode: 'enabled', thinkingEffort: effort } as LLMConfig;
    const callbacks = { onToken: vi.fn(), onDone: vi.fn(), onError: vi.fn() };
    await CustomProvider.streamChat([], config, callbacks, new AbortController().signal);
    expect(JSON.parse(request.mock.calls[0][1].body)).toMatchObject({ thinking: { type: 'enabled' }, reasoning_effort: effort });
    await CustomProvider.streamChat([], { ...config, thinkingMode: 'disabled' }, callbacks, new AbortController().signal);
    const body = JSON.parse(request.mock.calls[1][1].body);
    expect(body.thinking).toEqual({ type: 'disabled' });
    expect(body.reasoning_effort).toBeUndefined();
  });

  it.each([
    [' https://example.com/ ', 'https://example.com/v1'],
    ['https://example.com/v1/', 'https://example.com/v1'],
    ['https://example.com/v1/chat/completions/', 'https://example.com/v1'],
    ['https://example.com/gateway/v2/', 'https://example.com/gateway/v2'],
    ['http://localhost:1234/v1', 'http://localhost:1234/v1'],
  ])('uses the same API base for chat and model discovery: %s', (input, base) => {
    expect(resolveOpenAIEndpoint(input, 'chat/completions')).toBe(`${base}/chat/completions`);
    expect(resolveOpenAIEndpoint(input, 'models')).toBe(`${base}/models`);
  });

  it.each(['', 'file:///api', 'https://user:secret@example.com', 'https://example.com/#chat'])('rejects an invalid URL: %s', (input) => {
    expect(() => resolveOpenAIEndpoint(input, 'models')).toThrow();
  });

  it('fetches model suggestions with the configured key', async () => {
    const request = vi.fn().mockResolvedValue(Response.json({ data: [{ id: 'custom-model' }, null, { id: 123 }] }));
    vi.stubGlobal('fetch', request);
    expect(await fetchModels('https://example.com/v1/', ' test-key ')).toEqual([{ id: 'custom-model', name: 'custom-model' }]);
    expect(request).toHaveBeenCalledWith('https://example.com/v1/models', expect.objectContaining({ headers: { Authorization: 'Bearer test-key' } }));
  });

  it('surfaces model-list failures instead of hiding them', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(Response.json({ error: { message: 'Invalid key' } }, { status: 401 })));
    await expect(fetchModels('https://example.com/v1', 'bad')).rejects.toThrow('HTTP 401: Invalid key');
  });

  it('tests the chosen model without requiring model discovery or authentication', async () => {
    const request = vi.fn().mockResolvedValue(Response.json({ choices: [{ message: { content: 'OK' } }] }));
    vi.stubGlobal('fetch', request);
    expect((await testConnection('http://localhost:1234/v1/', '', 'local-model')).success).toBe(true);
    expect(request).toHaveBeenCalledTimes(1);
    const [url, options] = request.mock.calls[0];
    expect(url).toBe('http://localhost:1234/v1/chat/completions');
    expect(options.headers).not.toHaveProperty('Authorization');
    expect(JSON.parse(options.body).model).toBe('local-model');
  });

  it('does not report a rate-limited API as successfully configured', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(Response.json({ error: { message: 'Quota exceeded' } }, { status: 429 })));
    expect(await testConnection('https://example.com', 'key', 'model')).toEqual({ success: false, message: 'HTTP 429: Quota exceeded' });
  });

  it('rejects an HTML page returned with a successful HTTP status', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('<html>Wrong endpoint</html>')));
    expect((await testConnection('https://example.com', 'key', 'model')).success).toBe(false);
  });

  it.each([CustomProvider, OpenAIProvider])('streams directly from the configured URL using $id', async (provider) => {
    // 将响应拆成多个网络片段，验证真实流式请求使用设置地址和密钥。
    const stream = new ReadableStream({
      start(controller) {
        const encoder = new TextEncoder();
        controller.enqueue(encoder.encode('data: {"choices":[{"delta":{"content":"你'));
        controller.enqueue(encoder.encode('好"}}]}\n\ndata: [DONE]\n\n'));
        controller.close();
      },
    });
    const request = vi.fn().mockResolvedValue(new Response(stream));
    vi.stubGlobal('fetch', request);
    const config: LLMConfig = { providerId: provider.id, providerName: 'Test', endpoint: 'https://example.com/gateway/v2/', apiKey: 'test-key', model: 'custom-model', temperature: 0.7, maxTokens: 2048, mockDelay: 30 };
    const callbacks = { onToken: vi.fn(), onDone: vi.fn(), onError: vi.fn() };
    await provider.streamChat([{ id: '1', role: 'user', content: '你好', timestamp: 0 }], config, callbacks, new AbortController().signal);
    expect(request).toHaveBeenCalledWith('https://example.com/gateway/v2/chat/completions', expect.objectContaining({ headers: expect.objectContaining({ Authorization: 'Bearer test-key' }) }));
    expect(JSON.parse(request.mock.calls[0][1].body).stream_options).toEqual({ include_usage: true });
    expect(callbacks.onToken).toHaveBeenCalledWith('你好');
    expect(callbacks.onDone).toHaveBeenCalledTimes(1);
    expect(callbacks.onError).not.toHaveBeenCalled();
  });

  it('continues chatting when a compatible endpoint rejects usage options', async () => {
    const request = vi.fn().mockResolvedValueOnce(Response.json({ error: { message: 'Unsupported parameter: stream_options' } }, { status: 400 }))
      .mockResolvedValueOnce(new Response('data:{"choices":[{"delta":{"content":"答案"}}]}\ndata:[DONE]\n'));
    vi.stubGlobal('fetch', request);
    const config = { providerId: 'custom', endpoint: 'https://example.com/v1', model: 'test', apiKey: '', temperature: 0.7, maxTokens: 100 } as LLMConfig;
    const callbacks = { onToken: vi.fn(), onUsage: vi.fn(), onDone: vi.fn(), onError: vi.fn() };
    await CustomProvider.streamChat([], config, callbacks, new AbortController().signal);
    expect(request).toHaveBeenCalledTimes(2);
    expect(JSON.parse(request.mock.calls[1][1].body).stream_options).toBeUndefined();
    expect(callbacks.onToken).toHaveBeenCalledWith('答案');
    expect(callbacks.onUsage).not.toHaveBeenCalled();
    expect(callbacks.onDone).toHaveBeenCalledTimes(1);
  });
});
