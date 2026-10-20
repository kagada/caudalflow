import type { ContentReference } from '../types/chat';
import { isSqliteStorage } from './storage/client';
import { isAndroid } from './platform';

const ATTRIBUTE = 'data-caudalflow-reference';
const escape = (text: string) => text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

// HTML 元信息供本软件恢复引用；纯文字供其他编辑器正常粘贴，不输出内部 JSON。
export function referenceClipboardFormats(reference: ContentReference) {
  const text = reference.quote || reference.summary;
  return { text, html: `<div ${ATTRIBUTE}="${encodeURIComponent(JSON.stringify({ type: 'caudalflow-reference', version: 1, reference }))}"><pre>${escape(text)}</pre></div>` };
}

export async function copyReference(reference: ContentReference): Promise<void> {
  const formats = referenceClipboardFormats(reference);
  if (isAndroid()) {
    await (await import('./storage/androidBridge')).WorkspaceFiles.writeClipboard(formats);
  } else if (isSqliteStorage()) {
    const response = await fetch('/api/clipboard', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(formats) });
    const result = await response.json();
    if (!response.ok || !result.ok) throw new Error(result.error?.message ?? '未能确认引用写入剪切板，请重试');
  } else {
    if (!navigator.clipboard?.write || typeof ClipboardItem === 'undefined') throw new Error('当前浏览器不支持带来源的复制，请使用桌面版或新版浏览器');
    await navigator.clipboard.write([new ClipboardItem({ 'text/plain': new Blob([formats.text], { type: 'text/plain' }), 'text/html': new Blob([formats.html], { type: 'text/html' }) })]);
  }
  window.dispatchEvent(new Event('caudalflow:reference-copied'));
}

// 剪切板属于外部输入，只读取已校验的数据，不执行或插入其中的 HTML。
export function readReferenceClipboard(html: string): ContentReference | null {
  if (!html || html.length > 8 * 1024 * 1024) return null;
  const value = new DOMParser().parseFromString(html, 'text/html').querySelector(`[${ATTRIBUTE}]`)?.getAttribute(ATTRIBUTE);
  if (!value) return null;
  try {
    const payload = JSON.parse(decodeURIComponent(value));
    const item = payload.reference;
    const short = (entry: unknown) => typeof entry === 'string' && entry.length <= 1000;
    if (payload.type !== 'caudalflow-reference' || payload.version !== 1 || !item || !short(item.id) || !/^[A-Za-z0-9_-]{22}$/.test(item.snapshotKey) ||
      typeof item.summary !== 'string' || item.summary.length > 200000 || typeof item.quote !== 'string' || item.quote.length > 2000000 ||
      !Number.isFinite(item.createdAt) || !Array.isArray(item.sources) || !item.sources.length || item.sources.length > 100) throw new Error();
    const sources = item.sources.map((source: ContentReference['sources'][number]) => {
      if (!source || !short(source.workspaceId) || !short(source.conversationId) || !short(source.documentId) || !short(source.title) ||
        (source.versionId !== undefined && (!Number.isSafeInteger(source.versionId) || source.versionId <= 0)) || typeof source.documentText !== 'string' || source.documentText.length > 2000000 ||
        !Number.isInteger(source.start) || !Number.isInteger(source.length) || source.start < 0 || source.length < 0 || source.start + source.length > source.documentText.length) throw new Error();
      if (source.images && (!Array.isArray(source.images) || source.images.some((image) => !image || typeof image.mimeType !== 'string' || !image.mimeType.startsWith('image/') || typeof image.base64 !== 'string' || !/^[A-Za-z0-9+/]*={0,2}$/.test(image.base64)))) throw new Error();
      return { workspaceId: source.workspaceId, conversationId: source.conversationId, documentId: source.documentId, versionId: source.versionId,
        title: source.title, documentText: source.documentText, start: source.start, length: source.length, ...(source.images ? { images: source.images.map(({ mimeType, base64 }) => ({ mimeType, base64 })) } : {}) };
    });
    let summaryInput: ContentReference['summaryInput'];
    if (item.summaryInput !== undefined) {
      if (!Array.isArray(item.summaryInput) || item.summaryInput.length > 10000) throw new Error();
      summaryInput = item.summaryInput.map((message: NonNullable<ContentReference['summaryInput']>[number]) => {
        if (!message || !['user', 'assistant'].includes(message.role) || typeof message.content !== 'string' || message.content.length > 2000000 ||
          (message.images && (!Array.isArray(message.images) || message.images.some((image) => !image || typeof image.mimeType !== 'string' || !image.mimeType.startsWith('image/') || typeof image.base64 !== 'string' || !/^[A-Za-z0-9+/]*={0,2}$/.test(image.base64))))) throw new Error();
        return { role: message.role, content: message.content, ...(message.images ? { images: message.images.map(({ mimeType, base64 }) => ({ mimeType, base64 })) } : {}) };
      });
    }
    return { id: item.id, snapshotKey: item.snapshotKey, summary: item.summary, quote: item.quote, createdAt: item.createdAt, sources, ...(summaryInput ? { summaryInput } : {}) };
  } catch { throw new Error('剪切板中的引用信息不完整，请重新复制引用'); }
}
