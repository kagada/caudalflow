import { createPortal } from 'react-dom';
import type { ReactNode } from 'react';
import { useCancelLayer } from '../../hooks/useCancelLayer';

export interface PanelPoint { x: number; y: number }

// 独立于画布变换：鼠标触发时靠近点击位置，键盘触发时居中，并留出屏幕边距。
export function FloatingNodePanel({ point, children, close }: { point?: PanelPoint; children: ReactNode; close: () => void }) {
  useCancelLayer(true, close, 12000);
  const width = Math.min(360, window.innerWidth - 32);
  const position = point ? {
    position: 'absolute' as const,
    left: Math.max(16, Math.min(point.x + 8, window.innerWidth - width - 16)),
    top: Math.max(16, Math.min(point.y + 8, window.innerHeight - 300)),
    width,
  } : { width };
  return createPortal(<div data-floating-node-panel className="fixed inset-0 z-[12000] flex items-center justify-center bg-black/15 p-4 text-text-primary" onPointerDown={(event) => { event.stopPropagation(); if (event.target === event.currentTarget) close(); }} onMouseDown={(event) => event.stopPropagation()}>
    <div style={position} className="max-h-[calc(100vh-32px)] overflow-y-auto" onContextMenu={(event) => event.preventDefault()}>{children}</div>
  </div>, document.body);
}
