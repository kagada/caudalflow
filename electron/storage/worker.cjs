// 所有 SQLite 查询在此线程串行执行，避免阻塞 Electron 主进程和渲染界面。
const { parentPort, workerData } = require('node:worker_threads');
const { DatabaseSync } = require('node:sqlite');
const fs = require('node:fs');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
const { WorkspaceDatabase, EMPTY } = require('./database.cjs');

const root = workerData.root;
fs.mkdirSync(root, { recursive: true });
const catalog = new DatabaseSync(path.join(root, 'workspace-catalog.sqlite'));
catalog.exec(`PRAGMA journal_mode=DELETE; PRAGMA synchronous=FULL;
  CREATE TABLE IF NOT EXISTS workspaces (id TEXT PRIMARY KEY, path TEXT NOT NULL UNIQUE);
  CREATE TABLE IF NOT EXISTS app_meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);`);
const historyDirectory = path.join(root, 'local-history');
const connections = new Map();

async function database(id) {
  if (connections.has(id)) return connections.get(id);
  const entry = catalog.prepare('SELECT path FROM workspaces WHERE id=?').get(id);
  if (!entry) throw new Error('工作区未登记');
  const connection = await WorkspaceDatabase.open(entry.path, historyDirectory);
  connections.set(id, connection);
  return connection;
}

async function list() {
  return Promise.all(catalog.prepare('SELECT id,path FROM workspaces ORDER BY rowid').all().map(async (entry) => {
    try { return { ...(await database(entry.id)).metadata, filePath: entry.path }; }
    catch { return { id: entry.id, name: path.basename(entry.path), filePath: entry.path, unavailable: true, createdAt: 0, updatedAt: 0 }; }
  }));
}

async function create({ id = randomUUID(), name = '新工作区', filename, data = EMPTY(), createdAt }) {
  if (!/^[A-Za-z0-9_-]{1,128}$/.test(id)) throw new Error('工作区 ID 无效');
  const destination = filename ?? path.join(root, 'workspaces', `${id}.caudalflow`);
  if (fs.existsSync(destination)) throw new Error('工作区文件已存在，请选择新文件名');
  const now = Date.now();
  let connection;
  try {
    connection = await WorkspaceDatabase.open(destination, historyDirectory, { create: true, metadata: { id, name, createdAt: createdAt ?? now, updatedAt: now } });
    await connection.save(data, { history: false });
    catalog.prepare('INSERT INTO workspaces VALUES (?,?)').run(id, destination);
    connections.set(id, connection);
    return { ...await connection.load(), metadata: { ...connection.metadata, filePath: destination } };
  } catch (error) {
    await connection?.close();
    // 只清理本次独占创建的文件，不删除用户预先存在的文件。
    if (connection && fs.existsSync(destination)) fs.unlinkSync(destination);
    throw error;
  }
}

// 迁移前备份原字符串，迁移成功标记按工作区记录，失败后可重试且不重复创建。
async function bootstrap({ legacy = [], registryRaw } = {}) {
  if (!catalog.prepare('SELECT value FROM app_meta WHERE key=?').get('legacy-migrated')) {
    if (typeof registryRaw === 'string') {
      const backupRoot = path.join(root, 'legacy-backups'); fs.mkdirSync(backupRoot, { recursive: true });
      const registryBackup = path.join(backupRoot, 'workspaces.json');
      if (!fs.existsSync(registryBackup)) fs.writeFileSync(registryBackup, registryRaw, { flag: 'wx' });
    }
    for (const item of legacy) {
      if (catalog.prepare('SELECT id FROM workspaces WHERE id=?').get(item.metadata.id)) continue;
      const backupRoot = path.join(root, 'legacy-backups');
      fs.mkdirSync(backupRoot, { recursive: true });
      const backupId = require('node:crypto').createHash('sha256').update(item.metadata.id).digest('hex');
      const backupPath = path.join(backupRoot, `${backupId}.json`);
      if (!fs.existsSync(backupPath)) fs.writeFileSync(backupPath, item.raw, { flag: 'wx' });
      const parsed = JSON.parse(item.raw);
      await create({ id: item.metadata.id, name: item.metadata.name, data: parsed, createdAt: item.metadata.createdAt });
    }
    catalog.prepare('INSERT OR REPLACE INTO app_meta VALUES (?,?)').run('legacy-migrated', '1');
  }
  if (!(await list()).length) await create({ name: 'My Workspace' });
  return { workspaces: await list() };
}

const handlers = {
  bootstrap,
  list,
  load: async ({ id }) => (await database(id)).load(),
  save: async ({ id, data, ...options }) => (await database(id)).save(data, options),
  create,
  open: async ({ filename }) => {
    const connection = await WorkspaceDatabase.open(filename, historyDirectory);
    const id = connection.metadata.id;
    // 文件被用户搬走或打开同一工作区副本时，更新最近位置；旧文件不改写。
    await connections.get(id)?.close(); connections.set(id, connection);
    catalog.prepare('INSERT OR REPLACE INTO workspaces VALUES (?,?)').run(id, filename);
    return { ...await connection.load(), metadata: { ...connection.metadata, filePath: filename } };
  },
  rename: async ({ id, name }) => (await database(id)).rename(name),
  delete: async ({ id }) => {
    const connection = await database(id);
    const filename = connection.filename;
    const historyFile = connection.historyFile;
    await connection.close(); connections.delete(id);
    fs.unlinkSync(filename);
    if (fs.existsSync(historyFile)) fs.unlinkSync(historyFile);
    catalog.prepare('DELETE FROM workspaces WHERE id=?').run(id);
    return list();
  },
  export: async ({ id, filename }) => (await database(id)).exportTo(filename),
  history: async ({ id }) => (await database(id)).listHistory(),
  referenceCacheGet: async ({ id, key }) => (await database(id)).referenceCacheGet(key),
  referenceCachePut: async ({ id, key, summary }) => (await database(id)).referenceCachePut(key, summary),
  historyDetail: async ({ id, historyId }) => (await database(id)).readHistory(historyId),
  restore: async ({ id, historyId, side, conversationId, selection }) => (await database(id)).restoreHistory(historyId, side, conversationId, selection),
  versions: async ({ id, documentId }) => (await database(id)).listVersions(documentId),
  version: async ({ id, documentId, versionId }) => (await database(id)).readVersion(documentId, versionId),
  clearHistory: async ({ id }) => (await database(id)).clearHistory(),
  close: async () => {
    for (const connection of connections.values()) await connection.close();
    connections.clear(); catalog.close();
    return true;
  },
};

// 旧实现同步完成一条请求；改为异步后仍保留这个顺序，避免打开、保存和删除相互穿插。
let queue = Promise.resolve();
parentPort.on('message', ({ requestId, action, payload }) => {
  queue = queue.then(async () => {
    try {
      if (!Object.hasOwn(handlers, action)) throw new Error('未知存储操作');
      parentPort.postMessage({ requestId, result: await handlers[action](payload ?? {}) });
    } catch (error) {
      parentPort.postMessage({ requestId, error: error.message });
    }
  });
});
