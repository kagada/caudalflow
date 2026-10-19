import { useSettingsStore } from '../stores/settingsStore';

// 无论设置是否已打开，都在应用内定位模型管理，共用同一份设置状态。
export async function openModelSettings(): Promise<void> {
  useSettingsStore.setState({ settingsSection: 'models', showSettings: true });
}
