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

vi.hoisted(() => { window.matchMedia = vi.fn().mockReturnValue({ matches: false, addEventListener: vi.fn() }); });
vi.mock('@xyflow/react', () => ({ Handle: () => null, NodeResizer: () => null, Position: { Left: 'left', Right: 'right' }, useUpdateNodeInternals: () => () => {} }));
vi.mock('../../../hooks/useNodeCopilotChat', () => ({ useNodeCopilotChat: () => ({ sendMessage: vi.fn(), cancelStream: vi.fn(), reviseMessage: vi.fn() }) }));
vi.mock('../ChatMessageList', () => ({ ChatMessageList: () => null }));
vi.mock('../ChatInput', () => ({ ChatInput: () => null }));

function View() {
  const node = useFlowStore(state => state.nodes[0]);
  const props: NodeProps<ChatNode> = {
    id: node.id, data: node.data, type: 'chat', selected: false,
    dragging: false, draggable: true, selectable: true, deletable: true,
    isConnectable: true, positionAbsoluteX: 100, positionAbsoluteY: 200, zIndex: 1,
  };
  return <ChatNodeComponent {...props} />;
}

let root: Root;
let host: HTMLDivElement;
beforeEach(async () => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  vi.stubGlobal('requestAnimationFrame', vi.fn(() => 0));
  vi.stubGlobal('cancelAnimationFrame', vi.fn());
  await i18n.changeLanguage('zh');
  useFlowStore.setState({ nodes: [], edges: [] });
  useChatStore.setState({ conversations: {} });
  host = document.createElement('div'); document.body.append(host); root = createRoot(host);
});
afterEach(async () => { await act(async () => root.unmount()); host.remove(); vi.unstubAllGlobals(); });

describe('compact card opening uses the local setting', () => {
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
    expect(useFlowStore.getState().nodes[0].data).toMatchObject({ minimized: false, collapsed: false, maximized });
    expect(useFlowStore.getState().nodes[0].position).toEqual({ x: 100, y: 200 });
    expect(useFlowStore.getState().nodes[0].style).toEqual({ width: 400, height: 500 });
  });
});
