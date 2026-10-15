/** @vitest-environment jsdom */
import { act, useEffect } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { ReactFlowProvider, useStoreApi } from '@xyflow/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useCanvasNodeSelection } from '../useCanvasNodeSelection';
import { useFlowStore } from '../../stores/flowStore';

let flowApi: ReturnType<typeof useStoreApi>;
function Harness() {
  const api = useStoreApi();
  useEffect(() => { flowApi = api; }, [api]);
  const selectionHandlers = useCanvasNodeSelection();
  return <div {...selectionHandlers}>
    <div className="react-flow__node" data-id="b"><span>card</span></div>
    <button>canvas control</button>
  </div>;
}

describe('ordinary card clicks after compact transitions', () => {
  let root: Root;
  let container: HTMLDivElement;
  beforeEach(() => {
    vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
    useFlowStore.setState({ nodes: ['a', 'b', 'c'].map((id) => ({
      id, type: 'chat', position: { x: 0, y: 0 }, data: { topic: id, minimized: true }, selected: true,
    })), edges: [{ id: 'ab', source: 'a', target: 'b', selected: true }] });
    container = document.createElement('div'); document.body.append(container);
    root = createRoot(container);
    act(() => root.render(<ReactFlowProvider><Harness /></ReactFlowProvider>));
    flowApi.setState({ multiSelectionActive: true });
  });
  afterEach(() => {
    act(() => root.unmount()); container.remove(); vi.unstubAllGlobals();
  });

  it('clears stale multi-selection and other selected cards on an unmodified click', () => {
    act(() => container.querySelector('span')!.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true, button: 0 })));
    expect(flowApi.getState().multiSelectionActive).toBe(false);
    expect(useFlowStore.getState().nodes.every((node) => node.selected)).toBe(true);
    act(() => container.querySelector('span')!.dispatchEvent(new MouseEvent('click', { bubbles: true, button: 0 })));
    expect(useFlowStore.getState().nodes.filter((node) => node.selected).map((node) => node.id)).toEqual(['b']);
    expect(useFlowStore.getState().edges[0].selected).toBe(false);
  });

  it.each(['shiftKey', 'ctrlKey', 'metaKey'])('preserves intentional selection with %s', (key) => {
    act(() => container.querySelector('span')!.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true, button: 0, [key]: true })));
    act(() => container.querySelector('span')!.dispatchEvent(new MouseEvent('click', { bubbles: true, button: 0, [key]: true })));
    expect(useFlowStore.getState().nodes.every((node) => node.selected)).toBe(true);
    expect(useFlowStore.getState().edges[0].selected).toBe(true);
    expect(flowApi.getState().multiSelectionActive).toBe(key !== 'shiftKey');
  });

  it('leaves middle-button panning and canvas controls alone', () => {
    act(() => container.querySelector('span')!.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true, button: 1 })));
    act(() => container.querySelector('button')!.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true, button: 0 })));
    expect(useFlowStore.getState().nodes.every((node) => node.selected)).toBe(true);
    expect(flowApi.getState().multiSelectionActive).toBe(true);
  });
});
