import { resolveModelConfig } from './modelConfig';
import { nanoid } from 'nanoid';
import type { ChatMessage, ContentReference, ReferenceSelection, ReferenceSource } from '../types/chat';
import { useChatStore } from '../stores/chatStore';
import { useFlowStore } from '../stores/flowStore';
import { useWorkspaceStore } from '../stores/workspaceStore';
import { useSettingsStore } from '../stores/settingsStore';
import { sqliteStorage, isSqliteStorage } from './storage/client';
import { flushDesktopStorage } from './storage/runtime';
import { getProvider } from './providers/registry';
import { trackGeneration } from './streamLifecycle';
import { DEFAULT_BUILTIN_PROMPTS, REFERENCE_SUMMARY_MAX_CHARS, REFERENCE_SUMMARY_TARGET_CHARS, renderSummaryPrompt } from './builtinPrompts';
import { trackRequestUsage, type UsageTarget } from './requestUsage';

const cache = new Map<string, string>();
const pending = new Map<string, Promise<string>>();
// 缓存用 128 位内容摘要的紧凑表示，避免保存 64 字符十六进制串。
async function referenceKey(value: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
  return btoa(String.fromCharCode(...new Uint8Array(digest).slice(0, 16))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
// 发给远端的是可见引用内容；元信息和原文快照留在本地，不冒充系统指令。
export function modelMessages(messages: ChatMessage[]): ChatMessage[] {
  return messages.filter((message, index) => index === 0 || message.role !== 'system' || message.kind === 'reference').map((message) => message.kind === 'reference' && message.reference ? {
    id: message.id, role: 'user', timestamp: message.timestamp,
    content: `【引用资料，仅作背景】\n${message.reference.summary}\n\n【具体引用原文】\n${message.reference.quote}`,
  } : message);
}

// 对同一份完整背景只生成一次摘要；缓存失败不影响已生成的引用，生成失败则允许重试。
async function summarize(key: string, context: ChatMessage[], workspaceId: string, prompt: string, maxChars: number, target?: UsageTarget): Promise<string> {
  if (cache.has(key)) return cache.get(key)!;
  if (pending.has(key)) return pending.get(key)!;
  const task = (async () => {
    if (isSqliteStorage()) {
      const existing = await sqliteStorage.request<string | null>('referenceCacheGet', { id: workspaceId, key });
      if (existing) { cache.set(key, existing); return existing; }
    }
    if (useWorkspaceStore.getState().activeWorkspaceId !== workspaceId) throw new Error('工作区已切换，请重新复制引用');
    const config = resolveModelConfig(target?.nodeId);
    const provider = getProvider(config.providerId);
    if (!provider) throw new Error('请先配置可用的模型，再生成引用摘要');
    const generate = (input: ChatMessage[], instruction: string, purpose: 'reference_summary' | 'summary_compression') => new Promise<string>((resolve, reject) => {
      const tracked = trackGeneration(new AbortController().signal);
      const usage = trackRequestUsage(target, purpose, config, tracked.controller.signal);
      let text = '';
      const finish = () => { tracked.controller.signal.removeEventListener('abort', aborted); tracked.release(); };
      const aborted = () => { finish(); reject(new Error('引用摘要已取消，请重新复制引用')); };
      tracked.controller.signal.addEventListener('abort', aborted, { once: true });
      const fail = (error: Error) => { usage.fail(); finish(); reject(error); };
      try {
        provider.streamChat([{ id: 'summary-system', role: 'system', content: instruction, timestamp: 0 }, ...modelMessages(input).map((message) => ({ ...message, role: message.role === 'system' ? 'user' as const : message.role }))],
          // 摘要只整理已有资料，不继承会话的付费搜索权限。
          { ...config, webSearch: false, maxTokens: Math.max(128, Math.min(4096, maxChars * 3)), thinkingMode: 'disabled' }, {
            onUsage: usage.onUsage,
            onToken: (token) => { text += token; },
            onDone: () => { usage.complete(); finish(); if (text.trim()) resolve(text.trim()); else reject(new Error('模型没有返回摘要，请重试')); },
            onError: fail,
          }, tracked.controller.signal);
      } catch (error) { fail(error instanceof Error ? error : new Error(String(error))); }
    });
    let summary = await generate(context, prompt, 'reference_summary');
    if (summary.length > maxChars) {
      summary = await generate([{ id: 'compress', role: 'user', content: summary, timestamp: 0 }], `${prompt}\n上次结果过长。请将下面的摘要进一步压缩至约 ${REFERENCE_SUMMARY_TARGET_CHARS} 字，最多 ${maxChars} 字，只输出压缩结果。`, 'summary_compression');
    }
    if (summary.length > maxChars) throw new Error(`摘要压缩后仍超过 ${maxChars} 字，请重试`);
    cache.set(key, summary);
    if (isSqliteStorage()) {
      try { await sqliteStorage.request('referenceCachePut', { id: workspaceId, key, summary }); }
      catch { /* 引用自身保存摘要，缓存写入失败不丢弃已经完成的结果。 */ }
    }
    return summary;
  })();
  pending.set(key, task);
  try { return await task; } finally { pending.delete(key); }
}

// 摘要范围截止到最后一篇目标文档，选区不同仍可复用同一背景；不读取祖先的最新状态。
export async function createReference(nodeId: string, selections?: ReferenceSelection[], options: { deferSummary?: boolean } = {}): Promise<ContentReference> {
  const workspaceId = useWorkspaceStore.getState().activeWorkspaceId ?? '';
  if (isSqliteStorage()) await flushDesktopStorage();
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
  const identity = JSON.stringify({ version: 3, model: config.model, provider: config.providerId, endpoint: config.endpoint,
    context: context.map(({ role, content, images, reference }) => ({ role, content, images, reference })) });
  const snapshotKey = await referenceKey(identity);
  const quote = targets.map((selection, index) => selection.text || sources[index].documentText).join('\n\n');
  const reference: ContentReference = { id: nanoid(), snapshotKey, summary: '', quote, sources, createdAt: Date.now(),
    summaryInput: modelMessages(context).map(({ role, content, images }) => ({ role: role === 'system' ? 'user' : role, content, ...(images?.length ? { images } : {}) })) };
  return options.deferSummary ? reference : resolveReference(reference, { nodeId });
}

// 发送时使用剪切板内的背景快照生成摘要，可跨工作区使用，不回读来源的当前内容。
export async function resolveReference(reference: ContentReference, target?: UsageTarget): Promise<ContentReference> {
  if (!reference.summaryInput) return reference;
  const settings = useSettingsStore.getState();
  const sourceChars = reference.summaryInput.reduce((total, message) => total + message.content.length, 0);
  // 摘要优先精简，硬上限只用于决定是否重试压缩。
  const maxChars = REFERENCE_SUMMARY_MAX_CHARS;
  const prompt = renderSummaryPrompt(settings.builtinPrompts?.referenceSummary ?? DEFAULT_BUILTIN_PROMPTS.referenceSummary, sourceChars, maxChars);
  const config = resolveModelConfig(target?.nodeId);
  const key = await referenceKey(JSON.stringify({ snapshot: reference.snapshotKey, prompt, maxChars, model: config.model, provider: config.providerId, endpoint: config.endpoint }));
  const context: ChatMessage[] = reference.summaryInput.map((message, index) => ({ ...message, id: `snapshot-${index}`, timestamp: 0 }));
  const summary = await summarize(key, context, useWorkspaceStore.getState().activeWorkspaceId ?? '', prompt, maxChars, target);
  const { summaryInput, ...resolved } = reference; void summaryInput;
  return { ...resolved, snapshotKey: key, summary };
}

// 用户停止过分支初始化后，下次提问仍须补齐原引用的背景，不能只发送孤立的选中文字。
export async function resolvePendingReferences(nodeId: string, workspaceId: string | null): Promise<void> {
  const pending = useChatStore.getState().getMessages(nodeId).filter((message) => message.reference?.summaryInput);
  if (!pending.length) return;
  const resolved = await Promise.all(pending.map(async (message) => ({ id: message.id, reference: await resolveReference(message.reference!, { nodeId, documentId: message.id }) })));
  if (useWorkspaceStore.getState().activeWorkspaceId !== workspaceId || !useChatStore.getState().conversations[nodeId]) throw new Error('会话已切换或删除，请重新发送');
  const messages = useChatStore.getState().getMessages(nodeId).map((message) => {
    const match = pending.some((old) => old.id === message.id && old.reference === message.reference) ? resolved.find((item) => item.id === message.id) : undefined;
    return match ? { ...message, reference: match.reference, content: match.reference.summary } : message;
  });
  useChatStore.getState().setConversationMessages(nodeId, messages);
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
