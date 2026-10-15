import { Worker } from 'node:worker_threads';
import { mkdtempSync, rmSync, readFileSync, readdirSync, existsSync, renameSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

interface Reply { requestId: number; result?: unknown; error?: string }

describe('SQLite worker lifecycle and legacy migration', () => {
  let root: string;
  let worker: Worker;
  let serial: number;
  const start = () => { worker = new Worker(fileURLToPath(new URL('../worker.cjs', import.meta.url)), { workerData: { root } }); };
  const request = <T = unknown>(action: string, payload = {}) => new Promise<T>((resolve, reject) => {
    const requestId = ++serial;
    const listener = (reply: Reply) => {
      if (reply.requestId !== requestId) return;
      worker.off('message', listener);
      if (reply.error) reject(new Error(reply.error)); else resolve(reply.result as T);
    };
    worker.on('message', listener); worker.postMessage({ requestId, action, payload });
  });
  beforeEach(() => { root = mkdtempSync(join(tmpdir(), 'caudalflow-worker-')); serial = 0; start(); });
  afterEach(async () => { await worker.terminate(); rmSync(root, { recursive: true, force: true }); });

  it('backs up legacy strings, migrates once, preserves IDs and reopens after restart', async () => {
    const raw = JSON.stringify({ nodes: [{ id: 'c1', type: 'chat', position: { x: 1, y: 2 }, data: { topic: '迁移测试' } }], edges: [], conversations: { c1: { nodeId: 'c1', messages: [{ id: 'm1', role: 'assistant', content: '保留', timestamp: 123, previousVersions: [{ content: '旧版本', timestamp: 100 }] }], isStreaming: false } } });
    const legacy = [{ metadata: { id: 'old-workspace', name: '原工作区', createdAt: 10 }, raw }];
    const result = await request<{ workspaces: { id: string; filePath: string; createdAt: number }[] }>('bootstrap', { legacy });
    expect(result.workspaces).toHaveLength(1); expect(result.workspaces[0]).toMatchObject({ id: 'old-workspace', createdAt: 10 });
    expect(existsSync(result.workspaces[0].filePath)).toBe(true);
    const backups = readdirSync(join(root, 'legacy-backups'));
    expect(readFileSync(join(root, 'legacy-backups', backups[0]), 'utf8')).toBe(raw);
    expect(await request('bootstrap', { legacy })).toMatchObject({ workspaces: [{ id: 'old-workspace' }] });
    const versions = await request<unknown[]>('versions', { id: 'old-workspace', documentId: 'm1' }); expect(versions).toHaveLength(2);
    await request('close'); await worker.terminate(); start();
    expect(await request('load', { id: 'old-workspace' })).toMatchObject({ data: { conversations: { c1: { messages: [{ id: 'm1', content: '保留', timestamp: 123 }] } } } });
  });

  it('retains the backup and does not mark migration successful after invalid data', async () => {
    const raw = JSON.stringify({ nodes: [{ id: 'c1', position: { x: null, y: 1 }, data: { topic: '损坏' } }], edges: [], conversations: {} });
    await expect(request('bootstrap', { legacy: [{ metadata: { id: 'broken', name: '损坏' }, raw }] })).rejects.toThrow('位置无效');
    expect(readdirSync(join(root, 'legacy-backups'))).toHaveLength(1);
    expect(await request('list')).toEqual([]);
    const fixed = JSON.stringify({ nodes: [], edges: [], conversations: {} });
    expect(await request('bootstrap', { legacy: [{ metadata: { id: 'broken', name: '修复' }, raw: fixed }] })).toMatchObject({ workspaces: [{ id: 'broken' }] });
  });

  it('permanently deletes the workspace and its independent history', async () => {
    const created = await request<{ metadata: { id: string; filePath: string } }>('create', { id: 'delete-me', name: '删除' });
    expect(await request('delete', { id: created.metadata.id })).toEqual([]);
    expect(existsSync(created.metadata.filePath)).toBe(false);
    expect(readdirSync(join(root, 'local-history')).filter((name) => name.endsWith('.sqlite'))).toHaveLength(0);
    await expect(request('history', { id: created.metadata.id })).rejects.toThrow('未登记');
  });

  it('rejects workspace IDs that could escape the default directory', async () => {
    await expect(request('create', { id: '../outside', name: 'invalid' })).rejects.toThrow('ID 无效');
  });

  it('reopens a moved workspace and retains this device’s history by workspace identity', async () => {
    const created = await request<{ metadata: { id: string; filePath: string } }>('create', { id: 'move-me', name: '搬运' });
    const data = { nodes: [{ id: 'c1', type: 'chat', position: { x: 0, y: 0 }, data: { topic: '保留历史' } }], edges: [], conversations: {} };
    await request('save', { id: 'move-me', data });
    await request('close'); await worker.terminate();
    const moved = join(root, 'moved.caudalflow'); renameSync(created.metadata.filePath, moved); start();
    expect(await request('open', { filename: moved })).toMatchObject({ metadata: { id: 'move-me', filePath: moved } });
    expect(await request<unknown[]>('history', { id: 'move-me' })).toHaveLength(1);
    expect(readdirSync(join(root, 'local-history')).filter((name) => name.endsWith('.sqlite'))).toHaveLength(1);
  });
});
