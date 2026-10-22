import { CapacitorSQLite, SQLiteConnection } from '@capacitor-community/sqlite';
import type { SqlDriver, SqlValue } from '../../../shared/storage/workspace.mjs';

const connections = new SQLiteConnection(CapacitorSQLite);
let startup: Promise<unknown> | undefined;
const parameters = (values: SqlValue[]) => values.map(value => value instanceof Uint8Array ? { type: 'Buffer', data: Array.from(value) } : value);

// 插件的连接和 BLOB 表示只在这里转换，上层保留同一份 SQL 与业务规则。
export async function openAndroidSqlite(name: string): Promise<SqlDriver> {
  // WebView 重载后 JavaScript 对象已重建，先关闭原生层遗留连接再重新登记。
  startup ??= connections.checkConnectionsConsistency().catch(error => { startup = undefined; throw error; });
  await startup;
  const conn = await connections.createConnection(name, false, 'no-encryption', 4, false);
  try { await conn.open(); }
  catch (error) { await connections.closeConnection(name, false).catch(() => {}); throw error; }
  const query = async (sql: string, values: SqlValue[] = []) => (await conn.query(sql, parameters(values))).values ?? [];
  return {
    query,
    async get(sql, values = []) { return (await query(sql, values))[0]; },
    async run(sql, values = []) {
      const result = await conn.run(sql, parameters(values), false);
      return { changes: result.changes?.changes ?? 0, lastInsertRowid: Number(result.changes?.lastId ?? 0) };
    },
    async exec(sql) {
      // 共用业务拥有事务，禁止插件为每条写入再创建、提交自己的事务。
      if (sql.trim() === 'BEGIN IMMEDIATE') { await conn.beginTransaction(); return; }
      if (sql.trim() === 'COMMIT') { await conn.commitTransaction(); return; }
      if (sql.trim() === 'ROLLBACK') { await conn.rollbackTransaction(); return; }
      await conn.execute(sql, false);
    },
    async close() { await conn.close(); await connections.closeConnection(name, false); },
  };
}
