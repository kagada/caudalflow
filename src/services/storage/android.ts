import { WorkspaceDatabase, EMPTY } from '../../../shared/storage/workspace.mjs';
import type { SaveOptions, SqlDriver } from '../../../shared/storage/workspace.mjs';
import { workspaceHistoryKey } from '../../../shared/storage/bytes.mjs';
import { serializeWorkspace } from '../../../shared/storage/serialized.mjs';
import type { WorkspaceData, WorkspaceMetadata } from '../../types/workspace';
import type { HistorySelection, StoredWorkspace } from './types';
import { WorkspaceFiles } from './androidBridge';
import { openAndroidSqlite } from './androidSqlite';

interface Entry { id: string; database_name: string }
interface Payload extends SaveOptions {
  id?: string; name?: string; data?: WorkspaceData; historyId?: string;
  side?: 'before' | 'after'; conversationId?: string; selection?: HistorySelection;
  documentId?: string; versionId?: number; key?: string; summary?: string;
  legacy?: { metadata: WorkspaceMetadata; raw: string }[];
}

let catalog: SqlDriver;
const opened = new Map<string, { database: string; workspace: WorkspaceDatabase }>();
let queue: Promise<unknown> = Promise.resolve();
let initialization: Promise<void> | undefined;

async function initialize() {
  if (!initialization) initialization = (async () => {
    catalog = await openAndroidSqlite('catalog');
    await catalog.query('PRAGMA journal_mode=DELETE');
    await catalog.exec(`PRAGMA synchronous=FULL;
      CREATE TABLE IF NOT EXISTS workspaces(id TEXT PRIMARY KEY, database_name TEXT NOT NULL UNIQUE);
      CREATE TABLE IF NOT EXISTS app_meta(key TEXT PRIMARY KEY,value TEXT NOT NULL);`);
  })().catch(async error => {
    await catalog?.close().catch(() => {});
    initialization = undefined;
    throw error;
  });
  await initialization;
}

// 工作区文件使用内部随机名称；历史仍由工作区 ID 定位，文件导出不携带个人历史。
async function openFile(database: string, options: { create?: boolean; metadata?: WorkspaceMetadata } = {}) {
  const driver = await openAndroidSqlite(database);
  const workspace = new WorkspaceDatabase(driver);
  try {
    await workspace.open({ ...options, historyFile: async id => (await WorkspaceFiles.historyPath({ key: await workspaceHistoryKey(id) })).path });
    return serializeWorkspace(workspace);
  } catch (error) { await driver.close().catch(() => {}); throw error; }
}

async function database(id: string) {
  const existing = opened.get(id);
  if (existing) return existing;
  const entry = await catalog.get('SELECT database_name FROM workspaces WHERE id=?', [id]);
  if (!entry) throw new Error('工作区未登记');
  const name = String(entry.database_name);
  const result = { database: name, workspace: await openFile(name) };
  opened.set(id, result);
  return result;
}

async function list(): Promise<WorkspaceMetadata[]> {
  const entries = await catalog.query('SELECT id,database_name FROM workspaces ORDER BY rowid');
  const result: WorkspaceMetadata[] = [];
  for (const raw of entries) {
    const entry: Entry = { id: String(raw.id), database_name: String(raw.database_name) };
    try { result.push({ ...(await database(entry.id)).workspace.metadata }); }
    catch { result.push({ id: entry.id, name: '不可用的工作区', unavailable: true, createdAt: 0, updatedAt: 0 }); }
  }
  return result;
}

async function create(payload: Payload): Promise<StoredWorkspace> {
  const now = Date.now();
  const id = payload.id ?? crypto.randomUUID();
  const name = payload.name?.trim() || '新工作区';
  if (await catalog.get('SELECT id FROM workspaces WHERE id=?', [id])) throw new Error('工作区已存在');
  const internal = `w_${crypto.randomUUID().replaceAll('-', '')}`;
  const workspace = await openFile(internal, { create: true, metadata: { id, name, createdAt: now, updatedAt: now } });
  try {
    await workspace.save(payload.data ?? EMPTY(), { history: false });
    await catalog.run('INSERT INTO workspaces VALUES (?,?)', [id, internal]);
    opened.set(id, { database: internal, workspace });
    return await workspace.load();
  } catch (error) {
    await workspace.close().catch(() => {});
    await WorkspaceFiles.removeWorkspace({ database: internal }).catch(() => {});
    throw error;
  }
}

// 所有请求进入同一队列；原生文件选择等待期间也不能穿插删除或导出。
export function androidRequest<T>(action: string, payload: Payload = {}): Promise<T> {
  const result = queue.then(async () => { await initialize(); return handle(action, payload) as Promise<T>; });
  queue = result.catch(() => {});
  return result;
}

async function handle(action: string, payload: Payload): Promise<unknown> {
  if (action === 'bootstrap') {
    if (!await catalog.get("SELECT value FROM app_meta WHERE key='legacy-migrated'")) {
      for (const item of payload.legacy ?? []) {
        if (!await catalog.get('SELECT id FROM workspaces WHERE id=?', [item.metadata.id])) await create({ ...item.metadata, data: JSON.parse(item.raw) });
      }
      await catalog.run('INSERT OR REPLACE INTO app_meta VALUES (?,?)', ['legacy-migrated', '1']);
    }
    if (!(await list()).length) await create({ name: '我的工作区' });
    const active = await catalog.get("SELECT value FROM app_meta WHERE key='active-workspace'");
    return { workspaces: await list(), activeWorkspaceId: active?.value };
  }
  if (action === 'list') return list();
  if (action === 'create') return create(payload);
  if (action === 'open') {
    const file = await WorkspaceFiles.pickWorkspace();
    if (file.cancelled) return null;
    let workspace: WorkspaceDatabase | undefined;
    try {
      workspace = await openFile(file.database);
      const loaded = await workspace.load();
      const id = loaded.metadata.id;
      await opened.get(id)?.workspace.close();
      opened.delete(id);
      await catalog.run('INSERT OR REPLACE INTO workspaces VALUES (?,?)', [id, file.database]);
      opened.set(id, { database: file.database, workspace });
      return loaded;
    } catch (error) {
      await workspace?.close().catch(() => {});
      await WorkspaceFiles.removeWorkspace({ database: file.database }).catch(() => {});
      throw error;
    }
  }
  const id = payload.id ?? '';
  const entry = await database(id);
  const workspace = entry.workspace;
  switch (action) {
    case 'activate':
      await catalog.run('INSERT OR REPLACE INTO app_meta VALUES (?,?)', ['active-workspace', id]);
      return true;
    case 'load': return workspace.load();
    case 'save': {
      if (!payload.data) throw new Error('缺少工作区数据');
      return workspace.save(payload.data, payload);
    }
    case 'rename': return workspace.rename(payload.name ?? '');
    case 'history': return workspace.listHistory();
    case 'historyDetail': return workspace.readHistory(payload.historyId ?? '');
    case 'restore': return workspace.restoreHistory(payload.historyId ?? '', payload.side, payload.conversationId, payload.selection);
    case 'versions': return workspace.listVersions(payload.documentId ?? '');
    case 'version': return workspace.readVersion(payload.documentId ?? '', payload.versionId ?? 0);
    case 'clearHistory': return workspace.clearHistory();
    case 'referenceCacheGet': return workspace.referenceCacheGet(payload.key ?? '');
    case 'referenceCachePut': return workspace.referenceCachePut(payload.key ?? '', payload.summary ?? '');
    case 'delete':
      await workspace.close(); opened.delete(id);
      await WorkspaceFiles.removeWorkspace({ database: entry.database, historyKey: await workspaceHistoryKey(id) });
      await catalog.run('DELETE FROM workspaces WHERE id=?', [id]);
      return list();
    case 'export': {
      // 导出一致的 main 快照，系统选择器等待期间也不复制仍在写入的文件。
      const snapshot = `w_${crypto.randomUUID().replaceAll('-', '')}`;
      const file = await WorkspaceFiles.location({ database: snapshot });
      try {
        await workspace.exportTo(file.path);
        return await WorkspaceFiles.exportWorkspace({ database: snapshot, name: `${workspace.metadata.name}.caudalflow` });
      } finally { await WorkspaceFiles.removeWorkspace({ database: snapshot }); }
    }
    default: throw new Error('未知存储操作');
  }
}
