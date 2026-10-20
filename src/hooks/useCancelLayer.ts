import { useLayoutEffect, useRef } from 'react';
import { registerCancelable } from '../services/uiCancel';

// 界面只声明何时可关闭和如何关闭，不分别监听键盘、安卓返回键或侧滑手势。
export function useCancelLayer(active: boolean, close: () => void, level: number) {
  const currentClose = useRef(close);
  useLayoutEffect(() => { currentClose.current = close; });
  useLayoutEffect(() => {
    if (active) return registerCancelable(() => currentClose.current(), level);
  }, [active, level]);
}
