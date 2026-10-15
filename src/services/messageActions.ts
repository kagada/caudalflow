import { nanoid } from 'nanoid';
import { useChatStore } from '../stores/chatStore';
import { useFlowStore } from '../stores/flowStore';
import { streamChat } from './llm';
import { getRootSystemPrompt, getBranchSystemPrompt, getMergeSystemPrompt } from '../utils/systemPrompts';
import type { ChatMessage } from '../types/chat';
import { isDesktopStorage } from './storage/desktop';

function systemPrompt(nodeId: string): string {
  const node = useFlowStore.getState().nodes.find((item) => item.id === nodeId);
  if (!node) return getRootSystemPrompt();
  const parents = (node.data.parentNodeIds ?? (node.data.parentNodeId ? [node.data.parentNodeId] : [])) as string[];
  const contexts = parents.map((id) => ({ topic: useFlowStore.getState().nodes.find((item) => item.id === id)?.data.topic ?? '', messages: useChatStore.getState().getMessages(id).map(({ role, content }) => ({ role, content })) }));
  if (contexts.length > 1) return getMergeSystemPrompt(contexts, String(node.data.mergeAction ?? ''));
  if (contexts.length) return getBranchSystemPrompt(contexts[0].topic, contexts[0].messages);
  return getRootSystemPrompt();
}

// 只重新生成目标回复，保留旧版本和后续消息，流式内容按消息 ID 更新。
export function reviseMessage(nodeId: string, messageId: string, prompt: string | undefined, signal: AbortSignal): void {
  const store = useChatStore.getState();
  if (store.conversations[nodeId]?.isStreaming) return;
  const messages = store.getMessages(nodeId);
  const index = messages.findIndex((message) => message.id === messageId);
  if (index < 0 || messages[index].role === 'system') return;
  const source = messages[index];
  const next = messages[index + 1];
  const original = source.role === 'assistant' ? source : next?.role === 'assistant' ? next : undefined;
  const target: ChatMessage = { ...(original ?? { id: nanoid(), role: 'assistant', timestamp: Date.now() }), content: '', reasoning: undefined, generationStatus: undefined,
    // 桌面版本由 SQLite 管理，运行时不再把所有旧正文嵌进当前消息。
    previousVersions: isDesktopStorage() ? undefined : original ? [...(original.previousVersions ?? []), { content: original.content, reasoning: original.reasoning, timestamp: original.timestamp }] : [] };
  const history = messages.slice(0, source.role === 'assistant' ? index : index + 1);
  const context: ChatMessage[] = [{ id: 'system', role: 'system', content: systemPrompt(nodeId), timestamp: 0 }, ...history];
  if (prompt) context.push({ id: nanoid(), role: 'user', content: `请按以下要求重构这条回答：${prompt}\n\n原回答：\n${source.content}`, timestamp: Date.now() });
  if (original) store.addOrUpdateMessage(nodeId, target);
  else store.setConversationMessages(nodeId, [...messages.slice(0, index + 1), target, ...messages.slice(index + 1)]);
  store.setStreaming(nodeId, true, target.id);
  let content = '';
  let reasoning = '';
  const update = () => useChatStore.getState().addOrUpdateMessage(nodeId, { ...target, content, reasoning });
  const abort = () => { if (!content && original) useChatStore.getState().addOrUpdateMessage(nodeId, original); useChatStore.getState().setStreaming(nodeId, false); };
  signal.addEventListener('abort', abort, { once: true });
  streamChat(context, {
    onToken: (token) => { content += token; update(); },
    onReasoning: (token) => { reasoning += token; update(); },
    onDone: () => { signal.removeEventListener('abort', abort); useChatStore.getState().setStreaming(nodeId, false); },
    onError: (error) => { signal.removeEventListener('abort', abort); content = `${content || original?.content || ''}\n\n**错误：** ${error.message}`; update(); useChatStore.getState().setStreaming(nodeId, false); },
  }, signal);
}
