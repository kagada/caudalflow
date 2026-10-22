/** @vitest-environment jsdom */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { sampleReference } from './referenceFixtures';
import { copyReference, readReferenceClipboard, referenceClipboardFormats } from '../referenceClipboard';
vi.mock('../storage/client', () => ({ isSqliteStorage: () => true }));
afterEach(() => vi.unstubAllGlobals());

describe('reference clipboard formats', () => {
  it('awaits the desktop clipboard result and exposes native failures', async () => {
    const fetcher = vi.fn().mockResolvedValueOnce(new Response(JSON.stringify({ error: { message: '原生提交失败' } }), { status: 502 })).mockResolvedValueOnce(new Response('{"ok":true}'));
    vi.stubGlobal('fetch', fetcher);
    await expect(copyReference(sampleReference())).rejects.toThrow('原生提交失败');
    await expect(copyReference(sampleReference())).resolves.toBeUndefined();
    expect(JSON.parse(fetcher.mock.calls[1][1].body).text).toBe('具体原文');
  });
  it('preserves deferred background snapshots across workspace-independent copy and paste', () => {
    const reference = sampleReference(); reference.summary = ''; reference.summaryInput = [{ role: 'user', content: '复制时的完整背景' }];
    const formats = referenceClipboardFormats(reference);
    expect(formats.text).toBe('具体原文');
    expect(readReferenceClipboard(formats.html)?.summaryInput).toEqual(reference.summaryInput);
  });
  it('round trips the snapshot through HTML and offers readable plain text', () => {
    const reference = sampleReference(); reference.quote = '<script>bad()</script> & "引文"';
    const formats = referenceClipboardFormats(reference);
    expect(readReferenceClipboard(formats.html)).toEqual(reference);
    expect(formats.text).toBe(reference.quote); expect(formats.text).not.toContain('snapshotKey');
    expect(new DOMParser().parseFromString(formats.html, 'text/html').querySelector('script')).toBeNull();
  });
  it('does not treat normal HTML as a reference and rejects malformed or invalid source ranges', () => {
    expect(readReferenceClipboard('<table><tr><td>普通表格</td></tr></table>')).toBeNull();
    const reference = sampleReference(); reference.sources[0].start = 999;
    expect(() => readReferenceClipboard(referenceClipboardFormats(reference).html)).toThrow('不完整');
    expect(() => readReferenceClipboard('<div data-caudalflow-reference="%ZZ"></div>')).toThrow('不完整');
  });

  it('keeps integer source versions and rejects invalid version identifiers', () => {
    const reference = sampleReference(); reference.sources[0].versionId = 37;
    expect(readReferenceClipboard(referenceClipboardFormats(reference).html)?.sources[0].versionId).toBe(37);
    for (const value of [0, -1, 1.5, Number.MAX_SAFE_INTEGER + 1, '37']) {
      const invalid = { ...reference, sources: [{ ...reference.sources[0], versionId: value }] };
      const html = `<div data-caudalflow-reference="${encodeURIComponent(JSON.stringify({ type: 'caudalflow-reference', version: 1, reference: invalid }))}"></div>`;
      expect(() => readReferenceClipboard(html)).toThrow('不完整');
    }
  });
});
