import { addQuestionWithReferences } from '../services/references';
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
import { reviseMessage } from '../services/messageActions';

export function useNodeCopilotChat(
  nodeId: string,
  topic: string,
  parentNodeId?: string,
  _branchText?: string,
  parentNodeIds?: string[],
  mergeAction?: string,
) {
  const abortRef = useRef<AbortController | null>(null);

  const sendMessage = useCallback(
    async (content: string, files: File[] = [], references: ContentReference[] = []) => {
      const workspaceId = useWorkspaceStore.getState().activeWorkspaceId;
      const processedImages = await Promise.all(
        files.map(async (file) => {
          validateImage(file);
          return await fileToBase64(file);
        }),
      );

      const store = useChatStore.getState();
      if (useWorkspaceStore.getState().activeWorkspaceId !== workspaceId || !store.conversations[nodeId]) throw new Error('会话已切换或删除，请重新发送');
      if (store.conversations[nodeId].isStreaming) throw new Error('请先等待回复完成或停止生成');
      addQuestionWithReferences(nodeId, content, processedImages.length ? processedImages : undefined, references);
      const messages = store.getMessages(nodeId);

      // Tell the agent which node is active — the bridge picks this up on the next sync
      const mode: 'root' | 'branch' | 'merge' =
        (parentNodeIds?.length ?? 0) >= 2 ? 'merge' : parentNodeId ? 'branch' : 'root';
      useChatStore.getState().setActiveNodeContext({ nodeId, mode, topic, mergeAction });

      const systemPrompt = conversationSystemPrompt(nodeId);

      const fullMessages: ChatMessage[] = [
        { id: 'system', role: 'system', content: systemPrompt, timestamp: 0 },
        ...messages,
      ];

      prepareFirstQuestion(nodeId, messages.filter((message) => message.kind === 'reference').map((message) => message.content).join('\n\n') || systemPrompt);

      store.addMessage(nodeId, 'assistant', '');
      store.setStreaming(nodeId, true);

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
            useChatStore
              .getState()
              .appendToLastMessage(nodeId, `\n\n**Error:** ${error.message}`);
            useChatStore.getState().setStreaming(nodeId, false);
          },
        },
        controller.signal,
      );
    },
    [nodeId, topic, parentNodeId, parentNodeIds, mergeAction],
  );

  const cancelStream = useCallback(() => {
    cancelReferenceConversation(nodeId);
    abortRef.current?.abort();
    useChatStore.getState().setStreaming(nodeId, false);
  }, [nodeId]);

  const revise = useCallback((messageId: string, prompt?: string) => {
    if (useChatStore.getState().conversations[nodeId]?.isStreaming) return;
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    reviseMessage(nodeId, messageId, prompt, controller.signal);
  }, [nodeId]);
  return { sendMessage, cancelStream, reviseMessage: revise };
}
