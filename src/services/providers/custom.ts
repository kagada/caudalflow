import type { LLMProvider, StreamCallbacks } from './types';
import type { ChatMessage, LLMConfig } from '../../types/chat';
import { resolveOpenAIEndpoint } from './endpoints';
import { readOpenAIStream } from './openaiStream';
import { thinkingParameters } from './thinking';
import { usageAwareChatFetch } from './transport';

function toOpenAIMessages(messages: ChatMessage[]) {
  return messages.map((m) => {
    if (m.images && m.images.length > 0) {
      return {
        role: m.role,
        content: [
          ...(m.content ? [{ type: 'text', text: m.content }] : []),
          ...m.images.map((img) => ({
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

export const CustomProvider: LLMProvider = {
  id: 'custom',
  name: 'Custom (OpenAI Compatible)',
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
      max_tokens: config.maxTokens,
      stream: true,
      stream_options: { include_usage: true },
      ...thinkingParameters(config.endpoint, config.thinkingMode, config.thinkingEffort, config.providerId),
    };

    try {
      if (!config.model.trim()) throw new Error('Please enter a model ID in Settings.');
      const chatUrl = resolveOpenAIEndpoint(config.endpoint, 'chat/completions');
      const response = await usageAwareChatFetch(chatUrl, {
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
