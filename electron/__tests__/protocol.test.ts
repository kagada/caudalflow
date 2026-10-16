import { createRequire } from 'node:module';
import { describe, expect, it, vi } from 'vitest';

const require = createRequire(import.meta.url);
const { createProtocolHandler } = require('../protocol.cjs') as {
  createProtocolHandler: (directory: string, fetcher: typeof fetch, storage?: unknown, clipboard?: { write: (formats: { text: string; html: string }) => void | Promise<void>; readText?: () => string | Promise<string> }, windows?: { openSettings: (section: string) => Promise<void> }) => (request: Request) => Promise<Response>;
};

describe('desktop protocol', () => {
  it('awaits asynchronous clipboard errors instead of returning a false success', async () => {
    const handler = createProtocolHandler('D:/app/dist', vi.fn(), undefined, { write: vi.fn().mockRejectedValue(new Error('原生提交失败')) });
    const response = await handler(new Request('app://caudalflow/api/clipboard', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ text: '引用', html: '引用' }) }));
    expect(response.status).toBe(502); expect((await response.json()).error.message).toBe('原生提交失败');
  });
  it('reports a failed native clipboard write instead of claiming it copied successfully', async () => {
    const handler = createProtocolHandler('D:/app/dist', vi.fn(), undefined, { write: vi.fn(), readText: () => '仍是原剪切板内容' });
    const response = await handler(new Request('app://caudalflow/api/clipboard', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ text: '新引用', html: '<div>新引用</div>' }) }));
    expect(response.status).toBe(502); expect((await response.json()).error.message).toContain('剪切板未写入');
  });

  it('opens a dedicated settings window through an explicit same-origin action', async () => {
    const windows = { openSettings: vi.fn().mockResolvedValue(undefined) };
    const handler = createProtocolHandler('D:/app/dist', vi.fn(), undefined, undefined, windows);
    const response = await handler(new Request('app://caudalflow/api/settings-window', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ section: 'prompts' }) }));
    expect(response.status).toBe(200); expect(windows.openSettings).toHaveBeenCalledWith('prompts');
  });
  it('writes readable text and reference metadata together without allowing clipboard reads', async () => {
    const clipboard = { write: vi.fn() };
    const handler = createProtocolHandler('D:/app/dist', vi.fn(), undefined, clipboard);
    const formats = { text: '可读引用', html: '<div data-caudalflow-reference="metadata">可读引用</div>' };
    const request = (origin: string) => new Request('app://caudalflow/api/clipboard', { method: 'POST', headers: { 'Content-Type': 'application/json', Origin: origin }, body: JSON.stringify(formats) });
    expect((await handler(request('app://caudalflow'))).status).toBe(200);
    expect(clipboard.write).toHaveBeenCalledWith(formats);
    expect((await handler(request('https://unrelated.example'))).status).toBe(403);
    expect((await handler(new Request('app://caudalflow/api/clipboard'))).status).toBe(405);
    expect(clipboard.write).toHaveBeenCalledTimes(1);
  });
  it('forwards API authentication and preserves the response stream without browser headers', async () => {
    const reply = new Response('data: reply\n\n', { headers: { 'content-type': 'text/event-stream' } });
    const remote = vi.fn().mockResolvedValue(reply);
    const handler = createProtocolHandler('D:/app/dist', remote);
    const request = new Request(`app://caudalflow/api/proxy?url=${encodeURIComponent('http://localhost:1234/v1/chat/completions')}`, { method: 'POST', headers: { Authorization: 'Bearer test', 'Content-Type': 'application/json', Cookie: 'do-not-forward', Origin: 'app://caudalflow' }, body: '{"stream":true}' });
    expect(await handler(request)).toBe(reply);
    const [url, options] = remote.mock.calls[0];
    expect(url).toBe('http://localhost:1234/v1/chat/completions');
    expect(options.headers.get('authorization')).toBe('Bearer test');
    expect(options.headers.has('cookie')).toBe(false);
    expect(options.headers.has('origin')).toBe(false);
    expect(new TextDecoder().decode(options.body)).toBe('{"stream":true}');
    expect(options.redirect).toBe('error');
  });

  it('rejects attempts to proxy local files', async () => {
    const remote = vi.fn();
    const handler = createProtocolHandler('D:/app/dist', remote);
    expect((await handler(new Request('app://caudalflow/api/proxy?url=file%3A%2F%2F%2FC%3A%2Fsecret'))).status).toBe(400);
    expect(remote).not.toHaveBeenCalled();
  });

  it('rejects file paths outside the bundled UI directory', async () => {
    const remote = vi.fn();
    const handler = createProtocolHandler('D:/app/dist', remote);
    expect((await handler(new Request('app://caudalflow/%2e%2e%5csecret.txt'))).status).toBe(403);
    expect(remote).not.toHaveBeenCalled();
  });

  it('rejects requests initiated by an unrelated webpage', async () => {
    const remote = vi.fn();
    const handler = createProtocolHandler('D:/app/dist', remote);
    const request = Object.assign(new Request('app://caudalflow/'), { initiatorOrigin: 'https://example.com' });
    expect((await handler(request)).status).toBe(403);
    expect(remote).not.toHaveBeenCalled();
  });

  it('serves the bundled index with a content security policy', async () => {
    const remote = vi.fn().mockResolvedValue(new Response('<html></html>', { headers: { 'content-type': 'text/html' } }));
    const handler = createProtocolHandler('D:/app/dist', remote);
    const reply = await handler(new Request('app://caudalflow/'));
    expect(reply.headers.get('content-security-policy')).toContain("script-src 'self'");
    expect(await reply.text()).toBe('<html></html>');
  });

  it('reports unavailable Agent functionality without serving HTML as an API response', async () => {
    const remote = vi.fn();
    const handler = createProtocolHandler('D:/app/dist', remote);
    expect((await handler(new Request('app://caudalflow/api/agent', { method: 'POST' }))).status).toBe(503);
    expect(remote).not.toHaveBeenCalled();
  });
});
