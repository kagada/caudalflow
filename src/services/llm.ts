import { resolveModelConfig } from './modelConfig';
import type { ChatMessage, LLMConfig } from '../types/chat';
import type { StreamCallbacks } from './providers/types';
import { getProvider } from './providers/registry';
import { useSettingsStore } from '../stores/settingsStore';
import { trackGeneration } from './streamLifecycle';
import { modelMessages } from './references';
import { DEFAULT_BUILTIN_PROMPTS } from './builtinPrompts';
import { trackRequestUsage, type UsageTarget } from './requestUsage';
import { createWebSearchDebugger } from './webSearchDebug';
import { useWorkspaceStore } from '../stores/workspaceStore';

export function streamChat(
  messages: ChatMessage[],
  callbacks: StreamCallbacks,
  signal: AbortSignal,
  usageTarget?: UsageTarget,
) {
  let config: LLMConfig;
  try { config = resolveModelConfig(usageTarget?.nodeId); }
  catch (error) { callbacks.onError(error instanceof Error ? error : new Error(String(error))); return; }
  const provider = getProvider(config.providerId);

  if (!provider) {
    callbacks.onError(new Error(`Unknown provider: ${config.providerId}`));
    return;
  }

  const tracked = trackGeneration(signal);
  const usage = trackRequestUsage(usageTarget, 'answer', config, tracked.controller.signal);
  const debug = config.webSearch && usageTarget ? createWebSearchDebugger(useWorkspaceStore.getState().activeWorkspaceId, usageTarget.nodeId, usageTarget.documentId) : undefined;
  tracked.controller.signal.addEventListener('abort', () => debug?.({ stage: '已取消', data: {} }), { once: true });
  // 请求取消后不再回调 store，避免历史恢复或撤销后被晚到响应覆盖。
  provider.streamChat(modelMessages(messages), config, {
    onDebug: debug,
    onToken: (token) => { if (!tracked.controller.signal.aborted) callbacks.onToken(token); },
    onReasoning: (token) => { if (!tracked.controller.signal.aborted) callbacks.onReasoning?.(token); },
    onUsage: (value) => { if (!tracked.controller.signal.aborted) { usage.onUsage(value); callbacks.onUsage?.(value); } },
    onDone: () => { usage.complete(); tracked.release(); if (!tracked.controller.signal.aborted) callbacks.onDone(); },
    onError: (error) => { usage.fail(); tracked.release(); if (!tracked.controller.signal.aborted) callbacks.onError(error); },
  }, tracked.controller.signal);
}

export function generateTitle(
  userMessage: string,
  context: string,
  onTitle: (title: string) => void,
  usageTarget?: UsageTarget,
): void {
  let config: LLMConfig;
  try { config = resolveModelConfig(usageTarget?.nodeId); } catch { return; }
  const provider = getProvider(config.providerId);
  if (!provider) return;

  // 标题只需简短输出，支持关闭思考的接口无需为命名消耗正文的思考预算。
  const titleConfig: LLMConfig = { ...config, webSearch: false, maxTokens: 128, thinkingMode: 'disabled' };
  const messages: ChatMessage[] = [
    {
      id: 'system',
      role: 'system',
      content:
        useSettingsStore.getState().builtinPrompts?.conversationTitle ?? DEFAULT_BUILTIN_PROMPTS.conversationTitle,
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
  const usage = trackRequestUsage(usageTarget, 'title', titleConfig, tracked.controller.signal);
  provider.streamChat(
    messages,
    titleConfig,
    {
      onUsage: usage.onUsage,
      onToken: (token) => {
        title += token;
      },
      onDone: () => {
        usage.complete();
        tracked.release();
        if (tracked.controller.signal.aborted) return;
        const cleaned = title.trim().split(/\r?\n/)[0].replace(/^["'“”]+|["'“”]+$/g, '').trim().slice(0, 60);
        if (cleaned) onTitle(cleaned);
      },
      onError: () => { usage.fail(); tracked.release(); },
    },
    tracked.controller.signal,
  );
}
