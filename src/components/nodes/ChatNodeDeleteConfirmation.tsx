import { useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { AlertTriangle, Trash2, X } from 'lucide-react';
import { FloatingNodePanel, type PanelPoint } from '../ui/FloatingNodePanel';

interface ChatNodeDeleteConfirmationProps {
  topic: string;
  onConfirm: () => void;
  onCancel: () => void;
  point?: PanelPoint;
}

export function ChatNodeDeleteConfirmation({
  topic,
  onConfirm,
  onCancel,
  point,
}: ChatNodeDeleteConfirmationProps) {
  const { t } = useTranslation();
  const popupRef = useRef<HTMLDivElement>(null);
  const truncatedTopic = topic.length > 48 ? topic.slice(0, 48) + '...' : topic;

  useEffect(() => {
    // Use a ref flag to skip the very first mousedown (the one that opened the popup)
    let skipFirst = true;
    const handleMouseDown = (e: MouseEvent) => {
      if (skipFirst) {
        skipFirst = false;
        return;
      }
      const target = e.target as Node | null;
      if (target && popupRef.current?.contains(target)) return;
      onCancel();
    };

    // Small delay so the opening click is skipped
    const timer = setTimeout(() => {
      document.addEventListener('mousedown', handleMouseDown);
    }, 50);

    return () => {
      clearTimeout(timer);
      document.removeEventListener('mousedown', handleMouseDown);
    };
  }, [onCancel]);

  return (
    <FloatingNodePanel point={point} close={onCancel}>
    <div
      ref={popupRef}
      className="w-full rounded-xl border border-red-500/30 bg-surface-900 shadow-2xl"
      onPointerDown={(e) => e.stopPropagation()}
      onMouseDown={(e) => e.stopPropagation()}
      role="dialog"
      aria-modal="true"
      aria-labelledby="delete-chat-node-title"
    >
      <div className="p-5">
        <div className="flex items-start gap-2">
          <AlertTriangle size={15} className="mt-0.5 shrink-0 text-red-400" />
          <div className="min-w-0 flex-1">
            <div
              id="delete-chat-node-title"
              className="text-lg font-semibold text-text-primary"
            >
              {t('delete.deleteChat')}
            </div>
            <p className="mt-2 text-sm leading-6 text-text-secondary">
              {t('delete.deleteDescription', { topic: truncatedTopic })}
            </p>
          </div>
          <button
            onClick={(e) => {
              e.stopPropagation();
              onCancel();
            }}
            className="shrink-0 text-text-muted hover:text-text-primary transition-colors"
            title={t('delete.cancel')}
            aria-label={t('delete.cancel')}
          >
            <X size={12} />
          </button>
        </div>
      </div>

      <div className="border-t border-border p-3 flex justify-end gap-2">
        <button
          autoFocus
          className="text-sm text-text-secondary hover:text-text-primary hover:bg-surface-700 rounded-md px-3 py-2 transition-colors"
          onClick={(e) => {
            e.stopPropagation();
            onCancel();
          }}
        >
          {t('delete.cancel')}
        </button>
        <button
          className="flex items-center gap-1.5 text-sm text-red-400 hover:bg-red-500/10 rounded-md px-3 py-2 transition-colors"
          onClick={(e) => {
            e.stopPropagation();
            onConfirm();
          }}
        >
          <Trash2 size={12} />
          <span>{t('delete.delete')}</span>
        </button>
      </div>
    </div>
    </FloatingNodePanel>
  );
}
