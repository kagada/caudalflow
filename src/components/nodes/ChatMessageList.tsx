import { memo, useRef, useMemo, useState, useCallback } from 'react';
import { useShallow } from 'zustand/react/shallow';
import { useTranslation } from 'react-i18next';
import { GitBranch } from 'lucide-react';
import { useChatStore } from '../../stores/chatStore';
import { useWorkspaceStore } from '../../stores/workspaceStore';
import { useSettingsStore } from '../../stores/settingsStore';
import { useAutoScroll } from '../../hooks/useAutoScroll';
import { useTextSelection, selectionDocuments } from '../../hooks/useTextSelection';
import { useSelectionMenuAnchor } from '../../hooks/useSelectionMenuAnchor';
import type { ReferenceSelection } from '../../types/chat';
import { createReference } from '../../services/references';
import { copyReference } from '../../services/referenceClipboard';
import { ChatMessage } from './ChatMessage';
import { WebSearchDebug } from './WebSearchDebug';
import { SelectionPopup } from './SelectionPopup';
import { MessageContextMenu, type MenuTarget } from './MessageContextMenu';
import { DocumentVersions } from './DocumentVersions';
import { UsageStatistics } from './UsageStatistics';
import { isSqliteStorage } from '../../services/storage/client';
import { isAndroid } from '../../services/platform';
import { buildBacklinks, selectBacklinkInputs } from '../../utils/referenceBacklinks';

interface ChatMessageListProps {
  nodeId: string;
  onExplore: (selectedText: string, prompt: string, sources?: ReferenceSelection[]) => void;
  onRevise?: (messageId: string, prompt?: string) => void;
}

// 选中边框由卡片负责；正文只在消息或引用关系变化时更新。
export const ChatMessageList = memo(function ChatMessageList({ nodeId, onExplore, onRevise }: ChatMessageListProps) {
  const { t } = useTranslation();
  const allMessages = useChatStore((s) => s.conversations[nodeId]?.messages ?? []);
  const isStreaming = useChatStore((s) => s.conversations[nodeId]?.isStreaming ?? false);
  const streamingMessageId = useChatStore((s) => s.conversations[nodeId]?.streamingMessageId);
  const usage = useChatStore((s) => s.conversations[nodeId]?.usage);
  const showSystemPrompts = useSettingsStore((s) => s.showSystemPrompts);
  const messages = useMemo(
    () => showSystemPrompts ? allMessages : allMessages.filter((m) => m.role !== 'system' || m.kind === 'reference'),
    [allMessages, showSystemPrompts]
  );
  const workspaceId = useWorkspaceStore((s) => s.activeWorkspaceId);
  const backlinkInputs = useChatStore(useShallow((s) => selectBacklinkInputs(s.conversations, workspaceId ?? '', nodeId)));
  const backlinks = useMemo(() => buildBacklinks(backlinkInputs, workspaceId ?? '', nodeId), [backlinkInputs, workspaceId, nodeId]);
  const containerRef = useRef<HTMLDivElement>(null);
  const scrollRef = useAutoScroll(messages);
  const { selection, handleMouseUp, clearSelection } = useTextSelection(containerRef);
  const [popupOpen, setPopupOpen] = useState(false);
  const [menu, setMenu] = useState<MenuTarget | null>(null);
  const [versionDocument, setVersionDocument] = useState<string | null>(null);
  const closeMenu = useCallback(() => setMenu(null), []);
  const selectionMenuAnchor = useSelectionMenuAnchor(containerRef, closeMenu);

  const contextMenu = (event: React.MouseEvent) => {
    const selected = window.getSelection();
    const text = selected?.toString().trim();
    // 直接读取浏览器选区，不受悬浮分支按钮的状态或文字长度限制。
    if (text && selected?.rangeCount && selected.getRangeAt(0).intersectsNode(containerRef.current!)) {
      event.preventDefault(); event.stopPropagation(); setPopupOpen(false); clearSelection();
      const range = selected.getRangeAt(0);
      // 两个端点必须在同一条消息中，不能按右键位置猜测跨回答选区的操作对象。
      const start = (range.startContainer instanceof Element ? range.startContainer : range.startContainer.parentElement)?.closest('[data-message-id]');
      const end = (range.endContainer instanceof Element ? range.endContainer : range.endContainer.parentElement)?.closest('[data-message-id]');
      const message = start && start === end && containerRef.current!.contains(start)
        ? allMessages.find((item) => item.id === start.getAttribute('data-message-id')) : undefined;
      const anchor = selectionMenuAnchor(selected);
      setMenu({ kind: 'selection', text, message, sources: selectionDocuments(containerRef.current!, range),
        x: anchor?.x ?? event.clientX, y: anchor?.y ?? event.clientY });
      return;
    }
    // 空白处没有选区时也不弹消息菜单，保持安卓“仅正文响应长按”的范围。
    if (isAndroid() && !(event.target as HTMLElement).closest('.select-text')) {
      event.preventDefault(); event.stopPropagation(); return;
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
    const sources = menu ? menu.kind === 'selection' ? menu.sources : [{ documentId: menu.message.id, text: menu.message.content }] : selection?.sources;
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
        // 安卓只从正文启动选字，避免长按整行空白时吸附到远处文字；桌面保留现有操作。
        className={`nowheel nodrag nopan h-full overflow-y-auto ${isAndroid() ? 'select-none' : 'select-text'}`}
        onMouseUp={onMouseUp}
      >
        <WebSearchDebug nodeId={nodeId} />
        {!!usage?.length && <div className="px-6"><UsageStatistics usage={usage} label="本会话累计" /></div>}
        {messages.length === 0 ? (
          <div className="flex items-center justify-center h-full text-text-muted text-sm px-4 text-center">
            {t('chat.askQuestionToStart')}
          </div>
        ) : (
          <div className="py-3 space-y-2">
            {messages.map((msg) => (
              <ChatMessage key={msg.id} message={msg} backlinks={backlinks} isStreaming={isStreaming && msg.id === (streamingMessageId ?? allMessages.at(-1)?.id)} />
            ))}
          </div>
        )}
      </div>
      {versionDocument && <DocumentVersions nodeId={nodeId} documentId={versionDocument} close={() => setVersionDocument(null)} />}
      {menu && <MessageContextMenu target={menu} busy={isStreaming} close={closeMenu} explore={handleExplore} versions={isSqliteStorage() ? setVersionDocument : undefined} copyReference={async () => {
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
