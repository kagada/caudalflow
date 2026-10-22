// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { MessageContextMenu } from '../MessageContextMenu';
import i18n from '../../../i18n';
import { useSettingsStore } from '../../../stores/settingsStore';
const { android } = vi.hoisted(() => ({ android: vi.fn(() => false) }));
vi.mock('../../../services/platform', async original => ({ ...await original<typeof import('../../../services/platform')>(), isAndroid: android }));

vi.hoisted(() => { window.matchMedia = vi.fn().mockReturnValue({ matches: false, addEventListener: vi.fn() }); });

let root: Root;
let element: HTMLDivElement;
const items = () => [...document.querySelectorAll<HTMLButtonElement>('[role="menuitem"]')];
const click = async (label: string) => act(async () => [...document.querySelectorAll<HTMLButtonElement>('button')].find((button) => button.textContent === label)!.click());
const openOptions = async (label: string) => act(async () => document.querySelector<HTMLButtonElement>(`[aria-label="${label}的更多选项"]`)!.click());
beforeEach(async () => {
  android.mockReturnValue(false);
  useSettingsStore.setState({ promptPresets: [], showPromptSettings: false });
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  await i18n.changeLanguage('zh');
  element = document.createElement('div'); document.body.append(element); root = createRoot(element);
});

it('does not focus the copy option and offers prompt management in an empty submenu', async () => {
  await act(async () => root.render(<MessageContextMenu target={{ kind: 'selection', text: '选区', x: 50, y: 50 }} busy={false} close={vi.fn()} explore={vi.fn()} revise={vi.fn()} remove={vi.fn()} />));
  expect(document.activeElement?.hasAttribute('data-message-menu')).toBe(true);
  await openOptions('从选区分支追问');
  expect(document.body.textContent).toContain('自定义要求…');
  await click('管理快捷指令…');
  expect(useSettingsStore.getState().showPromptSettings).toBe(true);
});

it('runs the selected preset with the original selection snapshot', async () => {
  useSettingsStore.setState({ promptPresets: [{ id: 'p', name: '讲清楚', content: '保留例子并详细解释' }] });
  const explore = vi.fn();
  await act(async () => root.render(<MessageContextMenu target={{ kind: 'selection', text: '跨消息选区', x: 50, y: 50 }} busy={false} close={vi.fn()} explore={explore} revise={vi.fn()} remove={vi.fn()} />));
  await openOptions('从选区分支追问');
  await act(async () => [...document.querySelectorAll<HTMLButtonElement>('button')].find((button) => button.textContent === '讲清楚')!.click());
  expect(explore).toHaveBeenCalledWith('跨消息选区', '保留例子并详细解释');
});
afterEach(async () => { await act(async () => root.unmount()); element.remove(); vi.unstubAllGlobals(); });

it('keeps the full menu inside the viewport using its measured height', async () => {
  const bounds = vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue({ height: 500 } as DOMRect);
  try {
    await act(async () => root.render(<MessageContextMenu target={{ kind: 'selection', text: '选区', x: 50, y: 700 }} busy={false} close={vi.fn()} explore={vi.fn()} revise={vi.fn()} remove={vi.fn()} />));
    expect(document.querySelector<HTMLElement>('[data-message-menu]')!.style.top).toBe(`${window.innerHeight - 500 - 8}px`);
  } finally { bounds.mockRestore(); }
});

it('moves an Android selection menu above the handles instead of clamping it over them', async () => {
  android.mockReturnValue(true);
  vi.stubGlobal('innerWidth', 400); vi.stubGlobal('innerHeight', 800);
  const bounds = vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue({ width: 256, height: 400 } as DOMRect);
  try {
    await act(async () => root.render(<MessageContextMenu target={{ kind: 'selection', text: '选区', x: 350, y: 718,
      selectionBounds: { start: { x: 320, top: 650, bottom: 670 }, end: { x: 350, top: 690, bottom: 710 }, active: 'end' } }} busy={false} close={vi.fn()} explore={vi.fn()} revise={vi.fn()} remove={vi.fn()} />));
    const menu = document.querySelector<HTMLElement>('[data-message-menu]')!;
    expect(parseFloat(menu.style.top) + 400).toBeLessThan(650);
    expect(menu.style.height).toBe('');
    expect(menu.style.maxHeight).toBe('');
    expect(menu.style.overflowY).toBe('');
  } finally { bounds.mockRestore(); }
});

it('disables revision actions with an explanation for text spanning multiple bubbles', async () => {
  await act(async () => root.render(<MessageContextMenu target={{ kind: 'selection', text: '问题\n回答'.repeat(100), x: 50, y: 50 }} busy={false} close={vi.fn()} explore={vi.fn()} revise={vi.fn()} remove={vi.fn()} />));
  expect(document.body.textContent).toContain('从选区分支追问');
  const revisions = items().filter((button) => button.textContent === '重新回答这个问题' || button.textContent === '删除这条消息');
  expect(revisions).toHaveLength(2);
  for (const button of revisions) {
    expect(button.disabled).toBe(true);
    await act(async () => button.click());
  }
  expect(document.querySelector('[role="dialog"]')).toBeNull();
  expect(document.body.textContent).toContain('选区跨多条消息，无法确定要重答或删除哪一条。');
});

it('shows message actions and requires confirmation before deleting', async () => {
  const remove = vi.fn();
  await act(async () => root.render(<MessageContextMenu target={{ kind: 'message', message: { id: 'answer', role: 'assistant', content: '回答', timestamp: 0 }, x: 50, y: 50 }} busy={false} close={vi.fn()} explore={vi.fn()} revise={vi.fn()} remove={remove} />));
  expect(document.body.textContent).toContain('重新回答这个问题');
  expect(document.body.textContent).not.toContain('按要求改写…');
  expect(document.body.textContent).toContain('从这条消息分支追问');
  await act(async () => [...document.querySelectorAll<HTMLButtonElement>('button')].find((button) => button.textContent === '删除这条消息')!.click());
  expect(remove).not.toHaveBeenCalled();
  expect(document.querySelector('[role="dialog"]')).not.toBeNull();
  await act(async () => [...document.querySelectorAll<HTMLButtonElement>('[role="dialog"] button')].find((button) => button.textContent === '删除这条消息')!.click());
  expect(remove).toHaveBeenCalledWith('answer');
});

// 单回答选区的追问使用选中文字，重答和重构始终使用整条回答的 id。
it('keeps selection exploration separate from whole-answer revision', async () => {
  const revise = vi.fn();
  const explore = vi.fn();
  await act(async () => root.render(<MessageContextMenu target={{ kind: 'selection', text: '局部', message: { id: 'answer', role: 'assistant', content: '完整回答', timestamp: 0 }, x: 50, y: 50 }} busy={false} close={vi.fn()} explore={explore} revise={revise} remove={vi.fn()} />));
  await click('从选区分支追问');
  expect(explore).toHaveBeenCalledWith('局部', '');
  await click('重新回答这个问题');
  expect(revise).toHaveBeenCalledWith('answer');
  await openOptions('重新回答这个问题');
  await click('按要求改写…');
  expect(document.body.textContent).toContain('将改写整条回答');
  const input = document.querySelector('textarea')!;
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!.call(input, '短一点，保留例子');
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
  await click('执行');
  expect(revise).toHaveBeenLastCalledWith('answer', '短一点，保留例子');
});

it('uses the full message for exploration without a selection', async () => {
  const explore = vi.fn();
  await act(async () => root.render(<MessageContextMenu target={{ kind: 'message', message: { id: 'answer', role: 'assistant', content: '完整回答', timestamp: 0 }, x: 50, y: 50 }} busy={false} close={vi.fn()} explore={explore} revise={vi.fn()} remove={vi.fn()} />));
  await act(async () => [...document.querySelectorAll<HTMLButtonElement>('button')].find((button) => button.textContent === '从这条消息分支追问')!.click());
  expect(explore).toHaveBeenCalledWith('完整回答', '');
});

// 文字和箭头必须分开响应，避免触屏想展开选项却意外发起生成。
it('opens options only from the arrow and keeps all four actions for Android selections', async () => {
  android.mockReturnValue(true);
  const explore = vi.fn(); const revise = vi.fn(); const remove = vi.fn();
  const reference = vi.fn(); const versions = vi.fn(); const writeText = vi.fn().mockResolvedValue(undefined);
  Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText } });
  await act(async () => root.render(<MessageContextMenu target={{ kind: 'selection', text: '字', message: { id: 'a', role: 'assistant', content: '整条回答', timestamp: 0 }, x: 50, y: 50 }} busy={false} close={vi.fn()} explore={explore} revise={revise} remove={remove} copyReference={reference} versions={versions} />));
  expect(items().filter((button) => !button.hasAttribute('aria-haspopup')).map((button) => button.textContent)).toEqual(['复制选中文字', '从选区分支追问', '重新回答这个问题', '删除这条消息']);
  await act(async () => items().find((button) => button.textContent === '从选区分支追问')!.dispatchEvent(new MouseEvent('mouseover', { bubbles: true })));
  expect(document.querySelector('[data-submenu]')).toBeNull();
  await openOptions('从选区分支追问');
  expect(explore).not.toHaveBeenCalled();
  await click('总结（新分支）');
  expect(explore).toHaveBeenCalledWith('字', i18n.t('menu.summaryPrompt'));
  await openOptions('复制选中文字');
  expect(writeText).not.toHaveBeenCalled();
  await click('复制引用');
  expect(reference).toHaveBeenCalledTimes(1);
  await click('复制选中文字');
  expect(writeText).toHaveBeenCalledWith('字');
  await openOptions('重新回答这个问题');
  expect(revise).not.toHaveBeenCalled();
  await click('历史版本…');
  expect(versions).toHaveBeenCalledWith('a');
  await click('删除这条消息');
  expect(document.querySelector('[role="dialog"]')?.textContent).toContain('将删除整条消息，包括未选中的文字');
  expect(remove).not.toHaveBeenCalled();
  await act(async () => document.querySelector<HTMLButtonElement>('[role="dialog"] button:last-child')!.click());
  expect(remove).toHaveBeenCalledWith('a');
});

it('opens a blank custom request and uses the selected text in the new branch', async () => {
  const explore = vi.fn();
  await act(async () => root.render(<MessageContextMenu target={{ kind: 'selection', text: '局部选区', x: 50, y: 50 }} busy={false} close={vi.fn()} explore={explore} revise={vi.fn()} remove={vi.fn()} />));
  await openOptions('从选区分支追问');
  await click('自定义要求…');
  const input = document.querySelector('textarea')!;
  expect(input.value).toBe('');
  expect(input.getAttribute('aria-label')).toBe('你想了解什么？');
  expect(document.querySelector<HTMLButtonElement>('[role="dialog"] button:last-child')!.disabled).toBe(true);
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!.call(input, '举个例子');
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
  await click('执行');
  expect(explore).toHaveBeenCalledWith('局部选区', '举个例子');
});

it('keeps question version history accessible and supports keyboard submenu navigation', async () => {
  const revise = vi.fn(); const versions = vi.fn();
  await act(async () => root.render(<MessageContextMenu target={{ kind: 'message', message: { id: 'q', role: 'user', content: '问题', timestamp: 0 }, x: 50, y: 50 }} busy={false} close={vi.fn()} explore={vi.fn()} revise={revise} remove={vi.fn()} versions={versions} />));
  const arrow = document.querySelector<HTMLButtonElement>('[aria-label="重新回答这个问题的更多选项"]')!;
  await act(async () => arrow.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true })));
  expect(document.activeElement?.textContent).toBe('历史版本…');
  expect(document.body.textContent).not.toContain('按要求改写…');
  await act(async () => document.activeElement!.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowLeft', bubbles: true })));
  expect(document.querySelector('[data-submenu]')).toBeNull();
  expect(document.activeElement).toBe(arrow);
  await click('重新回答这个问题');
  expect(revise).toHaveBeenCalledWith('q');
});

it('keeps narrow-screen options on screen and returns to the main menu without running an action', async () => {
  const explore = vi.fn();
  const bounds = vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue({ left: 100, top: 100, bottom: 400, width: 256, height: 300 } as DOMRect);
  const width = window.innerWidth;
  try {
    Object.defineProperty(window, 'innerWidth', { configurable: true, value: 390 });
    await act(async () => root.render(<MessageContextMenu target={{ kind: 'selection', text: '字', message: { id: 'a', role: 'assistant', content: '整条消息', timestamp: 0 }, x: 100, y: 100 }} busy={false} close={vi.fn()} explore={explore} revise={vi.fn()} remove={vi.fn()} />));
    await openOptions('从选区分支追问');
    const panel = document.querySelector<HTMLElement>('[data-submenu]')!;
    expect(panel.style.right).toBe('auto');
    expect(panel.style.left).toBe('0px');
    expect(document.activeElement?.textContent).toBe('‹ 返回主菜单');
    await click('‹ 返回主菜单');
    expect(document.querySelector('[data-submenu]')).toBeNull();
    expect(document.activeElement?.getAttribute('aria-label')).toBe('从选区分支追问的更多选项');
    expect(explore).not.toHaveBeenCalled();
  } finally {
    Object.defineProperty(window, 'innerWidth', { configurable: true, value: width });
    bounds.mockRestore();
  }
});

it('allows text copying but disables generation and deletion while busy', async () => {
  await act(async () => root.render(<MessageContextMenu target={{ kind: 'selection', text: '字', message: { id: 'a', role: 'assistant', content: '整条消息', timestamp: 0 }, x: 50, y: 50 }} busy close={vi.fn()} explore={vi.fn()} revise={vi.fn()} remove={vi.fn()} copyReference={vi.fn()} />));
  expect(items().find((button) => button.textContent === '复制选中文字')?.disabled).toBe(false);
  for (const label of ['从选区分支追问', '重新回答这个问题', '删除这条消息']) {
    expect(items().find((button) => button.textContent === label)?.disabled).toBe(true);
  }
  await openOptions('复制选中文字');
  expect(items().find((button) => button.textContent === '复制引用')?.disabled).toBe(true);
});
