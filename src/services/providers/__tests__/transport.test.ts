import { afterEach, describe, expect, it, vi } from 'vitest';
import { apiFetch } from '../transport';

afterEach(() => vi.unstubAllGlobals());

describe('API transport', () => {
  it('uses a desktop-internal route while retaining request options', async () => {
    vi.stubGlobal('window', { location: { protocol: 'app:', hostname: 'caudalflow' } });
    const request = vi.fn().mockResolvedValue(new Response('OK'));
    vi.stubGlobal('fetch', request);
    const options = { method: 'POST', body: 'request' };
    await apiFetch('https://example.com/v1/chat/completions', options);
    expect(request).toHaveBeenCalledWith('app://caudalflow/api/proxy?url=https%3A%2F%2Fexample.com%2Fv1%2Fchat%2Fcompletions', options);
  });

  it('continues direct API requests in the web version', async () => {
    const request = vi.fn().mockResolvedValue(new Response('OK'));
    vi.stubGlobal('fetch', request);
    await apiFetch('https://example.com/v1/models');
    expect(request).toHaveBeenCalledWith('https://example.com/v1/models', undefined);
  });
});
