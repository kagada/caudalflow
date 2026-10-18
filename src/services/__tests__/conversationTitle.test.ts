/** @vitest-environment jsdom */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useChatStore } from '../../stores/chatStore';
import { useFlowStore } from '../../stores/flowStore';
import { prepareFirstQuestion } from '../conversationTitle';
import { generateTitle } from '../llm';
import { recordFirstQuestion } from '../storage/runtime';

vi.mock('../llm', () => ({ generateTitle: vi.fn() }));
vi.mock('../storage/runtime', () => ({ recordFirstQuestion: vi.fn() }));
vi.mock('../storage/desktop', () => ({ isDesktopStorage: () => true }));

beforeEach(() => {
  vi.clearAllMocks();
  useFlowStore.setState({ nodes: [{ id: 'c1', type: 'chat', position: { x: 0, y: 0 }, data: { topic: '新建对话', titleSource: 'pending' } }], edges: [] });
  useChatStore.setState({ conversations: { c1: { nodeId: 'c1', isStreaming: false, messages: [{ id: 'q1', role: 'user', content: '为什么这个分支的标题不正确？\n请帮我分析', timestamp: 1 }] } } });
});

describe('first question naming', () => {
  it('sets a temporary title immediately, passes branch context and accepts the background title while streaming', async () => {
    prepareFirstQuestion('c1', '父会话：数据存储结构');
    expect(useFlowStore.getState().nodes[0].data.topic).toBe('为什么这个分支的标题不正确？ 请帮我分析');
    expect(recordFirstQuestion).toHaveBeenCalledWith('c1');
    useChatStore.getState().addMessage('c1', 'assistant', '');
    useChatStore.getState().setStreaming('c1', true);
    await Promise.resolve();
    expect(generateTitle).toHaveBeenCalledWith(expect.any(String), '父会话：数据存储结构', expect.any(Function), { nodeId: 'c1' });
    vi.mocked(generateTitle).mock.calls[0][2]('分支标题命名');
    expect(useFlowStore.getState().nodes[0].data).toMatchObject({ topic: '分支标题命名', titleSource: 'generated' });
    expect(useChatStore.getState().conversations.c1.isStreaming).toBe(true);
  });

  it('preserves a manual rename even if its text matches the temporary title', async () => {
    prepareFirstQuestion('c1', ''); await Promise.resolve();
    useFlowStore.getState().updateNodeData('c1', { topic: useFlowStore.getState().nodes[0].data.topic });
    vi.mocked(generateTitle).mock.calls[0][2]('晚到标题');
    expect(useFlowStore.getState().nodes[0].data.titleSource).toBe('manual');
    expect(useFlowStore.getState().nodes[0].data.topic).not.toBe('晚到标题');
  });

  it('does not rename a manually named empty conversation', async () => {
    useFlowStore.getState().updateNodeData('c1', { topic: '我的标题' });
    prepareFirstQuestion('c1', ''); await Promise.resolve();
    expect(generateTitle).not.toHaveBeenCalled();
    expect(recordFirstQuestion).toHaveBeenCalledWith('c1');
    expect(useFlowStore.getState().nodes[0].data.topic).toBe('我的标题');
  });

  it('ignores deleted or replaced questions and does not rename on later questions', async () => {
    prepareFirstQuestion('c1', ''); await Promise.resolve();
    useChatStore.getState().setConversationMessages('c1', [{ id: 'replacement', role: 'user', content: '其他问题', timestamp: 2 }]);
    vi.mocked(generateTitle).mock.calls[0][2]('旧问题的标题');
    expect(useFlowStore.getState().nodes[0].data.titleSource).toBe('temporary');
    useChatStore.getState().addMessage('c1', 'user', '第二问');
    prepareFirstQuestion('c1', ''); await Promise.resolve();
    expect(generateTitle).toHaveBeenCalledTimes(1);
    useFlowStore.getState().removeNode('c1');
    expect(() => vi.mocked(generateTitle).mock.calls[0][2]('已删除')).not.toThrow();
  });

  it('keeps a useful fallback for image-only questions if title generation fails', async () => {
    useChatStore.getState().setConversationMessages('c1', [{ id: 'q1', role: 'user', content: '', timestamp: 1, images: [{ mimeType: 'image/png', base64: 'aA==' }] }]);
    prepareFirstQuestion('c1', ''); await Promise.resolve();
    expect(useFlowStore.getState().nodes[0].data.topic).toBe('图片提问');
  });
});
