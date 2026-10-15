import type React from 'react';
import { create } from 'zustand';
import {
  applyNodeChanges,
  applyEdgeChanges,
  type OnNodesChange,
  type OnEdgesChange,
} from '@xyflow/react';
import { nanoid } from 'nanoid';
import type { ChatNode, ChatNodeData, TopicEdge } from '../types/flow';

interface FlowState {
  nodes: ChatNode[];
  edges: TopicEdge[];
  activeNodeId: string | null;
  activateNode: (id: string) => void;
  closeActiveCard: () => void;
  onNodesChange: OnNodesChange<ChatNode>;
  onEdgesChange: OnEdgesChange<TopicEdge>;
  addChatNode: (position: { x: number; y: number }, data: ChatNodeData) => string;
  addNewChatNode: (fallback: { x: number; y: number }, data: ChatNodeData) => string;
  removeNode: (id: string) => void;
  updateNodeData: (id: string, data: Partial<ChatNodeData>) => void;
  updateNodeStyle: (id: string, style: React.CSSProperties) => void;
  addEdge: (source: string, target: string, label: string) => void;
  setNodes: (nodes: ChatNode[]) => void;
  setEdges: (edges: TopicEdge[]) => void;
  getChildCount: (parentId: string) => number;
  toggleCollapseSmart: () => void;
}

export const useFlowStore = create<FlowState>((set, get) => ({
  nodes: [],
  edges: [],
  activeNodeId: null,
  // Ctrl+W 只把活跃中卡片或大卡片收成小卡片，保留坐标、尺寸记录和对话。
  closeActiveCard: () => {
    const { nodes, activeNodeId } = get();
    const node = nodes.find((item) => item.id === activeNodeId);
    if (!node || node.data.minimized || node.data.collapsed) return;
    set({ nodes: nodes.map((item) => item.id === activeNodeId ? { ...item, data: {
      ...item.data, minimized: true, collapsed: false, maximized: false,
      _prevWidth: typeof item.style?.width === 'number' ? item.style.width : 400,
      _prevHeight: typeof item.style?.height === 'number' ? item.style.height : 500,
    } } : item) });
  },

  // 活动对话保持在最上层；不改选中状态，保留 Shift 多选和合并操作。
  activateNode: (id) => {
    const { nodes, activeNodeId } = get();
    if (!nodes.some((node) => node.id === id) || activeNodeId === id) return;
    const zIndex = Math.max(0, ...nodes.map((node) => node.zIndex ?? 0)) + 1;
    set({ activeNodeId: id, nodes: nodes.map((node) => node.id === id ? { ...node, zIndex } : node) });
  },

  onNodesChange: (changes) => {
    set({ nodes: applyNodeChanges(changes, get().nodes) });
  },

  onEdgesChange: (changes) => {
    set({ edges: applyEdgeChanges(changes, get().edges) });
  },

  // 普通新建入口共用位置规则；分支和连线创建仍使用各自指定的位置。
  addNewChatNode: (fallback, data) => {
    const active = get().nodes.find((node) => node.id === get().activeNodeId);
    return get().addChatNode(active ? { x: active.position.x + 48, y: active.position.y + 48 } : fallback, data);
  },

  addChatNode: (position, data) => {
    const id = nanoid();
    const newNode: ChatNode = {
      id,
      type: 'chat',
      position,
      data,
      style: { width: 400, height: 500 },
      selected: true,
      zIndex: Math.max(0, ...get().nodes.map((node) => node.zIndex ?? 0)) + 1,
    };
    // 新对话立即成为活动卡片并置顶，不能被已有卡片遮住。
    set({ activeNodeId: id, nodes: [...get().nodes.map((node) => ({ ...node, selected: false })), newNode] });
    return id;
  },

  removeNode: (id) => {
    set({
      nodes: get().nodes.filter((n) => n.id !== id),
      edges: get().edges.filter((e) => e.source !== id && e.target !== id),
      activeNodeId: get().activeNodeId === id ? null : get().activeNodeId,
    });
  },

  updateNodeData: (id, data) => {
    set({
      nodes: get().nodes.map((n) =>
        n.id === id ? { ...n, data: { ...n.data, ...data } } : n
      ),
    });
  },

  updateNodeStyle: (id, style) => {
    set({
      nodes: get().nodes.map((n) =>
        n.id === id ? { ...n, style: { ...n.style, ...style } } : n
      ),
    });
  },

  addEdge: (source, target, label) => {
    const edge: TopicEdge = {
      id: `e-${source}-${target}`,
      source,
      target,
      sourceHandle: 'right',
      targetHandle: 'left',
      type: 'topic',
      data: { label },
    };
    set({ edges: [...get().edges, edge] });
  },

  setNodes: (nodes) => set({ nodes, activeNodeId: nodes.some((node) => node.id === get().activeNodeId) ? get().activeNodeId : nodes.find((node) => node.selected)?.id ?? nodes.at(-1)?.id ?? null }),
  setEdges: (edges) => set({ edges }),

  getChildCount: (parentId) => {
    return get().edges.filter((e) => e.source === parentId).length;
  },

  toggleCollapseSmart: () => {
  const nodes = get().nodes;

  if (nodes.length === 0) return;

  const collapsedCount = nodes.filter((n) => n.data?.collapsed).length;

  const shouldCollapse = collapsedCount < nodes.length / 2;

  set({
    nodes: nodes.map((n) => ({
      ...n,
      data: {
        ...n.data,
        collapsed: shouldCollapse,
      },
    })),
  });
},
  
}));
