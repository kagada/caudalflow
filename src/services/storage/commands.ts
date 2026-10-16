import type { WorkspaceData } from '../../types/workspace';
import { contentKey, copyWorkspace, nodeContent, replayChanges } from './snapshot';

interface Command { before: WorkspaceData; after: WorkspaceData; beforeOrder: string[]; afterOrder: string[]; label: string; initializationId?: string }

// 只接纳首次回复和临时标题变为自动标题；用户编辑、再次提问和重新生成都会结束初始化。
function isInitializationStep(before: WorkspaceData, after: WorkspaceData, id: string): boolean {
  const oldNode = before.nodes.find((node) => node.id === id);
  const nextNode = after.nodes.find((node) => node.id === id);
  if (!oldNode || !nextNode) return false;
  const oldMessages = before.conversations[id]?.messages ?? [];
  const nextMessages = after.conversations[id]?.messages ?? [];
  const question = oldMessages.filter((message) => message.role === 'user');
  if (question.length !== 1 || nextMessages.filter((message) => message.role === 'user').length !== 1) return false;
  const title = oldNode.data.titleSource === 'temporary' && nextNode.data.titleSource === 'generated';
  const oldAnswers = oldMessages.filter((message) => message.role === 'assistant');
  const nextAnswers = nextMessages.filter((message) => message.role === 'assistant');
  const reply = oldAnswers.length === 0 && nextAnswers.length === 1 &&
    (!nextAnswers[0].replyToId || nextAnswers[0].replyToId === question[0].id);
  if (!title && !reply) return false;
  const normalized = copyWorkspace(after);
  if (title) normalized.nodes.find((node) => node.id === id)!.data = { ...nextNode.data, topic: oldNode.data.topic, titleSource: oldNode.data.titleSource };
  if (reply) normalized.conversations[id].messages = nextMessages.filter((message) => message.id !== nextAnswers[0].id);
  return contentKey(before) === contentKey(normalized);
}

// 操作栈只保留受影响的会话与连线，不为修改一个标签复制整个工作区的聊天正文。
function commandData(before: WorkspaceData, after: WorkspaceData, label: string): Command {
  const ids = new Set([...before.nodes.map((node) => node.id), ...after.nodes.map((node) => node.id)]);
  const changedConversations = new Set([...ids].filter((id) => JSON.stringify(before.conversations[id]) !== JSON.stringify(after.conversations[id])));
  const changedNodes = new Set([...ids].filter((id) => {
    const old = before.nodes.find((node) => node.id === id);
    const next = after.nodes.find((node) => node.id === id);
    return changedConversations.has(id) || JSON.stringify(old && nodeContent(old)) !== JSON.stringify(next && nodeContent(next));
  }));
  const edges = new Set([...before.edges, ...after.edges].map((edge) => edge.id));
  const changedEdges = new Set([...edges].filter((id) => JSON.stringify(before.edges.find((edge) => edge.id === id)) !== JSON.stringify(after.edges.find((edge) => edge.id === id))));
  const pick = (data: WorkspaceData) => copyWorkspace({ nodes: data.nodes.filter((node) => changedNodes.has(node.id)), edges: data.edges.filter((edge) => changedEdges.has(edge.id)), conversations: Object.fromEntries(Object.entries(data.conversations).filter(([id]) => changedConversations.has(id))) });
  return { before: pick(before), after: pick(after), beforeOrder: before.nodes.map((node) => node.id), afterOrder: after.nodes.map((node) => node.id), label };
}

function replay(current: WorkspaceData, from: WorkspaceData, to: WorkspaceData, order: string[]) {
  const data = replayChanges(current, from, to);
  const indexes = new Map(order.map((id, index) => [id, index]));
  data.nodes.sort((a, b) => (indexes.get(a.id) ?? order.length) - (indexes.get(b.id) ?? order.length));
  return data;
}

// 用用户动作命名历史，避免恢复列表里所有条目都叫“修改内容”。
export function describeContentChange(before: WorkspaceData, after: WorkspaceData): string {
  if (after.nodes.length > before.nodes.length) return '创建会话或分支';
  if (after.nodes.length < before.nodes.length) return '删除会话';
  for (const node of after.nodes) {
    const old = before.nodes.find((item) => item.id === node.id);
    if (!old) continue;
    if (old.data.topic !== node.data.topic) return node.data.titleSource === 'generated' ? '自动生成会话标题' : '修改会话名称';
    if (Boolean(old.data.done) !== Boolean(node.data.done)) return '修改搞定状态';
    if (old.data.label !== node.data.label || old.data.color !== node.data.color) return '修改会话标签';
    const previous = before.conversations[node.id]?.messages ?? [];
    const next = after.conversations[node.id]?.messages ?? [];
    if (next.length > previous.length) return next.slice(previous.length).every((message) => message.role === 'assistant') ? '回复完成' : '添加问题或回答';
    if (next.length < previous.length) return '删除文档';
    if (JSON.stringify(next) !== JSON.stringify(previous)) return '修改文档或切换版本';
  }
  return '修改会话关系';
}

// 操作栈只属于本次运行，不把拖动、布局或输入框原生编辑变成工作区撤销步骤。
export function createContentHistory() {
  const undo: Command[] = [];
  const redo: Command[] = [];
  let mergedCreationId: string | undefined;
  let mergedInitializationId: string | undefined;
  return {
    record(before: WorkspaceData, after: WorkspaceData, label = '修改内容', firstQuestionId?: string) {
      mergedCreationId = undefined;
      mergedInitializationId = undefined;
      if (contentKey(before) === contentKey(after)) return false;
      const command = commandData(before, after, label);
      const previous = undo.at(-1);
      const initializationId = previous?.initializationId;
      // 初始化只扩展当前最后一步，任何其他内容操作都会封闭这一组。
      if (!redo.length && initializationId && isInitializationStep(before, after, initializationId)) {
        undo.pop();
        undo.push({ ...previous, after: replayChanges(previous.after, command.before, command.after), afterOrder: command.afterOrder });
        mergedInitializationId = initializationId;
      } else if (firstQuestionId && !redo.length && previous?.label === '创建会话或分支' &&
        previous.before.nodes.length === 0 && previous.after.nodes.length === 1 && previous.after.nodes[0].id === firstQuestionId &&
        previous.before.edges.length === 0 && previous.after.edges.every((edge) => edge.source === firstQuestionId || edge.target === firstQuestionId) &&
        command.before.nodes.length === 1 && command.after.nodes.length === 1 && command.after.nodes[0].id === firstQuestionId &&
        command.before.edges.length === 0 && command.after.edges.length === 0 &&
        !(before.conversations[firstQuestionId]?.messages ?? []).some((message) => message.role !== 'system') &&
        (after.conversations[firstQuestionId]?.messages ?? []).filter((message) => message.role !== 'system').length === 1 &&
        after.conversations[firstQuestionId]?.messages.at(-1)?.role === 'user' &&
        contentKey({ ...previous.after, edges: [] }) === contentKey(command.before)) {
        undo.pop();
        undo.push({ ...command, before: previous.before, beforeOrder: previous.beforeOrder,
          after: { ...command.after, edges: previous.after.edges }, label: '创建会话并提问', initializationId: firstQuestionId });
        mergedCreationId = firstQuestionId;
      } else {
        if (previous) delete previous.initializationId;
        if (firstQuestionId && command.after.nodes.length === 1 && command.after.nodes[0].id === firstQuestionId &&
          (after.conversations[firstQuestionId]?.messages ?? []).filter((message) => message.role !== 'system').length === 1 &&
          after.conversations[firstQuestionId]?.messages.at(-1)?.role === 'user') command.initializationId = firstQuestionId;
        undo.push(command);
      }
      if (undo.length > 50) undo.shift();
      redo.length = 0;
      return true;
    },
    undo(current: WorkspaceData) {
      for (const entry of undo) delete entry.initializationId;
      const command = undo.pop();
      if (!command) return null;
      redo.push(command);
      return { data: replay(current, command.after, command.before, command.beforeOrder), label: `撤销：${command.label}` };
    },
    redo(current: WorkspaceData) {
      const command = redo.pop();
      if (!command) return null;
      undo.push(command);
      return { data: replay(current, command.before, command.after, command.afterOrder), label: `重做：${command.label}` };
    },
    clear() { undo.length = 0; redo.length = 0; },
    endInitialization() { for (const entry of undo) delete entry.initializationId; },
    get canUndo() { return undo.length > 0; },
    get canRedo() { return redo.length > 0; },
    get mergedCreationId() { return mergedCreationId; },
    get mergedInitializationId() { return mergedInitializationId; },
    get lastLabel() { return undo.at(-1)?.label; },
  };
}
