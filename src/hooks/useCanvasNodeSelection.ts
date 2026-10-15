import { useCallback, type MouseEvent, type PointerEvent } from 'react';
import { useStoreApi } from '@xyflow/react';
import { useFlowStore } from '../stores/flowStore';

// 每次按下都以当前修饰键判断单选，避免卡片切换后沿用画布残留的多选状态。
export function useCanvasNodeSelection() {
  const flowApi = useStoreApi();
  const onPointerDownCapture = useCallback((event: PointerEvent<HTMLDivElement>) => {
    if (event.button !== 0) return;
    const target = event.target as HTMLElement;
    const nodeId = target.closest<HTMLElement>('.react-flow__node')?.dataset.id;
    if (!nodeId) return;
    flowApi.setState({ multiSelectionActive: event.ctrlKey || event.metaKey });
  }, [flowApi]);
  // 到点击才清除其他选中项，按住已选卡片拖动时仍可一起移动整组选区。
  const onClickCapture = useCallback((event: MouseEvent<HTMLDivElement>) => {
    if (event.button !== 0) return;
    if (event.shiftKey || event.ctrlKey || event.metaKey) return;
    const nodeId = (event.target as HTMLElement).closest<HTMLElement>('.react-flow__node')?.dataset.id;
    if (!nodeId) return;
    const flow = useFlowStore.getState();
    const changes = flow.nodes.filter((node) => node.selected && node.id !== nodeId)
      .map((node) => ({ id: node.id, type: 'select' as const, selected: false }));
    if (changes.length) flow.onNodesChange(changes);
    const edgeChanges = flow.edges.filter((edge) => edge.selected)
      .map((edge) => ({ id: edge.id, type: 'select' as const, selected: false }));
    if (edgeChanges.length) flow.onEdgesChange(edgeChanges);
  }, []);
  return { onPointerDownCapture, onClickCapture };
}
