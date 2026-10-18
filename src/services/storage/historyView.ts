import type { ChatMessage } from '../../types/chat';
import type { WorkspaceData } from '../../types/workspace';
import type { HistoryDetail, HistorySelection } from './types';
import { nodeContent } from './snapshot';

export type ChangeKind = 'added' | 'removed' | 'modified';
export interface HistorySection { id: string; title: string; before?: ChatMessage; after?: ChatMessage; beforeText: string; afterText: string }
export interface HistoryItem {
  id: string; title: string; kind: ChangeKind; inferred: boolean;
  sections: HistorySection[]; selection: HistorySelection;
}
export interface HistoryConversation { id: string; title: string; kind: ChangeKind; items: HistoryItem[] }

function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical);
  return value && typeof value === 'object' ? Object.fromEntries(Object.entries(value).filter(([, item]) => item !== undefined).sort(([a], [b]) => a.localeCompare(b)).map(([key, item]) => [key, canonical(item)])) : value;
}
const serialize = (value: unknown) => JSON.stringify(canonical(value), null, 2);
const kind = (before: boolean, after: boolean): ChangeKind => !before ? 'added' : !after ? 'removed' : 'modified';
const preview = (text: string) => text.replace(/\s+/g, ' ').slice(0, 60) || '空内容';

// 版本 ID 变化本身不是正文差异；附件、思考和关联变化则不能被忽略。
function messageValue(message: ChatMessage) {
  const { versionId, previousVersions, usage, ...content } = message;
  void versionId; void previousVersions; void usage;
  return { ...content, kind: content.kind ?? 'message' };
}

function attributes(data: WorkspaceData, id: string) {
  const node = data.nodes.find((item) => item.id === id);
  if (!node) return undefined;
  const values = nodeContent(node);
  const names: Record<string, string> = { topic: '名称', titleSource: '标题来源', label: '标签', done: '搞定状态', color: '颜色', parentNodeId: '来源会话', parentNodeIds: '来源会话列表', branchText: '分支文字', mergeAction: '总结要求' };
  values.done = Boolean(values.done);
  const titleSources: Record<string, string> = { pending: '待命名', temporary: '首次问题节选', generated: 'AI 自动命名', manual: '手动命名' };
  if (typeof values.titleSource === 'string') values.titleSource = titleSources[values.titleSource] ?? values.titleSource;
  return Object.fromEntries(Object.entries(values).map(([key, value]) => [names[key] ?? key, value]));
}

interface MessageGroup { id: string; messages: ChatMessage[]; inferred: boolean }

// 老记录只能按当时的排列推断问答；先合并两侧来源，删除问题后仍能显示其原回复。
function groups(before: ChatMessage[], after: ChatMessage[]) {
  const owners = new Map<string, string>();
  for (const messages of [after, before]) {
    let question: string | undefined;
    for (const message of messages) {
      if (message.role === 'user') question = message.id;
      if (message.role === 'assistant' && question) owners.set(message.id, question);
    }
  }
  const explicit = new Map([...before, ...after].filter((message) => message.replyToId).map((message) => [message.id, message.replyToId!]));
  const collect = (messages: ChatMessage[]) => {
    const result = new Map<string, MessageGroup>();
    for (const message of messages) {
      const owner = message.kind === 'reference' ? message.referenceForId : message.role === 'user' ? message.id : message.role === 'assistant' ? message.replyToId ?? explicit.get(message.id) ?? owners.get(message.id) : undefined;
      const id = owner ? `question:${owner}` : `document:${message.id}`;
      const group = result.get(id) ?? { id, messages: [], inferred: false };
      group.messages.push(message);
      group.inferred ||= message.role === 'assistant' && Boolean(owner) && !message.replyToId && !explicit.has(message.id);
      result.set(id, group);
    }
    return result;
  };
  return [collect(before), collect(after)];
}

function messageSections(before: ChatMessage[], after: ChatMessage[]): HistorySection[] {
  const ids = [...new Set([...before, ...after].map((message) => message.id))];
  return ids.flatMap((id) => {
    const old = before.find((message) => message.id === id);
    const next = after.find((message) => message.id === id);
    const message = next ?? old!;
    const role = message.kind === 'reference' ? '引用' : message.role === 'user' ? '问题' : message.role === 'assistant' ? '回复文档' : '系统提示';
    const sections: HistorySection[] = [{ id, title: role, before: old, after: next, beforeText: old?.content ?? '', afterText: next?.content ?? '' }];
    if (old?.reference || next?.reference) sections.push({ id: `${id}:reference`, title: '引用原文与来源', beforeText: old?.reference ? serialize(old.reference) : '', afterText: next?.reference ? serialize(next.reference) : '' });
    if (old?.reasoning || next?.reasoning) sections.push({ id: `${id}:reasoning`, title: `${role} · 思考内容`, beforeText: old?.reasoning ?? '', afterText: next?.reasoning ?? '' });
    const info = (item?: ChatMessage) => item ? { 角色: item.role, 创建时间: item.timestamp, 来源: item.triggeredBy, 对应问题: item.replyToId, 生成状态: item.generationStatus } : undefined;
    if (old && next && serialize(info(old)) !== serialize(info(next))) sections.push({ id: `${id}:metadata`, title: `${role} · 属性`, beforeText: serialize(info(old)) ?? '', afterText: serialize(info(next)) ?? '' });
    return sections;
  });
}

// 从一次操作的前后快照构建“会话 → 变化内容”，不把未修改会话列为受影响对象。
export function buildHistoryView(detail: HistoryDetail): HistoryConversation[] {
  const { before, after } = detail;
  return [...new Set([...before.nodes, ...after.nodes].map((node) => node.id))].flatMap((id) => {
    const oldNode = before.nodes.find((node) => node.id === id);
    const nextNode = after.nodes.find((node) => node.id === id);
    const items: HistoryItem[] = [];
    const oldAttributes = attributes(before, id);
    const nextAttributes = attributes(after, id);
    if (serialize(oldAttributes) !== serialize(nextAttributes)) items.push({ id: `${id}:attributes`, title: '会话属性', kind: kind(Boolean(oldNode), Boolean(nextNode)), inferred: false, selection: { attributesOnly: true }, sections: [{ id: `${id}:attributes`, title: '会话属性', beforeText: serialize(oldAttributes) ?? '', afterText: serialize(nextAttributes) ?? '' }] });
    const [oldGroups, nextGroups] = groups(before.conversations[id]?.messages ?? [], after.conversations[id]?.messages ?? []);
    for (const key of new Set([...oldGroups.keys(), ...nextGroups.keys()])) {
      const old = oldGroups.get(key); const next = nextGroups.get(key);
      if (serialize(old?.messages.map(messageValue)) === serialize(next?.messages.map(messageValue))) continue;
      const oldMessages = old?.messages ?? []; const nextMessages = next?.messages ?? [];
      const question = [...nextMessages, ...oldMessages].find((message) => message.role === 'user');
      const title = question ? `问题：${preview(question.content)}` : key.startsWith('question:') ? '问题已不在记录中 · 关联回复' : `${nextMessages[0]?.role === 'system' || oldMessages[0]?.role === 'system' ? '系统提示' : '独立文档'}：${preview((nextMessages[0] ?? oldMessages[0]).content)}`;
      items.push({ id: `${id}:${key}`, title, kind: kind(Boolean(old), Boolean(next)), inferred: Boolean(old?.inferred || next?.inferred), sections: messageSections(oldMessages, nextMessages), selection: { documentIds: [...new Set([...oldMessages, ...nextMessages].map((message) => message.id))] } });
    }
    const oldEdges = before.edges.filter((edge) => edge.source === id || edge.target === id);
    const nextEdges = after.edges.filter((edge) => edge.source === id || edge.target === id);
    const edgeContent = (edges: typeof oldEdges) => edges.map(({ id, source, target, data }) => ({ id, source, target, data }));
    if (serialize(edgeContent(oldEdges)) !== serialize(edgeContent(nextEdges))) {
      const changedIds = [...new Set([...oldEdges, ...nextEdges].map((edge) => edge.id))].filter((edgeId) => serialize(edgeContent(oldEdges.filter((edge) => edge.id === edgeId))) !== serialize(edgeContent(nextEdges.filter((edge) => edge.id === edgeId))));
      items.push({ id: `${id}:relations`, title: '会话关系', kind: kind(Boolean(oldEdges.length), Boolean(nextEdges.length)), inferred: false, selection: { relationIds: changedIds }, sections: [{ id: `${id}:relations`, title: '会话关系', beforeText: serialize(edgeContent(oldEdges)), afterText: serialize(edgeContent(nextEdges)) }] });
    }
    return items.length ? [{ id, title: nextNode?.data.topic ?? oldNode!.data.topic, kind: kind(Boolean(oldNode), Boolean(nextNode)), items }] : [];
  });
}
