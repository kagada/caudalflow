import { nanoid } from 'nanoid';
import type { LLMConfig, RequestUsage, TokenUsage } from '../types/chat';
import { useChatStore } from '../stores/chatStore';
import { useWorkspaceStore } from '../stores/workspaceStore';

export interface UsageTarget { nodeId: string; documentId?: string }

// 请求属于发起时的会话；记录状态和服务商用量，供正文与辅助请求共用。
export function trackRequestUsage(target: UsageTarget | undefined, purpose: RequestUsage['purpose'], config: LLMConfig, signal: AbortSignal) {
  const workspaceId = useWorkspaceStore.getState().activeWorkspaceId;
  let record: RequestUsage = { id: nanoid(), purpose, providerId: config.providerId, model: config.model, createdAt: Date.now(), status: 'pending' };
  let finished = false;
  const publish = () => {
    if (target && useWorkspaceStore.getState().activeWorkspaceId === workspaceId) useChatStore.getState().recordUsage(target.nodeId, record, target.documentId);
  };
  const finish = (status: RequestUsage['status']) => {
    if (finished) return;
    finished = true; signal.removeEventListener('abort', abort);
    record = { ...record, status }; publish();
  };
  const abort = () => finish('interrupted');
  signal.addEventListener('abort', abort, { once: true });
  if (signal.aborted) abort(); else publish();
  return {
    onUsage: (usage: TokenUsage) => { if (!finished) { record = { ...record, ...usage }; publish(); } },
    complete: () => finish('complete'),
    fail: () => finish('failed'),
  };
}
