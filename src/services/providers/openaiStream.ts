import type { StreamCallbacks } from './types';
import { openAIUsage } from './usage';
import type { ToolCall } from './webSearch';

// 兼容标准 SSE 的空格、分片和末尾无换行，并分别传递思考与正文。
export async function readOpenAIStream(response: Response, callbacks: StreamCallbacks, signal: AbortSignal, allowTools = false) {
  const reader = response.body?.getReader();
  if (!reader) throw new Error('接口没有返回响应内容。');
  const decoder = new TextDecoder();
  let buffer = '';
  let contentReceived = false;
  let reasoningReceived = false;
  let finishReason: string | undefined;
  const toolCalls: ToolCall[] = [];
  let content = '';
  let reasoning = '';

  const consume = (line: string): boolean => {
    const trimmed = line.trim();
    if (!trimmed.startsWith('data:')) return false;
    const data = trimmed.slice(5).trim();
    if (!data) return false;
    if (data === '[DONE]') return true;
    const parsed = JSON.parse(data);
    if (parsed.search_info || parsed.usage?.plugins) callbacks.onDebug?.({ stage: '接口返回联网信息', data: parsed });
    if (parsed.error) throw new Error(parsed.error.message || '接口返回了流式错误。');
    const usage = openAIUsage(parsed.usage);
    if (usage) callbacks.onUsage?.(usage);
    const choice = parsed.choices?.[0];
    const delta = choice?.delta;
    // 工具参数可能跨多个流片段，必须按索引拼接后才能执行。
    if (allowTools && Array.isArray(delta?.tool_calls)) for (const part of delta.tool_calls) {
      if (!Number.isInteger(part.index) || part.index < 0 || part.index > 15) throw new Error('工具调用索引无效。');
      const tool = toolCalls[part.index] ??= { id: '', type: 'function', function: { name: '', arguments: '' } };
      if (part.id) tool.id += part.id;
      if (part.function?.name) tool.function.name += part.function.name;
      if (part.function?.arguments) tool.function.arguments += part.function.arguments;
    }
    if (typeof delta?.reasoning_content === 'string' && delta.reasoning_content) {
      reasoningReceived = true;
      reasoning += delta.reasoning_content;
      callbacks.onReasoning?.(delta.reasoning_content);
    }
    if (typeof delta?.content === 'string' && delta.content) {
      contentReceived = true;
      content += delta.content;
      callbacks.onToken(delta.content);
    }
    if (choice?.finish_reason) finishReason = choice.finish_reason;
    return false;
  };

  try {
    let complete = false;
    while (!complete && !signal.aborted) {
      const { done, value } = await reader.read();
      buffer += done ? decoder.decode() : decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() ?? '';
      for (const line of lines) {
        if (signal.aborted) return;
        if (consume(line)) { complete = true; break; }
      }
      if (done) {
        if (!complete && buffer.trim()) consume(buffer);
        break;
      }
    }
    if (signal.aborted) return;
    // 空白结束必须给出原因；思考耗尽额度不能表现为成功完成。
    if (finishReason === 'length') throw new Error('达到最大输出令牌数，回复可能不完整。请提高上限，或关闭思考模式后重试。');
    if (allowTools && toolCalls.length) {
      if (finishReason !== 'tool_calls' || toolCalls.some((tool) => !tool?.id || !tool.function.name)) throw new Error('工具请求未完整返回，请重试。');
      const result = { content, reasoning_content: reasoning, tool_calls: toolCalls };
      callbacks.onDebug?.({ stage: '模型返回工具请求', data: { ...result, finish_reason: finishReason } });
      return result;
    }
    if (!contentReceived) throw new Error(reasoningReceived
      ? '模型返回了思考内容，但没有返回正文。请关闭思考模式或提高最大输出令牌数后重试。'
      : '接口已结束，但没有返回正文。请检查模型和接口是否支持 Chat Completions 流式输出。');
    callbacks.onDebug?.({ stage: '模型返回回答', data: { content, reasoning_content: reasoning, finish_reason: finishReason } });
    callbacks.onDone();
  } finally {
    if (!signal.aborted) await reader.cancel().catch(() => {});
    reader.releaseLock();
  }
}
