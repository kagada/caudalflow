import { describe, expect, it } from 'vitest';
import type { WorkspaceData } from '../../../types/workspace';
import { buildHistoryView } from '../historyView';

function workspace(): WorkspaceData {
  return { nodes: [{ id: 'c1', type: 'chat', position: { x: 0, y: 0 }, data: { topic: '会话一' } }, { id: 'c2', type: 'chat', position: { x: 10, y: 0 }, data: { topic: '未修改会话' } }], edges: [], conversations: { c1: { nodeId: 'c1', messages: [{ id: 'q1', role: 'user', content: '问题一', timestamp: 1 }, { id: 'a1', role: 'assistant', content: '[标题](https://old.example)', replyToId: 'q1', timestamp: 2 }], isStreaming: false }, c2: { nodeId: 'c2', messages: [], isStreaming: false } } };
}
const detail = (before: WorkspaceData, after: WorkspaceData) => ({ id: 'h1', label: '修改', createdAt: 1, bytes: 10, before, after });

describe('affected objects in one history operation', () => {
  it('shows only affected conversations and groups a question with its reply', () => {
    const before = workspace(); const after = structuredClone(before); after.conversations.c1.messages[1].content = '[标题](https://new.example)';
    const view = buildHistoryView(detail(before, after));
    expect(view).toHaveLength(1); expect(view[0].id).toBe('c1');
    expect(view[0].items).toHaveLength(1);
    expect(view[0].items[0]).toMatchObject({ inferred: false, selection: { documentIds: ['q1', 'a1'] } });
    expect(view[0].items[0].sections.map((section) => section.title)).toEqual(['问题', '回复文档']);
  });

  it('keeps deleted old questions paired across both sides and marks inference', () => {
    const before = workspace(); delete before.conversations.c1.messages[1].replyToId;
    const after = structuredClone(before); after.conversations.c1.messages.shift();
    const item = buildHistoryView(detail(before, after))[0].items[0];
    expect(item.inferred).toBe(true); expect(item.selection.documentIds).toEqual(['q1', 'a1']);
    expect(item.sections.find((section) => section.id === 'q1')?.after).toBeUndefined();
  });

  it('detects image-only and reasoning changes without diffing Base64 as text', () => {
    const before = workspace(); const after = structuredClone(before);
    after.conversations.c1.messages[0].images = [{ mimeType: 'image/png', base64: 'aGVsbG8=' }];
    after.conversations.c1.messages[1].reasoning = '新思考';
    const item = buildHistoryView(detail(before, after))[0].items[0];
    expect(item.sections[0].after?.images).toHaveLength(1);
    expect(item.sections[0].afterText).toBe('问题一');
    expect(item.sections.some((section) => section.afterText === '新思考')).toBe(true);
  });

  it('ignores layout and version IDs but exposes changed labels and done state', () => {
    const before = workspace(); const after = structuredClone(before);
    after.nodes[0].position.x = 800; after.nodes[0].data.collapsed = true; after.conversations.c1.messages[1].versionId = 2;
    expect(buildHistoryView(detail(before, after))).toEqual([]);
    after.nodes[0].data.label = '标签'; after.nodes[0].data.done = true;
    const items = buildHistoryView(detail(before, after))[0].items;
    expect(items).toHaveLength(1); expect(items[0].selection).toEqual({ attributesOnly: true });
    expect(items[0].sections[0].afterText).toContain('搞定状态');
  });

  it('does not attach an explicitly orphaned answer to a different question', () => {
    const before = workspace(); before.conversations.c1.messages[1].replyToId = 'deleted-question';
    const after = structuredClone(before); after.conversations.c1.messages[1].content = '修改孤立回答';
    const item = buildHistoryView(detail(before, after))[0].items[0];
    expect(item.title).toContain('问题已不在记录中'); expect(item.selection.documentIds).toEqual(['a1']);
  });

  it('selects only changed relationships for a partial restore', () => {
    const before = workspace(); before.edges = [{ id: 'e1', source: 'c1', target: 'c2', data: { label: '旧关系' } }, { id: 'e2', source: 'c2', target: 'c1', data: { label: '不变关系' } }];
    const after = structuredClone(before); after.edges[0].data!.label = '新关系';
    const item = buildHistoryView(detail(before, after))[0].items.find((entry) => entry.title === '会话关系');
    expect(item?.selection).toEqual({ relationIds: ['e1'] });
  });
});
