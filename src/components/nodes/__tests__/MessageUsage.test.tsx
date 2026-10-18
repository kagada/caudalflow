/** @vitest-environment jsdom */
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { expect, it, vi } from 'vitest';
import '../../../i18n';
import { ChatMessageList } from '../ChatMessageList';
import { useChatStore } from '../../../stores/chatStore';
import { useWorkspaceStore } from '../../../stores/workspaceStore';
import type { RequestUsage } from '../../../types/chat';

vi.hoisted(() => {
  window.matchMedia = vi.fn().mockReturnValue({ matches: false, addEventListener: vi.fn() });
});

it('shows usage only below answers and keeps conversation totals separate', () => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  const container = document.createElement('div'); const root = createRoot(container);
  const first: RequestUsage = { id: 'r1', purpose: 'answer', model: 'test', providerId: 'custom', createdAt: 1, status: 'complete', inputTokens: 900, outputTokens: 100, versionId: 1 };
  const title: RequestUsage = { ...first, id: 'title', purpose: 'title', inputTokens: 20 };
  const latest = { ...first, id: 'r3', versionId: 3, inputTokens: 1000 };
  const second = { ...first, id: 'r2', versionId: 4, inputTokens: 1100 };
  useWorkspaceStore.setState({ activeWorkspaceId: 'w1' });
  useChatStore.setState({ conversations: { c1: { nodeId: 'c1', isStreaming: false, usage: [title, first, latest, second], messages: [
    { id: 'q1', role: 'user', content: '首问', timestamp: 1, usage: [title] },
    { id: 'a1', role: 'assistant', content: '重答', timestamp: 2, replyToId: 'q1', versionId: 3, usage: [first, latest] },
    { id: 'q2', role: 'user', content: '第二问', timestamp: 3 },
    { id: 'a2', role: 'assistant', content: '第二答', timestamp: 4, replyToId: 'q2', versionId: 4, usage: [second] },
  ] } } });
  try {
    act(() => root.render(<ChatMessageList nodeId="c1" onExplore={() => {}} />));
    const summary = (id: string) => container.querySelector(`[data-message-id="${id}"] [data-token-usage]`)?.textContent;
    expect(summary('q1')).toBeUndefined();
    expect(summary('a1')).toContain('本次回答'); expect(summary('a1')).toContain('输入 1,000');
    expect(summary('q2')).toBeUndefined(); expect(summary('a2')).toContain('输入 1,100');
    const total = [...container.querySelectorAll('[data-token-usage]')].find((element) => element.textContent?.includes('本会话累计'));
    expect(total?.textContent).toContain('输入 3,020');
  } finally { act(() => root.unmount()); vi.unstubAllGlobals(); }
});
