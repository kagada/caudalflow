const { Worker } = require('node:worker_threads');
const path = require('node:path');

// 主进程只负责文件选择和请求转发；数据库驱动不暴露给网页。
function createStorageService(root, dialog, getWindow) {
  const worker = new Worker(path.join(__dirname, 'worker.cjs'), { workerData: { root } });
  let serial = 0;
  const pending = new Map();
  let failure;
  let closing;
  worker.on('message', ({ requestId, result, error }) => {
    const request = pending.get(requestId);
    if (!request) return;
    pending.delete(requestId);
    if (error) request.reject(new Error(error)); else request.resolve(result);
  });
  const fail = (error) => {
    failure = error;
    for (const request of pending.values()) request.reject(error);
    pending.clear();
  };
  worker.on('error', fail);
  worker.on('exit', (code) => { if (code !== 0) fail(new Error(`存储线程异常退出 (${code})`)); });
  const call = (action, payload) => new Promise((resolve, reject) => {
    if (failure) { reject(failure); return; }
    const requestId = ++serial;
    pending.set(requestId, { resolve, reject });
    worker.postMessage({ requestId, action, payload });
  });
  return {
    call,
    async handle(action, payload = {}) {
      const allowed = ['bootstrap', 'list', 'load', 'save', 'create', 'open', 'rename', 'delete', 'export', 'history', 'historyDetail', 'restore', 'clearHistory', 'versions', 'version'];
      if (!allowed.includes(action)) throw new Error('未知存储操作');
      if (action === 'create' || action === 'export') {
        const picked = await dialog.showSaveDialog(getWindow(), { title: action === 'create' ? '新建工作区' : '保存工作区副本', defaultPath: `${payload.name ?? 'workspace'}.caudalflow`, filters: [{ name: 'CaudalFlow SQLite', extensions: ['caudalflow'] }] });
        if (picked.canceled) return null;
        payload = { ...payload, filename: picked.filePath };
      } else if (action === 'open') {
        const picked = await dialog.showOpenDialog(getWindow(), { title: '打开工作区', properties: ['openFile'], filters: [{ name: 'CaudalFlow SQLite', extensions: ['caudalflow', 'sqlite', 'db'] }] });
        if (picked.canceled) return null;
        payload = { filename: picked.filePaths[0] };
      } else if (Object.hasOwn(payload, 'filename')) throw new Error('文件路径必须由应用文件选择器提供');
      return call(action, payload);
    },
    close() { return closing ??= (async () => { try { await call('close'); } finally { await worker.terminate(); } })(); },
  };
}

module.exports = { createStorageService };
