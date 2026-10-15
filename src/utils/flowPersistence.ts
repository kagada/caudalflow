import { shallow } from 'zustand/shallow';
import type { ChatNode, TopicEdge } from '../types/flow';

type FlowSnapshot = { nodes: ChatNode[]; edges: TopicEdge[] };

// 框选、拖动过程标记和自动测量不改变工作区内容，不应触发或延后全量保存。
export function hasPersistedFlowChanges(next: FlowSnapshot, previous: FlowSnapshot): boolean {
  const nodesChanged = next.nodes !== previous.nodes && (
    next.nodes.length !== previous.nodes.length || next.nodes.some((node, index) => {
      const old = previous.nodes[index];
      if (node === old) return false;
      return !shallow(
        { ...node, selected: undefined, dragging: undefined, resizing: undefined, measured: undefined },
        { ...old, selected: undefined, dragging: undefined, resizing: undefined, measured: undefined },
      );
    })
  );
  if (nodesChanged) return true;
  return next.edges !== previous.edges && (
    next.edges.length !== previous.edges.length || next.edges.some((edge, index) => {
      const old = previous.edges[index];
      if (edge === old) return false;
      return !shallow({ ...edge, selected: undefined }, { ...old, selected: undefined });
    })
  );
}
