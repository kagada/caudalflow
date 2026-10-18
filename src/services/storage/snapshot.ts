import type { WorkspaceData } from '../../types/workspace';
import type { ChatNode } from '../../types/flow';

const layoutKeys = ['collapsed', 'minimized', 'maximized'];
const canonical = (value: unknown): unknown => Array.isArray(value) ? value.map(canonical) : value && typeof value === 'object' ? Object.fromEntries(Object.entries(value).filter(([, item]) => item !== undefined).sort(([a], [b]) => a.localeCompare(b)).map(([key, item]) => [key, canonical(item)])) : value;

// 布局与内容分离：内容撤销只替换发生变化的会话，现有卡片保持最新位置和尺寸。
export function nodeContent(node: ChatNode) {
  return Object.fromEntries(Object.entries(node.data).filter(([key]) => !layoutKeys.includes(key)));
}

export function contentKey(data: WorkspaceData): string {
  return JSON.stringify(canonical({ nodes: data.nodes.map((node) => ({ id: node.id, data: nodeContent(node) })), edges: data.edges.map(({ id, source, target, data }) => ({ id, source, target, data })), conversations: Object.fromEntries(data.nodes.map(({ id }) => [id, (data.conversations[id]?.messages ?? []).map(({ previousVersions, versionId, usage, ...message }) => {
    void previousVersions; void versionId; void usage;
    return { ...message, kind: message.kind ?? 'message' };
  })])) }));
}

export function copyWorkspace(data: WorkspaceData): WorkspaceData { return JSON.parse(JSON.stringify(data)) as WorkspaceData; }

// 仅对比并回放本次操作触及的内容，避免撤销 A 时覆盖随后生成的 B。
export function replayChanges(current: WorkspaceData, from: WorkspaceData, to: WorkspaceData): WorkspaceData {
  const result = copyWorkspace(current);
  const fromNodes = new Map(from.nodes.map((node) => [node.id, node]));
  const toNodes = new Map(to.nodes.map((node) => [node.id, node]));
  for (const id of new Set([...fromNodes.keys(), ...toNodes.keys()])) {
    const old = fromNodes.get(id);
    const next = toNodes.get(id);
    const contentChanged = JSON.stringify(old && nodeContent(old)) !== JSON.stringify(next && nodeContent(next));
    if (contentChanged) {
      const existing = result.nodes.find((node) => node.id === id);
      result.nodes = result.nodes.filter((node) => node.id !== id);
      if (next) {
        const replacement = existing ? { ...existing, data: { ...Object.fromEntries(Object.entries(existing.data).filter(([key]) => layoutKeys.includes(key))), ...nodeContent(next) } } as ChatNode : next;
        const index = to.nodes.findIndex((node) => node.id === id);
        result.nodes.splice(Math.min(index, result.nodes.length), 0, replacement);
      }
    }
    if (JSON.stringify(from.conversations[id]) !== JSON.stringify(to.conversations[id])) {
      if (to.conversations[id]) result.conversations[id] = copyWorkspace({ nodes: [], edges: [], conversations: { [id]: to.conversations[id] } }).conversations[id];
      else delete result.conversations[id];
    }
  }
  const oldEdges = new Map(from.edges.map((edge) => [edge.id, edge]));
  const nextEdges = new Map(to.edges.map((edge) => [edge.id, edge]));
  for (const id of new Set([...oldEdges.keys(), ...nextEdges.keys()])) {
    if (JSON.stringify(oldEdges.get(id)) === JSON.stringify(nextEdges.get(id))) continue;
    result.edges = result.edges.filter((edge) => edge.id !== id);
    if (nextEdges.has(id)) result.edges.push(nextEdges.get(id)!);
  }
  return result;
}
