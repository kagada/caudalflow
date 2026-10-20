/** @vitest-environment jsdom */
import { StrictMode, act, useState } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useCancelLayer } from '../useCancelLayer';
import { cancelUI, handleBackButton } from '../../services/uiCancel';
import { SettingsPanel } from '../../components/ui/SettingsPanel';
import { PromptSettingsPanel } from '../../components/ui/PromptSettingsPanel';
import { useSettingsStore } from '../../stores/settingsStore';

vi.hoisted(() => { window.matchMedia = vi.fn().mockReturnValue({ matches: false, addEventListener: vi.fn() }); });
let root: Root;
let host: HTMLDivElement;

function Layer({ close, level = 1000 }: { close: () => void; level?: number }) {
  useCancelLayer(true, close, level);
  return null;
}

// 设置使用真实组件；卡片仅模拟最大化状态，验证它与设置共享同一取消顺序。
function ReadingView() {
  const [maximized, setMaximized] = useState(true);
  const prompts = useSettingsStore(state => state.showPromptSettings);
  useCancelLayer(maximized, () => setMaximized(false), 1000);
  return <>
    {maximized && <div data-testid="maximized">阅读视图</div>}
    <SettingsPanel />
    {prompts && <PromptSettingsPanel />}
  </>;
}

beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  useSettingsStore.setState({ showSettings: false, showPromptSettings: false, settingsSection: 'general' });
  host = document.createElement('div'); document.body.append(host); root = createRoot(host);
});
afterEach(async () => { await act(async () => root.unmount()); host.remove(); vi.unstubAllGlobals(); expect(cancelUI()).toBe(false); });

describe('cancel layer lifecycle and real settings', () => {
  it.each(['escape', 'android'])('closes settings before the maximized view, then permits leaving: %s', async source => {
    await act(async () => root.render(<ReadingView />));
    await act(async () => useSettingsStore.setState({ showSettings: true }));
    const leave = vi.fn().mockResolvedValue(undefined);
    const back = () => act(async () => {
      if (source === 'escape') window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
      else await handleBackButton(leave);
    });
    await back(); expect(useSettingsStore.getState().showSettings).toBe(false);
    expect(host.querySelector('[data-testid="maximized"]')).not.toBeNull(); expect(leave).not.toHaveBeenCalled();
    await back(); expect(host.querySelector('[data-testid="maximized"]')).toBeNull();
    await back(); expect(leave).toHaveBeenCalledTimes(source === 'android' ? 1 : 0);
  });

  it('removes a settings layer closed with its button and cleans StrictMode registrations', async () => {
    useSettingsStore.setState({ showSettings: true });
    await act(async () => root.render(<StrictMode><ReadingView /></StrictMode>));
    await act(async () => document.querySelector<HTMLButtonElement>('[role="dialog"][aria-label="设置"] button[aria-label]')!.click());
    await act(async () => cancelUI());
    expect(host.querySelector('[data-testid="maximized"]')).toBeNull();
  });

  it('keeps same-level order across rerenders and calls the latest close callback', async () => {
    const old = vi.fn(), latest = vi.fn(), underneath = vi.fn();
    await act(async () => root.render(<><Layer close={underneath} /><Layer close={old} /></>));
    await act(async () => root.render(<><Layer close={() => underneath()} /><Layer close={latest} /></>));
    cancelUI(); expect(latest).toHaveBeenCalledOnce(); expect(old).not.toHaveBeenCalled(); expect(underneath).not.toHaveBeenCalled();
  });

  it('closes a prompt panel above settings without closing settings on the same Escape', async () => {
    await act(async () => root.render(<ReadingView />));
    await act(async () => useSettingsStore.setState({ showSettings: true }));
    await act(async () => useSettingsStore.setState({ showPromptSettings: true }));
    await act(async () => window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' })));
    expect(useSettingsStore.getState().showPromptSettings).toBe(false);
    expect(useSettingsStore.getState().showSettings).toBe(true);
    expect(host.querySelector('[data-testid="maximized"]')).not.toBeNull();
  });
});
