/** @vitest-environment jsdom */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cancelUI, handleBackButton, registerCancelable } from '../uiCancel';

const cleanup: (() => void)[] = [];
const register = (close: () => void, level = 1000) => {
  const dispose = registerCancelable(close, level); cleanup.push(dispose); return dispose;
};
afterEach(() => { cleanup.splice(0).forEach(dispose => dispose()); });

describe('shared UI cancel action', () => {
  it('closes one visible top layer, regardless of the order different levels registered', () => {
    const settings = vi.fn(), card = vi.fn();
    const removeSettings = register(settings, 11000);
    register(card, 1000);
    expect(cancelUI()).toBe(true);
    expect(settings).toHaveBeenCalledOnce(); expect(card).not.toHaveBeenCalled();
    removeSettings();
    cancelUI(); expect(card).toHaveBeenCalledOnce();
  });

  it('uses the most recent registration within a level and allows idempotent out-of-order cleanup', () => {
    const first = vi.fn(), second = vi.fn();
    const removeFirst = register(first), removeSecond = register(second);
    removeFirst(); removeFirst();
    cancelUI(); expect(second).toHaveBeenCalledOnce(); expect(first).not.toHaveBeenCalled();
    removeSecond(); expect(cancelUI()).toBe(false);
  });

  it('gives Escape and Android back the same handler without leaving the app', async () => {
    const close = vi.fn(), leave = vi.fn();
    register(close);
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', cancelable: true }));
    expect(close).toHaveBeenCalledOnce();
    await handleBackButton(leave);
    expect(close).toHaveBeenCalledTimes(2); expect(leave).not.toHaveBeenCalled();
  });

  it('prevents a single Escape from reaching other listeners and ignores IME or held keys', () => {
    const close = vi.fn(), oldListener = vi.fn();
    register(close);
    window.addEventListener('keydown', oldListener);
    try {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', isComposing: true }));
      expect(close).not.toHaveBeenCalled(); oldListener.mockClear();
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', repeat: true }));
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
      expect(close).toHaveBeenCalledOnce(); expect(oldListener).not.toHaveBeenCalled();
    } finally { window.removeEventListener('keydown', oldListener); }
  });

  it('leaves only with an empty stack and does not duplicate a pending save/minimize', async () => {
    let release!: () => void;
    const leave = vi.fn(() => new Promise<void>(resolve => { release = resolve; }));
    const first = handleBackButton(leave), second = handleBackButton(leave);
    await Promise.resolve(); expect(leave).toHaveBeenCalledOnce();
    release(); await Promise.all([first, second]);
    expect(cancelUI()).toBe(false);
  });

  it('allows retry after leaving fails, without silently swallowing the error', async () => {
    const leave = vi.fn().mockRejectedValueOnce(new Error('save failed')).mockResolvedValueOnce(undefined);
    await expect(handleBackButton(leave)).rejects.toThrow('save failed');
    await handleBackButton(leave); expect(leave).toHaveBeenCalledTimes(2);
  });
});
