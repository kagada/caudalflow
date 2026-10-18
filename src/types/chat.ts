export type MessageRole = 'user' | 'assistant' | 'system';

export interface ReferenceSource {
  workspaceId: string;
  conversationId: string;
  documentId: string;
  versionId?: number;
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
  // 复制时先保存背景，发送时才摘要，复制不再等待远端服务。
  summaryInput?: { role: 'user' | 'assistant'; content: string; images?: { base64: string; mimeType: string }[] }[];
}

export interface ReferenceSelection { documentId: string; text: string; start?: number; length?: number }

export interface ChatMessage {
  id: string;
  versionId?: number;
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
  // 普通消息缺省为 message；持久化后总有明确类型，引用有独立内容表。
  kind?: 'message' | 'reference';
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
