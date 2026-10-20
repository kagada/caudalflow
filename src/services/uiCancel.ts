interface CancelLayer { close: () => void; level: number }
const layers: CancelLayer[] = [];
let pendingBack: Promise<void> | undefined;

// Esc 只由最上层界面消费，阻止旧的局部监听器再次关闭下面的界面。
function handleEscape(event: KeyboardEvent) {
  if (event.key !== 'Escape' || event.isComposing || event.keyCode === 229) return;
  if (!layers.length) return;
  event.preventDefault();
  event.stopImmediatePropagation();
  if (!event.repeat) cancelUI();
}

// level 表示显示层级；卡片内弹层高于最大化卡片，全局弹窗按 z-index 排序。
// 同层后打开的优先，注册不随普通重绘重新排序。
export function registerCancelable(close: () => void, level: number): () => void {
  const layer = { close, level };
  if (!layers.length) window.addEventListener('keydown', handleEscape, true);
  layers.push(layer);
  return () => {
    const index = layers.indexOf(layer);
    if (index >= 0) layers.splice(index, 1);
    if (!layers.length) window.removeEventListener('keydown', handleEscape, true);
  };
}

// 由实际关闭和卸载清理注册；处理中的弹窗也会消费返回，不能穿透到下层或系统桌面。
export function cancelUI(): boolean {
  let top: CancelLayer | undefined;
  for (const layer of layers) if (!top || layer.level >= top.level) top = layer;
  if (!top) return false;
  top.close();
  return true;
}

// 安卓只有在没有可关闭界面时才离开应用；保存期间的连续返回共用同一次离开操作。
export async function handleBackButton(leaveApp: () => Promise<void>): Promise<void> {
  if (pendingBack) return pendingBack;
  if (cancelUI()) return;
  pendingBack = Promise.resolve().then(leaveApp).finally(() => { pendingBack = undefined; });
  return pendingBack;
}
