import type { WorkspaceData } from '../../types/workspace';
import type { SavedWorkspace, StoredWorkspace, WorkspaceStorage } from './types';
import { detectPlatform, usesSqliteStorage } from '../platform';

// 功能按完整 SQLite 存储能力启用，不再把版本和历史入口限定在桌面平台。
export const isSqliteStorage = usesSqliteStorage;

// 业务请求共用；安卓动态加载原生实现，普通网页不会加载 SQLite 插件。
export const sqliteStorage: WorkspaceStorage = {
  async request<T>(action: string, payload: object = {}): Promise<T> {
    const platform = detectPlatform();
    if (platform === 'android') return (await import('./android')).androidRequest<T>(action, payload);
    if (platform !== 'desktop') throw new Error(`当前平台尚未提供 SQLite 存储实现：${platform}`);
    const response = await fetch('/api/storage', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action, payload }) });
    const body = await response.json();
    if (!response.ok || body.error) throw new Error(body.error?.message ?? body.error ?? `存储请求失败 (${response.status})`);
    return body.result as T;
  },
  load(id: string) { return this.request<StoredWorkspace>('load', { id }); },
  save(id: string, data: WorkspaceData, revision: number, label: string, history = true) { return this.request<SavedWorkspace>('save', { id, data, expectedRevision: revision, label, history }); },
};
