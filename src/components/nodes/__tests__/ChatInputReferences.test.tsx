/** @vitest-environment jsdom */
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ChatInput } from '../ChatInput';
import { ReferenceBubble } from '../ReferenceBubble';
import { referenceClipboardFormats } from '../../../services/referenceClipboard';
import { sampleReference } from '../../../services/__tests__/referenceFixtures';
import { useChatStore } from '../../../stores/chatStore';
import { useFlowStore } from '../../../stores/flowStore';

vi.hoisted(() => { window.matchMedia = vi.fn().mockReturnValue({ matches: false, addEventListener: vi.fn() }); });

let container: HTMLDivElement; let root: Root;
beforeEach(() => { vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true); container = document.createElement('div'); document.body.append(container); root = createRoot(container); useChatStore.setState({ conversations: {} }); useFlowStore.setState({ nodes: [] }); });
afterEach(async () => { await act(async () => root.unmount()); container.remove(); vi.unstubAllGlobals(); });
const paste = async () => {
  const event = new Event('paste', { bubbles: true, cancelable: true });
  Object.defineProperty(event, 'clipboardData', { value: { getData: () => referenceClipboardFormats(sampleReference()).html, items: [] } });
  await act(async () => document.querySelector('textarea')!.dispatchEvent(event));
};
describe('reference attachment and source snapshot UI', () => {
  it('pastes as an attachment, allows removal and sends the reference before a question', async () => {
    const send = vi.fn(); await act(async () => root.render(<ChatInput nodeId="child" onSend={send} onCancel={vi.fn()} />));
    await paste(); expect(document.querySelector('[aria-label="待发送引用"]')?.textContent).toContain('来源标题');
    expect(document.querySelector('textarea')!.value).toBe('');
    await act(async () => document.querySelector<HTMLButtonElement>('[aria-label="移除引用 1"]')!.click());
    expect(document.querySelector('[aria-label="待发送引用"]')).toBeNull();
    await paste();
    await act(async () => document.querySelector('textarea')!.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })));
    expect(send).toHaveBeenCalledWith('', [], [sampleReference()]);
    expect(document.querySelector('[aria-label="待发送引用"]')).toBeNull();
  });
  it('retains the attachment when sending fails', async () => {
    await act(async () => root.render(<ChatInput nodeId="child" onSend={vi.fn().mockRejectedValue(new Error('发送失败'))} onCancel={vi.fn()} />));
    await paste(); await act(async () => document.querySelector('textarea')!.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })));
    expect(document.querySelector('[role="alert"]')?.textContent).toContain('发送失败');
    expect(document.querySelector('[aria-label="待发送引用"]')).not.toBeNull();
  });
  it('shows a collapsed reference and opens the saved original when its source no longer exists', async () => {
    const reference = sampleReference();
    await act(async () => root.render(<ReferenceBubble message={{ id: 'r1', role: 'system', kind: 'reference', content: reference.summary, reference, timestamp: 1 }} />));
    expect(document.querySelector('details')?.open).toBe(false);
    await act(async () => document.querySelector<HTMLButtonElement>('[data-reference] button')!.click());
    expect(document.querySelector('[aria-label="引用来源快照"] mark')?.textContent).toBe('具体原文');
  });
});
