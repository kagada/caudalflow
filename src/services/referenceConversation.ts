import type { ContentReference } from '../types/chat';
import { useChatStore } from '../stores/chatStore';
import { useWorkspaceStore } from '../stores/workspaceStore';
import { trackGeneration } from './streamLifecycle';
import { addQuestionWithReferences, resolveReference } from './references';
import { prepareFirstQuestion } from './conversationTitle';
import { getRootSystemPrompt } from '../utils/systemPrompts';
import { streamChat } from './llm';

const initialRequests = new Map<string, AbortController>();

// 分支和多会话总结共用显式引用，不再把父会话截断后藏进系统提示。
export function startReferenceConversation(nodeId: string, question: string, references: ContentReference[]): void {
  const store = useChatStore.getState();
  if (!store.conversations[nodeId] || store.conversations[nodeId].isStreaming) return;
  // 卡片、引用和问题先出现在界面上，摘要请求在后台准备，不能让分支按钮一直等远端。
  const workspaceId = useWorkspaceStore.getState().activeWorkspaceId;
  const questionId = addQuestionWithReferences(nodeId, question, undefined, references);
  prepareFirstQuestion(nodeId, references.map((reference) => reference.summary || reference.quote).join('\n\n'));
  const answerId = store.addMessage(nodeId, 'assistant', ''); store.setStreaming(nodeId, true, answerId);
  const tracked = trackGeneration(new AbortController().signal);
  const controller = tracked.controller; initialRequests.set(nodeId, controller);
  const current = () => !controller.signal.aborted && useWorkspaceStore.getState().activeWorkspaceId === workspaceId &&
    initialRequests.get(nodeId) === controller && useChatStore.getState().getMessages(nodeId).some((message) => message.id === answerId);
  const finish = () => {
    tracked.release();
    if (initialRequests.get(nodeId) !== controller) return;
    initialRequests.delete(nodeId);
    if (useWorkspaceStore.getState().activeWorkspaceId === workspaceId && useChatStore.getState().getMessages(nodeId).some((message) => message.id === answerId)) {
      useChatStore.getState().setStreaming(nodeId, false);
    }
  };
  void (async () => {
    try {
      const resolved = await Promise.all(references.map((reference) => resolveReference(reference, { nodeId,
        documentId: store.getMessages(nodeId).find((message) => message.reference?.id === reference.id)?.id })));
      if (!current()) { tracked.release(); return; }
      const messages = useChatStore.getState().getMessages(nodeId).map((message) => {
        if (message.referenceForId !== questionId || !message.reference) return message;
        const reference = resolved.find((item) => item.id === message.reference!.id);
        return reference ? { ...message, reference, content: reference.summary } : message;
      });
      useChatStore.getState().setConversationMessages(nodeId, messages);
      streamChat([{ id: 'system', role: 'system', content: getRootSystemPrompt(), timestamp: 0 }, ...messages.filter((message) => message.id !== answerId)], {
        onToken: (token) => { if (current()) useChatStore.getState().appendToLastMessage(nodeId, token); },
        onReasoning: (token) => { if (current()) useChatStore.getState().appendReasoningToLastMessage(nodeId, token); },
        onDone: finish,
        onError: (error) => { if (current()) useChatStore.getState().appendToLastMessage(nodeId, `\n\n**错误：** ${error.message}`); finish(); },
      }, controller.signal, { nodeId, documentId: answerId });
    } catch (error) {
      if (current()) useChatStore.getState().appendToLastMessage(nodeId, `\n\n**引用准备失败：** ${error instanceof Error ? error.message : String(error)}`);
      finish();
    }
  })();
}

export function cancelReferenceConversation(nodeId: string): void {
  initialRequests.get(nodeId)?.abort(); initialRequests.delete(nodeId);
  useChatStore.getState().setStreaming(nodeId, false);
}
