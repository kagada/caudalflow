import { ConversationModelPicker } from './ConversationModelPicker';
import { useState, useCallback, useRef } from 'react';
import { createPortal } from 'react-dom';
import { useTranslation } from 'react-i18next';
import { ArrowUp, Square, Plus, X } from 'lucide-react';
import { useChatStore } from '../../stores/chatStore';
import type { ContentReference } from '../../types/chat';
import { readReferenceClipboard } from '../../services/referenceClipboard';
import { ModelConfigurationError, resolveModelConfig } from '../../services/modelConfig';
import { openModelSettings } from '../../services/modelSettings';
import { useCancelLayer } from '../../hooks/useCancelLayer';

interface ChatInputProps {
  nodeId: string;
  onSend: (message: string, images: File[], references?: ContentReference[]) => void | Promise<void>;
  onCancel: () => void;
  supportsVision?: boolean;
}

export function ChatInput({
  nodeId,
  onSend,
  onCancel,
  supportsVision = true,
}: ChatInputProps) {
  const { t } = useTranslation();
  const [input, setInput] = useState('');
  const [images, setImages] = useState<File[]>([]);
  const [isDragging, setIsDragging] = useState(false);
  const [references, setReferences] = useState<ContentReference[]>([]);
  const [error, setError] = useState('');
  const [sending, setSending] = useState(false);
  const [showModelDialog, setShowModelDialog] = useState(false);
  useCancelLayer(showModelDialog, () => setShowModelDialog(false), 13000);

  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const isStreaming = useChatStore(
    (s) => s.conversations[nodeId]?.isStreaming ?? false
  );

  const handleSend = useCallback(async () => {
    const trimmed = input.trim();
    if ((!trimmed && images.length === 0 && references.length === 0) || isStreaming || sending) return;

    setSending(true); setError('');
    // 发送前检查配置，未设置模型时保留草稿并提供配置入口，不把配置错误塞进编辑框。
    try { resolveModelConfig(nodeId); await onSend(trimmed, images, references); setInput(''); setImages([]); setReferences([]); }
    catch (failure) {
      if (failure instanceof ModelConfigurationError) setShowModelDialog(true);
      else setError(String(failure));
    }
    finally { setSending(false); }
  }, [input, images, references, isStreaming, sending, onSend, nodeId]);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      void handleSend();
    }
  };

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (!e.target.files) return;

    const files = Array.from(e.target.files).filter((f) =>
      f.type.startsWith('image/')
    );

    setImages((prev) => [...prev, ...files]);
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
    if (sending) return;

    const files = Array.from(e.dataTransfer.files).filter((f) =>
      f.type.startsWith('image/')
    );

    setImages((prev) => [...prev, ...files]);
  };

  const handlePaste = (e: React.ClipboardEvent) => {
    if (sending) { e.preventDefault(); return; }
    try {
      const reference = readReferenceClipboard(e.clipboardData.getData('text/html'));
      if (reference) { e.preventDefault(); setReferences((old) => [...old, reference]); setError(''); return; }
    } catch (failure) { setError(String(failure)); }
    const items = e.clipboardData.items;

    for (const item of items) {
      if (item.type.startsWith('image/')) {
        const file = item.getAsFile();
        if (file) {
          setImages((prev) => [...prev, file]);
        }
      }
    }
  };

  const removeImage = (index: number) => {
    setImages((prev) => prev.filter((_, i) => i !== index));
  };

  return (
    <div
      data-chat-input={nodeId}
      className={`nowheel nodrag nopan m-3 rounded-3xl border border-border bg-surface-800 p-3 shadow-sm transition ${
        isDragging ? 'bg-surface-700' : ''
      }`}
      onDragOver={(e) => {
        e.preventDefault();
        setIsDragging(true);
      }}
      onDragLeave={() => setIsDragging(false)}
      onDrop={handleDrop}
    >
      {showModelDialog && createPortal(<div className="nowheel nodrag nopan fixed inset-0 z-[13000] flex items-center justify-center bg-black/45 p-5">
        <div role="alertdialog" aria-modal="true" aria-labelledby={`model-required-${nodeId}`} className="w-full max-w-sm rounded-2xl border border-border bg-surface-900 p-5 text-text-primary shadow-2xl">
          <h2 id={`model-required-${nodeId}`} className="font-semibold">未设置模型</h2>
          <p className="mt-3 text-sm text-text-secondary">请先在模型管理中配置并启用模型。</p>
          <div className="mt-5 flex justify-end gap-2">
            <button className="rounded-lg border border-border px-4 py-2 text-sm hover:bg-surface-800" onClick={() => setShowModelDialog(false)}>取消</button>
            <button autoFocus className="rounded-lg bg-accent-500 px-4 py-2 text-sm text-white hover:bg-accent-600" onClick={() => { setShowModelDialog(false); void openModelSettings(); }}>去配置</button>
          </div>
        </div>
      </div>, document.body)}
      {references.length > 0 && <div aria-label="待发送引用" className="mb-2 space-y-2">{references.map((reference, index) => <div key={`${reference.id}-${index}`} className="flex items-start gap-2 rounded-lg border border-border bg-surface-800 p-2 text-xs text-text-secondary">
        <details className="min-w-0 flex-1"><summary className="cursor-pointer truncate">引用 · {reference.sources.map((source) => source.title).join('、')}</summary><p className="mt-2 whitespace-pre-wrap break-words">{reference.summaryInput ? '已保存原文和背景快照，发送时生成摘要。' : reference.summary}</p><blockquote className="mt-2 whitespace-pre-wrap border-l-2 border-border pl-2">{reference.quote}</blockquote></details>
        <button disabled={sending} aria-label={`移除引用 ${index + 1}`} onClick={() => setReferences((old) => old.filter((_, item) => item !== index))}><X size={14} /></button>
      </div>)}</div>}
      {error && <p role="alert" className="mb-2 text-xs text-red-400">{error}</p>}
      {sending && <p role="status" className="mb-2 text-xs text-text-muted">正在准备引用和问题…</p>}
      {images.length > 0 && (
        <div className="flex gap-2 mb-2 flex-wrap">
          {images.map((file, i) => (
            <div
              key={i}
              className="relative w-16 h-16 rounded-md overflow-hidden border border-border-hover"
            >
              <img
                src={URL.createObjectURL(file)}
                className="w-full h-full object-cover"
              />
              <button
                disabled={sending}
                onClick={() => removeImage(i)}
                className="absolute top-1 right-1 bg-black/60 rounded-full p-0.5"
              >
                <X size={12} />
              </button>
            </div>
          ))}
        </div>
      )}

      <div className="flex flex-wrap items-center gap-2">
        

        <textarea
          disabled={sending}
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={handleKeyDown}
          onPaste={handlePaste}
          placeholder={t('chat.askSomething')}
          rows={1}
          className="nowheel w-full resize-none bg-transparent text-base text-text-primary px-2 py-2 placeholder-text-muted focus:outline-none"
          style={{ minHeight: '36px', maxHeight: '160px' }}
          onInput={(e) => {
            const target = e.target as HTMLTextAreaElement;
            target.style.height = 'auto';
            target.style.height =
              Math.min(target.scrollHeight, 160) + 'px';
          }}
        />

        <input
          ref={fileInputRef}
          type="file"
          accept="image/*"
          multiple
          hidden
          onChange={handleFileSelect}
        />

        <button
          onClick={() => fileInputRef.current?.click()}
          disabled={!supportsVision || sending}
          className="shrink-0 p-2 rounded-lg bg-surface-800 text-text-secondary hover:bg-surface-700 transition disabled:opacity-30"
          title={
            supportsVision
              ? t('chat.attachImage')
              : t('chat.imagesNotSupported')
          }
        >
          <Plus size={18} />
        </button>

        <div className="min-w-0 flex-1 flex justify-end"><ConversationModelPicker nodeId={nodeId} disabled={isStreaming || sending} /></div>
        {isStreaming ? (
          <button
            onClick={onCancel}
            className="shrink-0 p-2 rounded-lg bg-red-500/20 text-red-400 hover:bg-red-500/30 transition-colors"
          >
            <Square size={16} />
          </button>
        ) : (
          <button
            onClick={handleSend}
            disabled={sending || (!input.trim() && images.length === 0 && references.length === 0)}
            className="shrink-0 p-2 rounded-full bg-accent-500 text-white hover:opacity-90 transition-colors disabled:opacity-30"
          >
            <ArrowUp size={18} />
          </button>
        )}
      </div>
    </div>
  );
}
