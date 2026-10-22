import { Capacitor } from '@capacitor/core';

export type RuntimePlatform = 'android' | 'desktop' | 'web' | 'unsupported';

// 先识别原生宿主，安卓 WebView 的 https 地址不能触发浏览器 localStorage 路径。
export function detectPlatform(nativePlatform = Capacitor.getPlatform(), protocol = globalThis.location?.protocol, hostname = globalThis.location?.hostname): RuntimePlatform {
  if (nativePlatform === 'android') return 'android';
  if (nativePlatform !== 'web') return 'unsupported';
  if (protocol === 'app:' && hostname === 'caudalflow') return 'desktop';
  return 'web';
}

export const isAndroid = () => detectPlatform() === 'android';
export const usesSqliteStorage = () => detectPlatform() !== 'web';
