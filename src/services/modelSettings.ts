import { useSettingsStore } from '../stores/settingsStore';
import { openSettingsWindow } from './settingsWindow';

// 统一模型配置入口，首次挂载、已打开设置及桌面窗口失败回退都定位到模型管理。
export async function openModelSettings(): Promise<void> {
  if (location.protocol === 'app:') {
    try { await openSettingsWindow('models'); return; } catch { /* 桌面窗口打开失败时使用页内设置。 */ }
  }
  useSettingsStore.setState({ settingsSection: 'models', showSettings: true });
  window.dispatchEvent(new CustomEvent('caudalflow:settings-section', { detail: 'models' }));
}
