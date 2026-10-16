/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createRoot } from 'react-dom/client';
import { act } from 'react';
import '../../../i18n';
import { ChatMessage } from '../ChatMessage';
import type { ChatMessage as ChatMessageType } from '../../../types/chat';

describe('ChatMessage copy button', () => {
  let container: HTMLDivElement;
  let clipboardWrite: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.useFakeTimers();
    container = document.createElement('div');
    document.body.appendChild(container);
    clipboardWrite = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', {
      value: { writeText: clipboardWrite },
      configurable: true,
    });
  });

  afterEach(() => {
    vi.runOnlyPendingTimers();
    vi.useRealTimers();
    container.remove();
  });

  it('copies raw message content and toggles icon state', async () => {
    const message: ChatMessageType = {
      id: 'm1',
      role: 'user',
      content: 'hello **world**',
      timestamp: Date.now(),
    };

    const root = createRoot(container);
    act(() => {
      root.render(<ChatMessage message={message} exploredTexts={[]} />);
    });

    const button = container.querySelector<HTMLButtonElement>(
      'button[aria-label="Copy message"]',
    );
    expect(button).not.toBeNull();

    await act(async () => {
      button?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });

    expect(clipboardWrite).toHaveBeenCalledWith('hello **world**');
    expect(button?.getAttribute('data-state')).toBe('copied');

    act(() => {
      vi.advanceTimersByTime(1500);
    });

    expect(button?.getAttribute('data-state')).toBe('idle');

    act(() => {
      root.unmount();
    });
  });

  it('shows thinking progress instead of an empty cursor, then renders the answer separately', async () => {
    const root = createRoot(container);
    const message: ChatMessageType = { id: 'thinking', role: 'assistant', content: '', reasoning: '先分析问题', timestamp: 0 };
    await act(async () => root.render(<ChatMessage message={message} exploredTexts={[]} isStreaming />));
    expect(container.querySelector('details')?.textContent).toContain('先分析问题');
    expect(container.textContent).toContain('Waiting for the answer');
    expect(container.textContent).not.toContain('▊');
    await act(async () => root.render(<ChatMessage message={{ ...message, content: '这是正文' }} exploredTexts={[]} />));
    expect(container.querySelector('details')?.textContent).not.toContain('这是正文');
    expect(container.textContent).toContain('这是正文');
    await act(async () => root.unmount());
  });

  it('highlights quoted inline and fenced code without losing its contents', () => {
    const root = createRoot(container);
    const content = '代码 `hello`\n\n```js\nconst answer = 42;\n```';
    const message: ChatMessageType = { id: 'code', role: 'assistant', content, timestamp: 0 };
    const source = { workspaceId: '', conversationId: 'a', documentId: 'code', title: 'A', documentText: content, start: 0, length: content.length };
    act(() => root.render(<ChatMessage message={message} exploredTexts={[]} referenceSources={[source]} />));
    expect(container.querySelector('code mark')?.textContent).toBe('hello');
    expect([...container.querySelectorAll('pre mark')].map((mark) => mark.textContent).join('')).toContain('const answer = 42;');
    expect(container.textContent).not.toContain('[object Object]');
    act(() => root.render(<ChatMessage message={{ ...message, role: 'user', content: '重复 重复' }} exploredTexts={[]} referenceSources={[{ ...source, documentText: '重复 重复', start: 3, length: 2 }]} />));
    expect(container.querySelectorAll('mark')).toHaveLength(1);
    expect(container.querySelector('mark')?.textContent).toBe('重复');
    act(() => root.unmount());
  });
});
