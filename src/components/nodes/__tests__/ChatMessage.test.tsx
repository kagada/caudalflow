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
});
