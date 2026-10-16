export type MessageRole = 'user' | 'assistant' | 'system';

export interface ReferenceSource {
  workspaceId: string;
  conversationId: string;
  documentId: string;
  versionId?: string;
  title: string;
  documentText: string;
  start: number;
  length: number;
  images?: { base64: string; mimeType: string }[];
}

// 引用携带独立快照，来源只用于回看，父会话变化或删除不会改变聊天背景。
export interface ContentReference {
  id: string;
  snapshotKey: string;
  summary: string;
  quote: string;
  sources: ReferenceSource[];
  createdAt: number;
}

export interface ReferenceSelection { documentId: string; text: string; start?: number; length?: number }

export interface ChatMessage {
  id: string;
  versionId?: string;
  generationStatus?: 'complete' | 'interrupted' | 'failed';
  role: MessageRole;
  content: string;
  reasoning?: string;
  previousVersions?: { content: string; reasoning?: string; timestamp: number }[];
  timestamp: number;
  images?: {
    base64: string;
    mimeType: string;
  }[];
  triggeredBy?: string;
  // 回复明确关联到提问，避免删除问题后仅凭相邻位置错误配对。
  replyToId?: string;
  kind?: 'reference';
  reference?: ContentReference;
  referenceForId?: string;
}

export interface Conversation {
  nodeId: string;
  messages: ChatMessage[];
  isStreaming: boolean;
  streamingMessageId?: string;
}

export interface LLMConfig {
  providerId: string;
  providerName: string;
  endpoint: string;
  apiKey: string;
  model: string;
  temperature: number;
  maxTokens: number;
  mockDelay: number;
  thinkingMode?: 'auto' | 'enabled' | 'disabled';
}
