import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useChatStore } from '../../stores/chatStore';
import { useFlowStore } from '../../stores/flowStore';
import { streamChat } from '../llm';
import { reviseMessage } from '../messageActions';

vi.mock('../llm', () => ({ streamChat: vi.fn() }));
beforeEach(() => {
  vi.clearAllMocks();
  useChatStore.setState({ conversations: { node: { nodeId: 'node', isStreaming: false, messages: [
    { id: 'q1', role: 'user', content: '第一个问题', timestamp: 1 },
    { id: 'a1', role: 'assistant', content: '旧回答', timestamp: 2 },
    { id: 'q2', role: 'user', content: '后续问题', timestamp: 3 },
    { id: 'a2', role: 'assistant', content: '后续回答', timestamp: 4 },
  ] } } });
  useFlowStore.setState({ nodes: [], edges: [], activeNodeId: null });
});

describe('message revision', () => {
  it('regenerates a historical answer using only earlier context and retains later messages', () => {
    reviseMessage('node', 'a1', undefined, new AbortController().signal);
    const [context, callbacks] = vi.mocked(streamChat).mock.calls[0];
    expect(context.map((message) => message.content)).not.toContain('后续问题');
    expect(context.at(-1)?.content).toBe('第一个问题');
    callbacks.onToken('新回答');
    callbacks.onReasoning?.('思考');
    callbacks.onDone();
    const messages = useChatStore.getState().getMessages('node');
    expect(messages[1]).toMatchObject({ id: 'a1', content: '新回答', reasoning: '思考', previousVersions: [{ content: '旧回答', timestamp: 2 }] });
    expect(messages.slice(2).map((message) => message.content)).toEqual(['后续问题', '后续回答']);
  });

  it('regenerates the answer to the clicked user question', () => {
    reviseMessage('node', 'q1', undefined, new AbortController().signal);
    expect(useChatStore.getState().conversations.node.streamingMessageId).toBe('a1');
    vi.mocked(streamChat).mock.calls[0][1].onToken('替换回答');
    expect(useChatStore.getState().getMessages('node')[1].content).toBe('替换回答');
  });

  it('includes a custom rewrite prompt and the original answer', () => {
    reviseMessage('node', 'a1', '保留例子', new AbortController().signal);
    expect(vi.mocked(streamChat).mock.calls[0][0].at(-1)?.content).toContain('保留例子');
    expect(vi.mocked(streamChat).mock.calls[0][0].at(-1)?.content).toContain('旧回答');
  });

  it('restores the original answer if cancelled before receiving text', () => {
    const controller = new AbortController();
    reviseMessage('node', 'a1', undefined, controller.signal);
    controller.abort();
    expect(useChatStore.getState().getMessages('node')[1].content).toBe('旧回答');
  });

  it('does not start another request while the conversation is streaming', () => {
    useChatStore.getState().setStreaming('node', true);
    reviseMessage('node', 'a1', undefined, new AbortController().signal);
    expect(streamChat).not.toHaveBeenCalled();
  });
});
