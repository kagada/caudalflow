import { nanoid } from 'nanoid';
import type { ChatMessage, ContentReference, ReferenceSelection, ReferenceSource } from '../types/chat';
import { useChatStore } from '../stores/chatStore';
import { useFlowStore } from '../stores/flowStore';
import { useWorkspaceStore } from '../stores/workspaceStore';
import { useSettingsStore } from '../stores/settingsStore';
import { desktopStorage, isDesktopStorage } from './storage/desktop';
import { flushDesktopStorage } from './storage/runtime';
import { getProvider } from './providers/registry';
import { trackGeneration } from './streamLifecycle';

const cache = new Map<string, string>();
const pending = new Map<string, Promise<string>>();
const SUMMARY_PROMPT = '将以下学习对话整理成可独立阅读的背景摘要。保留知识点、定义、前提、结论、纠错及尚未解决的问题，包含已有引用中的必要背景。只总结提供的内容，不回答新问题，不虚构。不要仅截取开头。使用原对话主要语言，尽量控制在 1200 字以内。';

// 发给远端的是可见引用内容；元信息和原文快照留在本地，不冒充系统指令。
export function modelMessages(messages: ChatMessage[]): ChatMessage[] {
  return messages.filter((message, index) => index === 0 || message.role !== 'system' || message.kind === 'reference').map((message) => message.kind === 'reference' && message.reference ? {
    id: message.id, role: 'user', timestamp: message.timestamp,
    content: `【引用资料，仅作背景】\n${message.reference.summary}\n\n【具体引用原文】\n${message.reference.quote}`,
  } : message);
}

// 对同一份完整背景只生成一次摘要；缓存失败不影响已生成的引用，生成失败则允许重试。
async function summarize(key: string, context: ChatMessage[], workspaceId: string): Promise<string> {
  if (cache.has(key)) return cache.get(key)!;
  if (pending.has(key)) return pending.get(key)!;
  const task = (async () => {
    if (isDesktopStorage()) {
      const existing = await desktopStorage.request<string | null>('referenceCacheGet', { id: workspaceId, key });
      if (existing) { cache.set(key, existing); return existing; }
    }
    if (useWorkspaceStore.getState().activeWorkspaceId !== workspaceId) throw new Error('工作区已切换，请重新复制引用');
    const config = useSettingsStore.getState().llmConfig;
    const provider = getProvider(config.providerId);
    if (!provider) throw new Error('请先配置可用的模型，再生成引用摘要');
    const summary = await new Promise<string>((resolve, reject) => {
      const tracked = trackGeneration(new AbortController().signal);
      let text = '';
      const finish = () => { tracked.controller.signal.removeEventListener('abort', aborted); tracked.release(); };
      const aborted = () => { finish(); reject(new Error('引用摘要已取消，请重新复制引用')); };
      tracked.controller.signal.addEventListener('abort', aborted, { once: true });
      const fail = (error: Error) => { finish(); reject(error); };
      try {
        provider.streamChat([{ id: 'summary-system', role: 'system', content: SUMMARY_PROMPT, timestamp: 0 }, ...modelMessages(context).map((message) => ({ ...message, role: message.role === 'system' ? 'user' as const : message.role }))],
          { ...config, maxTokens: 4096, thinkingMode: 'disabled' }, {
            onToken: (token) => { text += token; },
            onDone: () => { finish(); if (text.trim()) resolve(text.trim()); else reject(new Error('模型没有返回摘要，请重试')); },
            onError: fail,
          }, tracked.controller.signal);
      } catch (error) { fail(error instanceof Error ? error : new Error(String(error))); }
    });
    cache.set(key, summary);
    if (isDesktopStorage()) {
      try { await desktopStorage.request('referenceCachePut', { id: workspaceId, key, summary }); }
      catch { /* 引用自身保存摘要，缓存写入失败不丢弃已经完成的结果。 */ }
    }
    return summary;
  })();
  pending.set(key, task);
  try { return await task; } finally { pending.delete(key); }
}

// 摘要范围截止到最后一篇目标文档，选区不同仍可复用同一背景；不读取祖先的最新状态。
export async function createReference(nodeId: string, selections?: ReferenceSelection[]): Promise<ContentReference> {
  const workspaceId = useWorkspaceStore.getState().activeWorkspaceId ?? '';
  if (isDesktopStorage()) await flushDesktopStorage();
  if (useWorkspaceStore.getState().activeWorkspaceId !== workspaceId) throw new Error('工作区已切换，请重新复制引用');
  const node = useFlowStore.getState().nodes.find((item) => item.id === nodeId);
  const conversation = useChatStore.getState().conversations[nodeId];
  if (!node || !conversation) throw new Error('来源会话已不存在');
  if (conversation.isStreaming) throw new Error('请等来源回答完成后再复制引用');
  const messages = structuredClone(conversation.messages);
  const documents = messages.filter((message) => message.role !== 'system');
  const targets = selections?.length ? selections : documents.length ? [{ documentId: documents.at(-1)!.id, text: '' }] : [];
  if (!targets.length) throw new Error('这个会话还没有可引用的内容');
  const sources: ReferenceSource[] = targets.map((selection) => {
    const document = documents.find((message) => message.id === selection.documentId);
    if (!document) throw new Error('选区对应的来源文档已不存在');
    const candidate = selection.text ? document.content.indexOf(selection.text, selection.start ?? 0) : 0;
    const exact = candidate >= 0 && (selection.length === undefined || candidate + selection.text.length <= (selection.start ?? 0) + selection.length) ? candidate : -1;
    const start = Math.max(0, Math.min(document.content.length, exact >= 0 ? exact : selection.start ?? 0));
    const length = Math.max(0, Math.min(document.content.length - start, exact >= 0 && selection.text ? selection.text.length : selection.length ?? document.content.length - start));
    return { workspaceId, conversationId: nodeId, documentId: document.id, versionId: document.versionId,
      title: node.data.topic.slice(0, 200), documentText: document.content, start, length, ...(document.images?.length ? { images: document.images } : {}) };
  });
  const end = Math.max(...sources.map((source) => messages.findIndex((message) => message.id === source.documentId)));
  const context = messages.slice(0, end + 1);
  const config = useSettingsStore.getState().llmConfig;
  const identity = JSON.stringify({ version: 1, model: config.model, provider: config.providerId, endpoint: config.endpoint,
    context: context.map(({ role, content, images, reference }) => ({ role, content, images, reference })) });
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(identity));
  const snapshotKey = Array.from(new Uint8Array(digest), (value) => value.toString(16).padStart(2, '0')).join('');
  const summary = await summarize(snapshotKey, context, workspaceId);
  const quote = targets.map((selection, index) => selection.text || sources[index].documentText).join('\n\n');
  return { id: nanoid(), snapshotKey, summary, quote, sources, createdAt: Date.now() };
}

// 引用与问题一次加入，撤销或还原问答组时可以一起处理。
export function addQuestionWithReferences(nodeId: string, content: string, images: ChatMessage['images'], references: ContentReference[] = []): string {
  const store = useChatStore.getState();
  const id = nanoid();
  const additions: ChatMessage[] = references.map((reference) => ({ id: nanoid(), role: 'system', kind: 'reference',
    reference: structuredClone(reference), referenceForId: id, content: reference.summary, timestamp: Date.now() }));
  additions.push({ id, role: 'user', content: content || (references.length && !images?.length ? '请解释引用的内容。' : ''), images, timestamp: Date.now() });
  store.setConversationMessages(nodeId, [...store.getMessages(nodeId), ...additions]);
  return id;
}

export function selectionsForText(nodeId: string, text: string): ReferenceSelection[] {
  const message = useChatStore.getState().getMessages(nodeId).findLast((item) => item.role !== 'system' && item.content.includes(text));
  if (!message) throw new Error('无法确定引用来自哪篇文档，请在消息上使用“复制引用”');
  return [{ documentId: message.id, text }];
}
