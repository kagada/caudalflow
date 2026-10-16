const { app, BrowserWindow, Menu, net, protocol, shell, session, dialog, clipboard } = require('electron');
const path = require('node:path');
const { APP_ORIGIN, createProtocolHandler } = require('./protocol.cjs');

app.setName('CaudalFlow');
protocol.registerSchemesAsPrivileged([{ scheme: 'app', privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true, stream: true } }]);

// 自检使用独立数据目录，不能读写用户的真实工作区和密钥。
const smokeTest = process.argv.includes('--smoke-test');
if (smokeTest) app.setPath('userData', path.join(app.getPath('temp'), `caudalflow-desktop-smoke-${process.pid}`));

let mainWindow;
let storageService;
let closing = false;

function openExternal(url) {
  if (['https:', 'http:'].includes(new URL(url).protocol)) void shell.openExternal(url);
}

// 刷新和退出都先暂停生成并落盘，不能依赖 beforeunload 的异步保存。
function reloadWindow() {
  if (!mainWindow) return;
  void mainWindow.webContents.executeJavaScript('window.caudalflowPrepareClose ? window.caudalflowPrepareClose() : Promise.resolve()').then(() => mainWindow?.webContents.reload()).catch((error) => dialog.showErrorBox('保存失败，未刷新', error.message));
}

// 窗口只加载自带界面，资料中的外部链接交给系统浏览器。
function createWindow() {
  mainWindow = new BrowserWindow({
    title: 'CaudalFlow',
    width: 1440,
    height: 960,
    minWidth: 900,
    minHeight: 640,
    backgroundColor: '#0a0a0a',
    show: false,
    autoHideMenuBar: true,
    webPreferences: { nodeIntegration: false, contextIsolation: true, sandbox: true, webSecurity: true, offscreen: smokeTest },
  });
  mainWindow.once('ready-to-show', () => { if (!smokeTest) mainWindow.show(); });
  // 在 Electron 默认关闭窗口前拦截 Ctrl+W，交给界面关闭当前卡片。
  mainWindow.webContents.on('before-input-event', (event, input) => {
    if (input.type === 'keyDown' && ((input.control && input.key.toLowerCase() === 'r') || input.key === 'F5')) {
      event.preventDefault(); reloadWindow(); return;
    }
    if (input.type === 'keyDown' && input.control && !input.shift && !input.alt && input.key.toLowerCase() === 'w') {
      event.preventDefault();
      void mainWindow.webContents.executeJavaScript("window.dispatchEvent(new Event('caudalflow-close-active-card'))");
    }
  });
  mainWindow.webContents.setWindowOpenHandler(({ url }) => { openExternal(url); return { action: 'deny' }; });
  mainWindow.webContents.on('will-navigate', (event, url) => {
    if (url !== `${APP_ORIGIN}/`) { event.preventDefault(); openExternal(url); }
  });
  mainWindow.webContents.on('did-fail-load', (_event, code, description) => {
    if (code !== -3 && !smokeTest) dialog.showErrorBox('CaudalFlow 启动失败', description);
  });
  mainWindow.on('closed', () => { mainWindow = null; });
  // 异步落盘完成后才关闭窗口，不能依赖 beforeunload 中来不及结束的网络请求。
  mainWindow.on('close', (event) => {
    if (closing || smokeTest) return;
    event.preventDefault();
    void mainWindow.webContents.executeJavaScript('window.caudalflowPrepareClose ? window.caudalflowPrepareClose() : Promise.resolve()').then(() => {
      closing = true; mainWindow?.close();
    }).catch((error) => { dialog.showErrorBox('保存失败，窗口未关闭', error.message); });
  });
  void mainWindow.loadURL(`${APP_ORIGIN}/`);
}

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.show();
      mainWindow.focus();
    }
  });
  app.whenReady().then(() => {
    storageService = require('./storage/service.cjs').createStorageService(app.getPath('userData'), dialog, () => mainWindow);
    protocol.handle('app', createProtocolHandler(path.join(app.getAppPath(), 'dist'), net.fetch, storageService, clipboard));
    session.defaultSession.setPermissionRequestHandler((_contents, permission, callback) => callback(permission === 'clipboard-sanitized-write'));
    session.defaultSession.on('will-download', (_event, item) => item.setSaveDialogOptions({ title: '导出学习工作区' }));
    Menu.setApplicationMenu(Menu.buildFromTemplate([
      { label: '文件', submenu: [{ label: '退出', role: 'quit' }] },
      { label: '编辑', submenu: [{ role: 'undo', label: '撤销' }, { role: 'redo', label: '重做' }, { type: 'separator' }, { role: 'cut', label: '剪切' }, { role: 'copy', label: '复制' }, { role: 'paste', label: '粘贴' }, { role: 'selectAll', label: '全选' }] },
      { label: '视图', submenu: [{ label: '刷新', click: reloadWindow }, { role: 'togglefullscreen', label: '全屏' }, { role: 'toggleDevTools', label: '开发者工具' }] },
    ]));
    createWindow();
    if (smokeTest) require('./storage-smoke.cjs').runSmokeTest(mainWindow, app, storageService);
    app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });
  }).catch((error) => {
    if (smokeTest) { console.error(error); app.exit(1); }
    else { dialog.showErrorBox('CaudalFlow 启动失败', error.message); app.quit(); }
  });
  app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });
  app.on('will-quit', () => { void storageService?.close(); });
}
