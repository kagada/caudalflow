import type { Node, Edge } from '@xyflow/react';

export interface ChatNodeData {
  topic: string;
  parentNodeId?: string;
  parentNodeIds?: string[];
  branchText?: string;
  mergeAction?: string;
  collapsed?: boolean;
  minimized?: boolean;
  maximized?: boolean;
  // 搞定状态独立于卡片展开/折叠，随工作区一同保存。
  done?: boolean;
  [key: string]: unknown;
  color?: string
  label?: string
}

export type ChatNode = Node<ChatNodeData, 'chat'>;

export interface TopicEdgeData {
  label: string;
  [key: string]: unknown;
}

export type TopicEdge = Edge<TopicEdgeData>;
