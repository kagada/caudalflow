import { useChatStore } from '../stores/chatStore';
import { getRootSystemPrompt } from '../utils/systemPrompts';

// 新引用提供完整背景；旧分支只沿用当时已经保存的提示，不再读取父会话的最新内容。
export function conversationSystemPrompt(nodeId: string): string {
  const messages = useChatStore.getState().getMessages(nodeId);
  if (messages.some((message) => message.kind === 'reference')) return getRootSystemPrompt();
  return messages.find((message) => message.role === 'system')?.content ?? getRootSystemPrompt();
}
