import type { WorkspaceData, WorkspaceMetadata } from '../../types/workspace';

export interface StoredWorkspace {
  metadata: WorkspaceMetadata;
  revision: number;
  data: WorkspaceData;
}

export interface HistoryEntry {
  id: string;
  createdAt: number;
  label: string;
  bytes: number;
  side: 'before' | 'after';
  conversations: { id: string; topic: string }[];
}

export interface DocumentVersion { id: string; createdAt: number; preview: string }
export interface SavedWorkspace { revision: number; versions?: Record<string, string> }

// 上层只提交完整操作和读取结果，不依赖 Electron 路径或 SQLite 事务对象。
export interface WorkspaceStorage {
  request<T>(action: string, payload?: object): Promise<T>;
  load(id: string): Promise<StoredWorkspace>;
  save(id: string, data: WorkspaceData, revision: number, label: string, history?: boolean): Promise<SavedWorkspace>;
}
