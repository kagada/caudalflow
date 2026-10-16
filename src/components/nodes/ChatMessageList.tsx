import { memo, useRef, useMemo, useState, useCallback } from 'react';
import { useShallow } from 'zustand/react/shallow';
import { useTranslation } from 'react-i18next';
import { GitBranch } from 'lucide-react';
import { useChatStore } from '../../stores/chatStore';
import { useFlowStore } from '../../stores/flowStore';
import { useWorkspaceStore } from '../../stores/workspaceStore';
import { useSettingsStore } from '../../stores/settingsStore';
import { useAutoScroll } from '../../hooks/useAutoScroll';
import { useTextSelection, selectionDocuments } from '../../hooks/useTextSelection';
import type { ReferenceSelection } from '../../types/chat';
import { createReference } from '../../services/references';
import { copyReference } from '../../services/referenceClipboard';
import { ChatMessage } from './ChatMessage';
import { SelectionPopup } from './SelectionPopup';
import { MessageContextMenu, type MenuTarget } from './MessageContextMenu';
import { DocumentVersions } from './DocumentVersions';
import { isDesktopStorage } from '../../services/storage/desktop';
import { effectiveReferenceSources } from '../../utils/referenceHighlights';

interface ChatMessageListProps {
  nodeId: string;
  onExplore: (selectedText: string, prompt: string, sources?: ReferenceSelection[]) => void;
  onRevise?: (messageId: string, prompt?: string) => void;
}

// 选中边框由卡片负责；正文只在消息或分支高亮文字变化时更新。
export const ChatMessageList = memo(function ChatMessageList({ nodeId, onExplore, onRevise }: ChatMessageListProps) {
  const { t } = useTranslation();
  const allMessages = useChatStore((s) => s.conversations[nodeId]?.messages ?? []);
  const isStreaming = useChatStore((s) => s.conversations[nodeId]?.isStreaming ?? false);
  const streamingMessageId = useChatStore((s) => s.conversations[nodeId]?.streamingMessageId);
  const showSystemPrompts = useSettingsStore((s) => s.showSystemPrompts);
  const messages = useMemo(
    () => showSystemPrompts ? allMessages : allMessages.filter((m) => m.role !== 'system' || m.kind === 'reference'),
    [allMessages, showSystemPrompts]
  );
  const workspaceId = useWorkspaceStore((s) => s.activeWorkspaceId);
  // 分支和粘贴引用共享来源记录，连线只为旧版数据提供文字匹配兼容。
  const referencingMessages = useChatStore(useShallow((s) => Object.values(s.conversations).flatMap((conversation) =>
    conversation.messages.filter((message) => message.kind === 'reference' && message.reference?.sources.some((source) =>
      source.conversationId === nodeId && source.workspaceId === (workspaceId ?? ''))))));
  const referenceSources = useMemo(() => referencingMessages.flatMap((message) => effectiveReferenceSources(message.reference!).filter((source) =>
    source.conversationId === nodeId && source.workspaceId === (workspaceId ?? ''))), [referencingMessages, nodeId, workspaceId]);
  const legacyLabels = useFlowStore(useShallow(
    (s) => s.edges
        .filter((e) => e.source === nodeId && e.data?.label)
        .map((e) => e.target + '\0' + e.data!.label)
  ));
  const exploredTexts = useMemo(() => legacyLabels.filter((entry) => {
    const target = entry.slice(0, entry.indexOf('\0'));
    return !useChatStore.getState().conversations[target]?.messages.some((message) => referencingMessages.includes(message));
  }).map((entry) => entry.slice(entry.indexOf('\0') + 1)), [legacyLabels, referencingMessages]);
  const containerRef = useRef<HTMLDivElement>(null);
  const scrollRef = useAutoScroll(messages);
  const { selection, handleMouseUp, clearSelection } = useTextSelection(containerRef);
  const [popupOpen, setPopupOpen] = useState(false);
  const [menu, setMenu] = useState<MenuTarget | null>(null);
  const [versionDocument, setVersionDocument] = useState<string | null>(null);
  const closeMenu = useCallback(() => setMenu(null), []);

  const contextMenu = (event: React.MouseEvent) => {
    const selected = window.getSelection();
    const text = selected?.toString().trim();
    // 直接读取浏览器选区，不受悬浮分支按钮的状态或文字长度限制。
    if (text && selected?.rangeCount && selected.getRangeAt(0).intersectsNode(containerRef.current!)) {
      event.preventDefault(); event.stopPropagation(); setPopupOpen(false); clearSelection();
      setMenu({ kind: 'selection', text, sources: selectionDocuments(containerRef.current!, selected.getRangeAt(0)), x: event.clientX, y: event.clientY });
      return;
    }
    const id = (event.target as HTMLElement).closest('[data-message-id]')?.getAttribute('data-message-id');
    const message = allMessages.find((item) => item.id === id);
    if (message) { event.preventDefault(); event.stopPropagation(); setMenu({ kind: 'message', message, x: event.clientX, y: event.clientY }); }
  };

  const dismiss = useCallback(() => {
    setPopupOpen(false);
    clearSelection();
    window.getSelection()?.removeAllRanges();
  }, [clearSelection]);

  const handleExplore = (selectedText: string, prompt: string) => {
    const sources = menu?.kind === 'selection' ? menu.sources : selection?.sources;
    dismiss();
    onExplore(selectedText, prompt, sources);
  };

  // When a new selection is made, reset to the small button
  const onMouseUp = useCallback(() => {
    setPopupOpen(false);
    handleMouseUp();
  }, [handleMouseUp]);

  return (
    <div className="relative flex-1 min-h-0" ref={containerRef} onContextMenu={contextMenu}>
      <div
        ref={scrollRef}
        className="nowheel nodrag nopan h-full overflow-y-auto select-text"
        onMouseUp={onMouseUp}
      >
        {messages.length === 0 ? (
          <div className="flex items-center justify-center h-full text-text-muted text-sm px-4 text-center">
            {t('chat.askQuestionToStart')}
          </div>
        ) : (
          <div className="py-3 space-y-2">
            {messages.map((msg) => (
              <ChatMessage key={msg.id} message={msg} exploredTexts={exploredTexts} referenceSources={referenceSources} isStreaming={isStreaming && msg.id === (streamingMessageId ?? allMessages.at(-1)?.id)} />
            ))}
          </div>
        )}
      </div>
      {versionDocument && <DocumentVersions nodeId={nodeId} documentId={versionDocument} close={() => setVersionDocument(null)} />}
      {menu && <MessageContextMenu target={menu} busy={isStreaming} close={closeMenu} explore={handleExplore} versions={isDesktopStorage() ? setVersionDocument : undefined} copyReference={async () => {
        if (menu.kind === 'message' && menu.message.reference) await copyReference(menu.message.reference);
        else await copyReference(await createReference(nodeId, menu.kind === 'selection' ? menu.sources : [{ documentId: menu.message.id, text: menu.message.content }], { deferSummary: true }));
      }} revise={(id, prompt) => onRevise?.(id, prompt)} remove={(id) => {
        const store = useChatStore.getState();
        store.setConversationMessages(nodeId, store.getMessages(nodeId).filter((message) => message.id !== id && message.referenceForId !== id));
      }} />}
      {selection && !popupOpen && (
        <div
          data-selection-popup
          className="nodrag nopan nowheel absolute z-50"
          style={{
            left: selection.x,
            top: selection.y,
            transform: 'translate(-50%, -100%)',
          }}
          onPointerDown={(e) => e.stopPropagation()}
        >
          <button
            onClick={(e) => {
              e.stopPropagation();
              setPopupOpen(true);
            }}
            className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg border border-accent-500/60 bg-accent-600 shadow-lg shadow-black/50 text-white hover:bg-accent-500 transition-colors"
            title={t('selection.branchFromSelection')}
          >
            <GitBranch size={14} />
            <span className="text-xs font-semibold">{t('selection.branch')}</span>
          </button>
        </div>
      )}
      {selection && popupOpen && (
        <SelectionPopup
          text={selection.text}
          x={selection.x}
          y={selection.y}
          onExplore={handleExplore}
          onDismiss={dismiss}
        />
      )}
    </div>
  );
});
