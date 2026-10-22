/** @vitest-environment jsdom */
import { act, useEffect } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useAndroidKeyboardAvoidance } from '../useAndroidKeyboardAvoidance';
import { useWorkspaceStore } from '../../stores/workspaceStore';
import { useFlowStore } from '../../stores/flowStore';

const fake = vi.hoisted(() => ({
  android: true, viewport: { x: 20, y: 30, zoom: 0.8 },
  getViewport: vi.fn(), setViewport: vi.fn(),
  listeners: new Map<string, (info?: { keyboardHeight: number }) => void>(), addListener: vi.fn(),
}));
vi.mock('@xyflow/react', () => ({ useReactFlow: () => ({ getViewport: fake.getViewport, setViewport: fake.setViewport }) }));
vi.mock('../../services/platform', () => ({ isAndroid: () => fake.android }));
vi.mock('@capacitor/keyboard', () => ({ Keyboard: { addListener: fake.addListener } }));

let controls: ReturnType<typeof useAndroidKeyboardAvoidance>;
function Harness() {
  const current = useAndroidKeyboardAvoidance();
  useEffect(() => { controls = current; });
  return <div className="react-flow__node"><div data-chat-input="c1"><textarea /><button>发送</button></div></div>;
}
let root: Root;
let host: HTMLDivElement;
let visual: EventTarget & { height: number; offsetTop: number };
let frames: Map<number, FrameRequestCallback>;
let frameId: number;
let baseBottom: number;
let resized: ResizeObserverCallback;
async function flush() {
  await act(async () => {
    const callbacks = [...frames.values()]; frames.clear(); callbacks.forEach(callback => callback(0));
    await Promise.resolve();
  });
}
async function show(resizes = true) {
  if (resizes) { visual.height = 500; vi.stubGlobal('innerHeight', 500); }
  fake.listeners.get('keyboardWillShow')!({ keyboardHeight: 300 });
  fake.listeners.get('keyboardDidShow')!({ keyboardHeight: 300 });
  visual.dispatchEvent(new Event('resize'));
  await flush();
}
async function hide() {
  fake.listeners.get('keyboardWillHide')!();
  fake.listeners.get('keyboardDidHide')!();
  visual.height = 800; vi.stubGlobal('innerHeight', 800);
  visual.dispatchEvent(new Event('resize'));
  await flush();
}
beforeEach(async () => {
  vi.clearAllMocks(); fake.android = true; fake.viewport = { x: 20, y: 30, zoom: 0.8 }; fake.listeners.clear();
  frames = new Map(); frameId = 0; baseBottom = 620;
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  vi.stubGlobal('innerHeight', 800);
  visual = Object.assign(new EventTarget(), { height: 800, offsetTop: 0 });
  vi.stubGlobal('visualViewport', visual);
  vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => { frames.set(++frameId, callback); return frameId; });
  vi.stubGlobal('cancelAnimationFrame', (id: number) => frames.delete(id));
  vi.stubGlobal('ResizeObserver', class { constructor(callback: ResizeObserverCallback) { resized = callback; } observe() {} disconnect() {} });
  fake.getViewport.mockImplementation(() => ({ ...fake.viewport }));
  fake.setViewport.mockImplementation(async (viewport) => { fake.viewport = viewport; return true; });
  fake.addListener.mockImplementation(async (name, callback) => {
    fake.listeners.set(name, callback);
    return { remove: async () => { fake.listeners.delete(name); } };
  });
  useWorkspaceStore.setState({ activeWorkspaceId: 'a' });
  useFlowStore.setState({ nodes: [{ id: 'c1', type: 'chat', position: { x: 0, y: 0 }, data: { topic: 'test' } }], edges: [] });
  host = document.createElement('div'); document.body.append(host); root = createRoot(host);
  await act(async () => root.render(<Harness />));
  await vi.waitFor(() => expect(fake.listeners.size).toBe(4));
  const area = host.querySelector('[data-chat-input]')!;
  vi.spyOn(area, 'getBoundingClientRect').mockImplementation(() => ({ bottom: baseBottom + fake.viewport.y - 30 }) as DOMRect);
  await act(async () => host.querySelector('textarea')!.focus());
});
afterEach(async () => { await act(async () => root.unmount()); host.remove(); vi.unstubAllGlobals(); });

describe('Android keyboard avoidance', () => {
  it.each([true, false])('moves only the obscured distance, with window resizing=%s', async resizes => {
    await show(resizes);
    expect(fake.viewport).toEqual({ x: 20, y: -102, zoom: 0.8 });
    expect(controls.shouldSaveViewport()).toBe(false);
    expect(useFlowStore.getState().nodes[0].position).toEqual({ x: 0, y: 0 });
    await hide();
    expect(fake.viewport).toEqual({ x: 20, y: 30, zoom: 0.8 });
    expect(controls.shouldSaveViewport()).toBe(true);
  });

  it('does not move an input that is already visible', async () => {
    baseBottom = 450; await show();
    expect(fake.setViewport).not.toHaveBeenCalled();
    expect(controls.shouldSaveViewport()).toBe(true);
  });

  it('does not accumulate movement on repeated viewport resize events', async () => {
    await show();
    for (let n = 0; n < 3; n++) { visual.dispatchEvent(new Event('resize')); await flush(); }
    expect(fake.viewport.y).toBe(-102);
    expect(fake.setViewport).toHaveBeenCalledOnce();
  });

  it('keeps a manually chosen view and allows it to be saved', async () => {
    await show();
    controls.onMoveStart(new MouseEvent('mousedown'));
    fake.viewport = { x: 80, y: -60, zoom: 0.7 };
    visual.dispatchEvent(new Event('resize')); await flush();
    expect(controls.shouldSaveViewport()).toBe(true);
    await hide();
    expect(fake.viewport).toEqual({ x: 80, y: -60, zoom: 0.7 });
  });

  it('does not mistake a programmatic move for manual navigation', async () => {
    await show(); controls.onMoveStart(null); await hide();
    expect(fake.viewport.y).toBe(30);
  });

  it('adjusts when the focused input grows', async () => {
    await show(); baseBottom += 40;
    resized([], {} as ResizeObserver); await flush();
    expect(fake.viewport.y).toBe(-142);
  });

  it('uses the enlarged visible area when rotating with the keyboard open', async () => {
    visual.height = 450; vi.stubGlobal('innerHeight', 450); baseBottom = 350;
    await act(async () => { host.querySelector('textarea')!.blur(); host.querySelector('textarea')!.focus(); });
    visual.height = 150; vi.stubGlobal('innerHeight', 150); await show(false);
    const previous = fake.viewport.y;
    visual.height = 500; vi.stubGlobal('innerHeight', 500); baseBottom += 80;
    visual.dispatchEvent(new Event('resize')); await flush();
    expect(fake.viewport.y).toBe(previous);
  });

  it('leaves a full-screen conversation to its existing layout', async () => {
    host.firstElementChild!.setAttribute('data-maximized-conversation', '');
    await show(); await hide();
    expect(fake.setViewport).not.toHaveBeenCalled();
  });

  it('restores the temporary pan when a conversation becomes full-screen', async () => {
    await show();
    await act(async () => useFlowStore.getState().updateNodeData('c1', { maximized: true }));
    await flush();
    expect(fake.viewport.y).toBe(30);
    expect(controls.shouldSaveViewport()).toBe(true);
  });

  it('does not restore old coordinates after switching workspaces', async () => {
    await show();
    await act(async () => useWorkspaceStore.setState({ activeWorkspaceId: 'b' }));
    fake.viewport = { x: 100, y: 200, zoom: 1 };
    await hide();
    expect(fake.viewport).toEqual({ x: 100, y: 200, zoom: 1 });
  });

  it('does not install keyboard listeners or adjust anything on PC', async () => {
    await act(async () => root.unmount()); fake.addListener.mockClear(); fake.android = false;
    root = createRoot(host); await act(async () => root.render(<Harness />));
    visual.dispatchEvent(new Event('resize')); await flush();
    expect(fake.addListener).not.toHaveBeenCalled();
    expect(fake.setViewport).not.toHaveBeenCalled();
  });
});
