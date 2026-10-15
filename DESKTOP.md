# Electron 桌面版

## 使用

Windows x64 打包文件在 `release/`：

- `CaudalFlow-版本-x64-portable.exe`：免安装，双击运行。
- `CaudalFlow-版本-x64-setup.exe`：安装版，可选择安装目录并创建快捷方式。

使用时不需要 Node.js、终端、Vite 或单独的服务进程。节点聊天使用设置中的 OpenAI 或自定义 OpenAI 兼容 API，流式响应由 Electron 内部转发。联网和 API Key 仍由模型服务商要求。

桌面版的配置和工作区保存在 `%APPDATA%/CaudalFlow` 中。关闭和刷新窗口前会立即保存工作区。免安装版也使用此目录，并非把数据放在 exe 旁边。安装升级使用同一数据目录，卸载默认保留数据。API Key 延续当前的本地存储方式，未加密。

从网页版迁移：在网页右上角导出工作区 JSON，打开桌面版后导入。每个工作区分别导出；API 设置不在工作区导出文件中，需要重新填写。

项目原有的画布 Agent 助手和 Anthropic 原生代理仍依赖额外后端，未包含在安装包里。使用兼容网关时请选择自定义 API。

## 开发和打包

```powershell
npm ci
npm run desktop
npm run desktop:check
npm run desktop:pack
npm run desktop:dist
```

- `desktop`：构建前端，再启动 Electron。
- `desktop:check`：启动隐藏的 Electron 窗口，使用独立临时目录和本地测试 API 验证流式聊天、持久化和导出。不会使用真实密钥或修改用户工作区。
- `desktop:pack`：生成 `release/win-unpacked/CaudalFlow.exe`。
- `desktop:dist`：生成 Windows x64 安装版和免安装版；只生成本地文件，不发布。

首轮打包需要下载 Electron 和 NSIS。当前未配置代码签名证书。

## 性能诊断版

运行 `npm run desktop:dist:diagnostic`，生成 `release/diagnostic/CaudalFlow-版本-x64-diagnostic.exe`。
诊断版使用生产构建并附带源码映射（source map），用于把压缩脚本中的位置还原到原始源码；不修改画布交互逻辑。

关闭原桌面版后再运行诊断版，沿用原来的配置和工作区。打开开发者工具，在设置的 Sources 中启用 JavaScript source maps，然后在 Performance 中重新录制一次框选。
可以在 Sources 中查找 `ChatMessageList.tsx`，确认原始源码可见。导出性能录制时，如提供了源码映射选项，请一并保存源码映射，方便离线分析。
