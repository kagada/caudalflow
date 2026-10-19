/** @vitest-environment jsdom */
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { openModelSettings } from '../modelSettings';
import { useSettingsStore } from '../../stores/settingsStore';
import { openSettingsWindow } from '../settingsWindow';

vi.hoisted(() => { window.matchMedia = vi.fn().mockReturnValue({ matches: false, addEventListener: vi.fn() }); });
vi.mock('../settingsWindow', () => ({ openSettingsWindow: vi.fn(), isSettingsWindow: () => false }));
beforeEach(() => {
  vi.clearAllMocks();
  useSettingsStore.setState({ showSettings: false, settingsSection: 'general' });
  vi.stubGlobal('location', { protocol: 'app:' });
});
afterEach(() => vi.unstubAllGlobals());

it('opens the model section in the desktop settings window', async () => {
  vi.mocked(openSettingsWindow).mockResolvedValue(undefined);
  await openModelSettings();
  expect(openSettingsWindow).toHaveBeenCalledWith('models');
  expect(useSettingsStore.getState().showSettings).toBe(false);
});

it('retains the model section when falling back to an in-page settings panel', async () => {
  vi.mocked(openSettingsWindow).mockRejectedValue(new Error('window unavailable'));
  await openModelSettings();
  expect(useSettingsStore.getState()).toMatchObject({ showSettings: true, settingsSection: 'models' });
});
