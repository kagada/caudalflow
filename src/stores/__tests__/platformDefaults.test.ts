/** @vitest-environment jsdom */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { RuntimePlatform } from '../../services/platform';

const runtime = vi.hoisted(() => {
  window.matchMedia = vi.fn().mockReturnValue({ matches: false, addEventListener: vi.fn() });
  return { platform: 'web' as RuntimePlatform };
});
vi.mock('../../services/platform', () => ({ detectPlatform: () => runtime.platform }));

beforeEach(() => { vi.resetModules(); localStorage.clear(); runtime.platform = 'web'; });

describe('device defaults and persisted preferences', () => {
  it.each(['android', 'desktop', 'web'] as const)('uses the correct defaults on a fresh %s installation', async platform => {
    runtime.platform = platform;
    const { useSettingsStore } = await import('../settingsStore');
    expect(useSettingsStore.getState().openCompactCardsMaximized).toBe(platform === 'android');
    expect(useSettingsStore.getState().theme).toBe('dark');
    expect(useSettingsStore.getState().llmConfig.model).toBe('');
  });

  it('fills the new Android option for old preferences without resetting other choices', async () => {
    runtime.platform = 'android';
    localStorage.setItem('caudalflow-settings', JSON.stringify({ version: 0, state: { theme: 'light', language: 'zh', showMinimap: false } }));
    const { useSettingsStore } = await import('../settingsStore');
    expect(useSettingsStore.getState()).toMatchObject({ openCompactCardsMaximized: true, theme: 'light', language: 'zh', showMinimap: false });
  });

  it.each([['android', false], ['desktop', true]] as const)('preserves an explicit %s preference after restart', async (platform, enabled) => {
    runtime.platform = platform;
    localStorage.setItem('caudalflow-settings', JSON.stringify({ version: 0, state: { openCompactCardsMaximized: enabled } }));
    const { useSettingsStore } = await import('../settingsStore');
    expect(useSettingsStore.getState().openCompactCardsMaximized).toBe(enabled);
    useSettingsStore.getState().setOpenCompactCardsMaximized(!enabled);
    expect(JSON.parse(localStorage.getItem('caudalflow-settings')!).state.openCompactCardsMaximized).toBe(!enabled);
    await useSettingsStore.persist.rehydrate();
    expect(useSettingsStore.getState().openCompactCardsMaximized).toBe(!enabled);
  });
});
