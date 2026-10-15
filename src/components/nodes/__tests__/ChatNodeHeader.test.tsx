// @vitest-environment jsdom
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { expect, it, vi } from 'vitest';
import { ChatNodeHeader } from '../ChatNodeHeader';
import i18n from '../../../i18n';

it('closing a card never calls deletion, while deletion is available only in the menu', async () => {
  await i18n.changeLanguage('zh');
  const element = document.createElement('div'); document.body.append(element);
  const root = createRoot(element);
  const close = vi.fn(); const remove = vi.fn(); const palette = vi.fn();
  await act(async () => root.render(<ChatNodeHeader topic="对话" maximized={false} onMinimize={close} onMaximize={vi.fn()} onDelete={remove} onTogglePalette={palette} onToggleDone={vi.fn()} />));
  expect(element.querySelector('button[title="最大化"] svg.lucide-square')).not.toBeNull();
  expect(element.querySelector('button[title="关闭"] svg.lucide-x')).not.toBeNull();
  expect(element.querySelector('svg.lucide-trash-2')).toBeNull();
  await act(async () => element.querySelector<HTMLButtonElement>('button[title="关闭"]')!.click());
  expect(close).toHaveBeenCalledTimes(1); expect(remove).not.toHaveBeenCalled();
  await act(async () => element.querySelector<HTMLButtonElement>('button[title="卡片菜单"]')!.click());
  const menu = element.querySelector('[role="menu"]')!;
  expect([...menu.querySelectorAll('button')].map(button => button.textContent)).toEqual(['标记为已搞定', '添加标签和颜色', '删除对话', '关闭']);
  expect(menu.querySelector('[role="separator"]')).not.toBeNull();
  await act(async () => [...menu.querySelectorAll<HTMLButtonElement>('button')].find(button => button.textContent === '删除对话')!.click());
  expect(remove).toHaveBeenCalledTimes(1); expect(close).toHaveBeenCalledTimes(1);
  await act(async () => root.unmount()); element.remove();
});
