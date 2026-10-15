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

it('shows only selection operations for text spanning multiple bubbles', async () => {
  await act(async () => root.render(<MessageContextMenu target={{ kind: 'selection', text: '问题\n回答'.repeat(100), x: 50, y: 50 }} busy={false} close={vi.fn()} explore={vi.fn()} revise={vi.fn()} remove={vi.fn()} />));
  expect(document.body.textContent).toContain('从选区分支追问');
  expect(document.body.textContent).not.toContain('重新回答这个问题');
  expect(document.body.textContent).not.toContain('删除这条消息');
});

it('shows message actions and requires confirmation before deleting', async () => {
  const remove = vi.fn();
  await act(async () => root.render(<MessageContextMenu target={{ kind: 'message', message: { id: 'answer', role: 'assistant', content: '回答', timestamp: 0 }, x: 50, y: 50 }} busy={false} close={vi.fn()} explore={vi.fn()} revise={vi.fn()} remove={remove} />));
  expect(document.body.textContent).toContain('重新回答这个问题');
  expect(document.body.textContent).toContain('用 prompt 重构回答');
  expect(document.body.textContent).not.toContain('从选区分支追问');
  await act(async () => [...document.querySelectorAll<HTMLButtonElement>('button')].find((button) => button.textContent === '删除这条消息')!.click());
  expect(remove).not.toHaveBeenCalled();
  expect(document.querySelector('[role="dialog"]')).not.toBeNull();
  await act(async () => [...document.querySelectorAll<HTMLButtonElement>('[role="dialog"] button')].find((button) => button.textContent === '删除这条消息')!.click());
  expect(remove).toHaveBeenCalledWith('answer');
});
