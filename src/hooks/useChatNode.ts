import { resolveModelConfig } from '../services/modelConfig';
import { addQuestionWithReferences, resolveReference, resolvePendingReferences } from '../services/references';
import { cancelReferenceConversation } from '../services/referenceConversation';
import type { ContentReference } from '../types/chat';
import { prepareFirstQuestion } from '../services/conversationTitle';
import { useCallback, useRef } from 'react';
import { useChatStore } from '../stores/chatStore';
import { useWorkspaceStore } from '../stores/workspaceStore';
import { streamChat } from '../services/llm';
import { conversationSystemPrompt } from '../services/conversationContext';
import type { ChatMessage } from '../types/chat';
import { validateImage, fileToBase64 } from '../utils/image';

export function useChatNode(nodeId: string) {
  const abortRef = useRef<AbortController | null>(null);

  const sendMessage = useCallback(
    async(content: string, files: File[] = [], references: ContentReference[] = []) => {
      resolveModelConfig(nodeId);
      const workspaceId = useWorkspaceStore.getState().activeWorkspaceId;
      const processedImages = await Promise.all(
        files.map(async (file) => {
          validateImage(file);
          return await fileToBase64(file);
        })
      );      
      const resolvedReferences = await Promise.all(references.map((reference) => resolveReference(reference, { nodeId })));
      const store = useChatStore.getState();
      if (useWorkspaceStore.getState().activeWorkspaceId !== workspaceId || !store.conversations[nodeId]) throw new Error('会话已切换或删除，请重新发送');
      if (store.conversations[nodeId].isStreaming) throw new Error('请先等待回复完成或停止生成');
      await resolvePendingReferences(nodeId, workspaceId);
      addQuestionWithReferences(nodeId, content, processedImages, resolvedReferences);
      const messages = store.getMessages(nodeId);

      const systemPrompt = conversationSystemPrompt(nodeId);

      const fullMessages: ChatMessage[] = [
        {
          id: 'system',
          role: 'system',
          content: systemPrompt,
          timestamp: 0,
        },
        ...messages,
      ];

      prepareFirstQuestion(nodeId, messages.filter((message) => message.kind === 'reference').map((message) => message.content).join('\n\n') || systemPrompt);

      // Create placeholder assistant message
      const answerId = store.addMessage(nodeId, 'assistant', '');
      store.setStreaming(nodeId, true);

      // Cancel previous stream
      abortRef.current?.abort();
      const controller = new AbortController();
      abortRef.current = controller;

      streamChat(
        fullMessages,
        {
          onToken: (token) => {
            useChatStore.getState().appendToLastMessage(nodeId, token);
          },
          onReasoning: (token: string) => {
            useChatStore.getState().appendReasoningToLastMessage(nodeId, token);
          },
          onDone: () => {
            useChatStore.getState().setStreaming(nodeId, false);
          },
          onError: (error) => {
            useChatStore.getState().appendToLastMessage(
              nodeId,
              `\n\n**Error:** ${error.message}`
            );
            useChatStore.getState().setStreaming(nodeId, false);
          },
        },
        controller.signal,
        { nodeId, documentId: answerId },
      );
    },
    [nodeId]
  );

  const cancelStream = useCallback(() => {
    cancelReferenceConversation(nodeId);
    abortRef.current?.abort();
    useChatStore.getState().setStreaming(nodeId, false);
  }, [nodeId]);

  return { sendMessage, cancelStream };
}
