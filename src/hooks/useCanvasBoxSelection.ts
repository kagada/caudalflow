import { useCallback, useEffect, useRef, type PointerEvent } from 'react';

// 画布框选期间暂停浏览器文字选择；直接更新属性，避免鼠标移动引起正文重绘。
export function useCanvasBoxSelection(panMode: boolean) {
  const canvasRef = useRef<HTMLDivElement>(null);
  const selecting = useRef(false);

  const endSelection = useCallback(() => {
    selecting.current = false;
    canvasRef.current?.removeAttribute('data-canvas-box-selecting');
  }, []);

  const startSelection = useCallback(() => {
    selecting.current = true;
    canvasRef.current?.setAttribute('data-canvas-box-selecting', '');
    window.getSelection()?.removeAllRanges();
  }, []);

  const onPointerDownCapture = useCallback((event: PointerEvent<HTMLDivElement>) => {
    const target = event.target as HTMLElement;
    if (event.button !== 0 || panMode || !target.closest('.react-flow__pane')) return;
    const blankCanvas = target.classList.contains('react-flow__pane');
    if (!blankCanvas && (!event.shiftKey || target.closest('.nokey'))) return;
    // 空白画布按下时即拦截默认文字拖选，不能等新卡片被选中后才清除。
    event.preventDefault();
    startSelection();
  }, [panMode, startSelection]);

  useEffect(() => {
    const preventTextSelection = (event: Event) => {
      if (selecting.current) event.preventDefault();
    };
    document.addEventListener('selectstart', preventTextSelection);
    window.addEventListener('pointerup', endSelection);
    window.addEventListener('pointercancel', endSelection);
    window.addEventListener('blur', endSelection);
    return () => {
      document.removeEventListener('selectstart', preventTextSelection);
      window.removeEventListener('pointerup', endSelection);
      window.removeEventListener('pointercancel', endSelection);
      window.removeEventListener('blur', endSelection);
    };
  }, [endSelection]);

  return { canvasRef, onPointerDownCapture, startSelection, endSelection };
}
