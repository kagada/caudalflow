/** @vitest-environment jsdom */
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { openModelSettings } from '../modelSettings';
import { useSettingsStore } from '../../stores/settingsStore';

vi.hoisted(() => { window.matchMedia = vi.fn().mockReturnValue({ matches: false, addEventListener: vi.fn() }); });
beforeEach(() => {
  vi.clearAllMocks();
  useSettingsStore.setState({ showSettings: false, settingsSection: 'general' });
  vi.stubGlobal('location', { protocol: 'app:' });
});
afterEach(() => vi.unstubAllGlobals());

it('opens model management inside the desktop app', async () => {
  await openModelSettings();
  expect(useSettingsStore.getState()).toMatchObject({ showSettings: true, settingsSection: 'models' });
});

it('switches an already open settings panel to model management', async () => {
  useSettingsStore.setState({ showSettings: true, settingsSection: 'prompts' });
  await openModelSettings();
  expect(useSettingsStore.getState()).toMatchObject({ showSettings: true, settingsSection: 'models' });
});
