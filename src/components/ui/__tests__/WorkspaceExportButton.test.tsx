/** @vitest-environment jsdom */
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import i18n from '../../../i18n';
import { cancelUI } from '../../../services/uiCancel';
import { WorkspaceExportButton } from '../WorkspaceExportButton';

let root: Root;
let container: HTMLDivElement;
const onExport = vi.fn();
const onMarkdown = vi.fn();
const arrow = () => container.querySelector<HTMLButtonElement>('[aria-haspopup="menu"]')!;

beforeEach(async () => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  vi.clearAllMocks();
  await i18n.changeLanguage('zh');
  container = document.createElement('div'); document.body.append(container);
  root = createRoot(container);
  await act(async () => root.render(<WorkspaceExportButton onExport={onExport} onExportMarkdown={onMarkdown} />));
});
afterEach(async () => { await act(async () => root.unmount()); container.remove(); vi.unstubAllGlobals(); });

it('keeps default export separate from the format menu and Markdown export', async () => {
  await act(async () => container.querySelector('button')!.click());
  expect(onExport).toHaveBeenCalledTimes(1);
  expect(document.querySelector('[role="menu"]')).toBeNull();
  await act(async () => arrow().click());
  expect(onExport).toHaveBeenCalledTimes(1);
  expect(onMarkdown).not.toHaveBeenCalled();
  expect(arrow().getAttribute('aria-expanded')).toBe('true');
  const item = document.querySelector<HTMLButtonElement>('[role="menuitem"]')!;
  expect(item.textContent).toBe('Markdown 格式');
  // 工具栏可横向滚动，子菜单通过独立弹层显示，避免被工具栏裁掉。
  expect(container.querySelector('[role="menu"]')).toBeNull();
  await act(async () => item.click());
  expect(onMarkdown).toHaveBeenCalledTimes(1);
  expect(document.querySelector('[role="menu"]')).toBeNull();
});

it('supports keyboard opening and shared back handling without exporting', async () => {
  await act(async () => arrow().dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true })));
  expect(document.activeElement?.textContent).toBe('Markdown 格式');
  await act(async () => { expect(cancelUI()).toBe(true); });
  expect(document.querySelector('[role="menu"]')).toBeNull();
  expect(document.activeElement).toBe(arrow());
  expect(onExport).not.toHaveBeenCalled();
  expect(onMarkdown).not.toHaveBeenCalled();
});

it('closes on a canvas pointer event even when the canvas stops propagation', async () => {
  await act(async () => arrow().click());
  const canvas = document.createElement('div'); document.body.append(canvas);
  canvas.addEventListener('pointerdown', (event) => { event.preventDefault(); event.stopPropagation(); });
  try {
    await act(async () => canvas.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true, cancelable: true })));
    expect(document.querySelector('[role="menu"]')).toBeNull();
    expect(onExport).not.toHaveBeenCalled();
    expect(onMarkdown).not.toHaveBeenCalled();
  } finally { canvas.remove(); }
});
