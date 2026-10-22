import { useCallback, useEffect, useRef } from 'react';
import { isAndroid } from '../services/platform';
import type { SelectionEndpointRect } from '../utils/selectionMenuPosition';

type Endpoint = 'start' | 'end';
interface Boundaries {
  startNode: Node;
  startOffset: number;
  endNode: Node;
  endOffset: number;
}

// 原生手柄不向网页发送松手坐标，比较选区边界来跟随实际移动的一端。
export function useSelectionMenuAnchor(containerRef: React.RefObject<HTMLElement | null>, closeMenu: () => void) {
  const android = isAndroid();
  const previous = useRef<Boundaries | null>(null);
  const endpoint = useRef<Endpoint>('end');
  const read = useCallback((selection: Selection | null) => {
    if (!selection?.rangeCount || selection.isCollapsed) {
      previous.current = null;
      return;
    }
    let range = selection.getRangeAt(0);
    const before = previous.current;
    const container = containerRef.current;
    if (!container) return;
    if (!container.contains(range.commonAncestorContainer)) {
      // 安卓切换跨回答选区的手柄时，固定端偶尔被映射到浮动菜单或输入栏。
      // 移动端仍在正文内时保留它，只恢复上一次有效的固定端，避免选中界面控件。
      if (!isAndroid() || !before || !selection.focusNode || !selection.anchorNode) return;
      if (container.contains(selection.focusNode) && !container.contains(selection.anchorNode)) {
        const movingStart = selection.focusNode === range.startContainer && selection.focusOffset === range.startOffset;
        const anchorNode = movingStart ? before.endNode : before.startNode;
        const anchorOffset = movingStart ? before.endOffset : before.startOffset;
        if (!container.contains(anchorNode)) return;
        selection.setBaseAndExtent(anchorNode, anchorOffset, selection.focusNode, selection.focusOffset);
      } else if (container.contains(selection.anchorNode) && !container.contains(selection.focusNode)) {
        // 手柄移出消息区域时最多选到正文边界，不能把菜单、输入栏也带入选区。
        const bodies = container.querySelectorAll('.select-text');
        const end = container.contains(range.startContainer);
        const body = bodies[end ? bodies.length - 1 : 0];
        if (!body) return;
        const edge = document.createRange(); edge.selectNodeContents(body); edge.collapse(!end);
        selection.setBaseAndExtent(selection.anchorNode, selection.anchorOffset, edge.startContainer, edge.startOffset);
      } else return;
      range = selection.getRangeAt(0);
    }
    const startMoved = before && (before.startNode !== range.startContainer || before.startOffset !== range.startOffset);
    const endMoved = before && (before.endNode !== range.endContainer || before.endOffset !== range.endOffset);
    if (startMoved && !endMoved) endpoint.current = 'start';
    else if (endMoved && !startMoved) endpoint.current = 'end';
    else if (!before || (startMoved && endMoved)) {
      endpoint.current = selection.focusNode === range.startContainer && selection.focusOffset === range.startOffset ? 'start' : 'end';
    }
    // Range 会随选区原地变化，必须保存当时的节点和偏移，才能判断下次移动的是哪端。
    previous.current = { startNode: range.startContainer, startOffset: range.startOffset,
      endNode: range.endContainer, endOffset: range.endOffset };
    return range;
  }, [containerRef]);

  useEffect(() => {
    if (!android) return;
    const change = () => {
      const before = previous.current;
      const range = read(window.getSelection());
      // 拖动途中收起菜单，避免选区端点落进菜单文字；原生再次请求菜单时再按新端点定位。
      if (before && range && (before.startNode !== range.startContainer || before.startOffset !== range.startOffset
        || before.endNode !== range.endContainer || before.endOffset !== range.endOffset)) closeMenu();
    };
    document.addEventListener('selectionchange', change);
    return () => document.removeEventListener('selectionchange', change);
  }, [android, read, closeMenu]);

  return useCallback((selection: Selection) => {
    // PC 选区和右键是两个独立步骤，继续由调用方使用右键坐标；只有安卓跟随选区手柄。
    if (!android) return;
    const range = read(selection);
    if (!range) return;
    const caret = range.cloneRange();
    caret.collapse(endpoint.current === 'start');
    const caretRect = caret.getBoundingClientRect?.();
    let rect = caretRect;
    // 元素边界可能没有光标矩形，改用这一端紧邻的选中文字矩形。
    if (!rect?.height) {
      const rects = range.getClientRects?.();
      rect = rects?.[endpoint.current === 'start' ? 0 : rects.length - 1];
    }
    if (!rect) return;
    const point = { x: endpoint.current === 'end' && !caretRect?.height ? rect.right : rect.left, y: rect.bottom + 8 };
    // 把两个端点同时交给菜单定位，不能避开刚拖动的一端却挡住另一端。
    const endpointRect = (side: Endpoint): SelectionEndpointRect | undefined => {
      const boundary = range.cloneRange(); boundary.collapse(side === 'start');
      const caretBox = boundary.getBoundingClientRect?.();
      const parts = !caretBox?.height ? range.getClientRects?.() : undefined;
      const box = caretBox?.height ? caretBox : parts?.[side === 'start' ? 0 : parts.length - 1];
      if (!box) return;
      return { x: !caretBox?.height && side === 'end' ? box.right : box.left, top: box.top, bottom: box.bottom };
    };
    const start = endpointRect('start'), end = endpointRect('end');
    return { ...point, selectionBounds: start && end ? { start, end, active: endpoint.current } : undefined };
  }, [android, read]);
}
