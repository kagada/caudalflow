import { create } from 'zustand';
import { nanoid } from 'nanoid';
import type { ChatMessage, Conversation, MessageRole, RequestUsage } from '../types/chat';
import { mergeUsage } from '../utils/tokenUsage';

export interface ActiveNodeContext {
  nodeId: string;
  mode: 'root' | 'branch' | 'merge';
  topic: string;
  mergeAction?: string;
}

interface ChatState {
  conversations: Record<string, Conversation>;
  activeNodeContext: ActiveNodeContext | null;
  setActiveNodeContext: (ctx: ActiveNodeContext | null) => void;
  initConversation: (nodeId: string) => void;
  addMessage: (nodeId: string, role: MessageRole, content: string, images?: {
    base64: string;
    mimeType: string;
  }[], triggeredBy?: string) => string;
  appendToLastMessage: (nodeId: string, chunk: string) => void;
  appendReasoningToLastMessage: (nodeId: string, chunk: string) => void;
  setStreaming: (nodeId: string, streaming: boolean, messageId?: string) => void;
  getMessages: (nodeId: string) => ChatMessage[];
  removeConversation: (nodeId: string) => void;
  setConversations: (conversations: Record<string, Conversation>) => void;
  setConversationMessages: (nodeId: string, messages: ChatMessage[]) => void;
  addOrUpdateMessage: (nodeId: string, message: ChatMessage) => void;
  recordUsage: (nodeId: string, usage: RequestUsage, documentId?: string) => void;
}

export const useChatStore = create<ChatState>((set, get) => ({
  conversations: {},
  activeNodeContext: null,
  setActiveNodeContext: (ctx) => set({ activeNodeContext: ctx }),

  // 会话累计包含标题、摘要和已删除回答的请求；消息自身保留对应请求明细。
  recordUsage: (nodeId, usage, documentId) => {
    const conversation = get().conversations[nodeId];
    if (!conversation) return;
    const messages = documentId ? conversation.messages.map((message) => message.id === documentId ? { ...message, usage: mergeUsage(message.usage, [usage]) } : message) : conversation.messages;
    set({ conversations: { ...get().conversations, [nodeId]: { ...conversation, messages, usage: mergeUsage(conversation.usage, [usage]) } } });
  },

  initConversation: (nodeId) => {
    if (get().conversations[nodeId]) return;
    set({
      conversations: {
        ...get().conversations,
        [nodeId]: { nodeId, messages: [], isStreaming: false },
      },
    });
  },

  addMessage: (nodeId, role, content, images, triggeredBy) => {
    const id = nanoid();
    const message: ChatMessage = { id, role, kind: 'message', content, timestamp: Date.now(), images, triggeredBy };
    const conv = get().conversations[nodeId];
    if (!conv) return id;
    if (role === 'assistant') message.replyToId = conv.messages.findLast((item) => item.role === 'user')?.id;
    set({
      conversations: {
        ...get().conversations,
        [nodeId]: { ...conv, messages: [...conv.messages, message] },
      },
    });
    return id;
  },

  appendToLastMessage: (nodeId, chunk) => {
    const conv = get().conversations[nodeId];
    if (!conv || conv.messages.length === 0) return;
    const messages = [...conv.messages];
    const last = messages[messages.length - 1];
    messages[messages.length - 1] = { ...last, content: last.content + chunk };
    set({
      conversations: {
        ...get().conversations,
        [nodeId]: { ...conv, messages },
      },
    });
  },

  // 思考单独保存在消息中，避免混入正文和下一轮对话上下文。
  appendReasoningToLastMessage: (nodeId, chunk) => {
    const conv = get().conversations[nodeId];
    if (!conv || !conv.messages.length) return;
    const messages = [...conv.messages];
    const last = messages[messages.length - 1];
    messages[messages.length - 1] = { ...last, reasoning: (last.reasoning ?? '') + chunk };
    set({ conversations: { ...get().conversations, [nodeId]: { ...conv, messages } } });
  },

  setStreaming: (nodeId, streaming, messageId) => {
    const conv = get().conversations[nodeId];
    if (!conv) return;
    set({
      conversations: {
        ...get().conversations,
        [nodeId]: { ...conv, isStreaming: streaming, streamingMessageId: streaming ? messageId ?? conv.messages.at(-1)?.id : undefined },
      },
    });
  },

  getMessages: (nodeId) => {
    return get().conversations[nodeId]?.messages ?? [];
  },

  removeConversation: (nodeId) => {
    const { [nodeId]: _, ...rest } = get().conversations;
    void _;
    set({ conversations: rest });
  },

  setConversations: (conversations) => set({ conversations }),

  setConversationMessages: (nodeId, messages) => {
    const conv = get().conversations[nodeId];
    if (!conv) return;
    set({
      conversations: {
        ...get().conversations,
        [nodeId]: { ...conv, messages },
      },
    });
  },

  addOrUpdateMessage: (nodeId, message) => {
    const conv = get().conversations[nodeId];
    if (!conv) return;
    const existing = conv.messages.findIndex((m) => m.id === message.id);
    const messages =
      existing >= 0
        ? conv.messages.map((m, i) => (i === existing ? { ...m, ...message, ...(m.usage?.length || message.usage?.length ? { usage: mergeUsage(message.usage, m.usage) } : {}) } : m))
        : [...conv.messages, message];
    set({
      conversations: {
        ...get().conversations,
        [nodeId]: { ...conv, messages },
      },
    });
  },
}));
