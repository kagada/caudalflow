import { useCallback, useEffect, useRef } from 'react';
import { useReactFlow, type Viewport } from '@xyflow/react';
import type { PluginListenerHandle } from '@capacitor/core';
import { isAndroid } from '../services/platform';
import { useWorkspaceStore } from '../stores/workspaceStore';
import { useFlowStore } from '../stores/flowStore';

interface InputSession {
  original: Viewport;
  shifted: boolean;
  userMoved: boolean;
}

// 只临时平移安卓画布里的输入区；全屏卡片仍由窗口尺寸变化自行排版。
export function useAndroidKeyboardAvoidance() {
  const { getViewport, setViewport } = useReactFlow();
  const session = useRef<InputSession | null>(null);
  const restoring = useRef(false);
  const onMoveStart = useCallback((event: MouseEvent | TouchEvent | null) => {
    if (event && session.current) {
      session.current.userMoved = true;
      session.current.shifted = false;
    }
  }, []);
  const shouldSaveViewport = useCallback(() => !restoring.current && !session.current?.shifted, []);

  useEffect(() => {
    if (!isAndroid()) return;
    let disposed = false;
    let visible = false;
    let keyboardHeight = 0;
    let frame = 0;
    let screenBottom = window.innerHeight;
    let observed: HTMLElement | null = null;
    const handles: PluginListenerHandle[] = [];
    const visual = window.visualViewport;
    const visualBottom = () => visual ? visual.offsetTop + visual.height : window.innerHeight;

    const inputArea = () => {
      const active = document.activeElement;
      if (!(active instanceof HTMLElement) || active.closest('[data-maximized-conversation]')) return null;
      if (!active.closest('.react-flow__node')) return null;
      const composer = active.closest<HTMLElement>('[data-chat-input]');
      return composer ?? (active.matches('textarea,input:not([type="file"])') ? active : null);
    };
    const restore = () => {
      const previous = session.current;
      session.current = null;
      if (!previous?.shifted || previous.userMoved) return;
      restoring.current = true;
      void setViewport(previous.original, { duration: 0 }).finally(() => { restoring.current = false; });
    };
    const ensureVisible = () => {
      frame = 0;
      if (disposed || !visible) return;
      const area = inputArea();
      if (!area || useFlowStore.getState().nodes.some(node => node.data.maximized)) { restore(); return; }
      session.current ??= { original: getViewport(), shifted: false, userMoved: false };
      if (session.current.userMoved) return;
      const bottom = visualBottom();
      if (bottom > screenBottom + 1) screenBottom = bottom + keyboardHeight;
      // 系统已缩小可见区域时直接采用它，只有覆盖模式才用键盘高度补足，避免重复减去键盘。
      const availableBottom = bottom < screenBottom - 1 ? bottom : Math.max(0, screenBottom - keyboardHeight);
      const moveUp = area.getBoundingClientRect().bottom + 12 - availableBottom;
      if (moveUp <= 1) return;
      const current = getViewport();
      session.current.shifted = true;
      void setViewport({ ...current, y: current.y - moveUp }, { duration: 0 });
    };
    const schedule = () => {
      if (frame) cancelAnimationFrame(frame);
      frame = requestAnimationFrame(ensureVisible);
    };
    const observer = new ResizeObserver(schedule);
    const focusChanged = () => {
      const area = inputArea();
      if (!visible) screenBottom = Math.max(window.innerHeight, visualBottom());
      if (area && !session.current) session.current = { original: getViewport(), shifted: false, userMoved: false };
      if (area !== observed) {
        observer.disconnect(); observed = area;
        if (area) observer.observe(area);
      }
      schedule();
    };
    const hiding = () => {
      visible = false;
      if (frame) cancelAnimationFrame(frame);
      frame = 0;
    };
    const hidden = () => { hiding(); keyboardHeight = 0; restore(); };
    const shown = ({ keyboardHeight: height }: { keyboardHeight: number }) => {
      visible = true; keyboardHeight = height; schedule();
    };

    document.addEventListener('focusin', focusChanged);
    document.addEventListener('focusout', schedule);
    window.addEventListener('resize', schedule);
    visual?.addEventListener('resize', schedule);
    visual?.addEventListener('scroll', schedule);
    const unsubscribeFlow = useFlowStore.subscribe(schedule);
    const unsubscribeWorkspace = useWorkspaceStore.subscribe((next, previous) => {
      // 换工作区丢弃旧的临时视角，不把原工作区的坐标恢复到新工作区。
      if (next.activeWorkspaceId !== previous.activeWorkspaceId) session.current = null;
    });
    void import('@capacitor/keyboard').then(({ Keyboard }) => {
      const listeners = [
        Keyboard.addListener('keyboardWillShow', shown), Keyboard.addListener('keyboardDidShow', shown),
        Keyboard.addListener('keyboardWillHide', hiding), Keyboard.addListener('keyboardDidHide', hidden),
      ];
      for (const listener of listeners) void listener.then(handle => {
        if (disposed) void handle.remove(); else handles.push(handle);
      }).catch(error => console.error('无法监听安卓键盘', error));
    }).catch(error => console.error('无法加载安卓键盘监听', error));
    return () => {
      disposed = true;
      if (frame) cancelAnimationFrame(frame);
      observer.disconnect(); unsubscribeFlow(); unsubscribeWorkspace();
      document.removeEventListener('focusin', focusChanged);
      document.removeEventListener('focusout', schedule);
      window.removeEventListener('resize', schedule);
      visual?.removeEventListener('resize', schedule); visual?.removeEventListener('scroll', schedule);
      for (const handle of handles) void handle.remove();
      session.current = null;
    };
  }, [getViewport, setViewport]);

  return { onMoveStart, shouldSaveViewport };
}
