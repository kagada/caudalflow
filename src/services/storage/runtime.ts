import { create } from 'zustand';
import { useFlowStore } from '../../stores/flowStore';
import { useChatStore } from '../../stores/chatStore';
import { useWorkspaceStore } from '../../stores/workspaceStore';
import type { WorkspaceData, WorkspaceMetadata } from '../../types/workspace';
import { desktopStorage as storage } from './desktop';
import { contentKey, copyWorkspace, nodeContent } from './snapshot';
import { createContentHistory, describeContentChange } from './commands';
import type { HistoryDetail, HistoryEntry, HistorySelection, SavedWorkspace, StoredWorkspace } from './types';
import type { DocumentVersion } from './types';
import type { ChatMessage } from '../../types/chat';
import { cancelAllGenerations } from '../streamLifecycle';
import { hasPersistedFlowChanges } from '../../utils/flowPersistence';

interface StorageStatus {
  ready: boolean;
  busy: boolean;
  error: string | null;
  canUndo: boolean;
  canRedo: boolean;
}

export const useStorageStatus = create<StorageStatus>(() => ({ ready: false, busy: false, error: null, canUndo: false, canRedo: false }));
const histories = new Map<string, ReturnType<typeof createContentHistory>>();
const revisions = new Map<string, number>();
const pendingConversations = new Set<string>();
let activeId: string | null = null;
let settled: WorkspaceData = { nodes: [], edges: [], conversations: {} };
let applying = false;
let scheduled = false;
let draftTimer: ReturnType<typeof setTimeout> | undefined;
let layoutTimer: ReturnType<typeof setTimeout> | undefined;
let initialization: Promise<void> | undefined;
let queue: Promise<unknown> = Promise.resolve();
let flowUnsubscribe: (() => void) | undefined;
let chatUnsubscribe: (() => void) | undefined;

export function deferConversationCommand(id: string) { pendingConversations.add(id); }
export function currentWorkspace(): WorkspaceData {
  return { nodes: useFlowStore.getState().nodes, edges: useFlowStore.getState().edges, conversations: useChatStore.getState().conversations };
}

function report(error: unknown) {
  useStorageStatus.setState({ error: error instanceof Error ? error.message : String(error) });
}

function history() {
  if (!activeId) throw new Error('没有打开的工作区');
  if (!histories.has(activeId)) histories.set(activeId, createContentHistory());
  return histories.get(activeId)!;
}

function updateButtons() {
  useStorageStatus.setState({ canUndo: activeId ? history().canUndo : false, canRedo: activeId ? history().canRedo : false });
}

// 提交返回真实选用版本；只标记仍与该次提交相同的正文，不能给后续新草稿套上旧版本 ID。
function acceptSavedVersions(id: string, submitted: WorkspaceData, result: SavedWorkspace) {
  if (id !== activeId || !result.versions) return;
  const current = useChatStore.getState().conversations;
  let changed = false;
  const conversations = Object.fromEntries(Object.entries(current).map(([nodeId, conversation]) => {
    const messages = conversation.messages.map((message) => {
      const sent = submitted.conversations[nodeId]?.messages.find((item) => item.id === message.id);
      return !conversation.isStreaming && sent && sent.content === message.content && sent.reasoning === message.reasoning && JSON.stringify(sent.images) === JSON.stringify(message.images) && result.versions?.[message.id] && result.versions[message.id] !== message.versionId ? { ...message, versionId: result.versions[message.id] } : message;
    });
    const different = messages.some((message, index) => message !== conversation.messages[index]);
    changed ||= different;
    return [nodeId, different ? { ...conversation, messages } : conversation];
  }));
  if (!changed) return;
  applying = true;
  try { useChatStore.getState().setConversations(conversations); }
  finally { applying = false; }
}

// 把 store 保留为界面投影；所有持久化写入和内容回放都经过本模块串行执行。
function apply(data: WorkspaceData) {
  applying = true;
  try {
    useFlowStore.getState().setNodes(data.nodes);
    useFlowStore.getState().setEdges(data.edges);
    useChatStore.getState().setConversations(data.conversations);
  } finally { applying = false; }
}

function enqueue<T>(action: () => Promise<T>): Promise<T> {
  const next = queue.then(action);
  queue = next.catch(report);
  return next;
}

// 生成中的会话用生成前内容参与撤销对比，其余会话仍可独立记录操作。
function completedSnapshot(data: WorkspaceData): WorkspaceData {
  const result = copyWorkspace(data);
  for (const node of data.nodes) {
    const conversation = data.conversations[node.id];
    if (pendingConversations.has(node.id) && conversation?.messages.length && !conversation.isStreaming) pendingConversations.delete(node.id);
    if (!conversation?.isStreaming && !pendingConversations.has(node.id)) continue;
    const old = settled.nodes.find((item) => item.id === node.id);
    result.nodes = result.nodes.filter((item) => item.id !== node.id);
    if (old) {
      result.nodes.push({ ...node, data: old.data });
      if (settled.conversations[node.id]) result.conversations[node.id] = settled.conversations[node.id];
      else delete result.conversations[node.id];
    } else {
      delete result.conversations[node.id];
      result.edges = result.edges.filter((edge) => edge.source !== node.id && edge.target !== node.id);
    }
  }
  // 过滤时不改变会话的原排列顺序。
  result.nodes.sort((a, b) => data.nodes.findIndex((node) => node.id === a.id) - data.nodes.findIndex((node) => node.id === b.id));
  return result;
}

function capture() {
  clearTimeout(draftTimer); draftTimer = undefined;
  clearTimeout(layoutTimer); layoutTimer = undefined;
  scheduled = false;
  if (applying || !activeId || !useStorageStatus.getState().ready || useStorageStatus.getState().error) return;
  const id = activeId;
  const actual = copyWorkspace(currentWorkspace());
  const complete = completedSnapshot(actual);
  const before = settled;
  const changed = contentKey(before) !== contentKey(complete);
  const label = changed ? describeContentChange(before, complete) : '保存布局或草稿';
  if (changed) {
    history().record(before, complete, label);
    updateButtons();
  }
  settled = copyWorkspace(complete);
  // 流式草稿会落盘，但不会为每个 token 生成版本或个人历史。
  void enqueue(async () => {
    const error = useStorageStatus.getState().error;
    if (error) throw new Error(error);
    const response = await storage.request<SavedWorkspace>('save', { id, data: actual, expectedRevision: revisions.get(id), label, history: changed, historyBefore: changed ? before : undefined, historyAfter: changed ? complete : undefined });
    revisions.set(id, response.revision);
    acceptSavedVersions(id, actual, response);
  }).catch(report);
}

function schedule() {
  if (applying || scheduled || !useStorageStatus.getState().ready) return;
  if (Object.values(useChatStore.getState().conversations).some((conversation) => conversation.isStreaming)) {
    draftTimer ??= setTimeout(() => { draftTimer = undefined; capture(); }, 1000);
    return;
  }
  clearTimeout(draftTimer); draftTimer = undefined;
  scheduled = true;
  queueMicrotask(() => { if (scheduled) capture(); });
}

function activate(workspace: StoredWorkspace, metadata?: WorkspaceMetadata) {
  activeId = workspace.metadata.id;
  revisions.set(activeId, workspace.revision);
  pendingConversations.clear();
  apply(workspace.data);
  settled = copyWorkspace(workspace.data);
  const store = useWorkspaceStore.getState();
  const entry = { ...workspace.metadata, ...metadata };
  const workspaces = [...store.workspaces.filter((item) => item.id !== entry.id), entry];
  useWorkspaceStore.setState({ workspaces, activeWorkspaceId: entry.id });
  updateButtons();
}

function observeStores() {
  flowUnsubscribe?.(); chatUnsubscribe?.();
  flowUnsubscribe = useFlowStore.subscribe((next, previous) => {
    if (applying || !hasPersistedFlowChanges(next, previous)) return;
    const contentChanged = next.nodes.length !== previous.nodes.length || next.edges !== previous.edges || next.nodes.some((node, index) => node.id !== previous.nodes[index]?.id || JSON.stringify(nodeContent(node)) !== JSON.stringify(nodeContent(previous.nodes[index])));
    if (contentChanged) schedule();
    else {
      // 拖动和自动测量不能每帧排队写整份界面投影；布局停下后再保存。
      clearTimeout(layoutTimer); layoutTimer = setTimeout(capture, 500);
    }
  });
  chatUnsubscribe = useChatStore.subscribe(schedule);
  window.caudalflowFlush = flushDesktopStorage;
  window.caudalflowPrepareClose = async () => {
    useStorageStatus.setState({ busy: true });
    try { await finishGenerations(); }
    catch (error) { useStorageStatus.setState({ busy: false }); throw error; }
  };
}

// 只迁移工作区字符串，保留旧 localStorage；设置和密钥不进入工作区文件。
export function initializeDesktopStorage(): Promise<void> {
  if (initialization) return initialization;
  initialization = (async () => {
    try {
      const registryRaw = localStorage.getItem('caudalflow-workspaces');
      const registry = JSON.parse(registryRaw ?? '{}').state;
      const legacy = (registry?.workspaces ?? []).map((metadata: WorkspaceMetadata) => {
        const raw = localStorage.getItem(`caudalflow-workspace-${metadata.id}`);
        return raw ? { metadata, raw } : null;
      }).filter(Boolean);
      const result = await storage.request<{ workspaces: WorkspaceMetadata[] }>('bootstrap', { legacy, registryRaw });
      const id = result.workspaces.find((item) => item.id === registry?.activeWorkspaceId && !item.unavailable)?.id ?? result.workspaces.find((item) => !item.unavailable)?.id;
      if (!id) throw new Error('没有可打开的工作区，请恢复文件到原位置后重试');
      useWorkspaceStore.setState({ workspaces: result.workspaces });
      const workspace = await storage.load(id);
      activate(workspace, result.workspaces.find((item) => item.id === id));
      useStorageStatus.setState({ ready: true });
      observeStores();
    } catch (error) { report(error); throw error; }
  })();
  return initialization;
}

export async function flushDesktopStorage() {
  if (layoutTimer) { clearTimeout(layoutTimer); layoutTimer = undefined; capture(); }
  if (draftTimer) { clearTimeout(draftTimer); draftTimer = undefined; capture(); }
  if (scheduled) capture();
  await queue;
  const error = useStorageStatus.getState().error;
  if (error) throw new Error(error);
}

// 保存失败允许显式重试；仍使用原 revision，冲突时不会覆盖外部更新。
export async function retryDesktopStorage() {
  await queue;
  useStorageStatus.setState({ error: null });
  if (!activeId) { initialization = undefined; await initializeDesktopStorage(); return; }
  try {
    const data = copyWorkspace(currentWorkspace());
    const result = await storage.save(activeId, data, revisions.get(activeId)!, '重试保存');
    revisions.set(activeId, result.revision);
    acceptSavedVersions(activeId, data, result);
    settled = completedSnapshot(data);
  } catch (error) { report(error); throw error; }
}

// 文件被搬走时允许重新选择位置，不要求用户先把文件搬回应用默认目录。
export async function recoverOpenDesktopWorkspace() {
  try {
    const workspace = await storage.request<StoredWorkspace | null>('open');
    if (!workspace) return;
    useWorkspaceStore.setState({ workspaces: await storage.request<WorkspaceMetadata[]>('list') });
    activate(workspace); observeStores();
    useStorageStatus.setState({ ready: true, error: null });
    initialization = Promise.resolve();
  } catch (error) { report(error); }
}

async function finishGenerations() {
  cancelAllGenerations();
  for (const [id, conversation] of Object.entries(useChatStore.getState().conversations)) if (conversation.isStreaming) {
    const target = conversation.streamingMessageId ?? conversation.messages.at(-1)?.id;
    useChatStore.getState().setConversationMessages(id, conversation.messages.map((message) => message.id === target ? { ...message, generationStatus: 'interrupted' } : message));
    useChatStore.getState().setStreaming(id, false);
  }
  pendingConversations.clear();
  if (scheduled || draftTimer) capture();
  await flushDesktopStorage();
}

async function perform<T>(action: () => Promise<T>): Promise<T | undefined> {
  if (useStorageStatus.getState().busy) return;
  useStorageStatus.setState({ busy: true });
  try {
    await flushDesktopStorage();
    return await action();
  } catch (error) { report(error); }
  finally { useStorageStatus.setState({ busy: false }); }
}

export async function switchDesktopWorkspace(id: string) {
  return perform(async () => {
    await finishGenerations();
    const workspace = await storage.load(id);
    activate(workspace, useWorkspaceStore.getState().workspaces.find((item) => item.id === id));
  });
}

export async function createDesktopWorkspace(name = '新工作区', data?: WorkspaceData) {
  return perform(async () => {
    await finishGenerations();
    const workspace = await storage.request<StoredWorkspace | null>('create', { name, ...(data ? { data } : {}) });
    if (workspace) activate(workspace);
  });
}

export async function openDesktopWorkspace() {
  return perform(async () => {
    await finishGenerations();
    const workspace = await storage.request<StoredWorkspace | null>('open');
    if (workspace) { histories.delete(workspace.metadata.id); activate(workspace); }
  });
}

export async function deleteDesktopWorkspace(id: string) {
  return perform(async () => {
    if (id === activeId) await finishGenerations();
    let workspaces = await storage.request<WorkspaceMetadata[]>('delete', { id });
    histories.delete(id); revisions.delete(id);
    if (!workspaces.length) workspaces = (await storage.request<{ workspaces: WorkspaceMetadata[] }>('bootstrap')).workspaces;
    useWorkspaceStore.setState({ workspaces });
    if (id === activeId) activate(await storage.load(workspaces[0].id), workspaces[0]);
  });
}

export async function renameDesktopWorkspace(id: string, name: string) {
  return perform(async () => {
    const metadata = await storage.request<WorkspaceMetadata>('rename', { id, name });
    useWorkspaceStore.setState((state) => ({ workspaces: state.workspaces.map((item) => item.id === id ? { ...item, ...metadata } : item) }));
  });
}

export async function exportDesktopWorkspace() {
  return perform(async () => { if (activeId) await storage.request('export', { id: activeId, name: useWorkspaceStore.getState().getActiveWorkspace()?.name }); });
}

// 暂停生成后把部分结果作为完整一步，再执行撤销；回放不触发新的 AI 请求。
export async function replayDesktopCommand(direction: 'undo' | 'redo') {
  return perform(async () => {
    await finishGenerations();
    const result = history()[direction](currentWorkspace());
    if (!result || !activeId) return;
    const id = activeId;
    try {
      const saved = await storage.save(id, result.data, revisions.get(id)!, result.label);
      revisions.set(id, saved.revision);
      apply(result.data); acceptSavedVersions(id, result.data, saved); settled = copyWorkspace(currentWorkspace());
    } catch (error) { history()[direction === 'undo' ? 'redo' : 'undo'](currentWorkspace()); throw error; }
    updateButtons();
  });
}

export async function listDesktopHistory(): Promise<HistoryEntry[]> {
  await flushDesktopStorage();
  return activeId ? storage.request('history', { id: activeId }) : [];
}

// 捕获工作区 ID，异步返回结果只能由该工作区的历史窗口使用。
export async function readDesktopHistory(historyId: string, workspaceId: string): Promise<HistoryDetail> {
  if (workspaceId !== activeId) throw new Error('工作区已切换，请重新打开本地历史');
  return storage.request('historyDetail', { id: workspaceId, historyId });
}

export async function clearDesktopHistory() {
  return perform(async () => { if (activeId) await storage.request('clearHistory', { id: activeId }); });
}

export async function restoreDesktopHistory(historyId: string, side: 'before' | 'after' = 'after', conversationId?: string, selection?: HistorySelection) {
  return perform(async () => {
    if (!activeId) return;
    // 先停止生成并排空旧保存队列，避免晚到的草稿在还原后覆盖历史内容。
    await finishGenerations();
    activate(await storage.request<StoredWorkspace>('restore', { id: activeId, historyId, side, conversationId, selection }), useWorkspaceStore.getState().getActiveWorkspace());
    history().clear(); updateButtons();
    return true;
  });
}

export async function listDocumentVersions(documentId: string): Promise<DocumentVersion[]> {
  await flushDesktopStorage();
  return activeId ? storage.request('versions', { id: activeId, documentId }) : [];
}

export async function selectDocumentVersion(nodeId: string, documentId: string, versionId: string) {
  return perform(async () => {
    if (!activeId || useChatStore.getState().conversations[nodeId]?.isStreaming) return;
    const message = await storage.request<ChatMessage>('version', { id: activeId, documentId, versionId });
    const chat = useChatStore.getState();
    // 完整替换，旧版本没有的图片和思考内容也必须清除，不能与当前版本合并。
    chat.setConversationMessages(nodeId, chat.getMessages(nodeId).map((item) => item.id === documentId ? { ...message, replyToId: message.replyToId ?? item.replyToId } : item));
    if (scheduled) capture();
    await flushDesktopStorage();
  });
}

// 只供卸载和测试清理订阅；桌面初始化在应用生命周期内保持单例。
export function disposeDesktopStorage() { flowUnsubscribe?.(); chatUnsubscribe?.(); clearTimeout(draftTimer); clearTimeout(layoutTimer); }

declare global { interface Window { caudalflowFlush?: () => Promise<void>; caudalflowPrepareClose?: () => Promise<void> } }
