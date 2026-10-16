import type { ContentReference } from '../types/chat';
import { useChatStore } from '../stores/chatStore';
import { addQuestionWithReferences } from './references';
import { prepareFirstQuestion } from './conversationTitle';
import { getRootSystemPrompt } from '../utils/systemPrompts';
import { streamChat } from './llm';

const initialRequests = new Map<string, AbortController>();

// 分支和多会话总结共用显式引用，不再把父会话截断后藏进系统提示。
export function startReferenceConversation(nodeId: string, question: string, references: ContentReference[]): void {
  const store = useChatStore.getState();
  if (!store.conversations[nodeId] || store.conversations[nodeId].isStreaming) return;
  addQuestionWithReferences(nodeId, question, undefined, references);
  const system = getRootSystemPrompt();
  const messages = [{ id: 'system', role: 'system' as const, content: system, timestamp: 0 }, ...store.getMessages(nodeId)];
  prepareFirstQuestion(nodeId, references.map((reference) => reference.summary).join('\n\n'));
  store.addMessage(nodeId, 'assistant', ''); store.setStreaming(nodeId, true);
  const controller = new AbortController(); initialRequests.set(nodeId, controller);
  const finish = () => { initialRequests.delete(nodeId); useChatStore.getState().setStreaming(nodeId, false); };
  streamChat(messages, {
    onToken: (token) => useChatStore.getState().appendToLastMessage(nodeId, token),
    onReasoning: (token) => useChatStore.getState().appendReasoningToLastMessage(nodeId, token),
    onDone: finish,
    onError: (error) => { useChatStore.getState().appendToLastMessage(nodeId, `\n\n**错误：** ${error.message}`); finish(); },
  }, controller.signal);
}

export function cancelReferenceConversation(nodeId: string): void {
  initialRequests.get(nodeId)?.abort(); initialRequests.delete(nodeId);
}
