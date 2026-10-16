export const isSettingsWindow = () => typeof location !== 'undefined' && new URLSearchParams(location.search).get('view') === 'settings';

// 桌面设置使用同源独立窗口，网页保留弹窗；打开设置不初始化工作区存储。
export async function openSettingsWindow(section = 'general'): Promise<void> {
  const response = await fetch('/api/settings-window', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ section }) });
  if (!response.ok) throw new Error('无法打开设置窗口');
}
