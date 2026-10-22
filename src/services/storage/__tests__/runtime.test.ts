/** @vitest-environment jsdom */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { WorkspaceData } from '../../../types/workspace';

const fake = vi.hoisted(() => ({ request: vi.fn(), save: vi.fn(), load: vi.fn() }));
vi.mock('../client', () => ({ sqliteStorage: fake, isSqliteStorage: () => true }));

describe('desktop command and persistence coordination', () => {
  let runtime: typeof import('../runtime');
  let flow: typeof import('../../../stores/flowStore');
  let chat: typeof import('../../../stores/chatStore');
  let stored: WorkspaceData;
  let revision: number;
  let failSave: boolean;
  const metadata = { id: 'w1', name: '测试', createdAt: 0, updatedAt: 0 };
  beforeEach(async () => {
    vi.resetModules(); localStorage.clear();
    revision = 1; failSave = false;
    stored = { nodes: [{ id: 'c1', type: 'chat', position: { x: 0, y: 0 }, data: { topic: '主题', done: false } }], edges: [], conversations: { c1: { nodeId: 'c1', messages: [{ id: 'm1', role: 'assistant', content: '初始', timestamp: 1 }], isStreaming: false } } };
    fake.load.mockImplementation(async () => ({ metadata, revision, data: structuredClone(stored) }));
    fake.request.mockImplementation(async (action: string, payload: { data?: WorkspaceData; expectedRevision?: number } = {}) => {
      if (action === 'bootstrap') return { workspaces: [metadata] };
      if (action === 'save') {
        if (failSave) throw new Error('磁盘不可写');
        expect(payload.expectedRevision).toBe(revision);
        stored = structuredClone(payload.data!); return { revision: ++revision };
      }
      if (action === 'restore') return { metadata, revision: ++revision, data: structuredClone(stored) };
      return [];
    });
    fake.save.mockImplementation(async (_id, data, expectedRevision) => fake.request('save', { data, expectedRevision }));
    runtime = await import('../runtime'); flow = await import('../../../stores/flowStore'); chat = await import('../../../stores/chatStore');
    await runtime.initializeDesktopStorage();
  });
  afterEach(() => { runtime.disposeDesktopStorage(); delete window.caudalflowFlush; delete window.caudalflowPrepareClose; });

  it('records done state and preserves later layout through undo and redo', async () => {
    flow.useFlowStore.getState().updateNodeData('c1', { done: true }); await runtime.flushDesktopStorage();
    flow.useFlowStore.getState().onNodesChange([{ type: 'position', id: 'c1', position: { x: 500, y: 600 } }]); await runtime.flushDesktopStorage();
    await runtime.replayDesktopCommand('undo');
    expect(flow.useFlowStore.getState().nodes[0].data.done).toBe(false);
    expect(flow.useFlowStore.getState().nodes[0].position).toEqual({ x: 500, y: 600 });
    await runtime.replayDesktopCommand('redo'); expect(flow.useFlowStore.getState().nodes[0].data.done).toBe(true);
  });

  it('renames metadata immediately without flushing drafts or blocking the canvas', async () => {
    const workspace = (await import('../../../stores/workspaceStore')).useWorkspaceStore;
    let finishRename!: (value: unknown) => void;
    const previous = fake.request.getMockImplementation()!;
    fake.request.mockImplementation((action, payload) => action === 'rename' ? new Promise((resolve) => { finishRename = resolve; }) : previous(action, payload));
    const savingBefore = fake.request.mock.calls.filter(([action]) => action === 'save').length;
    const rename = runtime.renameDesktopWorkspace('w1', '新名称');
    expect(workspace.getState().getActiveWorkspace()?.name).toBe('新名称');
    expect(runtime.useStorageStatus.getState().busy).toBe(false);
    expect(fake.request.mock.calls.filter(([action]) => action === 'save')).toHaveLength(savingBefore);
    finishRename({ ...metadata, name: '新名称' }); await rename;
    expect(workspace.getState().getActiveWorkspace()?.name).toBe('新名称');
  });

  it('groups streaming tokens into one complete content operation', async () => {
    const store = chat.useChatStore.getState();
    store.addMessage('c1', 'user', '新问题'); store.addMessage('c1', 'assistant', ''); store.setStreaming('c1', true);
    store.appendToLastMessage('c1', '部分'); await runtime.flushDesktopStorage();
    expect(runtime.useStorageStatus.getState().canUndo).toBe(false);
    store.appendToLastMessage('c1', '回答'); store.setStreaming('c1', false); await runtime.flushDesktopStorage();
    expect(runtime.useStorageStatus.getState().canUndo).toBe(true);
    await runtime.replayDesktopCommand('undo'); expect(chat.useChatStore.getState().getMessages('c1')).toHaveLength(1);
    await runtime.replayDesktopCommand('redo'); expect(chat.useChatStore.getState().getMessages('c1').at(-1)?.content).toBe('部分回答');
  });

  it('saves the first question before streaming and keeps title and other conversation edits in chronological order', async () => {
    const id = flow.useFlowStore.getState().addChatNode({ x: 10, y: 10 }, { topic: '新建对话' });
    chat.useChatStore.getState().initConversation(id); await runtime.flushDesktopStorage();
    const store = chat.useChatStore.getState();
    store.addMessage(id, 'user', '首次提问');
    flow.useFlowStore.getState().updateNodeData(id, { topic: '临时题目', titleSource: 'temporary' });
    runtime.recordFirstQuestion(id);
    store.addMessage(id, 'assistant', ''); store.setStreaming(id, true);
    await runtime.flushDesktopStorage();
    const first = fake.request.mock.calls.filter(([action, payload]) => action === 'save' && payload.label === '创建会话并提问').at(-1)![1];
    expect(first.mergeCreationId).toBe(id);
    expect(first.historyAfter.conversations[id].messages).toHaveLength(1);
    flow.useFlowStore.getState().updateNodeData('c1', { done: true }); await runtime.flushDesktopStorage();
    flow.useFlowStore.getState().updateNodeData(id, { topic: 'AI 短标题', titleSource: 'generated' }); await runtime.flushDesktopStorage();
    const title = fake.request.mock.calls.filter(([action, payload]) => action === 'save' && payload.label === '自动生成会话标题').at(-1)![1];
    expect(title.historyAfter.nodes.find((node: { id: string }) => node.id === 'c1').data.done).toBe(true);
    expect(title.historyAfter.conversations[id].messages).toHaveLength(1);
    store.appendToLastMessage(id, '回复结果'); store.setStreaming(id, false); await runtime.flushDesktopStorage();
    await runtime.replayDesktopCommand('undo');
    expect(chat.useChatStore.getState().getMessages(id)).toHaveLength(1);
    expect(flow.useFlowStore.getState().nodes.find((node) => node.id === 'c1')?.data.done).toBe(true);
    expect(flow.useFlowStore.getState().nodes.find((node) => node.id === id)?.data.topic).toBe('AI 短标题');
  });

  it('merges asynchronous title and first reply into the initial command and redoes saved results', async () => {
    const id = flow.useFlowStore.getState().addChatNode({ x: 10, y: 10 }, { topic: '新建对话' });
    const store = chat.useChatStore.getState(); store.initConversation(id); await runtime.flushDesktopStorage();
    store.addMessage(id, 'user', '首次提问');
    flow.useFlowStore.getState().updateNodeData(id, { topic: '问题节选', titleSource: 'temporary' });
    runtime.recordFirstQuestion(id);
    store.addMessage(id, 'assistant', ''); store.setStreaming(id, true); await runtime.flushDesktopStorage();
    flow.useFlowStore.getState().updateNodeData(id, { topic: 'AI 短标题', titleSource: 'generated' }); await runtime.flushDesktopStorage();
    store.appendToLastMessage(id, '首次回复'); store.setStreaming(id, false); await runtime.flushDesktopStorage();
    const merged = fake.request.mock.calls.filter(([action, payload]) => action === 'save' && payload.mergeInitializationId === id);
    expect(merged).toHaveLength(2);
    expect(merged.every(([, payload]) => payload.label === '创建会话并提问')).toBe(true);
    await runtime.replayDesktopCommand('undo');
    expect(flow.useFlowStore.getState().nodes.map((node) => node.id)).toEqual(['c1']);
    expect(runtime.useStorageStatus.getState().canUndo).toBe(false);
    await runtime.replayDesktopCommand('redo');
    expect(flow.useFlowStore.getState().nodes.find((node) => node.id === id)?.data.topic).toBe('AI 短标题');
    expect(chat.useChatStore.getState().getMessages(id).at(-1)?.content).toBe('首次回复');
  });

  it('restores deleted content at its most recent layout position', async () => {
    flow.useFlowStore.getState().onNodesChange([{ type: 'position', id: 'c1', position: { x: 900, y: 800 } }]); await runtime.flushDesktopStorage();
    flow.useFlowStore.getState().removeNode('c1'); chat.useChatStore.getState().removeConversation('c1'); await runtime.flushDesktopStorage();
    await runtime.replayDesktopCommand('undo');
    expect(flow.useFlowStore.getState().nodes[0].position).toEqual({ x: 900, y: 800 });
    expect(chat.useChatStore.getState().getMessages('c1')[0].id).toBe('m1');
  });

  it('opens a matching cross-workspace source but keeps the active workspace when the original version is unavailable', async () => {
    const source = { workspaceId: 'w2', conversationId: 'c1', documentId: 'm1', title: '来源', documentText: '初始', start: 0, length: 2 };
    const foreign = { metadata: { ...metadata, id: 'w2' }, revision: 1, data: structuredClone(stored) };
    fake.load.mockResolvedValue(foreign);
    expect(await runtime.openReferenceSourceWorkspace({ ...source, documentText: '已经被替换的原文' })).toBe(false);
    expect(runtime.useStorageStatus.getState().error).toBeNull();
    expect(await runtime.openReferenceSourceWorkspace(source)).toBe(true);
    expect((await import('../../../stores/workspaceStore')).useWorkspaceStore.getState().activeWorkspaceId).toBe('w2');
  });

  it('does not discard unsaved runtime data on a failed write and allows retry', async () => {
    failSave = true; flow.useFlowStore.getState().updateNodeData('c1', { label: '未保存' });
    await expect(runtime.flushDesktopStorage()).rejects.toThrow('磁盘不可写');
    expect(stored.nodes[0].data.label).toBeUndefined(); expect(flow.useFlowStore.getState().nodes[0].data.label).toBe('未保存');
    failSave = false; await runtime.retryDesktopStorage();
    expect(stored.nodes[0].data.label).toBe('未保存'); expect(runtime.useStorageStatus.getState().error).toBeNull();
  });

  it('clears undo and redo after restoring local history', async () => {
    flow.useFlowStore.getState().updateNodeData('c1', { done: true }); await runtime.flushDesktopStorage();
    await runtime.restoreDesktopHistory('h1');
    expect(runtime.useStorageStatus.getState()).toMatchObject({ canUndo: false, canRedo: false });
  });

  it('switches the entire document version including removal of newer attachments', async () => {
    const chatStore = chat.useChatStore.getState();
    chatStore.addOrUpdateMessage('c1', { ...chatStore.getMessages('c1')[0], content: '带图片的新版本', reasoning: '新思考', images: [{ mimeType: 'image/png', base64: 'cGljdHVyZQ==' }] });
    await runtime.flushDesktopStorage();
    const previous = fake.request.getMockImplementation()!;
    fake.request.mockImplementation((action, payload) => action === 'version' ? Promise.resolve({ id: 'm1', role: 'assistant', content: '初始', timestamp: 1, versionId: 1 }) : previous(action, payload));
    await runtime.selectDocumentVersion('c1', 'm1', 1);
    const selected = chat.useChatStore.getState().getMessages('c1')[0];
    expect(selected.content).toBe('初始'); expect(selected.images).toBeUndefined(); expect(selected.reasoning).toBeUndefined();
    await runtime.replayDesktopCommand('undo'); expect(chat.useChatStore.getState().getMessages('c1')[0].images).toHaveLength(1);
  });
});
