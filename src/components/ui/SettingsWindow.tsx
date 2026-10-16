import { useEffect } from 'react';
import { SettingsPanel } from './SettingsPanel';
import { PromptSettingsPanel } from './PromptSettingsPanel';
import { useSettingsStore } from '../../stores/settingsStore';

// 独立入口不挂载画布、聊天助手或工作区保存订阅。
export function SettingsWindow() {
  const showPresets = useSettingsStore((state) => state.showPromptSettings);
  useEffect(() => {
    if (new URLSearchParams(location.search).get('section') === 'presets') useSettingsStore.getState().setShowPromptSettings(true);
  }, []);
  return <><SettingsPanel standalone />{showPresets && <PromptSettingsPanel />}</>;
}
