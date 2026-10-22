/** @vitest-environment jsdom */
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import type { NodeProps } from '@xyflow/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ChatNodeComponent } from '../ChatNode';
import { useFlowStore } from '../../../stores/flowStore';
import { useSettingsStore } from '../../../stores/settingsStore';
import { useChatStore } from '../../../stores/chatStore';
import type { ChatNode } from '../../../types/flow';
import i18n from '../../../i18n';
const { androidPlatform } = vi.hoisted(() => ({ androidPlatform: vi.fn(() => false) }));
vi.mock('../../../services/platform', async original => ({ ...await original<typeof import('../../../services/platform')>(), isAndroid: androidPlatform }));

vi.hoisted(() => { window.matchMedia = vi.fn().mockReturnValue({ matches: false, addEventListener: vi.fn() }); });
vi.mock('@xyflow/react', () => ({ Handle: () => null, NodeResizer: ({ isVisible }: { isVisible: boolean }) => isVisible ? <div data-resize-controls /> : null, Position: { Left: 'left', Right: 'right' }, useUpdateNodeInternals: () => () => {} }));
vi.mock('../../../hooks/useNodeCopilotChat', () => ({ useNodeCopilotChat: () => ({ sendMessage: vi.fn(), cancelStream: vi.fn(), reviseMessage: vi.fn() }) }));
vi.mock('../ChatMessageList', () => ({ ChatMessageList: () => null }));
vi.mock('../ChatInput', () => ({ ChatInput: () => null }));

function View() {
  const node = useFlowStore(state => state.nodes[0]);
  const props: NodeProps<ChatNode> = {
    id: node.id, data: node.data, type: 'chat', selected: !!node.selected,
    dragging: false, draggable: true, selectable: true, deletable: true,
    isConnectable: true, positionAbsoluteX: 100, positionAbsoluteY: 200, zIndex: 1,
  };
  return <ChatNodeComponent {...props} />;
}

let root: Root;
let host: HTMLDivElement;
beforeEach(async () => {
  androidPlatform.mockReturnValue(false);
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  vi.stubGlobal('requestAnimationFrame', vi.fn(() => 0));
  vi.stubGlobal('cancelAnimationFrame', vi.fn());
  await i18n.changeLanguage('zh');
  useFlowStore.setState({ nodes: [], edges: [], activeNodeId: null });
  useChatStore.setState({ conversations: {} });
  host = document.createElement('div'); document.body.append(host); root = createRoot(host);
});
afterEach(async () => { await act(async () => root.unmount()); host.remove(); vi.unstubAllGlobals(); });

describe('compact card opening uses the local setting', () => {
  it.each([false, true])('shows the active Android card border with React Flow selection disabled (compact=%s)', async collapsed => {
    androidPlatform.mockReturnValue(true);
    const first = useFlowStore.getState().addChatNode({ x: 0, y: 0 }, { topic: '第一张', collapsed });
    const second = useFlowStore.getState().addChatNode({ x: 450, y: 0 }, { topic: '第二张' });
    useFlowStore.setState(state => ({ nodes: state.nodes.map(node => ({ ...node, selected: false })), activeNodeId: first }));
    await act(async () => root.render(<View />));
    expect(host.firstElementChild!.className).toContain('border-accent-500');
    expect(!!host.querySelector('[data-resize-controls]')).toBe(!collapsed);
    await act(async () => useFlowStore.getState().activateNode(second));
    expect(host.firstElementChild!.className).toContain('border-border');
    expect(host.querySelector('[data-resize-controls]')).toBeNull();
    await act(async () => useFlowStore.getState().activateNode(first));
    expect(host.firstElementChild!.className).toContain('border-accent-500');
    expect(!!host.querySelector('[data-resize-controls]')).toBe(!collapsed);
    expect(useFlowStore.getState().nodes.every(node => !node.selected)).toBe(true);
  });

  it.each([false, true])('keeps desktop borders tied to selection rather than the active card (compact=%s)', async collapsed => {
    const first = useFlowStore.getState().addChatNode({ x: 0, y: 0 }, { topic: '第一张', collapsed });
    const second = useFlowStore.getState().addChatNode({ x: 450, y: 0 }, { topic: '第二张' });
    useFlowStore.setState(state => ({ nodes: state.nodes.map(node => ({ ...node, selected: node.id === first })) }));
    await act(async () => root.render(<View />));
    expect(host.firstElementChild!.className).toContain('border-accent-500');
    await act(async () => useFlowStore.getState().activateNode(first));
    await act(async () => useFlowStore.getState().activateNode(second));
    expect(host.firstElementChild!.className).toContain('border-accent-500');
    await act(async () => useFlowStore.setState(state => ({ nodes: state.nodes.map(node => ({ ...node, selected: false })) })));
    expect(host.firstElementChild!.className).toContain('border-border');
  });

  it.each([
    ['minimized', true, 'expand'], ['collapsed', true, 'expand'],
    ['minimized', false, 'expand'], ['collapsed', false, 'expand'],
    ['minimized', true, 'doubleClick'], ['collapsed', true, 'doubleClick'],
    ['minimized', false, 'doubleClick'], ['collapsed', false, 'doubleClick'],
  ] as const)('%s / maximized=%s / %s', async (kind, maximized, trigger) => {
    useSettingsStore.getState().setOpenCompactCardsMaximized(maximized);
    useFlowStore.getState().addChatNode({ x: 100, y: 200 }, { topic: '阅读', [kind]: true });
    await act(async () => root.render(<View />));
    await act(async () => {
      if (trigger === 'expand') host.querySelector<HTMLButtonElement>('button[title="展开"]')!.click();
      else host.firstElementChild!.dispatchEvent(new MouseEvent('dblclick', { bubbles: true }));
    });
    expect(Boolean(document.querySelector('[data-maximized-conversation]'))).toBe(maximized);
    expect(!!document.querySelector('[data-resize-controls]')).toBe(!maximized);
    expect(useFlowStore.getState().nodes[0].data).toMatchObject({ minimized: false, collapsed: false, maximized });
    expect(useFlowStore.getState().nodes[0].position).toEqual({ x: 100, y: 200 });
    expect(useFlowStore.getState().nodes[0].style).toEqual({ width: 400, height: 500 });
  });
});
