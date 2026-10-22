import type { WorkspaceData, WorkspaceMetadata } from '../../src/types/workspace';
import type { ChatMessage } from '../../src/types/chat';
import type { StoredWorkspace, SavedWorkspace, DocumentVersion, HistoryDetail, HistoryEntry, HistorySelection } from '../../src/services/storage/types';

export type SqlValue = string | number | null | Uint8Array;
export type SqlRow = Record<string, unknown>;
export interface SqlDriver {
  get(sql: string, params?: SqlValue[]): Promise<SqlRow | undefined>;
  query(sql: string, params?: SqlValue[]): Promise<SqlRow[]>;
  run(sql: string, params?: SqlValue[]): Promise<{ changes: number; lastInsertRowid: number }>;
  exec(sql: string): Promise<void>;
  close(): Promise<void>;
}
export interface SaveOptions {
  expectedRevision?: number; label?: string; history?: boolean;
  historyBefore?: WorkspaceData; historyAfter?: WorkspaceData;
  mergeCreationId?: string; mergeInitializationId?: string;
}
export class WorkspaceDatabase {
  constructor(driver: SqlDriver);
  metadata: WorkspaceMetadata;
  historyFile: string;
  db: SqlDriver;
  open(options: { create?: boolean; metadata?: WorkspaceMetadata; historyFile(id: string): Promise<string> }): Promise<this>;
  readRevision(): Promise<number>;
  load(): Promise<StoredWorkspace>;
  save(data: WorkspaceData, options?: SaveOptions): Promise<SavedWorkspace>;
  rename(name: string): Promise<WorkspaceMetadata>;
  listHistory(): Promise<HistoryEntry[]>;
  readHistory(id: string): Promise<HistoryDetail>;
  restoreHistory(id: string, side?: 'before' | 'after', conversationId?: string, selection?: HistorySelection): Promise<StoredWorkspace>;
  listVersions(id: string): Promise<DocumentVersion[]>;
  readVersion(id: string, version: number): Promise<ChatMessage>;
  referenceCacheGet(key: string): Promise<string | null>;
  referenceCachePut(key: string, summary: string): Promise<boolean>;
  clearHistory(): Promise<boolean>;
  exportTo(path: string): Promise<string>;
  close(): Promise<void>;
}
export const APPLICATION_ID: number;
export const SCHEMA_VERSION: number;
export function EMPTY(): WorkspaceData;
export function validateData(data: WorkspaceData): void;
export function contentOf(data: WorkspaceData): unknown;
