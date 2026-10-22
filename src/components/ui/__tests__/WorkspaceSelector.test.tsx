/** @vitest-environment jsdom */
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import i18n from '../../../i18n';
import { useWorkspaceStore } from '../../../stores/workspaceStore';
import { WorkspaceSelector } from '../WorkspaceSelector';
import { cancelUI } from '../../../services/uiCancel';

vi.hoisted(() => { window.matchMedia = vi.fn().mockReturnValue({ matches: false, addEventListener: vi.fn() }); });
const fake = vi.hoisted(() => ({ rename: vi.fn(), switch: vi.fn(), create: vi.fn(), android: false }));
vi.mock('../../../services/platform', async (original) => ({ ...await original<typeof import('../../../services/platform')>(), isAndroid: () => fake.android }));
vi.mock('../../../services/storage/client', () => ({ isSqliteStorage: () => true }));
vi.mock('../../../services/storage/runtime', () => ({ renameDesktopWorkspace: fake.rename, switchDesktopWorkspace: fake.switch,
  createDesktopWorkspace: fake.create, useStorageStatus: { getState: () => ({ error: '磁盘不可写' }) },
  deleteDesktopWorkspace: vi.fn(), initializeDesktopStorage: vi.fn(), exportDesktopWorkspace: vi.fn() }));
vi.mock('../StorageControls', () => ({ StorageControls: () => null }));

let root: Root;
let container: HTMLDivElement;
beforeEach(async () => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true); vi.clearAllMocks();
  fake.android = false;
  await i18n.changeLanguage('zh');
  useWorkspaceStore.setState({ activeWorkspaceId: 'a', workspaces: ['a', 'b'].map((id) => ({ id, name: id, createdAt: 0, updatedAt: 0 })) });
  fake.rename.mockImplementation(async (id, name) => useWorkspaceStore.getState().renameWorkspace(id, name));
  fake.switch.mockImplementation(async (id) => useWorkspaceStore.getState().switchWorkspace(id));
  container = document.createElement('div'); document.body.append(container); root = createRoot(container);
  await act(async () => root.render(<WorkspaceSelector />));
});

describe('workspace creation', () => {
  async function openNew(android: boolean) {
    fake.android = android;
    await act(async () => container.querySelector('button')!.click());
    const button = [...container.querySelectorAll('button')].find(button => button.textContent?.trim() === '新建工作区')!;
    await act(async () => button.click());
    return document.querySelector<HTMLFormElement>('[role="dialog"]');
  }

  async function enterName(dialog: HTMLFormElement, value: string) {
    const input = dialog.querySelector('input')!;
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, value);
      input.dispatchEvent(new Event('input', { bubbles: true }));
    });
    return input;
  }

  it('keeps the PC creation entry unchanged', async () => {
    expect(await openNew(false)).toBeNull();
    expect(fake.create).toHaveBeenCalledExactlyOnceWith();
  });

  it('opens an Android dialog without creating or showing a permanent export reminder', async () => {
    const dialog = (await openNew(true))!;
    expect(dialog).not.toBeNull();
    expect(document.activeElement).toBe(dialog.querySelector('input'));
    expect(dialog.querySelector<HTMLButtonElement>('[type="submit"]')!.disabled).toBe(true);
    expect(fake.create).not.toHaveBeenCalled();
    expect(container.textContent).not.toContain('内部副本');
    await enterName(dialog, '   ');
    expect(dialog.querySelector<HTMLButtonElement>('[type="submit"]')!.disabled).toBe(true);
  });

  it('trims the name and prevents duplicate creation and back navigation while saving', async () => {
    let resolve!: (value: unknown) => void;
    fake.create.mockImplementation(() => new Promise(done => { resolve = done; }));
    const dialog = (await openNew(true))!;
    await enterName(dialog, '  安卓笔记  ');
    await act(async () => {
      dialog.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
      dialog.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
      expect(cancelUI()).toBe(true);
    });
    expect(fake.create).toHaveBeenCalledExactlyOnceWith('安卓笔记');
    expect(document.querySelector('[role="dialog"]')).toBe(dialog);
    await act(async () => resolve({ metadata: { id: 'new' } }));
    expect(document.querySelector('[role="dialog"]')).toBeNull();
  });

  it('cancels with the shared back handler without creating a workspace', async () => {
    const dialog = (await openNew(true))!;
    await enterName(dialog, '不应创建');
    await act(async () => { expect(cancelUI()).toBe(true); });
    expect(document.querySelector('[role="dialog"]')).toBeNull();
    expect(fake.create).not.toHaveBeenCalled();
    expect(document.activeElement).toBe(container.querySelector('button'));
  });

  it('keeps the name and shows the storage error when creation fails', async () => {
    fake.create.mockResolvedValue(undefined);
    const dialog = (await openNew(true))!;
    const input = await enterName(dialog, '保留名称');
    await act(async () => { dialog.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })); });
    expect(dialog.querySelector('[role="alert"]')!.textContent).toBe('磁盘不可写');
    expect(input.value).toBe('保留名称');
    expect(dialog.querySelector<HTMLButtonElement>('[type="submit"]')!.disabled).toBe(false);
  });
});
afterEach(async () => { await act(async () => root.unmount()); container.remove(); vi.unstubAllGlobals(); });

async function edit(entry: 'title' | 'active' | 'other') {
  if (entry !== 'title') await act(async () => container.querySelector('button')!.click());
  const buttons = container.querySelectorAll<HTMLButtonElement>('button[title="重命名工作区"]');
  await act(async () => buttons[entry === 'title' ? 0 : entry === 'active' ? 1 : 2].click());
  const input = container.querySelector('input.w-48') as HTMLInputElement;
  expect(input).not.toBeNull();
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, '新名称');
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
  return input;
}

describe('workspace rename entry points', () => {
  for (const entry of ['title', 'active', 'other'] as const) {
    for (const finish of ['Enter', 'blur', 'canvas'] as const) {
      it(`${entry} commits with ${finish} and exits editing`, async () => {
        const input = await edit(entry);
        await act(async () => {
          if (finish === 'Enter') input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
          else if (finish === 'blur') input.blur();
          else {
            // 画布会阻止默认行为，此时浏览器不会自动让输入框失焦。
            const canvas = document.createElement('div'); document.body.append(canvas);
            canvas.addEventListener('pointerdown', (event) => event.preventDefault());
            const event = new MouseEvent('pointerdown', { bubbles: true, cancelable: true });
            canvas.dispatchEvent(event); expect(event.defaultPrevented).toBe(true); canvas.remove();
          }
        });
        expect(fake.rename).toHaveBeenCalledExactlyOnceWith(entry === 'other' ? 'b' : 'a', '新名称');
        expect(container.querySelector('input.w-48')).toBeNull();
        expect(container.textContent).toContain('新名称');
      });
    }
  }
  it('cancels a dropdown edit and allows starting a new edit', async () => {
    const input = await edit('active');
    await act(async () => input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })));
    expect(fake.rename).not.toHaveBeenCalled(); expect(container.querySelector('input.w-48')).toBeNull();
    const again = await edit('title');
    await act(async () => again.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })));
    expect(fake.rename).toHaveBeenCalledOnce();
  });
  it('does not submit Enter while a Chinese input method is composing', async () => {
    const input = await edit('active');
    await act(async () => input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', isComposing: true, bubbles: true })));
    expect(fake.rename).not.toHaveBeenCalled(); expect(container.querySelector('input.w-48')).toBe(input);
  });
  it('saves when the application window loses focus', async () => {
    await edit('active');
    await act(async () => window.dispatchEvent(new Event('blur')));
    expect(fake.rename).toHaveBeenCalledExactlyOnceWith('a', '新名称');
    expect(container.querySelector('input.w-48')).toBeNull();
  });
});

describe('workspace dropdown outside click', () => {
  it('closes on canvas or card clicks even when they suppress mouse events', async () => {
    for (const className of ['react-flow__pane', 'react-flow__node']) {
      await act(async () => container.querySelector('button')!.click());
      expect(container.querySelector('.max-h-60')).not.toBeNull();
      const outside = document.createElement('div'); outside.className = className;
      const text = document.createElement('span'); outside.append(text); document.body.append(outside);
      outside.addEventListener('pointerdown', (event) => { event.preventDefault(); event.stopPropagation(); });
      await act(async () => text.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true, cancelable: true })));
      expect(container.querySelector('.max-h-60')).toBeNull();
      expect(fake.switch).not.toHaveBeenCalled(); expect(fake.rename).not.toHaveBeenCalled();
      outside.remove();
    }
  });

  it('keeps internal pointer clicks available for workspace selection and reopening', async () => {
    await act(async () => container.querySelector('button')!.click());
    const row = container.querySelectorAll<HTMLButtonElement>('.max-h-60 > button')[1];
    await act(async () => row.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true, cancelable: true })));
    expect(container.querySelector('.max-h-60')).not.toBeNull();
    await act(async () => row.click());
    expect(fake.switch).toHaveBeenCalledExactlyOnceWith('b');
    expect(container.querySelector('.max-h-60')).toBeNull();
    await act(async () => container.querySelector('button')!.click());
    expect(container.querySelector('.max-h-60')).not.toBeNull();
    await act(async () => container.querySelector('button')!.click());
    expect(container.querySelector('.max-h-60')).toBeNull();
  });
});
