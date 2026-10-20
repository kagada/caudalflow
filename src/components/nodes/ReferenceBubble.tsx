import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import type { ChatMessage, ReferenceSource } from '../../types/chat';
import { useChatStore } from '../../stores/chatStore';
import { useFlowStore } from '../../stores/flowStore';
import { useWorkspaceStore } from '../../stores/workspaceStore';
import { isSqliteStorage } from '../../services/storage/client';
import { openReferenceSourceWorkspace } from '../../services/storage/runtime';
import { locateReferenceMessage } from '../../services/referenceNavigation';
import { effectiveReferenceSources } from '../../utils/referenceHighlights';
import { UsageStatistics } from './UsageStatistics';

// 来源失效时打开独立原文快照，不切换当前文档版本，也不影响已有问答。
export function ReferenceBubble({ message }: { message: ChatMessage }) {
  const [snapshot, setSnapshot] = useState<ReferenceSource | null>(null);
  useEffect(() => {
    if (!snapshot) return;
    const close = (event: KeyboardEvent) => { if (event.key === 'Escape') { event.stopPropagation(); setSnapshot(null); } };
    document.addEventListener('keydown', close);
    return () => document.removeEventListener('keydown', close);
  }, [snapshot]);
  const reference = message.reference;
  if (!reference) return null;
  const sources = effectiveReferenceSources(reference);
  const locate = async (source: ReferenceSource) => {
    if (useWorkspaceStore.getState().activeWorkspaceId !== source.workspaceId) {
      if (!isSqliteStorage() || !await openReferenceSourceWorkspace(source)) { setSnapshot(source); return; }
    }
    const flow = useFlowStore.getState();
    const node = flow.nodes.find((item) => item.id === source.conversationId);
    const current = useChatStore.getState().getMessages(source.conversationId).find((item) => item.id === source.documentId);
    if (useWorkspaceStore.getState().activeWorkspaceId !== source.workspaceId || !node || !current ||
      current.content !== source.documentText || (source.versionId && current.versionId !== source.versionId)) { setSnapshot(source); return; }
    locateReferenceMessage(source.conversationId, source.documentId, source.start);
  };
  return <div data-message-id={message.id} data-reference className="px-6 py-2">
    <div className="rounded-xl border border-border bg-surface-800/70 px-4 py-3 text-sm text-text-secondary">
      <details><summary className="cursor-pointer truncate" title={reference.sources.map((source) => source.title).join('、')}>引用 · {reference.sources.map((source) => source.title).join('、')}</summary>
        <p className="mt-3 whitespace-pre-wrap break-words leading-6">{reference.summaryInput ? '摘要尚未生成，原文和背景快照已保存。' : reference.summary}</p>
        <blockquote className="mt-3 whitespace-pre-wrap break-words border-l-2 border-border-hover pl-3 leading-6">{reference.quote}</blockquote>
      </details>
      <UsageStatistics usage={message.usage} label="本引用累计" />
      <div className="mt-2 flex flex-wrap gap-3 text-xs text-text-muted">{sources.map((source, index) => <button key={index} className="max-w-full truncate hover:text-text-primary hover:underline" onClick={(event) => { event.stopPropagation(); void locate(source); }} title="定位原回答；原版本不可用时查看引用快照">来源：{source.title}{sources.length > 1 ? ` · ${index + 1}` : ''}</button>)}</div>
    </div>
    {snapshot && createPortal(<div role="dialog" aria-modal="true" aria-label="引用来源快照" className="fixed inset-0 z-[3000] flex items-center justify-center bg-black/50 p-6" onPointerDown={(event) => event.stopPropagation()}>
      <div className="flex max-h-[85vh] w-full max-w-4xl flex-col rounded-xl border border-border bg-surface-900 p-5 text-text-primary shadow-xl">
        <div className="mb-3 flex items-center justify-between gap-3"><h2 className="truncate font-semibold">引用来源 · {snapshot.title}</h2><button onClick={() => setSnapshot(null)}>关闭</button></div>
        <p className="mb-3 text-xs text-text-muted">这是复制引用时保存的原文。当前来源可能已修改、移除或位于其他工作区；此快照仍可独立阅读。</p>
        <pre className="overflow-auto whitespace-pre-wrap break-words rounded-lg bg-surface-800 p-4 text-sm leading-6">{snapshot.documentText.slice(0, snapshot.start)}<mark className="reference-highlight">{snapshot.documentText.slice(snapshot.start, snapshot.start + snapshot.length)}</mark>{snapshot.documentText.slice(snapshot.start + snapshot.length)}</pre>
        {!!snapshot.images?.length && <div className="mt-3 flex flex-wrap gap-3 overflow-auto">{snapshot.images.map((image, index) => <img key={index} alt={`来源图片 ${index + 1}`} src={`data:${image.mimeType};base64,${image.base64}`} className="max-h-60 max-w-full rounded-lg border border-border object-contain" />)}</div>}
      </div>
    </div>, document.body)}
  </div>;
}
