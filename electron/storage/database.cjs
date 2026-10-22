// 桌面只管理文件和 Node 驱动；SQLite 表结构及保存规则与安卓共用。
const { DatabaseSync } = require('node:sqlite');
const fs = require('node:fs');
const path = require('node:path');
const core = require('../../shared/storage/workspace.mjs');
const { workspaceHistoryKey } = require('../../shared/storage/bytes.mjs');
const { serializeWorkspace } = require('../../shared/storage/serialized.mjs');

class WorkspaceDatabase extends core.WorkspaceDatabase {
  // 初始化涉及异步 SQL，调用者必须等待 open 完成后再登记或使用文件。
  static async open(filename, historyDirectory, options = {}) {
    if (!options.create && !fs.existsSync(filename)) throw new Error('工作区文件不存在');
    if (options.create) {
      fs.mkdirSync(path.dirname(filename), { recursive: true });
      fs.closeSync(fs.openSync(filename, 'wx'));
    }
    let raw;
    try {
      raw = new DatabaseSync(filename);
      const driver = {
        get: async (sql, params = []) => raw.prepare(sql).get(...params),
        query: async (sql, params = []) => raw.prepare(sql).all(...params),
        run: async (sql, params = []) => {
          const result = raw.prepare(sql).run(...params);
          return { changes: Number(result.changes), lastInsertRowid: Number(result.lastInsertRowid) };
        },
        exec: async sql => raw.exec(sql),
        close: async () => raw.close(),
        // 仅供桌面诊断和现有 SQL 回归测试，不由共用业务调用。
        prepare: sql => raw.prepare(sql),
      };
      const workspace = new WorkspaceDatabase(driver);
      workspace.filename = filename;
      workspace.raw = raw;
      await core.WorkspaceDatabase.prototype.open.call(workspace, {
        ...options,
        historyFile: async id => {
          fs.mkdirSync(historyDirectory, { recursive: true });
          return path.join(historyDirectory, `${await workspaceHistoryKey(id)}.sqlite`);
        },
      });
      return serializeWorkspace(workspace);
    } catch (error) {
      try { raw?.close(); } catch { /* 打开失败时优先保留原始错误。 */ }
      if (options.create && fs.existsSync(filename)) fs.unlinkSync(filename);
      throw error;
    }
  }

  get revision() { return Number(this.raw.prepare("SELECT value FROM workspace_meta WHERE key='revision'").get().value); }

  async exportTo(filename) {
    if (path.resolve(filename) === path.resolve(this.filename)) throw new Error('目标文件不能是当前工作区');
    if (fs.existsSync(filename)) throw new Error('目标文件已存在，请选择新的文件名');
    return super.exportTo(filename);
  }
}

module.exports = { ...core, WorkspaceDatabase };
