import { describe, expect, it } from 'vitest';
import { selectionMenuPosition, type SelectionMenuBounds } from '../selectionMenuPosition';

describe('selection menu avoids both handles without resizing', () => {
  it.each([
    { name: 'bottom edge', start: { x: 330, top: 600, bottom: 620 }, end: { x: 350, top: 630, bottom: 650 }, active: 'end' as const },
    { name: 'top edge', start: { x: 40, top: 20, bottom: 40 }, end: { x: 90, top: 40, bottom: 60 }, active: 'start' as const },
    { name: 'opposite screen edges', start: { x: 40, top: 100, bottom: 120 }, end: { x: 350, top: 650, bottom: 670 }, active: 'end' as const },
    { name: 'side placement', start: { x: 350, top: 80, bottom: 100 }, end: { x: 350, top: 650, bottom: 670 }, active: 'end' as const },
  ])('does not push the menu onto a handle at $name', bounds => {
    const size = { width: 256, height: 400 };
    const point = selectionMenuPosition(bounds, size, { width: 393, height: 760 });
    expect(point.x).toBeGreaterThanOrEqual(8);
    expect(point.y).toBeGreaterThanOrEqual(8);
    expect(point.x + size.width).toBeLessThanOrEqual(385);
    expect(point.y + size.height).toBeLessThanOrEqual(752);
    for (const endpoint of [bounds.start, bounds.end]) {
      // 手柄通常伸到文字下方、左右两侧；检查实际需要拖动的区域而非只检查文字点。
      for (const x of [endpoint.x - 20, endpoint.x, endpoint.x + 20]) {
        const inside = x >= point.x && x <= point.x + size.width
          && endpoint.bottom + 20 >= point.y && endpoint.bottom + 20 <= point.y + size.height;
        expect(inside).toBe(false);
      }
    }
    expect(size).toEqual({ width: 256, height: 400 });
  });

  it('prefers above the start handle when that handle moved', () => {
    const bounds: SelectionMenuBounds = { start: { x: 100, top: 400, bottom: 420 }, end: { x: 150, top: 440, bottom: 460 }, active: 'start' };
    const point = selectionMenuPosition(bounds, { width: 200, height: 150 }, { width: 600, height: 1000 });
    expect(point.y + 150).toBeLessThan(bounds.start.top);
  });

  it('prefers below the end handle when that handle moved', () => {
    const bounds: SelectionMenuBounds = { start: { x: 100, top: 400, bottom: 420 }, end: { x: 150, top: 440, bottom: 460 }, active: 'end' };
    const point = selectionMenuPosition(bounds, { width: 200, height: 150 }, { width: 600, height: 1000 });
    expect(point.y).toBeGreaterThan(bounds.end.bottom + 30);
  });
});
