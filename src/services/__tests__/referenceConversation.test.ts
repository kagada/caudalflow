/** @vitest-environment jsdom */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useChatStore } from '../../stores/chatStore';
import { useWorkspaceStore } from '../../stores/workspaceStore';
import { startReferenceConversation, cancelReferenceConversation } from '../referenceConversation';
import type { ContentReference } from '../../types/chat';

vi.hoisted(() => { window.matchMedia = vi.fn().mockReturnValue({ matches: false, addEventListener: vi.fn() }); });
const fake = vi.hoisted(() => ({ resolve: vi.fn(), stream: vi.fn() }));
vi.mock('../references', async (original) => ({ ...await original<typeof import('../references')>(), resolveReference: fake.resolve }));
vi.mock('../llm', () => ({ streamChat: fake.stream }));
vi.mock('../conversationTitle', () => ({ prepareFirstQuestion: vi.fn() }));

const reference: ContentReference = { id: 'r', snapshotKey: 'key', summary: '', quote: '选中原文', sources: [], createdAt: 0,
  summaryInput: [{ role: 'assistant', content: '背景原文' }] };
beforeEach(() => {
  vi.clearAllMocks();
  useWorkspaceStore.setState({ activeWorkspaceId: 'w' });
  useChatStore.setState({ conversations: { child: { nodeId: 'child', messages: [], isStreaming: false } } });
});

describe('branch initialization stays responsive while summarizing', () => {
  it('shows reference and question before a slow summary and waits to send the complete context', async () => {
    let resolve!: (value: ContentReference) => void;
    fake.resolve.mockImplementation(() => new Promise((done) => { resolve = done; }));
    startReferenceConversation('child', '为什么', [reference]);
    expect(useChatStore.getState().getMessages('child').map((message) => message.kind ?? message.role)).toEqual(['reference', 'user', 'assistant']);
    expect(useChatStore.getState().conversations.child.isStreaming).toBe(true);
    expect(fake.stream).not.toHaveBeenCalled();
    resolve({ ...reference, summary: '准备完毕的摘要', summaryInput: undefined });
    await vi.waitFor(() => expect(fake.stream).toHaveBeenCalledOnce());
    const messages = fake.stream.mock.calls[0][0];
    expect(messages[1].reference.summary).toBe('准备完毕的摘要');
    expect(messages.at(-1).role).toBe('user');
    fake.stream.mock.calls[0][1].onDone();
    expect(useChatStore.getState().conversations.child.isStreaming).toBe(false);
  });

  it('does not send a late answer after the user stops preparation or switches workspaces', async () => {
    let resolve!: (value: ContentReference) => void;
    fake.resolve.mockImplementation(() => new Promise((done) => { resolve = done; }));
    startReferenceConversation('child', '为什么', [reference]);
    cancelReferenceConversation('child');
    useWorkspaceStore.setState({ activeWorkspaceId: 'other' });
    resolve({ ...reference, summary: '晚到摘要', summaryInput: undefined });
    await new Promise((done) => setTimeout(done, 0));
    expect(fake.stream).not.toHaveBeenCalled();
    expect(useChatStore.getState().getMessages('child').at(-1)?.content).toBe('');
  });
});
