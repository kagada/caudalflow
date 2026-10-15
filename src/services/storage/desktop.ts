import type { WorkspaceData } from '../../types/workspace';
import type { SavedWorkspace, StoredWorkspace, WorkspaceStorage } from './types';

export const isDesktopStorage = () => typeof location !== 'undefined' && location.protocol === 'app:';

// 浏览器版仍保留旧存储；只在桌面调用异步接口，未来可替换为 Web 的存储适配。
export const desktopStorage: WorkspaceStorage = {
  async request<T>(action: string, payload: object = {}): Promise<T> {
    const response = await fetch('/api/storage', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action, payload }) });
    const body = await response.json();
    if (!response.ok || body.error) throw new Error(body.error?.message ?? body.error ?? `存储请求失败 (${response.status})`);
    return body.result as T;
  },
  load(id: string) { return this.request<StoredWorkspace>('load', { id }); },
  save(id: string, data: WorkspaceData, revision: number, label: string, history = true) { return this.request<SavedWorkspace>('save', { id, data, expectedRevision: revision, label, history }); },
};
