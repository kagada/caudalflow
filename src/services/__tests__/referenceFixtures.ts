import type { ContentReference } from '../../types/chat';

export function sampleReference(): ContentReference {
  return { id: 'ref', snapshotKey: 'a'.repeat(22), summary: '背景摘要', quote: '具体原文', createdAt: 1,
    sources: [{ workspaceId: 'w1', conversationId: 'parent', documentId: 'a1', versionId: 1, title: '来源标题', documentText: '具体原文', start: 0, length: 4 }] };
}
