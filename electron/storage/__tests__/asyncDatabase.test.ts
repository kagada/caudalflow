import { createRequire } from 'node:module';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

const { WorkspaceDatabase } = createRequire(import.meta.url)('../database.cjs');
const data = () => ({ nodes: [{ id: 'c1', type: 'chat', position: { x: 0, y: 0 }, data: { topic: '原题' } }], edges: [], conversations: { c1: { nodeId: 'c1', messages: [{ id: 'a1', role: 'assistant', content: '原文', timestamp: 1 }], isStreaming: false } } });

describe('shared asynchronous workspace transaction boundaries', () => {
  let root: string;
  let workspace: InstanceType<typeof WorkspaceDatabase>;
  beforeEach(async () => {
    root = mkdtempSync(join(tmpdir(), 'caudalflow-async-'));
    workspace = await WorkspaceDatabase.open(join(root, 'workspace.caudalflow'), join(root, 'history'), { create: true, metadata: { id: 'w1', name: '异步验证', createdAt: 1, updatedAt: 1 } });
    await workspace.save(data());
  });
  afterEach(async () => { await workspace.close(); rmSync(root, { recursive: true, force: true }); });

  it('queues reads and writes behind the whole asynchronous save, then detects stale revisions', async () => {
    let release!: () => void;
    let entered!: () => void;
    const gate = new Promise<void>(resolve => { release = resolve; });
    const began = new Promise<void>(resolve => { entered = resolve; });
    const exec = workspace.db.exec;
    workspace.db.exec = async (sql: string) => {
      await exec(sql);
      if (sql === 'BEGIN IMMEDIATE') { entered(); await gate; }
    };
    const before = await workspace.load();
    const changed = data(); changed.conversations.c1.messages[0].content = '新正文';
    const saving = workspace.save(changed, { expectedRevision: before.revision });
    await began;
    let readFinished = false;
    const reading = workspace.load().then((value: unknown) => { readFinished = true; return value; });
    const stale = workspace.save(data(), { expectedRevision: before.revision });
    await Promise.resolve(); expect(readFinished).toBe(false);
    release();
    await saving;
    expect(await reading).toMatchObject({ data: { conversations: { c1: { messages: [{ content: '新正文' }] } } } });
    await expect(stale).rejects.toThrow('已被其他操作更新');
  });

  it('blocks later operations when rollback itself fails, while allowing close', async () => {
    const exec = workspace.db.exec;
    workspace.db.exec = async (sql: string) => {
      if (sql === 'ROLLBACK') throw new Error('rollback unavailable');
      return exec(sql);
    };
    workspace.db.prepare("CREATE TRIGGER reject_save BEFORE INSERT ON document_versions BEGIN SELECT RAISE(ABORT, 'write failed'); END").run();
    const changed = data(); changed.conversations.c1.messages[0].content = '失败写入';
    await expect(workspace.save(changed)).rejects.toMatchObject({ errors: [expect.objectContaining({ message: 'write failed' }), expect.objectContaining({ message: 'rollback unavailable' })] });
    await expect(workspace.load()).rejects.toThrow('回滚失败');
  });
});
