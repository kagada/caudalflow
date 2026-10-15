import type { ChatMessage, LLMConfig } from '../types/chat';
import type { StreamCallbacks } from './providers/types';
import { getProvider } from './providers/registry';
import { useSettingsStore } from '../stores/settingsStore';
import { trackGeneration } from './streamLifecycle';

export function streamChat(
  messages: ChatMessage[],
  callbacks: StreamCallbacks,
  signal: AbortSignal
) {
  const config = useSettingsStore.getState().llmConfig;
  const provider = getProvider(config.providerId);

  if (!provider) {
    callbacks.onError(new Error(`Unknown provider: ${config.providerId}`));
    return;
  }

  const tracked = trackGeneration(signal);
  // 请求取消后不再回调 store，避免历史恢复或撤销后被晚到响应覆盖。
  provider.streamChat(messages, config, {
    onToken: (token) => { if (!tracked.controller.signal.aborted) callbacks.onToken(token); },
    onReasoning: (token) => { if (!tracked.controller.signal.aborted) callbacks.onReasoning?.(token); },
    onDone: () => { tracked.release(); if (!tracked.controller.signal.aborted) callbacks.onDone(); },
    onError: (error) => { tracked.release(); if (!tracked.controller.signal.aborted) callbacks.onError(error); },
  }, tracked.controller.signal);
}

export function generateTitle(
  userMessage: string,
  context: string,
  onTitle: (title: string) => void
): void {
  const config = useSettingsStore.getState().llmConfig;
  const provider = getProvider(config.providerId);
  if (!provider) return;

  // 标题只需简短输出，支持关闭思考的接口无需为命名消耗正文的思考预算。
  const titleConfig: LLMConfig = { ...config, maxTokens: 128, thinkingMode: 'disabled' };
  const messages: ChatMessage[] = [
    {
      id: 'system',
      role: 'system',
      content:
        '根据首次问题提炼简短、具体的会话标题，使用问题的语言，中文尽量不超过 16 字，其他语言不超过 8 个词。上下文仅用于理解指代。只输出一行标题，不要引号、Markdown、解释或回答问题。',
      timestamp: 0,
    },
    {
      id: 'context',
      role: 'user',
      content: `首次问题：${userMessage.slice(0, 6000)}\n\n相关上下文：${context.slice(0, 6000)}`,
      timestamp: 0,
    },
  ];

  let title = '';
  const controller = new AbortController();
  const tracked = trackGeneration(controller.signal);
  provider.streamChat(
    messages,
    titleConfig,
    {
      onToken: (token) => {
        title += token;
      },
      onDone: () => {
        tracked.release();
        if (tracked.controller.signal.aborted) return;
        const cleaned = title.trim().split(/\r?\n/)[0].replace(/^["'“”]+|["'“”]+$/g, '').trim().slice(0, 60);
        if (cleaned) onTitle(cleaned);
      },
      onError: () => { tracked.release(); },
    },
    tracked.controller.signal,
  );
}
