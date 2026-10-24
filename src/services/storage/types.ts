import type { WorkspaceData, WorkspaceMetadata } from '../../types/workspace';
import type { RequestUsage } from '../../types/chat';

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
}

export interface HistoryDetail extends HistoryEntry { before: WorkspaceData; after: WorkspaceData }
export interface HistorySelection { documentIds?: string[]; attributesOnly?: boolean; relationIds?: string[] }

export interface DocumentVersion { id: number; createdAt: number; preview: string }
export interface SavedWorkspace { revision: number; versions?: Record<string, number | null>; usage?: Record<string, RequestUsage[]>; documentUsage?: Record<string, RequestUsage[]> }

// 上层只提交完整操作和读取结果，不依赖 Electron 路径或 SQLite 事务对象。
export interface WorkspaceStorage {
  request<T>(action: string, payload?: object): Promise<T>;
  load(id: string): Promise<StoredWorkspace>;
  save(id: string, data: WorkspaceData, revision: number, label: string, history?: boolean): Promise<SavedWorkspace>;
}
