/** @vitest-environment jsdom */
import { describe, expect, it } from 'vitest';
import { sampleReference } from './referenceFixtures';
import { readReferenceClipboard, referenceClipboardFormats } from '../referenceClipboard';

describe('reference clipboard formats', () => {
  it('round trips the snapshot through HTML and offers readable plain text', () => {
    const reference = sampleReference(); reference.quote = '<script>bad()</script> & "引文"';
    const formats = referenceClipboardFormats(reference);
    expect(readReferenceClipboard(formats.html)).toEqual(reference);
    expect(formats.text).toContain('背景摘要'); expect(formats.text).not.toContain('snapshotKey');
    expect(new DOMParser().parseFromString(formats.html, 'text/html').querySelector('script')).toBeNull();
  });
  it('does not treat normal HTML as a reference and rejects malformed or invalid source ranges', () => {
    expect(readReferenceClipboard('<table><tr><td>普通表格</td></tr></table>')).toBeNull();
    const reference = sampleReference(); reference.sources[0].start = 999;
    expect(() => readReferenceClipboard(referenceClipboardFormats(reference).html)).toThrow('不完整');
    expect(() => readReferenceClipboard('<div data-caudalflow-reference="%ZZ"></div>')).toThrow('不完整');
  });
});
