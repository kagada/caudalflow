/// <reference types="node" />
/** @vitest-environment jsdom */
import { webcrypto } from 'node:crypto';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useChatStore } from '../../stores/chatStore';
import { useFlowStore } from '../../stores/flowStore';
import { useWorkspaceStore } from '../../stores/workspaceStore';
import { addQuestionWithReferences, createReference, modelMessages } from '../references';
import { conversationSystemPrompt } from '../conversationContext';

const provider = vi.hoisted(() => ({ streamChat: vi.fn() }));
vi.mock('../providers/registry', () => ({ getProvider: () => provider }));
vi.mock('../../stores/settingsStore', () => ({ useSettingsStore: { getState: () => ({ llmConfig: { providerId: 'test', model: 'test', endpoint: 'local' } }) } }));
vi.mock('../storage/desktop', () => ({ isDesktopStorage: () => false }));
vi.mock('../storage/runtime', () => ({ flushDesktopStorage: vi.fn() }));
let serial = 0;
beforeEach(() => {
  vi.clearAllMocks(); vi.stubGlobal('crypto', webcrypto); serial++;
  provider.streamChat.mockImplementation((_messages, _config, callbacks) => { callbacks.onToken('完整知识背景摘要'); callbacks.onDone(); });
  useWorkspaceStore.setState({ activeWorkspaceId: 'w1' });
  useFlowStore.setState({ nodes: [{ id: 'parent', type: 'chat', position: { x: 0, y: 0 }, data: { topic: '学习来源' } }], edges: [] });
  useChatStore.setState({ conversations: { parent: { nodeId: 'parent', isStreaming: false, messages: [
    { id: 'q1', role: 'user', content: `问题 ${serial}`, timestamp: 1 },
    { id: 'a1', versionId: 'v1', role: 'assistant', content: '第一段知识。后半段重要结论。', timestamp: 2 },
    { id: 'q2', role: 'user', content: '之后的问题不应进入摘要', timestamp: 3 },
    { id: 'a2', role: 'assistant', content: '之后的回答不应进入摘要', timestamp: 4 },
  ] } } });
});

describe('independent reference snapshots', () => {
  it('summarizes complete documents up to the selected answer and shares the cache across selections', async () => {
    const a = await createReference('parent', [{ documentId: 'a1', text: '第一段知识' }]);
    const b = await createReference('parent', [{ documentId: 'a1', text: '重要结论' }]);
    expect(provider.streamChat).toHaveBeenCalledTimes(1);
    const request = provider.streamChat.mock.calls[0][0];
    expect(request.map((message: { content: string }) => message.content).join('\n')).toContain('后半段重要结论');
    expect(request.map((message: { content: string }) => message.content).join('\n')).not.toContain('之后的问题');
    expect(a.snapshotKey).toBe(b.snapshotKey); expect(a.quote).not.toBe(b.quote);
    expect(a.sources[0]).toMatchObject({ documentId: 'a1', versionId: 'v1', start: 0, length: 5 });
  });

  it('keeps old references unchanged after editing or deleting the source and inherits their background in grandchildren', async () => {
    const reference = await createReference('parent', [{ documentId: 'a1', text: '第一段知识' }]);
    useChatStore.getState().initConversation('child');
    addQuestionWithReferences('child', '为什么？', undefined, [reference]);
    useChatStore.getState().addMessage('child', 'assistant', '子回答');
    useFlowStore.setState({ nodes: [{ id: 'child', type: 'chat', position: { x: 0, y: 0 }, data: { topic: '子会话' } }] });
    useChatStore.getState().removeConversation('parent');
    const inherited = await createReference('child');
    const request = provider.streamChat.mock.calls.at(-1)![0];
    expect(JSON.stringify(request)).toContain('完整知识背景摘要');
    expect(JSON.stringify(request)).toContain('第一段知识');
    expect(inherited.sources[0].conversationId).toBe('child');
    expect(reference.sources[0].documentText).toBe('第一段知识。后半段重要结论。');
  });

  it('supports multi-document selections and changes the summary key only when background changes', async () => {
    const a = await createReference('parent', [{ documentId: 'q1', text: `问题 ${serial}` }, { documentId: 'a1', text: '重要结论' }]);
    expect(a.sources).toHaveLength(2);
    const messages = useChatStore.getState().getMessages('parent');
    useChatStore.getState().setConversationMessages('parent', messages.map((message) => message.id === 'a1' ? { ...message, versionId: 'v2', content: '已修正的新知识' } : message));
    const b = await createReference('parent', [{ documentId: 'a1', text: '新知识' }]);
    expect(a.snapshotKey).not.toBe(b.snapshotKey); expect(provider.streamChat).toHaveBeenCalledTimes(2);
    expect(a.sources[1].versionId).toBe('v1'); expect(b.sources[0].versionId).toBe('v2');
  });

  it('sends visible snapshots and original text without leaking source metadata or duplicate hidden system prompts', async () => {
    const reference = await createReference('parent');
    useChatStore.getState().initConversation('child');
    const questionId = addQuestionWithReferences('child', '继续问', undefined, [reference]);
    const messages = useChatStore.getState().getMessages('child');
    expect(messages.map((message) => message.kind ?? message.role)).toEqual(['reference', 'user']);
    expect(messages[0].referenceForId).toBe(questionId);
    const request = modelMessages([{ id: 'system', role: 'system', content: '正常系统提示', timestamp: 0 }, { id: 'old', role: 'system', content: '过时父会话提示', timestamp: 0 }, ...messages]);
    expect(request.map((message) => message.role)).toEqual(['system', 'user', 'user']);
    expect(JSON.stringify(request)).toContain(reference.quote);
    expect(JSON.stringify(request)).not.toContain('过时父会话提示');
    expect(JSON.stringify(request)).not.toContain('documentText');
  });

  it('does not cache failed summaries and retries without falling back to silent truncation', async () => {
    provider.streamChat.mockImplementationOnce((_messages, _config, callbacks) => callbacks.onError(new Error('离线')));
    await expect(createReference('parent')).rejects.toThrow('离线');
    await expect(createReference('parent')).resolves.toMatchObject({ summary: '完整知识背景摘要' });
    expect(provider.streamChat).toHaveBeenCalledTimes(2);
  });

  it('uses the selected paragraph to locate repeated text and keeps attached images in the source snapshot', async () => {
    const messages = useChatStore.getState().getMessages('parent');
    useChatStore.getState().setConversationMessages('parent', messages.map((message) => message.id === 'a1' ? { ...message, content: '重复\n\n重复', images: [{ mimeType: 'image/png', base64: 'aA==' }] } : message));
    const reference = await createReference('parent', [{ documentId: 'a1', text: '重复', start: 4, length: 2 }]);
    expect(reference.sources[0].start).toBe(4);
    expect(reference.sources[0].images).toEqual([{ mimeType: 'image/png', base64: 'aA==' }]);
  });

  it('freezes legacy branch prompts instead of silently rebuilding them from current parent content', () => {
    useChatStore.getState().initConversation('legacy');
    useChatStore.getState().addMessage('legacy', 'system', '创建时保存的背景');
    expect(conversationSystemPrompt('legacy')).toBe('创建时保存的背景');
    useChatStore.getState().removeConversation('parent');
    expect(conversationSystemPrompt('legacy')).toBe('创建时保存的背景');
  });

  it('gives reference-only sends an explicit question instead of an empty message bubble', async () => {
    const reference = await createReference('parent');
    useChatStore.getState().initConversation('child');
    addQuestionWithReferences('child', '', undefined, [reference]);
    expect(useChatStore.getState().getMessages('child').at(-1)?.content).toBe('请解释引用的内容。');
  });
});
