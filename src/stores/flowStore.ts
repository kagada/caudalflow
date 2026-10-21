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
  openCompactCard: (id: string, maximized: boolean) => void;
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
    } } : item) });
  },

  // 折叠和关闭产生的小卡片共用打开入口；切换阅读方式不改画布坐标及展开尺寸。
  openCompactCard: (id, maximized) => {
    const { nodes } = get();
    const target = nodes.find(node => node.id === id);
    if (!target || (!target.data.minimized && !target.data.collapsed)) return;
    const zIndex = Math.max(0, ...nodes.map(node => node.zIndex ?? 0)) + 1;
    set({ activeNodeId: id, nodes: nodes.map(node => node.id === id
      ? { ...node, zIndex, data: { ...node.data, minimized: false, collapsed: false, maximized } }
      : maximized && node.data.maximized ? { ...node, data: { ...node.data, maximized: false } } : node),
    });
  },

  // 活动对话保持在最上层；不改选中状态，保留 Shift 多选和合并操作。
  activateNode: (id) => {
    const { nodes, activeNodeId } = get();
    if (!nodes.some((node) => node.id === id) || activeNodeId === id) return;
    const zIndex = Math.max(0, ...nodes.map((node) => node.zIndex ?? 0)) + 1;
    set({ activeNodeId: id, nodes: nodes.map((node) => node.id === id ? { ...node, zIndex } : node) });
  },

  onNodesChange: (changes) => {
    const nodes = applyNodeChanges(changes, get().nodes);
    // 用户调整尺寸才更新展开尺寸；紧凑卡片和自动测量不能覆盖它。
    const resized = changes.filter((change) => change.type === 'dimensions' && change.setAttributes);
    set({ nodes: nodes.map((node) => {
      if (node.data.collapsed || node.data.minimized) return node;
      const change = resized.find((item) => item.type === 'dimensions' && item.id === node.id);
      if (!change || change.type !== 'dimensions' || !change.dimensions) return node;
      return { ...node, style: { ...node.style,
        ...(change.setAttributes === true || change.setAttributes === 'width' ? { width: change.dimensions.width } : {}),
        ...(change.setAttributes === true || change.setAttributes === 'height' ? { height: change.dimensions.height } : {}),
      } };
    }) });
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
      data: { titleSource: 'pending', ...data },
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
        n.id === id ? { ...n, data: { ...n.data, ...data, ...(data.topic !== undefined && data.titleSource === undefined ? { titleSource: 'manual' as const } : {}) } } : n
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
      // 两端节点单独保存，连线使用独立的短标识。
      id: nanoid(12),
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
