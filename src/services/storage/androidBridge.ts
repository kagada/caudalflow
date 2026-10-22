import { registerPlugin } from '@capacitor/core';

export interface InternalFile { database: string; path: string; name?: string; cancelled?: boolean }
interface WorkspaceFilesPlugin {
  location(options: { database: string }): Promise<InternalFile>;
  historyPath(options: { key: string }): Promise<{ path: string }>;
  pickWorkspace(): Promise<InternalFile>;
  exportWorkspace(options: { database: string; name: string }): Promise<{ cancelled?: boolean }>;
  removeWorkspace(options: { database: string; historyKey?: string }): Promise<void>;
  writeClipboard(options: { text: string; html: string }): Promise<void>;
}

// 只向原生层传内部名称，不允许页面指定任意系统文件路径。
export const WorkspaceFiles = registerPlugin<WorkspaceFilesPlugin>('WorkspaceFiles');
