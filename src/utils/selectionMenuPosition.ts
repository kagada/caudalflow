export interface SelectionEndpointRect { x: number; top: number; bottom: number }
export interface SelectionMenuBounds {
  start: SelectionEndpointRect;
  end: SelectionEndpointRect;
  active: 'start' | 'end';
}

// 菜单保持原尺寸，先尝试端点上方或下方，再尝试侧面；屏幕边界调整后仍检查两个手柄。
export function selectionMenuPosition(bounds: SelectionMenuBounds, menu: { width: number; height: number }, viewport: { width: number; height: number }) {
  const zones = [bounds.start, bounds.end].map(point => ({ left: point.x - 32, right: point.x + 32, top: point.top - 8, bottom: point.bottom + 40 }));
  const above = { x: bounds.start.x, y: zones[0].top - menu.height - 8 };
  const below = { x: bounds.end.x, y: zones[1].bottom + 8 };
  const active = bounds[bounds.active];
  const candidates = [
    ...(bounds.active === 'start' ? [above, below] : [below, above]),
    ...zones.flatMap(zone => [
      { x: zone.left - menu.width - 8, y: active.top },
      { x: zone.right + 8, y: active.top },
    ]),
    { x: 8, y: 8 }, { x: viewport.width - menu.width - 8, y: 8 },
    { x: 8, y: viewport.height - menu.height - 8 },
    { x: viewport.width - menu.width - 8, y: viewport.height - menu.height - 8 },
  ];
  let best = { x: 8, y: 8 }, leastOverlap = Infinity;
  for (const candidate of candidates) {
    const point = {
      x: Math.max(8, Math.min(candidate.x, viewport.width - menu.width - 8)),
      y: Math.max(8, Math.min(candidate.y, viewport.height - menu.height - 8)),
    };
    const overlap = zones.reduce((area, zone) => area
      + Math.max(0, Math.min(point.x + menu.width, zone.right) - Math.max(point.x, zone.left))
      * Math.max(0, Math.min(point.y + menu.height, zone.bottom) - Math.max(point.y, zone.top)), 0);
    if (overlap < leastOverlap) { best = point; leastOverlap = overlap; }
    if (!overlap) break;
  }
  return best;
}
