# Electron 桌面版

## 使用

Windows x64 打包文件在 `release/`：

- `CaudalFlow-版本-x64-portable.exe`：免安装，双击运行。
- `CaudalFlow-版本-x64-setup.exe`：安装版，可选择安装目录并创建快捷方式。

使用时不需要 Node.js、终端、Vite 或单独的服务进程。节点聊天使用设置中的 OpenAI 或自定义 OpenAI 兼容 API，流式响应由 Electron 内部转发。联网和 API Key 仍由模型服务商要求。

桌面版工作区使用 SQLite 文件，扩展名为 `.caudalflow`。新建工作区时选择保存位置；工具栏的文件夹按钮打开已有文件，下载按钮保存不含个人历史的工作区副本。关闭应用后也可直接复制或搬运文件，重新打开即可。

配置、最近工作区目录和个人本地历史保存在 `%APPDATA%/CaudalFlow`，免安装版也使用此目录。API Key 延续当前 localStorage 的存储方式，未加密，不进入工作区文件。安装升级使用同一数据目录，卸载默认保留数据。

第一次启动新版会将原 localStorage 工作区迁移到 `%APPDATA%/CaudalFlow/workspaces/`，在 `legacy-backups/` 保留原始 JSON 备份，并保留原 localStorage 数据。迁移失败会显示错误，不用空数据覆盖原内容；再次启动可重试。迁移后的工作区可以关闭应用后搬到其他位置，再用文件夹按钮打开。

问题和回答各有稳定文档 ID，不同内容保存为不可变版本，会话记录顺序及当前选用版本。消息右键菜单中的“文档版本”可以切换版本；该操作可以撤销。当前每条文档最多保留 50 个功能版本，它们随工作区文件一起搬运；会话删除等个人操作恢复记录另存在 `local-history/`，不随文件分享。

工具栏提供撤销、重做和本地历史。画布中可使用 Ctrl+Z、Ctrl+Shift+Z 或 Ctrl+Y；输入框仍使用文字编辑自身的撤销。内容恢复保留现有卡片布局，拖动、缩放、尺寸和折叠不进入内容操作栈。重启后撤销队列清空，本地历史继续保留。

本地历史可以选择操作前或操作后的整个工作区，也可只还原某个会话。还原不可撤销，并清空当前工作区撤销／重做队列。历史默认保留最近 30 天，最多 200 次操作、约 64 MiB 的记录内容，可手动清空；单条超大记录可超过该容量目标，数据库清理后可复用空闲页，不保证立即缩小文件。删除工作区会删除文件及对应本地历史，不提供撤销或恢复入口。

流式回复使用独立草稿检查点，不为每个 token 创建版本；中断后重新打开会保留已落盘的部分内容。关闭、刷新或切换工作区时先停止生成并完成保存；保存失败会保留界面内存中的内容并阻止正常关闭，允许重试。

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

开发及测试需要 Node.js 22.13 或更新版本，推荐 Node.js 24。SQLite 使用 Electron 自带的 `node:sqlite`，无额外原生扩展依赖；SQL 在独立工作线程执行，通过异步接口访问。工作区和个人历史采用回滚日志及附加数据库事务，不使用 WAL，以保持一次内容修改和历史记录的跨文件提交一致性。浏览器版此次继续沿用 localStorage，未实现 Web SQLite 后端。

首轮打包需要下载 Electron 和 NSIS。当前未配置代码签名证书。

## 性能诊断版

运行 `npm run desktop:dist:diagnostic`，生成 `release/diagnostic/CaudalFlow-版本-x64-diagnostic.exe`。
诊断版使用生产构建并附带源码映射（source map），用于把压缩脚本中的位置还原到原始源码；不修改画布交互逻辑。

关闭原桌面版后再运行诊断版，沿用原来的配置和工作区。打开开发者工具，在设置的 Sources 中启用 JavaScript source maps，然后在 Performance 中重新录制一次框选。
可以在 Sources 中查找 `ChatMessageList.tsx`，确认原始源码可见。导出性能录制时，如提供了源码映射选项，请一并保存源码映射，方便离线分析。
