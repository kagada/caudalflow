/// <reference types="node" />
/** @vitest-environment jsdom */
import { webcrypto } from 'node:crypto';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useChatStore } from '../../stores/chatStore';
import { useFlowStore } from '../../stores/flowStore';
import { useWorkspaceStore } from '../../stores/workspaceStore';
import { addQuestionWithReferences, createReference, modelMessages, resolveReference } from '../references';
import { conversationSystemPrompt } from '../conversationContext';

const provider = vi.hoisted(() => ({ streamChat: vi.fn(), prompt: undefined as string | undefined }));
vi.mock('../providers/registry', () => ({ getProvider: () => provider }));
vi.mock('../../stores/settingsStore', () => ({ useSettingsStore: { getState: () => ({ builtinPrompts: { referenceSummary: provider.prompt }, llmConfig: { providerId: 'test', model: 'test', endpoint: 'local' } }) } }));
vi.mock('../storage/desktop', () => ({ isDesktopStorage: () => false }));
vi.mock('../storage/runtime', () => ({ flushDesktopStorage: vi.fn() }));
let serial = 0;
beforeEach(() => {
  vi.clearAllMocks(); vi.stubGlobal('crypto', webcrypto); serial++;
  provider.prompt = undefined;
  provider.streamChat.mockImplementation((_messages, _config, callbacks) => { callbacks.onToken('完整知识背景摘要'); callbacks.onDone(); });
  useWorkspaceStore.setState({ activeWorkspaceId: 'w1' });
  useFlowStore.setState({ nodes: [{ id: 'parent', type: 'chat', position: { x: 0, y: 0 }, data: { topic: '学习来源' } }], edges: [] });
  useChatStore.setState({ conversations: { parent: { nodeId: 'parent', isStreaming: false, messages: [
    { id: 'q1', role: 'user', content: `问题 ${serial}`, timestamp: 1 },
    { id: 'a1', versionId: 1, role: 'assistant', content: '第一段知识。后半段重要结论。', timestamp: 2 },
    { id: 'q2', role: 'user', content: '之后的问题不应进入摘要', timestamp: 3 },
    { id: 'a2', role: 'assistant', content: '之后的回答不应进入摘要', timestamp: 4 },
  ] } } });
});

describe('independent reference snapshots', () => {
  it('copies without contacting the model and resolves the captured background after switching workspaces', async () => {
    const reference = await createReference('parent', [{ documentId: 'a1', text: '重要结论' }], { deferSummary: true });
    expect(provider.streamChat).not.toHaveBeenCalled();
    expect(reference.summaryInput?.length).toBe(2);
    useChatStore.getState().removeConversation('parent');
    useWorkspaceStore.setState({ activeWorkspaceId: 'w2' });
    const resolved = await resolveReference(reference);
    expect(resolved.summary).toBe('完整知识背景摘要'); expect(resolved.quote).toBe('重要结论');
    expect(resolved.sources[0].workspaceId).toBe('w1'); expect(resolved.summaryInput).toBeUndefined();
  });

  it('includes prompt changes in the cache key and retries oversized summaries without saving oversized results', async () => {
    const draft = await createReference('parent', undefined, { deferSummary: true });
    const first = await resolveReference(draft);
    provider.prompt = '请压缩为短摘要，最多 {{maxChars}} 字。';
    provider.streamChat.mockImplementationOnce((_messages, _config, callbacks) => { callbacks.onToken('长'.repeat(1001)); callbacks.onDone(); });
    const second = await resolveReference(draft);
    expect(first.snapshotKey).not.toBe(second.snapshotKey);
    expect(provider.streamChat).toHaveBeenCalledTimes(3);
    expect(provider.streamChat.mock.calls[2][0][0].content).toContain('上次结果过长');
    expect(second.summary).toBe('完整知识背景摘要');
  });

  it('rejects an uncompressed result after one retry and permits retrying the original snapshot', async () => {
    const draft = await createReference('parent', undefined, { deferSummary: true });
    provider.streamChat.mockImplementation((_messages, _config, callbacks) => { callbacks.onToken('长'.repeat(1001)); callbacks.onDone(); });
    await expect(resolveReference(draft)).rejects.toThrow('仍超过 1000 字');
    expect(provider.streamChat).toHaveBeenCalledTimes(2);
    expect(draft.summaryInput).toBeDefined();
  });

  it.each([500, 600, 1000])('accepts a %i-character summary with a 500-character target and 1000-character limit', async (length) => {
    provider.prompt = '只输出背景摘要。';
    const summary = '摘'.repeat(length);
    provider.streamChat.mockImplementationOnce((_messages, _config, callbacks) => { callbacks.onToken(summary); callbacks.onDone(); });
    const reference = await createReference('parent');
    expect(reference.summary).toBe(summary);
    expect(provider.streamChat).toHaveBeenCalledTimes(1);
    const [messages, config] = provider.streamChat.mock.calls[0];
    expect(messages[0].content).toContain('目标约 500 字');
    expect(messages[0].content).toContain('最多 1000 字');
    expect(config.maxTokens).toBe(3000);
  });

  it('accepts compression to a result above the target but within the hard limit', async () => {
    const summary = '摘'.repeat(800);
    provider.streamChat.mockImplementationOnce((_messages, _config, callbacks) => { callbacks.onToken('长'.repeat(1001)); callbacks.onDone(); });
    provider.streamChat.mockImplementationOnce((_messages, _config, callbacks) => { callbacks.onToken(summary); callbacks.onDone(); });
    expect((await createReference('parent')).summary).toBe(summary);
    expect(provider.streamChat).toHaveBeenCalledTimes(2);
    expect(provider.streamChat.mock.calls[1][0][0].content).toContain('压缩至约 500 字，最多 1000 字');
  });

  it('records summary and compression requests in the target workspace and reuses cached summaries', async () => {
    const reference = await createReference('parent', undefined, { deferSummary: true });
    useWorkspaceStore.setState({ activeWorkspaceId: 'w2' }); useChatStore.getState().initConversation('target');
    provider.streamChat.mockImplementationOnce((_messages, _config, callbacks) => { callbacks.onUsage({ inputTokens: 100, outputTokens: 1001, cachedInputTokens: 50 }); callbacks.onToken('长'.repeat(1001)); callbacks.onDone(); });
    provider.streamChat.mockImplementationOnce((_messages, _config, callbacks) => { callbacks.onUsage({ inputTokens: 1001, outputTokens: 500 }); callbacks.onToken('摘'.repeat(500)); callbacks.onDone(); });
    await resolveReference(reference, { nodeId: 'target' });
    await resolveReference(reference, { nodeId: 'target' });
    const usage = useChatStore.getState().conversations.target.usage!;
    expect(usage.map((record) => record.purpose)).toEqual(['reference_summary', 'summary_compression']);
    expect(usage.map((record) => record.inputTokens)).toEqual([100, 1001]);
    expect(useChatStore.getState().conversations.parent.usage).toBeUndefined();
    expect(provider.streamChat).toHaveBeenCalledTimes(2);
  });
  it('summarizes complete documents up to the selected answer and shares the cache across selections', async () => {
    const a = await createReference('parent', [{ documentId: 'a1', text: '第一段知识' }]);
    const b = await createReference('parent', [{ documentId: 'a1', text: '重要结论' }]);
    expect(provider.streamChat).toHaveBeenCalledTimes(1);
    const request = provider.streamChat.mock.calls[0][0];
    expect(request.map((message: { content: string }) => message.content).join('\n')).toContain('后半段重要结论');
    expect(request.map((message: { content: string }) => message.content).join('\n')).not.toContain('之后的问题');
    expect(a.snapshotKey).toBe(b.snapshotKey); expect(a.quote).not.toBe(b.quote);
    expect(a.sources[0]).toMatchObject({ documentId: 'a1', versionId: 1, start: 0, length: 5 });
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
    useChatStore.getState().setConversationMessages('parent', messages.map((message) => message.id === 'a1' ? { ...message, versionId: 2, content: '已修正的新知识' } : message));
    const b = await createReference('parent', [{ documentId: 'a1', text: '新知识' }]);
    expect(a.snapshotKey).not.toBe(b.snapshotKey); expect(provider.streamChat).toHaveBeenCalledTimes(2);
    expect(a.sources[1].versionId).toBe(1); expect(b.sources[0].versionId).toBe(2);
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
