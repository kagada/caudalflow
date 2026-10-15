import { memo, useRef, useMemo, useState, useCallback } from 'react';
import { useShallow } from 'zustand/react/shallow';
import { useTranslation } from 'react-i18next';
import { GitBranch } from 'lucide-react';
import { useChatStore } from '../../stores/chatStore';
import { useFlowStore } from '../../stores/flowStore';
import { useSettingsStore } from '../../stores/settingsStore';
import { useAutoScroll } from '../../hooks/useAutoScroll';
import { useTextSelection } from '../../hooks/useTextSelection';
import { ChatMessage } from './ChatMessage';
import { SelectionPopup } from './SelectionPopup';
import { MessageContextMenu, type MenuTarget } from './MessageContextMenu';

interface ChatMessageListProps {
  nodeId: string;
  onExplore: (selectedText: string, prompt: string) => void;
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
    () => showSystemPrompts ? allMessages : allMessages.filter((m) => m.role !== 'system'),
    [allMessages, showSystemPrompts]
  );
  const exploredTexts = useFlowStore(useShallow(
    (s) => s.edges
        .filter((e) => e.source === nodeId && e.data?.label)
        .map((e) => e.data!.label)
  ));
  const containerRef = useRef<HTMLDivElement>(null);
  const scrollRef = useAutoScroll(messages);
  const { selection, handleMouseUp, clearSelection } = useTextSelection(containerRef);
  const [popupOpen, setPopupOpen] = useState(false);
  const [menu, setMenu] = useState<MenuTarget | null>(null);
  const closeMenu = useCallback(() => setMenu(null), []);

  const contextMenu = (event: React.MouseEvent) => {
    const selected = window.getSelection();
    const text = selected?.toString().trim();
    // 直接读取浏览器选区，不受悬浮分支按钮的状态或文字长度限制。
    if (text && selected?.rangeCount && selected.getRangeAt(0).intersectsNode(containerRef.current!)) {
      event.preventDefault(); event.stopPropagation(); setPopupOpen(false); clearSelection();
      setMenu({ kind: 'selection', text, x: event.clientX, y: event.clientY });
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
    dismiss();
    onExplore(selectedText, prompt);
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
              <ChatMessage key={msg.id} message={msg} exploredTexts={exploredTexts} isStreaming={isStreaming && msg.id === (streamingMessageId ?? allMessages.at(-1)?.id)} />
            ))}
          </div>
        )}
      </div>
      {menu && <MessageContextMenu target={menu} busy={isStreaming} close={closeMenu} explore={handleExplore} revise={(id, prompt) => onRevise?.(id, prompt)} remove={(id) => {
        const store = useChatStore.getState();
        store.setConversationMessages(nodeId, store.getMessages(nodeId).filter((message) => message.id !== id));
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
