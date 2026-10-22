import type { CapacitorConfig } from '@capacitor/cli';

// 正式应用与 SQLite 验证工具使用不同包名，分别保留手机上的工作区。
const config: CapacitorConfig = {
  appId: 'com.caudalflow.learning.android',
  appName: 'CaudalFlow',
  webDir: 'dist',
  plugins: { CapacitorSQLite: { androidIsEncryption: false } },
};
export default config;
