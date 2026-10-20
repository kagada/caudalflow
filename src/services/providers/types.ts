import type { ChatMessage, LLMConfig, TokenUsage } from '../../types/chat';
import type { WebSearchDebugEvent } from '../webSearchDebug';

export interface StreamCallbacks {
  onDebug?: (event: WebSearchDebugEvent) => void;
  onToken: (token: string) => void;
  onReasoning?: (token: string) => void;
  onUsage?: (usage: TokenUsage) => void;
  onDone: () => void;
  onError: (error: Error) => void;
}

export interface LLMProvider {
  id: string;
  name: string;
  streamChat: (
    messages: ChatMessage[],
    config: LLMConfig,
    callbacks: StreamCallbacks,
    signal: AbortSignal
  ) => void;
  supportsVision?: boolean;
}
