// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { MessageContextMenu } from '../MessageContextMenu';
import i18n from '../../../i18n';
import { useSettingsStore } from '../../../stores/settingsStore';

vi.hoisted(() => { window.matchMedia = vi.fn().mockReturnValue({ matches: false, addEventListener: vi.fn() }); });

let root: Root;
let element: HTMLDivElement;
beforeEach(async () => {
  useSettingsStore.setState({ promptPresets: [], showPromptSettings: false });
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  await i18n.changeLanguage('zh');
  element = document.createElement('div'); document.body.append(element); root = createRoot(element);
});

it('does not focus the copy option and offers prompt management in an empty submenu', async () => {
  await act(async () => root.render(<MessageContextMenu target={{ kind: 'selection', text: '选区', x: 50, y: 50 }} busy={false} close={vi.fn()} explore={vi.fn()} revise={vi.fn()} remove={vi.fn()} />));
  expect(document.activeElement?.hasAttribute('data-message-menu')).toBe(true);
  await act(async () => [...document.querySelectorAll<HTMLButtonElement>('button')].find((button) => button.textContent?.includes('用 prompt 追问选区'))!.click());
  expect(document.body.textContent).toContain('还没有预设');
  await act(async () => [...document.querySelectorAll<HTMLButtonElement>('button')].find((button) => button.textContent === '管理 prompt')!.click());
  expect(useSettingsStore.getState().showPromptSettings).toBe(true);
});

it('runs the selected preset with the original selection snapshot', async () => {
  useSettingsStore.setState({ promptPresets: [{ id: 'p', name: '讲清楚', content: '保留例子并详细解释' }] });
  const explore = vi.fn();
  await act(async () => root.render(<MessageContextMenu target={{ kind: 'selection', text: '跨消息选区', x: 50, y: 50 }} busy={false} close={vi.fn()} explore={explore} revise={vi.fn()} remove={vi.fn()} />));
  await act(async () => [...document.querySelectorAll<HTMLButtonElement>('button')].find((button) => button.textContent?.includes('用 prompt 追问选区'))!.click());
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

it('disables revision actions with an explanation for text spanning multiple bubbles', async () => {
  await act(async () => root.render(<MessageContextMenu target={{ kind: 'selection', text: '问题\n回答'.repeat(100), x: 50, y: 50 }} busy={false} close={vi.fn()} explore={vi.fn()} revise={vi.fn()} remove={vi.fn()} />));
  expect(document.body.textContent).toContain('从选区分支追问');
  const revisions = [...document.querySelectorAll<HTMLButtonElement>('[role="menuitem"]')].filter((button) => button.textContent?.includes('重新回答这个问题') || button.textContent?.includes('用 prompt 重构回答'));
  expect(revisions).toHaveLength(2);
  for (const button of revisions) {
    expect(button.disabled).toBe(true);
    expect(button.querySelector('span')?.textContent).toBe('（选中多个回答时不可用）');
    await act(async () => button.click());
  }
  expect(document.querySelector('[role="dialog"]')).toBeNull();
  expect(document.body.textContent).not.toContain('删除这条消息');
});

it('shows message actions and requires confirmation before deleting', async () => {
  const remove = vi.fn();
  await act(async () => root.render(<MessageContextMenu target={{ kind: 'message', message: { id: 'answer', role: 'assistant', content: '回答', timestamp: 0 }, x: 50, y: 50 }} busy={false} close={vi.fn()} explore={vi.fn()} revise={vi.fn()} remove={remove} />));
  expect(document.body.textContent).toContain('重新回答这个问题');
  expect(document.body.textContent).toContain('用 prompt 重构回答');
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
  const click = async (label: string) => act(async () => [...document.querySelectorAll<HTMLButtonElement>('button')].find((button) => button.textContent === label)!.click());
  await click('从选区分支追问');
  expect(explore).toHaveBeenCalledWith('局部', '');
  await click('重新回答这个问题');
  expect(revise).toHaveBeenCalledWith('answer');
  await click('用 prompt 重构回答');
  expect(document.body.textContent).toContain('重构将替换这条回复');
  await click('执行');
  expect(revise).toHaveBeenLastCalledWith('answer', i18n.t('menu.defaultPrompt'));
});

it('uses the full message for exploration without a selection', async () => {
  const explore = vi.fn();
  await act(async () => root.render(<MessageContextMenu target={{ kind: 'message', message: { id: 'answer', role: 'assistant', content: '完整回答', timestamp: 0 }, x: 50, y: 50 }} busy={false} close={vi.fn()} explore={explore} revise={vi.fn()} remove={vi.fn()} />));
  await act(async () => [...document.querySelectorAll<HTMLButtonElement>('button')].find((button) => button.textContent === '从这条消息分支追问')!.click());
  expect(explore).toHaveBeenCalledWith('完整回答', '');
});
