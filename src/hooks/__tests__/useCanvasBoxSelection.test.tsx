/** @vitest-environment jsdom */
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useCanvasBoxSelection } from '../useCanvasBoxSelection';

function Harness({ panMode = false }: { panMode?: boolean }) {
  const { canvasRef, onPointerDownCapture } = useCanvasBoxSelection(panMode);
  return <div ref={canvasRef} onPointerDownCapture={onPointerDownCapture}>
    <div className="react-flow__pane">
      <div className="react-flow__node"><span className="select-text">conversation text</span><input className="nokey" /></div>
    </div>
  </div>;
}

describe('box selection and browser text selection', () => {
  let root: Root;
  let container: HTMLDivElement;

  beforeEach(() => {
    vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
    act(() => root.render(<Harness />));
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    window.getSelection()?.removeAllRanges();
    vi.unstubAllGlobals();
  });

  it('blocks text selection throughout a canvas drag and restores it on release', () => {
    const range = document.createRange();
    range.selectNodeContents(container.querySelector('span')!);
    window.getSelection()?.addRange(range);
    const down = new MouseEvent('pointerdown', { bubbles: true, cancelable: true, button: 0 });
    act(() => container.querySelector('.react-flow__pane')!.dispatchEvent(down));
    expect(down.defaultPrevented).toBe(true);
    expect(window.getSelection()?.toString()).toBe('');
    expect(container.querySelector('[data-canvas-box-selecting]')).not.toBeNull();
    const selecting = new Event('selectstart', { bubbles: true, cancelable: true });
    container.querySelector('span')!.dispatchEvent(selecting);
    expect(selecting.defaultPrevented).toBe(true);
    act(() => window.dispatchEvent(new Event('pointerup')));
    expect(container.querySelector('[data-canvas-box-selecting]')).toBeNull();
    const restored = new Event('selectstart', { bubbles: true, cancelable: true });
    container.querySelector('span')!.dispatchEvent(restored);
    expect(restored.defaultPrevented).toBe(false);
  });

  it('keeps ordinary conversation text selection available', () => {
    const down = new MouseEvent('pointerdown', { bubbles: true, cancelable: true, button: 0 });
    container.querySelector('span')!.dispatchEvent(down);
    expect(down.defaultPrevented).toBe(false);
    expect(container.querySelector('[data-canvas-box-selecting]')).toBeNull();
  });

  it('supports Shift box selection over a node, but leaves nokey inputs alone', () => {
    act(() => container.querySelector('span')!.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true, cancelable: true, button: 0, shiftKey: true })));
    expect(container.querySelector('[data-canvas-box-selecting]')).not.toBeNull();
    act(() => window.dispatchEvent(new Event('pointerup')));
    const down = new MouseEvent('pointerdown', { bubbles: true, cancelable: true, button: 0, shiftKey: true });
    container.querySelector('input')!.dispatchEvent(down);
    expect(down.defaultPrevented).toBe(false);
  });

  it.each(['pointercancel', 'blur'])('restores text selection after %s', (event) => {
    act(() => container.querySelector('.react-flow__pane')!.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true, cancelable: true, button: 0 })));
    act(() => window.dispatchEvent(new Event(event)));
    expect(container.querySelector('[data-canvas-box-selecting]')).toBeNull();
  });

  it('does not interfere with space panning or middle-button panning', () => {
    act(() => root.render(<Harness panMode />));
    const down = new MouseEvent('pointerdown', { bubbles: true, cancelable: true, button: 0 });
    container.querySelector('.react-flow__pane')!.dispatchEvent(down);
    expect(down.defaultPrevented).toBe(false);
    act(() => root.render(<Harness />));
    const middle = new MouseEvent('pointerdown', { bubbles: true, cancelable: true, button: 1 });
    container.querySelector('.react-flow__pane')!.dispatchEvent(middle);
    expect(middle.defaultPrevented).toBe(false);
  });
});
