import { describe, expect, it, vi } from 'vitest';
import { readOpenAIStream } from '../openaiStream';
import { thinkingParameters } from '../thinking';

function response(parts: string[]) {
  return new Response(new ReadableStream({ start(controller) {
    for (const part of parts) controller.enqueue(new TextEncoder().encode(part));
    controller.close();
  } }));
}

function callbacks() {
  return { onToken: vi.fn(), onReasoning: vi.fn(), onDone: vi.fn(), onError: vi.fn() };
}

describe('OpenAI-compatible streaming', () => {
  it('separates DeepSeek thinking from the final answer and accepts data without a space', async () => {
    const cb = callbacks();
    await readOpenAIStream(response([
      ': keep-alive\n\ndata:{"choices":[{"delta":{"reasoning_content":"思考中"}}]}\r\n\r\n',
      'data: {"choices":[{"delta":{"content":"答',
      '案"}}]}\n\ndata: [DONE]',
    ]), cb, new AbortController().signal);
    expect(cb.onReasoning).toHaveBeenCalledWith('思考中');
    expect(cb.onToken).toHaveBeenCalledWith('答案');
    expect(cb.onDone).toHaveBeenCalledTimes(1);
  });

  it('does not lose a final answer when the last line has no newline', async () => {
    const cb = callbacks();
    await readOpenAIStream(response(['data:{"choices":[{"delta":{"content":"完整答案"}}]}']), cb, new AbortController().signal);
    expect(cb.onToken).toHaveBeenCalledWith('完整答案');
    expect(cb.onDone).toHaveBeenCalledTimes(1);
  });

  it('reports when thinking consumes the token budget without producing an answer', async () => {
    const cb = callbacks();
    await expect(readOpenAIStream(response([
      'data: {"choices":[{"delta":{"reasoning_content":"思考"}}]}\n',
      'data: {"choices":[{"delta":{},"finish_reason":"length"}]}\n',
      'data: [DONE]\n',
    ]), cb, new AbortController().signal)).rejects.toThrow('最大输出令牌数');
    expect(cb.onReasoning).toHaveBeenCalledWith('思考');
    expect(cb.onDone).not.toHaveBeenCalled();
  });

  it('reports reasoning-only completion even without an explicit length limit', async () => {
    await expect(readOpenAIStream(response(['data:{"choices":[{"delta":{"reasoning_content":"思考"}}]}\ndata:[DONE]\n']), callbacks(), new AbortController().signal)).rejects.toThrow('没有返回正文');
  });

  it('surfaces errors embedded in a successful HTTP stream', async () => {
    await expect(readOpenAIStream(response(['data:{"error":{"message":"Quota exceeded"}}\n']), callbacks(), new AbortController().signal)).rejects.toThrow('Quota exceeded');
  });

  it('reports an empty completion instead of treating it as successful', async () => {
    const cb = callbacks();
    await expect(readOpenAIStream(response(['data:[DONE]\n']), cb, new AbortController().signal)).rejects.toThrow('没有返回正文');
    expect(cb.onDone).not.toHaveBeenCalled();
  });

  it('does not emit tokens or completion after cancellation', async () => {
    const cb = callbacks();
    const controller = new AbortController();
    controller.abort();
    await readOpenAIStream(response(['data:{"choices":[{"delta":{"content":"答案"}}]}\n']), cb, controller.signal);
    expect(cb.onToken).not.toHaveBeenCalled();
    expect(cb.onDone).not.toHaveBeenCalled();
  });
});

describe('DeepSeek thinking configuration', () => {
  it('defaults ordinary DeepSeek chats to direct answers', () => {
    expect(thinkingParameters('https://api.deepseek.com')).toEqual({ thinking: { type: 'disabled' } });
  });
  it('allows enabling thinking or following the model default', () => {
    expect(thinkingParameters('https://api.deepseek.com/v1', 'enabled')).toEqual({ thinking: { type: 'enabled' } });
    expect(thinkingParameters('https://api.deepseek.com/v1', 'auto')).toEqual({});
  });
  it('does not send DeepSeek-specific fields to other compatible APIs', () => {
    expect(thinkingParameters('https://example.com/v1', 'enabled')).toEqual({});
  });
});
