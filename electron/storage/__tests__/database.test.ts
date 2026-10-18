import { createRequire } from 'node:module';
import { mkdtempSync, rmSync, existsSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { WorkspaceData } from '../../../src/types/workspace';
import { sampleReference } from '../../../src/services/__tests__/referenceFixtures';

const require = createRequire(import.meta.url);
const { WorkspaceDatabase, SCHEMA_VERSION } = require('../database.cjs');

function example(): WorkspaceData {
  return { nodes: [{ id: 'c1', type: 'chat', position: { x: 10, y: 20 }, data: { topic: '会话', label: '学习', done: true }, style: { width: 400, height: 500 } }], edges: [], conversations: { c1: { nodeId: 'c1', messages: [{ id: 'q1', role: 'user', content: '问题', timestamp: 100 }, { id: 'a1', role: 'assistant', content: '原回答', reasoning: '思考', timestamp: 200 }], isStreaming: false } } };
}

describe('SQLite workspace and independent local history', () => {
  let root: string;
  let workspace: InstanceType<typeof WorkspaceDatabase>;
  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'caudalflow-db-'));
    workspace = new WorkspaceDatabase(join(root, 'workspace.caudalflow'), join(root, 'personal'), { create: true, metadata: { id: 'w1', name: '测试', createdAt: 1, updatedAt: 1 } });
  });
  afterEach(() => { workspace?.close(); rmSync(root, { recursive: true, force: true }); });

  it('keeps a reference as an independent versioned document after its source conversation is deleted', () => {
    const data = example(); const reference = sampleReference();
    data.nodes.push({ id: 'child', type: 'chat', position: { x: 100, y: 0 }, data: { topic: '子会话' } });
    data.conversations.child = { nodeId: 'child', isStreaming: false, messages: [
      { id: 'r1', role: 'system', kind: 'reference', reference, referenceForId: 'cq', content: reference.summary, timestamp: 3 },
      { id: 'cq', role: 'user', content: '继续提问', timestamp: 4 },
    ] };
    workspace.save(data);
    const version = workspace.load().data.conversations.child.messages[0].versionId;
    data.nodes = data.nodes.filter((node) => node.id === 'child'); delete data.conversations.c1;
    workspace.save(data);
    const stored = workspace.load().data.conversations.child.messages[0];
    expect(stored).toMatchObject({ kind: 'reference', referenceForId: 'cq', versionId: version, reference });
    expect(workspace.readVersion('r1', version)).toMatchObject({ reference });
  });

  it('persists reusable summary caches without adding user history and validates incoming snapshots', () => {
    const historyCount = workspace.listHistory().length;
    workspace.referenceCachePut('b'.repeat(22), '共享摘要');
    expect(workspace.referenceCacheGet('b'.repeat(22))).toBe('共享摘要');
    expect(workspace.listHistory()).toHaveLength(historyCount);
    const filename = workspace.filename; workspace.close();
    workspace = new WorkspaceDatabase(filename, join(root, 'personal'));
    expect(workspace.referenceCacheGet('b'.repeat(22))).toBe('共享摘要');
    const bad = example(); const reference = sampleReference(); reference.sources[0].length = 999;
    bad.conversations.c1.messages.push({ id: 'r1', role: 'system', kind: 'reference', reference, content: reference.summary, timestamp: 3 });
    expect(() => workspace.save(bad)).toThrow('引用快照');
  });

  it.each(['title-first', 'reply-first'])('persists one stable initialization record: %s', (order) => {
    const created = example(); created.conversations.c1.messages = []; created.nodes[0].data.titleSource = 'pending';
    workspace.save(created, { label: '创建会话或分支' });
    const id = workspace.listHistory()[0].id;
    let current = structuredClone(created); current.nodes[0].data.titleSource = 'temporary';
    current.conversations.c1.messages.push({ id: 'q1', role: 'user', content: '问题', timestamp: 1 });
    workspace.save(current, { label: '创建会话并提问', mergeCreationId: 'c1' });
    for (const step of order === 'title-first' ? ['title', 'reply'] : ['reply', 'title']) {
      const next = structuredClone(current);
      if (step === 'title') { next.nodes[0].data.topic = 'AI 短标题'; next.nodes[0].data.titleSource = 'generated'; }
      else next.conversations.c1.messages.push({ id: 'a1', role: 'assistant', content: '首次回复', replyToId: 'q1', timestamp: 2 });
      next.nodes[0].position.x = 900;
      workspace.save(next, { label: '创建会话并提问', mergeInitializationId: 'c1' });
      current = next;
    }
    expect(workspace.listHistory()).toHaveLength(1); expect(workspace.listHistory()[0].id).toBe(id);
    const detail = workspace.readHistory(id);
    expect(detail.before.nodes).toHaveLength(0);
    expect(detail.after.nodes[0].data.topic).toBe('AI 短标题');
    expect(detail.after.conversations.c1.messages.map((message: { content: string }) => message.content)).toEqual(['问题', '首次回复']);
    workspace.restoreHistory(id, 'before'); expect(workspace.load().data.nodes).toHaveLength(0);
  });

  it('refuses to merge a late initialization result across another operation or edited question', () => {
    const asked = example(); asked.nodes[0].data.titleSource = 'temporary'; asked.conversations.c1.messages = [asked.conversations.c1.messages[0]];
    workspace.save(asked, { label: '创建会话并提问' });
    const marked = structuredClone(asked); marked.nodes[0].data.done = false;
    workspace.save(marked, { label: '修改搞定状态' });
    const titled = structuredClone(marked); titled.nodes[0].data.topic = 'AI 标题'; titled.nodes[0].data.titleSource = 'generated';
    workspace.save(titled, { label: '自动生成会话标题', mergeInitializationId: 'c1' });
    expect(workspace.listHistory()).toHaveLength(3);
    const changed = structuredClone(titled); changed.conversations.c1.messages[0].content = '问题也变了';
    changed.conversations.c1.messages.push({ id: 'a1', role: 'assistant', content: '首次回复', timestamp: 3 });
    workspace.save(changed, { label: '回复完成', mergeInitializationId: 'c1' });
    expect(workspace.listHistory()).toHaveLength(4);
  });

  it('merges an adjacent empty creation and first question without including a later reply', () => {
    const created = example(); created.conversations.c1.messages = [];
    workspace.save(created, { label: '创建会话或分支' });
    const asked = structuredClone(created); asked.nodes[0].data.topic = '临时问题';
    asked.conversations.c1.messages.push({ id: 'q1', role: 'user', content: '问题', timestamp: 1 });
    workspace.save(asked, { label: '创建会话并提问', mergeCreationId: 'c1' });
    expect(workspace.listHistory()).toHaveLength(1);
    const event = workspace.readHistory(workspace.listHistory()[0].id);
    expect(event.before.nodes).toHaveLength(0);
    expect(event.after.conversations.c1.messages).toHaveLength(1);
    const answered = structuredClone(asked); answered.conversations.c1.messages.push({ id: 'a1', role: 'assistant', content: '回答', timestamp: 2 });
    workspace.save(answered, { label: '回复完成' });
    expect(workspace.listHistory()).toHaveLength(2);
    expect(workspace.readHistory(workspace.listHistory()[1].id).after.conversations.c1.messages).toHaveLength(1);
    workspace.restoreHistory(workspace.listHistory()[1].id, 'before');
    expect(workspace.load().data.nodes).toHaveLength(0);
  });

  it('refuses a requested merge across intervening content changes', () => {
    const created = example(); created.conversations.c1.messages = [];
    workspace.save(created, { label: '创建会话或分支' });
    const marked = structuredClone(created); marked.nodes[0].data.label = '之后的修改';
    workspace.save(marked, { label: '修改会话标签' });
    const asked = structuredClone(marked); asked.conversations.c1.messages.push({ id: 'q1', role: 'user', content: '问题', timestamp: 1 });
    workspace.save(asked, { label: '首次提问', mergeCreationId: 'c1' });
    expect(workspace.listHistory()).toHaveLength(3);
    expect(workspace.readHistory(workspace.listHistory()[0].id).before.nodes).toHaveLength(1);
  });

  it('stores documents, immutable versions, selected versions and relational layouts', () => {
    workspace.save(example());
    const first = workspace.load();
    const firstVersion = first.data.conversations.c1.messages[1].versionId;
    const next = example(); next.conversations.c1.messages[1].content = '新回答';
    workspace.save(next);
    expect(workspace.db.prepare('SELECT COUNT(*) AS n FROM documents').get().n).toBe(2);
    expect(workspace.db.prepare('SELECT COUNT(*) AS n FROM document_versions WHERE document_id=?').get('a1').n).toBe(2);
    expect(workspace.db.prepare('SELECT content FROM document_versions WHERE id=?').get(firstVersion).content).toBe('原回答');
    workspace.save(first.data);
    expect(workspace.load().data.conversations.c1.messages[1].versionId).toBe(firstVersion);
    expect(workspace.db.prepare('SELECT COUNT(*) AS n FROM document_versions WHERE document_id=?').get('a1').n).toBe(2);
    expect(workspace.load().data.nodes[0].data).toMatchObject({ topic: '会话', label: '学习', done: true });
  });

  it('stores current text and order on documents and removes deleted messages and versions', () => {
    const data = example();
    data.conversations.c1.messages.push({ id: 'q2', role: 'user', content: '后续问题', timestamp: 300 });
    workspace.save(data);
    data.conversations.c1.messages[1].content = '重新生成';
    data.conversations.c1.messages[1].timestamp = 999; workspace.save(data);
    expect(workspace.db.prepare('SELECT id,position,content,kind FROM documents ORDER BY position').all()).toEqual([
      { id: 'q1', position: 0, content: '问题', kind: 'message' }, { id: 'a1', position: 1, content: '重新生成', kind: 'message' }, { id: 'q2', position: 2, content: '后续问题', kind: 'message' },
    ]);
    data.conversations.c1.messages.reverse(); workspace.save(data);
    expect(workspace.load().data.conversations.c1.messages.map((message: { id: string }) => message.id)).toEqual(['q2', 'a1', 'q1']);
    data.conversations.c1.messages = data.conversations.c1.messages.filter((message) => message.id !== 'a1'); workspace.save(data);
    expect(workspace.db.prepare("SELECT id FROM documents WHERE id='a1'").get()).toBeUndefined();
    expect(workspace.listVersions('a1')).toEqual([]);
    expect(workspace.db.prepare('PRAGMA foreign_key_check').all()).toEqual([]);
  });

  it('uses integer version identities without reusing deleted IDs or accepting cross-document hints', () => {
    workspace.save(example());
    const loaded = workspace.load().data; const firstId = loaded.conversations.c1.messages[0].versionId;
    expect(Number.isSafeInteger(firstId)).toBe(true);
    expect(workspace.db.prepare('SELECT DISTINCT typeof(id) type FROM document_versions').all()).toEqual([{ type: 'integer' }]);
    const previousMax = workspace.db.prepare('SELECT MAX(id) n FROM document_versions').get().n;
    const data = example(); data.conversations.c1.messages = [data.conversations.c1.messages[0]]; workspace.save(data);
    data.conversations.c1.messages.push({ id: 'a2', role: 'assistant', content: '新回答', timestamp: 3, versionId: firstId });
    workspace.save(data);
    expect(workspace.load().data.conversations.c1.messages[1].versionId).toBeGreaterThan(previousMax);
    expect(workspace.readVersion('q1', firstId).content).toBe('问题');
    expect(() => workspace.readVersion('a2', firstId)).toThrow('不存在');
  });

  it('stores immutable document kinds once and rejects changes before committing any other edits', () => {
    const data = example(); workspace.save(data); const revision = workspace.revision;
    data.nodes[0].data.topic = '不能部分写入';
    Object.assign(data.conversations.c1.messages[1], { role: 'system', kind: 'reference', reference: sampleReference() });
    expect(() => workspace.save(data)).toThrow('不能改变类型');
    expect(workspace.revision).toBe(revision);
    expect(workspace.load().data.nodes[0].data.topic).toBe('会话');
    const columns = workspace.db.prepare('PRAGMA table_info(document_versions)').all().map((row: { name: string }) => row.name);
    expect(columns).not.toContain('kind'); expect(columns).not.toContain('fingerprint'); expect(columns).not.toContain('metadata_json');
  });

  it('keeps independent reference fields, multiple sources and source images through version switching and deletion', () => {
    const data = example(); const reference = sampleReference();
    const image = { mimeType: 'image/png', base64: Buffer.from('source image').toString('base64') };
    reference.sources[0].images = [image];
    reference.sources.push({ ...reference.sources[0], documentId: 'another', versionId: undefined, images: undefined });
    reference.summaryInput = [{ role: 'user', content: '待摘要的完整背景', images: [image] }];
    data.conversations.c1.messages.push({ id: 'r1', role: 'system', kind: 'reference', reference, referenceForId: 'q1', content: reference.summary, timestamp: 3 });
    workspace.save(data); const versionId = workspace.load().data.conversations.c1.messages[2].versionId;
    expect(workspace.db.prepare('SELECT summary,quote FROM document_references').get()).toEqual({ summary: reference.summary, quote: reference.quote });
    expect(workspace.db.prepare('SELECT COUNT(*) n FROM reference_sources').get().n).toBe(2);
    const filename = workspace.filename; workspace.close(); workspace = new WorkspaceDatabase(filename, join(root, 'personal'));
    expect(workspace.readVersion('r1', versionId).reference).toEqual(reference);
    const resolved = structuredClone(data); delete resolved.conversations.c1.messages[2].reference!.summaryInput;
    resolved.conversations.c1.messages[2].reference!.summary = '完成的摘要'; resolved.conversations.c1.messages[2].content = '完成的摘要';
    workspace.save(resolved);
    expect(workspace.readVersion('r1', versionId).reference).toEqual(reference);
    expect(workspace.load().data.conversations.c1.messages[2].reference.summaryInput).toBeUndefined();
    workspace.save(data); expect(workspace.load().data.conversations.c1.messages[2].versionId).toBe(versionId);
    data.conversations.c1.messages.pop(); workspace.save(data);
    for (const table of ['document_references', 'reference_sources', 'reference_source_attachments', 'attachments']) expect(workspace.db.prepare(`SELECT COUNT(*) n FROM ${table}`).get().n).toBe(0);
  });

  it('reuses reference versions regardless of object key order and empty optional image lists', () => {
    const data = example(); const reference = sampleReference(); reference.sources[0].images = [];
    data.conversations.c1.messages.push({ id: 'r1', role: 'system', kind: 'reference', reference, content: reference.summary, timestamp: 3 });
    workspace.save(data); const versionId = workspace.load().data.conversations.c1.messages[2].versionId;
    data.conversations.c1.messages[2].reference = Object.fromEntries(Object.entries(reference).reverse()) as typeof reference;
    workspace.save(data);
    expect(workspace.load().data.conversations.c1.messages[2].versionId).toBe(versionId);
    expect(workspace.listVersions('r1')).toHaveLength(1);
  });

  it('persists explicit layout columns and restores compact cards with the original expanded dimensions', () => {
    const data = example(); data.nodes[0].style = { width: 780, height: 640 }; data.nodes[0].zIndex = 7;
    data.nodes[0].data.minimized = true; data.nodes[0].data.maximized = true;
    workspace.save(data);
    expect(workspace.db.prepare('SELECT * FROM conversation_layouts').get()).toEqual({ conversation_id: 'c1', x: 10, y: 20, width: 780, height: 640, z_index: 7, collapsed: 0, minimized: 1 });
    const filename = workspace.filename; workspace.close(); workspace = new WorkspaceDatabase(filename, join(root, 'personal'));
    expect(workspace.load().data.nodes[0]).toMatchObject({ style: { width: 780, height: 640 }, zIndex: 7, data: { minimized: true, maximized: false } });
    const loaded = workspace.load().data; loaded.nodes[0].data.minimized = false; workspace.save(loaded);
    expect(workspace.load().data.nodes[0].style).toEqual({ width: 780, height: 640 });
    expect(workspace.listHistory()).toHaveLength(1);
  });

  it('stores only business fields for relations and restores interface defaults when loading', () => {
    const data = example(); data.nodes.push({ id: 'child', type: 'chat', position: { x: 500, y: 0 }, data: { topic: '分支' } });
    data.edges.push({ id: 'short', source: 'c1', target: 'child', type: 'topic', sourceHandle: 'right', targetHandle: 'left', data: { label: '关联说明' } });
    workspace.save(data);
    expect(workspace.db.prepare('SELECT * FROM relations').get()).toEqual({ id: 'short', source_id: 'c1', target_id: 'child', position: 0, label: '关联说明' });
    expect(workspace.load().data.edges).toEqual(data.edges);
    const tables = workspace.db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all().map((row: { name: string }) => row.name);
    expect(tables).not.toContain('conversation_documents'); expect(tables).not.toContain('version_assets');
  });

  it('keeps the selected old version as the regeneration baseline', () => {
    workspace.save(example()); const old = workspace.load().data;
    const changed = example(); changed.conversations.c1.messages[1].content = '另一个版本'; workspace.save(changed);
    workspace.save(old); old.conversations.c1.isStreaming = true; old.conversations.c1.streamingMessageId = 'a1';
    old.conversations.c1.messages[1].content = '生成中'; workspace.save(old, { history: false });
    expect(workspace.db.prepare("SELECT content,current_version_id FROM documents WHERE id='a1'").get()).toEqual({ content: '原回答', current_version_id: old.conversations.c1.messages[1].versionId });
    expect(workspace.load().data.conversations.c1.messages[1].content).toBe('生成中');
  });

  it('rejects previous schema versions without migrating or changing the file', () => {
    const filename = workspace.filename; workspace.close();
    for (const version of [1, 2]) {
      const old = new DatabaseSync(filename); old.exec(`PRAGMA user_version=${version}`); old.close();
      const original = readFileSync(filename);
      expect(() => new WorkspaceDatabase(filename, join(root, 'personal'))).toThrow('文件版本不受支持');
      expect(readFileSync(filename)).toEqual(original);
    }
    const repair = new DatabaseSync(filename); repair.exec(`PRAGMA user_version=${SCHEMA_VERSION}`); repair.close();
    workspace = new WorkspaceDatabase(filename, join(root, 'personal'));
  });

  it('stores image bytes once and keeps attachments bound to versions', () => {
    const data = example();
    data.conversations.c1.messages[0].images = [{ mimeType: 'image/png', base64: Buffer.from('picture').toString('base64') }];
    workspace.save(data);
    const next = structuredClone(data); next.conversations.c1.messages[0].content = '修改问题';
    workspace.save(next);
    expect(workspace.db.prepare('SELECT COUNT(*) AS n FROM attachments').get().n).toBe(1);
    expect(workspace.db.prepare('SELECT COUNT(*) AS n FROM version_attachments').get().n).toBe(2);
    expect(workspace.load().data.conversations.c1.messages[0].images).toEqual(data.conversations.c1.messages[0].images);
  });

  it('rolls back the complete content change if a version insert fails', () => {
    workspace.save(example());
    const revision = workspace.revision;
    const historyCount = workspace.listHistory().length;
    workspace.db.exec("CREATE TRIGGER reject_version BEFORE INSERT ON document_versions BEGIN SELECT RAISE(ABORT, 'simulated disk failure'); END");
    const next = example(); next.nodes[0].data.topic = '不能部分保存'; next.conversations.c1.messages[1].content = '触发失败';
    expect(() => workspace.save(next)).toThrow('simulated disk failure');
    expect(workspace.load().data.nodes[0].data.topic).toBe('会话');
    expect(workspace.revision).toBe(revision);
    expect(workspace.listHistory()).toHaveLength(historyCount);
  });

  it('rolls back workspace content when the independent history write fails', () => {
    workspace.save(example());
    workspace.db.exec("CREATE TRIGGER personal.reject_history BEFORE INSERT ON history BEGIN SELECT RAISE(ABORT, 'history unavailable'); END");
    const next = example(); next.conversations.c1.messages[1].content = '不应成功';
    expect(() => workspace.save(next)).toThrow('history unavailable');
    expect(workspace.load().data.conversations.c1.messages[1].content).toBe('原回答');
  });

  it('does not put local history in a copied SQLite workspace', () => {
    workspace.save(example());
    expect(existsSync(workspace.historyFile)).toBe(true);
    const destination = join(root, 'shared.caudalflow'); workspace.exportTo(destination);
    const copy = new DatabaseSync(destination);
    try {
      const tables = copy.prepare("SELECT name FROM sqlite_master WHERE type='table'").all().map((row) => row.name);
      expect(tables).toContain('documents'); expect(tables).not.toContain('history');
      expect(copy.prepare('SELECT COUNT(*) AS n FROM documents').get()?.n).toBe(2);
    } finally { copy.close(); }
  });

  it('keeps draft checkpoints out of immutable revisions and recovers interrupted output', () => {
    workspace.save(example());
    const next = example(); next.conversations.c1.isStreaming = true; next.conversations.c1.streamingMessageId = 'a1';
    for (let index = 0; index < 5; index++) { next.conversations.c1.messages[1].content = `部分回答${index}`; workspace.save(next, { history: false }); }
    expect(workspace.db.prepare('SELECT COUNT(*) AS n FROM document_versions WHERE document_id=?').get('a1').n).toBe(1);
    expect(workspace.load().data.conversations.c1).toMatchObject({ isStreaming: false });
    expect(workspace.load().data.conversations.c1.messages[1]).toMatchObject({ content: '部分回答4', generationStatus: 'interrupted' });
    next.conversations.c1.isStreaming = false;
    workspace.save(next, { historyBefore: example(), historyAfter: next });
    expect(workspace.db.prepare('SELECT COUNT(*) AS n FROM generation_drafts').get().n).toBe(0);
    expect(workspace.db.prepare('SELECT COUNT(*) AS n FROM document_versions WHERE document_id=?').get('a1').n).toBe(2);
  });

  it('restores deleted content from before-history and retains current card positions', () => {
    workspace.save(example());
    const changed = example(); changed.conversations.c1.messages[1].content = '修改'; workspace.save(changed);
    const historyEntry = workspace.listHistory()[0];
    changed.nodes[0].position = { x: 800, y: 900 }; workspace.save(changed);
    workspace.restoreHistory(historyEntry.id, 'before');
    expect(workspace.load().data.conversations.c1.messages[1].content).toBe('原回答');
    expect(workspace.load().data.nodes[0].position).toEqual({ x: 800, y: 900 });
    workspace.save({ nodes: [], edges: [], conversations: {} });
    workspace.restoreHistory(workspace.listHistory()[0].id, 'before');
    expect(workspace.load().data.nodes).toHaveLength(1);
  });

  it('does not create history for layout changes and rejects stale revisions', () => {
    workspace.save(example()); const count = workspace.listHistory().length;
    const next = example(); next.nodes[0].position.x = 500; next.nodes[0].data.minimized = true;
    workspace.save(next);
    expect(workspace.listHistory()).toHaveLength(count);
    expect(() => workspace.save(example(), { expectedRevision: 0 })).toThrow('已被其他操作更新');
  });

  it('restores one conversation without reverting other conversations', () => {
    const old = example();
    old.nodes.push({ id: 'c2', type: 'chat', position: { x: 600, y: 20 }, data: { topic: '另一个会话' } });
    old.conversations.c2 = { nodeId: 'c2', messages: [{ id: 'q2', role: 'user', content: '原问题', timestamp: 300 }], isStreaming: false };
    workspace.save(old); const entry = workspace.listHistory()[0];
    const next = structuredClone(old); next.conversations.c1.messages[1].content = '修改一'; next.conversations.c2.messages[0].content = '修改二'; workspace.save(next);
    workspace.restoreHistory(entry.id, 'after', 'c1');
    const result = workspace.load().data;
    expect(result.conversations.c1.messages[1].content).toBe('原回答');
    expect(result.conversations.c2.messages[0].content).toBe('修改二');
  });

  it('bounds functional versions and can recreate a pruned version for undo', () => {
    workspace.save(example(), { history: false }); const original = workspace.load().data;
    for (let index = 0; index < 55; index++) {
      const data = example(); data.conversations.c1.messages[1].content = `版本 ${index}`; workspace.save(data, { history: false });
    }
    expect(workspace.listVersions('a1')).toHaveLength(50);
    workspace.save(original, { history: false });
    expect(workspace.load().data.conversations.c1.messages[1].versionId).toBe(original.conversations.c1.messages[1].versionId);
    expect(workspace.listVersions('a1')).toHaveLength(50);
  });

  it('lists each operation once and loads its before/after snapshots on demand', () => {
    workspace.save(example());
    const entries = workspace.listHistory(); expect(entries).toHaveLength(1);
    expect(entries[0].before).toBeUndefined(); expect(entries[0].side).toBeUndefined();
    const detail = workspace.readHistory(entries[0].id);
    expect(detail.before.nodes).toEqual([]); expect(detail.after.nodes).toHaveLength(1);
    expect(() => workspace.readHistory('missing')).toThrow('清理或不存在');
  });

  it('restores a selected question and reply without reverting later independent questions or labels', () => {
    const before = example(); before.conversations.c1.messages[1].replyToId = 'q1'; workspace.save(before);
    const after = structuredClone(before); after.conversations.c1.messages[1].content = '重答'; workspace.save(after);
    const entry = workspace.listHistory()[0];
    const current = structuredClone(after); current.nodes[0].data.label = '后来标签'; current.nodes[0].position.x = 900;
    current.conversations.c1.messages.push({ id: 'later-answer', role: 'assistant', content: '同问题的新回复', replyToId: 'q1', timestamp: 300 }, { id: 'q2', role: 'user', content: '另一个问题', timestamp: 400 });
    workspace.save(current);
    const count = workspace.listHistory().length;
    workspace.restoreHistory(entry.id, 'before', 'c1', { documentIds: ['q1', 'a1'] });
    const restored = workspace.load().data;
    expect(restored.conversations.c1.messages.map((message: { id: string }) => message.id)).toEqual(['q1', 'a1', 'q2']);
    expect(restored.conversations.c1.messages[1].content).toBe('原回答');
    expect(restored.nodes[0].data.label).toBe('后来标签'); expect(restored.nodes[0].position.x).toBe(900);
    expect(workspace.listHistory()).toHaveLength(count);
  });

  it('restores only attributes touched by the selected operation', () => {
    const before = example(); workspace.save(before);
    const after = structuredClone(before); after.nodes[0].data.label = '新标签'; workspace.save(after);
    const entry = workspace.listHistory()[0];
    after.nodes[0].data.done = false; workspace.save(after);
    workspace.restoreHistory(entry.id, 'before', 'c1', { attributesOnly: true });
    expect(workspace.load().data.nodes[0].data).toMatchObject({ label: '学习', done: false });
  });

  it('restores absence of a newly created conversation and rejects unrelated selection IDs', () => {
    workspace.save(example()); const entry = workspace.listHistory()[0];
    const revision = workspace.revision;
    expect(() => workspace.restoreHistory(entry.id, 'before', 'c1', { documentIds: ['unrelated'] })).toThrow('不属于');
    expect(workspace.revision).toBe(revision);
    workspace.restoreHistory(entry.id, 'before', 'c1');
    expect(workspace.load().data.nodes).toHaveLength(0);
  });

  it('rejects invalid input and unrelated databases without changing current content', () => {
    workspace.save(example());
    const invalid = example(); invalid.conversations.c1.messages.push({ ...invalid.conversations.c1.messages[0] });
    expect(() => workspace.save(invalid)).toThrow('文档 ID');
    const other = join(root, 'other.sqlite'); const db = new DatabaseSync(other); db.exec('CREATE TABLE unrelated (id INTEGER)'); db.close();
    expect(() => new WorkspaceDatabase(other, join(root, 'personal'))).toThrow('不是支持');
    const verify = new DatabaseSync(other);
    try { expect(verify.prepare('PRAGMA application_id').get()?.application_id).toBe(0); } finally { verify.close(); }
    expect(workspace.load().data.nodes).toHaveLength(1);
  });
});
