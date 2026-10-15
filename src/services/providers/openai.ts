import type { LLMProvider, StreamCallbacks } from './types';
import type { ChatMessage, LLMConfig } from '../../types/chat';
import { resolveOpenAIEndpoint } from './endpoints';
import { readOpenAIStream } from './openaiStream';
import { thinkingParameters } from './thinking';
import { apiFetch } from './transport';

function toOpenAIMessages(messages: ChatMessage[]) {
  return messages.map((m, index) => {
    const isLast = index === messages.length - 1;

    const validImages =
      isLast
        ? m.images?.filter(
            (img) =>
              img &&
              img.base64 &&
              img.mimeType?.startsWith('image/')
          ) || []
        : []; 

    if (validImages.length > 0) {
      return {
        role: m.role,
        content: [
          ...(m.content
            ? [{ type: 'text', text: m.content }]
            : []),
          ...validImages.map((img) => ({
            type: 'image_url',
            image_url: {
              url: `data:${img.mimeType};base64,${img.base64}`,
            },
          })),
        ],
      };
    }

    return { role: m.role, content: m.content };
  });
}

export const OpenAIProvider: LLMProvider = {
  id: 'openai',
  name: 'OpenAI',
  supportsVision: true,

  async streamChat(
    messages: ChatMessage[],
    config: LLMConfig,
    callbacks: StreamCallbacks,
    signal: AbortSignal
  ) {
    const body = {
      model: config.model.trim(),
      messages: toOpenAIMessages(messages),
      temperature: config.temperature,
      max_completion_tokens: config.maxTokens,
      stream: true,
      ...thinkingParameters(config.endpoint, config.thinkingMode),
    };

    try {
      // 本地使用直接访问设置中的接口，不再要求额外启动后端代理。
      if (!config.model.trim()) throw new Error('Please enter a model ID in Settings.');
      const response = await apiFetch(resolveOpenAIEndpoint(config.endpoint, 'chat/completions'), {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(config.apiKey.trim() ? { Authorization: `Bearer ${config.apiKey.trim()}` } : {}),
        },
        body: JSON.stringify(body),
        signal,
      });

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`API error ${response.status}: ${errorText}`);
      }

      await readOpenAIStream(response, callbacks, signal);
    } catch (error) {
      if (signal.aborted) return;
      callbacks.onError(error instanceof Error ? error : new Error(String(error)));
    }
  },
};
