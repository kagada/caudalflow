import { createRequire } from 'node:module';
import { describe, expect, it, vi } from 'vitest';

const require = createRequire(import.meta.url);
const { createReferenceClipboard } = require('../clipboard.cjs');

describe('Electron 44 reference clipboard adapter', () => {
  it('uses ClipboardItem[] with text and HTML blobs and awaits the native commit', async () => {
    class Item { constructor(public formats: Record<string, Blob>) {} }
    let commit!: () => void;
    const native = { write: vi.fn().mockImplementation(() => new Promise<void>((resolve) => { commit = resolve; })), readText: vi.fn().mockResolvedValue('选中原文') };
    const adapter = createReferenceClipboard(native, Item);
    let finished = false;
    const result = adapter.write({ text: '选中原文', html: '<div data-caudalflow-reference="test">选中原文</div>' }).then(() => { finished = true; });
    const items = native.write.mock.calls[0][0];
    expect(Array.isArray(items)).toBe(true); expect(items[0]).toBeInstanceOf(Item);
    expect(await items[0].formats['text/plain'].text()).toBe('选中原文');
    expect(await items[0].formats['text/html'].text()).toContain('data-caudalflow-reference');
    expect(finished).toBe(false); commit(); await result; expect(finished).toBe(true);
    expect(await adapter.readText()).toBe('选中原文');
  });
});
