import { createPortal } from 'react-dom';
import { memo, useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Handle, Position, NodeResizer, useUpdateNodeInternals } from '@xyflow/react';
import type { NodeProps } from '@xyflow/react';
import { Maximize2, Trash2, CircleCheck, Circle } from 'lucide-react';
import type { ChatNode } from '../../types/flow';
import { useChatStore } from '../../stores/chatStore';
import { useFlowStore } from '../../stores/flowStore';
import { useNodeCopilotChat } from '../../hooks/useNodeCopilotChat';
import { streamChat } from '../../services/llm';
import { calculateBranchPosition } from '../../utils/nodeLayout';
import { getBranchSystemPrompt } from '../../utils/systemPrompts';
import { ChatNodeHeader } from './ChatNodeHeader';
import { ChatMessageList } from './ChatMessageList';
import { ChatInput } from './ChatInput';
import { ChatNodeDeleteConfirmation } from './ChatNodeDeleteConfirmation';
import { FloatingNodePanel, type PanelPoint } from '../ui/FloatingNodePanel';

const PALETTE_COLORS = [
  '#22c55e',
  '#3b82f6',
  '#f59e0b',
  '#ef4444',
  '#a855f7',
  '#06b6d4',
];

export const ChatNodeComponent = memo(function ChatNodeComponent({ id, data, selected }: NodeProps<ChatNode>) {
  const { t } = useTranslation();
  const { topic, collapsed, minimized, maximized, done, parentNodeId, branchText, parentNodeIds, mergeAction, color, label } = data;
  const [showDeleteConfirmation, setShowDeleteConfirmation] = useState(false);
  const [panelPoint, setPanelPoint] = useState<PanelPoint | undefined>();
  const [isPanning, setIsPanning] = useState(false);
  const { sendMessage, cancelStream, reviseMessage } = useNodeCopilotChat(id, topic, parentNodeId, branchText, parentNodeIds as string[] | undefined, mergeAction as string | undefined);

  // Listen for space key and delete key
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement).tagName === 'INPUT' || (e.target as HTMLElement).tagName === 'TEXTAREA') {
        return;
      }
      if (e.code === 'Space' && !e.repeat) {
        setIsPanning(true);
      }
      // 删除仅绑定 Delete，X 不再触发重量级删除操作。
      if (e.code === 'Delete' && selected) {
        e.preventDefault();
        setPanelPoint(undefined);
        setShowDeleteConfirmation(true);
      }
    };
    const handleKeyUp = (e: KeyboardEvent) => {
      if (e.code === 'Space') {
        setIsPanning(false);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    window.addEventListener('keyup', handleKeyUp);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('keyup', handleKeyUp);
    };
  }, [selected]);
  const updateNodeInternals = useUpdateNodeInternals();
  // 等待紧凑卡片的 DOM 更新后重新测量，批量折叠、最小化和恢复都要同步连线。
  useEffect(() => {
    let second = 0;
    const first = requestAnimationFrame(() => { second = requestAnimationFrame(() => updateNodeInternals(id)); });
    return () => { cancelAnimationFrame(first); cancelAnimationFrame(second); };
  }, [id, collapsed, minimized, maximized, updateNodeInternals]);
  const preview = useChatStore((s) => s.conversations[id]?.messages.filter((message) => message.role !== 'system').at(-1)?.content ?? '');
  const messageCount = useChatStore(
    (s) =>
      s.conversations[id]?.messages.filter((m) => m.role !== "system").length ??
      0,
  );
  const [isPaletteOpen, setIsPaletteOpen] = useState(false);
  const popoverRef = useRef<HTMLDivElement | null>(null);
  const labelRef = useRef(label);
  useEffect(() => { labelRef.current = label; }, [label]);

  const updateLabel = useCallback((newLabel?: string) => {
    useFlowStore.getState().updateNodeData(id, {
      label: newLabel,
    });
  }, [id]);

  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (!popoverRef.current) return;

      if (!popoverRef.current.contains(event.target as Node)) {
        const trimmed = labelRef.current?.trim() || undefined;
        useFlowStore.getState().updateNodeData(id, { label: trimmed });
        setIsPaletteOpen(false);
      }
    }

    const handleKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setIsPaletteOpen(false);
      }
    };

    if (isPaletteOpen) {
      document.addEventListener("mousedown", handleClickOutside);
      window.addEventListener("keydown", handleKey);
    }

    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
      window.removeEventListener("keydown", handleKey);
    };
  }, [isPaletteOpen, id]);

  useEffect(() => {
    useChatStore.getState().initConversation(id);
  }, [id]);

  const handleToggleCollapse = useCallback(() => {
    const flowStore = useFlowStore.getState();
    flowStore.updateNodeData(id, { collapsed: !collapsed, maximized: false });
    
    // Force React Flow to re-measure after DOM update
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        updateNodeInternals(id);
      });
    });
  }, [id, collapsed, updateNodeInternals]);

  const handleMinimize = useCallback(() => {
    const flowStore = useFlowStore.getState();
    const node = flowStore.nodes.find((n) => n.id === id);
    if (!node) return;
    const prevWidth = (node.style?.width as number) ?? 400;
    const prevHeight = (node.style?.height as number) ?? 500;
    flowStore.setNodes(
      flowStore.nodes.map((n) =>
        n.id === id
          ? {
              ...n,
              data: {
                ...n.data,
                minimized: true,
                maximized: false,
                _prevWidth: prevWidth,
                _prevHeight: prevHeight,
              },
              style: { ...n.style, width: "auto", height: "auto" },
            }
          : n,
      ),
    );
  }, [id]);

  const handleRestore = useCallback(() => {
    const flowStore = useFlowStore.getState();
    const node = flowStore.nodes.find((n) => n.id === id);
    if (!node) return;
    const w = (node.data._prevWidth as number) ?? 400;
    const h = (node.data._prevHeight as number) ?? 500;
    flowStore.setNodes(
      flowStore.nodes.map((n) =>
        n.id === id
          ? {
              ...n,
              data: { ...n.data, minimized: false, collapsed: false, maximized: false },
              style: { ...n.style, width: w, height: h },
              // 小卡片展开为中卡片只恢复尺寸，左上角保留当前排版位置。
              position: n.position,
            }
          : n,
      ),
    );
  }, [id]);

  // 最大化是独立阅读视图，不改变节点尺寸、位置或画布缩放。
  const handleMaximize = useCallback(() => {
    useFlowStore.getState().updateNodeData(id, { maximized: !maximized });
  }, [id, maximized]);

  useEffect(() => {
    if (!maximized) return;
    const exit = (event: KeyboardEvent) => { if (event.key === 'Escape') useFlowStore.getState().updateNodeData(id, { maximized: false }); };
    window.addEventListener('keydown', exit);
    return () => window.removeEventListener('keydown', exit);
  }, [id, maximized]);

  const handleDelete = useCallback((point?: PanelPoint) => {
    setPanelPoint(point);
    setShowDeleteConfirmation(true);
  }, []);

  const handleCancelDelete = useCallback(() => {
    setShowDeleteConfirmation(false);
  }, []);

  const handleConfirmDelete = useCallback(() => {
    useFlowStore.getState().removeNode(id);
    useChatStore.getState().removeConversation(id);
  }, [id]);

  const handleExplore = useCallback(
    (selectedText: string, prompt: string) => {
      const flowStore = useFlowStore.getState();
      let parentNode = flowStore.nodes.find((n) => n.id === id);
      if (!parentNode) return;

      // 从大卡片返回画布仅退出独立视图，不能恢复旧坐标或改动中卡片尺寸。
      if (parentNode.data.maximized) {
        flowStore.updateNodeData(id, { maximized: false });
        parentNode = useFlowStore.getState().nodes.find((n) => n.id === id)!;
      }

      const childCount = flowStore.getChildCount(id);
      const position = calculateBranchPosition(parentNode, childCount);

      const newNodeId = flowStore.addChatNode(position, {
        topic: selectedText,
        parentNodeId: id,
        branchText: selectedText,
        collapsed: false,
      });

      flowStore.addEdge(id, newNodeId, selectedText);

      // Initialize conversation with branch context
      const chatStore = useChatStore.getState();
      chatStore.initConversation(newNodeId);

      const parentMessages = chatStore
        .getMessages(id)
        .map((m) => ({ role: m.role, content: m.content }));

      const systemPrompt = getBranchSystemPrompt(topic, parentMessages);
      chatStore.addMessage(newNodeId, "system", systemPrompt);

      // First user message: popup input + highlighted text
      const firstMessage = prompt
        ? `${prompt}\n\n> "${selectedText}"`
        : selectedText;

      // Auto-send first message
      setTimeout(() => {
        const store = useChatStore.getState();
        const messages = store.getMessages(newNodeId);

        store.addMessage(newNodeId, "user", firstMessage);
        store.addMessage(newNodeId, "assistant", "");
        store.setStreaming(newNodeId, true);

        const controller = new AbortController();

        streamChat(
          [
            ...messages,
            {
              id: "q",
              role: "user" as const,
              content: firstMessage,
              timestamp: Date.now(),
            },
          ],
          {
            onToken: (token: string) => {
              useChatStore.getState().appendToLastMessage(newNodeId, token);
            },
            onReasoning: (token: string) => {
              useChatStore.getState().appendReasoningToLastMessage(newNodeId, token);
            },
            onDone: () => {
              useChatStore.getState().setStreaming(newNodeId, false);
            },
            onError: (error: Error) => {
              useChatStore
                .getState()
                .appendToLastMessage(
                  newNodeId,
                  `\n\n**Error:** ${error.message}`,
                );
              useChatStore.getState().setStreaming(newNodeId, false);
            },
          },
          controller.signal,
        );
      }, 100);
    },
    [id, topic],
  );

  const updateColor = (newColor?: string) => {
    useFlowStore.getState().updateNodeData(id, { color: newColor });
  };

  // 标记只更新会话状态，保留正文、连线和当前位置。
  const handleToggleDone = useCallback(() => {
    const flowStore = useFlowStore.getState();
    const node = flowStore.nodes.find((item) => item.id === id);
    if (node) flowStore.updateNodeData(id, { done: !node.data.done });
  }, [id]);

  if (minimized || collapsed) {
    return (
      <div className={`relative h-full w-full rounded-xl border bg-surface-900 shadow-lg ${selected ? 'border-accent-500' : 'border-border'}`}
        onPointerDownCapture={() => useFlowStore.getState().activateNode(id)}
        onFocusCapture={() => useFlowStore.getState().activateNode(id)}
        onDoubleClick={minimized ? handleRestore : handleToggleCollapse}>
        <Handle type="target" position={Position.Left} id="left" className="!bg-accent-500 !border-none !w-2.5 !h-2.5" />
        <Handle type="source" position={Position.Right} id="right" className="!bg-accent-400 !border-none !w-2.5 !h-2.5" />
        <div className="flex items-start gap-2 px-4 pt-3">
          {color && <span className="mt-1.5 h-2.5 w-2.5 shrink-0 rounded-full" style={{ backgroundColor: color }} />}
          <div className="min-w-0 flex-1 font-semibold text-[15px] leading-5 line-clamp-2" title={topic}>{topic}</div>
          <button onClick={minimized ? handleRestore : handleToggleCollapse} title={t('node.expand')} className="nodrag p-1 text-text-secondary"><Maximize2 size={15} /></button>
          <button onClick={(event) => handleDelete(event.detail ? { x: event.clientX, y: event.clientY } : undefined)} title={t('node.deleteConversation')} className="nodrag p-1 text-text-muted hover:text-red-400"><Trash2 size={15} /></button>
        </div>
        <div className="px-4 pt-2 text-[13px] leading-5 text-text-secondary line-clamp-2">{preview.replace(/[#*`>]/g, '') || t('chat.askQuestionToStart')}</div>
        <div className="absolute bottom-3 left-4 right-4 flex items-center justify-between gap-2 text-xs text-text-muted">
          <div className="flex min-w-0 items-center gap-1.5">
            <button data-conversation-done={done ? '' : undefined} aria-pressed={!!done} aria-label={t(done ? 'node.markNotDone' : 'node.markDone')} title={t(done ? 'node.markNotDone' : 'node.markDone')}
              className={`nodrag nopan inline-flex shrink-0 items-center gap-1 rounded-full px-1.5 py-0.5 focus-visible:outline-2 focus-visible:outline-accent-500 ${done ? 'bg-emerald-500/10 text-status-done' : 'hover:bg-surface-800 hover:text-text-primary'}`}
              onClick={(event) => { event.stopPropagation(); handleToggleDone(); }} onDoubleClick={(event) => event.stopPropagation()}>
              {done ? <CircleCheck size={14} /> : <Circle size={14} />}{done && t('node.done')}
            </button>
            <span className="truncate">{label || (!done && t('node.collapse'))}</span>
          </div>
          <span className="shrink-0">{messageCount} {t('menu.messages')}</span>
        </div>
        {showDeleteConfirmation && <ChatNodeDeleteConfirmation topic={topic} point={panelPoint} onConfirm={handleConfirmDelete} onCancel={handleCancelDelete} />}
      </div>
    );
  }

  // Expanded view - full card
  const card = (
    <div
      // 中卡片中的中键交给内容区，不能继续冒泡到画布平移处理。
      onMouseDownCapture={(event) => { if (event.button === 1) event.stopPropagation(); }}
      onPointerDownCapture={() => useFlowStore.getState().activateNode(id)}
      onFocusCapture={() => useFlowStore.getState().activateNode(id)}
      className={`relative flex flex-col bg-surface-900 border rounded-xl shadow-xl shadow-black/30 h-full ${
        selected
          ? 'border-accent-500/60'
          : 'border-border'
      } transition-colors`}
    >
      {!maximized && <NodeResizer
        minWidth={320}
        minHeight={300}
        isVisible={selected}
        lineClassName="!border-accent-500/30"
        handleClassName="!bg-accent-500 !border-none !w-2 !h-2 !rounded-sm"
      />}
      {!maximized && <Handle
        type="target"
        position={Position.Left}
        className="!bg-accent-500 !border-none !w-2.5 !h-2.5"
        id="left"
      />}
      {!maximized && <Handle
        type="source"
        position={Position.Right}
        className="!bg-accent-400 !border-none !w-2.5 !h-2.5"
        id="right"
      />}

      <ChatNodeHeader
        topic={topic}
        maximized={!!maximized}
        done={!!done}
        onToggleDone={handleToggleDone}
        isPanning={isPanning}
        onMinimize={handleMinimize}
        onMaximize={handleMaximize}
        onDelete={handleDelete}
        onTogglePalette={(point) => { setPanelPoint(point); setIsPaletteOpen((p) => !p); }}
        color={color}
        label={label}
      />
      {showDeleteConfirmation && (
        <ChatNodeDeleteConfirmation
          topic={topic}
          point={panelPoint}
          onConfirm={handleConfirmDelete}
          onCancel={handleCancelDelete}
        />
      )}

      {isPaletteOpen && (
        <FloatingNodePanel point={panelPoint} close={() => { updateLabel(labelRef.current?.trim() || undefined); setIsPaletteOpen(false); }}>
        <div
          ref={popoverRef}
          role="dialog" aria-modal="true" aria-label={t('node.addLabelAndColor')}
          onMouseDown={(e) => e.stopPropagation()}
          className="w-full bg-surface-900 border border-border rounded-xl p-5 shadow-2xl"
        >
          <div className="mb-4 flex items-center justify-between"><h2 className="text-lg font-semibold">{t('node.addLabelAndColor')}</h2><button className="text-sm text-text-muted hover:text-text-primary" onClick={() => setIsPaletteOpen(false)}>{t('common.close')}</button></div>
          <div className="flex flex-wrap gap-2 mb-2">
            {PALETTE_COLORS.map((c) => (
              <button
                key={c}
                onClick={() => updateColor(color === c ? undefined : c)}
                aria-label={c}
                className={`w-7 h-7 rounded-full border-2 ${
                  color === c ? "border-white" : "border-transparent"
                }`}
                style={{ backgroundColor: c }}
              />
            ))}
          </div>

          <input
            autoFocus
            value={label ?? ""}
            onChange={(e) => updateLabel(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                updateLabel(label?.trim() || undefined);
                setIsPaletteOpen(false);
              }
            }}
            placeholder={t('node.addLabel')}
            maxLength={20}
            aria-label={t('node.addLabel')}
            className="w-full text-base bg-surface-800 border border-border px-3 py-2 rounded-lg outline-none"
          />

          <button
            onClick={() => {
              updateColor(undefined);
              updateLabel(undefined);
            }}
            className="text-sm text-red-400 mt-4 rounded-lg px-3 py-2 hover:bg-surface-800"
          >
            {t('node.clear')}
          </button>
        </div>
        </FloatingNodePanel>
      )}

      <ChatMessageList nodeId={id} onExplore={handleExplore} onRevise={reviseMessage} />
      <ChatInput nodeId={id} onSend={sendMessage} onCancel={cancelStream} />
    </div>
  );
  return maximized ? createPortal(<div data-maximized-conversation className="fixed inset-0 z-[1000] bg-surface-900 p-0">{card}</div>, document.body) : card;
});
