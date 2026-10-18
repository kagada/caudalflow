/** @vitest-environment jsdom */
import { beforeEach, describe, expect, it } from 'vitest';
import { trackRequestUsage } from '../requestUsage';
import { useChatStore } from '../../stores/chatStore';
import { useWorkspaceStore } from '../../stores/workspaceStore';
import { answerUsage, mergeUsage, sumUsage } from '../../utils/tokenUsage';
import type { LLMConfig } from '../../types/chat';

const config = { providerId: 'custom', model: 'test-model' } as LLMConfig;
beforeEach(() => {
  useWorkspaceStore.setState({ activeWorkspaceId: 'w1' });
  useChatStore.setState({ conversations: { c1: { nodeId: 'c1', isStreaming: false, messages: [{ id: 'a1', role: 'assistant', content: '', timestamp: 1 }] } } });
});

describe('request usage accounting', () => {
  it('updates one record from cumulative reports and retains it after deleting the answer', () => {
    const tracker = trackRequestUsage({ nodeId: 'c1', documentId: 'a1' }, 'answer', config, new AbortController().signal);
    tracker.onUsage({ inputTokens: 100, outputTokens: 10, cachedInputTokens: 0 });
    tracker.onUsage({ outputTokens: 20 }); tracker.complete();
    const conversation = useChatStore.getState().conversations.c1;
    expect(conversation.usage).toHaveLength(1);
    expect(conversation.messages[0].usage?.[0]).toMatchObject({ inputTokens: 100, outputTokens: 20, cachedInputTokens: 0, status: 'complete' });
    expect(sumUsage(conversation.usage!, 'inputTokens').tokens).toBe(100);
    useChatStore.getState().setConversationMessages('c1', []);
    expect(useChatStore.getState().conversations.c1.usage).toEqual(conversation.usage);
  });

  it('preserves cancellation as an incomplete report and ignores late updates after switching workspaces', () => {
    const controller = new AbortController();
    const tracker = trackRequestUsage({ nodeId: 'c1' }, 'reference_summary', config, controller.signal);
    controller.abort(); tracker.onUsage({ inputTokens: 500 });
    expect(useChatStore.getState().conversations.c1.usage?.[0]).toMatchObject({ status: 'interrupted' });
    expect(sumUsage(useChatStore.getState().conversations.c1.usage!, 'inputTokens').reported).toBe(0);
    const second = trackRequestUsage({ nodeId: 'c1' }, 'title', config, new AbortController().signal);
    useWorkspaceStore.setState({ activeWorkspaceId: 'w2' });
    useChatStore.setState({ conversations: { c1: { nodeId: 'c1', messages: [], isStreaming: false } } });
    second.onUsage({ inputTokens: 100 }); second.complete();
    expect(useChatStore.getState().conversations.c1.usage).toBeUndefined();
  });

  it('distinguishes missing usage from zero and deduplicates reports when summing', () => {
    const tracker = trackRequestUsage({ nodeId: 'c1' }, 'answer', config, new AbortController().signal);
    tracker.onUsage({ inputTokens: 0 }); tracker.complete();
    const records = useChatStore.getState().conversations.c1.usage!;
    expect(sumUsage([...records, ...records], 'inputTokens')).toEqual({ tokens: 0, reported: 1, requests: 1 });
    expect(sumUsage(records, 'cachedInputTokens').reported).toBe(0);
    expect(mergeUsage(records, [{ ...records[0], status: 'pending' }])[0].status).toBe('complete');
  });

  it('selects one request for each answer version while retaining the conversation sum', () => {
    const tracker = trackRequestUsage({ nodeId: 'c1', documentId: 'a1' }, 'answer', config, new AbortController().signal);
    tracker.onUsage({ inputTokens: 900 }); tracker.complete();
    const original = useChatStore.getState().getMessages('c1')[0];
    const first = { ...original.usage![0], versionId: 1 };
    const second = { ...first, id: 'second', versionId: 2, inputTokens: 950 };
    const third = { ...first, id: 'third', versionId: 3, inputTokens: 1000 };
    const message = { ...original, versionId: 3, usage: [first, second, third] };
    expect(answerUsage(message)?.inputTokens).toBe(1000);
    expect(answerUsage({ ...message, versionId: 1 })?.inputTokens).toBe(900);
    expect(sumUsage(message.usage, 'inputTokens').tokens).toBe(2850);
    expect(answerUsage({ ...message, usage: [...message.usage, { ...third, id: 'pending', versionId: undefined, status: 'pending', inputTokens: undefined }] }, true)?.inputTokens).toBeUndefined();
  });
});
