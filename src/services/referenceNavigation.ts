import { useFlowStore } from '../stores/flowStore';
import { useChatStore } from '../stores/chatStore';
import { useWorkspaceStore } from '../stores/workspaceStore';

// 正向与反向追溯都只展开、平移并定位消息，缩放仍由画布保留当前值。
export function locateReferenceMessage(nodeId: string, messageId: string, sourceStart?: number): boolean {
  const workspaceId = useWorkspaceStore.getState().activeWorkspaceId;
  const flow = useFlowStore.getState();
  if (!flow.nodes.some((node) => node.id === nodeId) || !useChatStore.getState().getMessages(nodeId).some((message) => message.id === messageId)) return false;
  for (const node of flow.nodes) if (node.data.maximized) flow.updateNodeData(node.id, { maximized: false });
  flow.updateNodeData(nodeId, { minimized: false, collapsed: false }); flow.activateNode(nodeId);
  window.dispatchEvent(new CustomEvent('caudalflow:locate-reference', { detail: nodeId }));
  window.setTimeout(() => {
    if (useWorkspaceStore.getState().activeWorkspaceId !== workspaceId) return;
    const element = [...document.querySelectorAll<HTMLElement>('[data-message-id]')].find((item) => item.dataset.messageId === messageId && item.closest<HTMLElement>('.react-flow__node')?.dataset.id === nodeId);
    if (!element) return;
    const paragraph = sourceStart === undefined ? undefined : [...element.querySelectorAll<HTMLElement>('[data-source-start]')].find((item) => Number(item.dataset.sourceStart) <= sourceStart && Number(item.dataset.sourceEnd) > sourceStart);
    const target = paragraph ?? element.querySelector<HTMLElement>('[data-message-content]') ?? element;
    target.scrollIntoView?.({ block: 'center', behavior: 'smooth' });
    target.animate?.([{ backgroundColor: getComputedStyle(target).getPropertyValue('--reference-highlight-bg').trim() }, { backgroundColor: 'transparent' }], { duration: 1500, iterations: 2 });
  }, 100);
  return true;
}
