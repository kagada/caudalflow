// 工作区保存规范化的当前内容和文档版本；个人恢复记录只写入独立历史文件。
const { DatabaseSync } = require('node:sqlite');
const { randomUUID, createHash } = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

const APPLICATION_ID = 0x43464c57;
const SCHEMA_VERSION = 1;
const EMPTY = () => ({ nodes: [], edges: [], conversations: {} });
const hash = (value) => createHash('sha256').update(value).digest('hex');
const canonical = (value) => Array.isArray(value) ? value.map(canonical) : value && typeof value === 'object' ? Object.fromEntries(Object.keys(value).sort().filter((key) => value[key] !== undefined).map((key) => [key, canonical(value[key])])) : value;

// 入口校验失败就中止整次写入，不用“空工作区”覆盖损坏或不兼容的数据。
function validateData(data) {
  if (!data || !Array.isArray(data.nodes) || !Array.isArray(data.edges) || !data.conversations || typeof data.conversations !== 'object') throw new Error('工作区数据格式无效');
  const nodes = new Set();
  const documents = new Set();
  for (const node of data.nodes) {
    if (!node.id || nodes.has(node.id) || typeof node.data?.topic !== 'string' || !Number.isFinite(node.position?.x) || !Number.isFinite(node.position?.y)) throw new Error('会话 ID、标题或位置无效');
    nodes.add(node.id);
    for (const message of data.conversations[node.id]?.messages ?? []) {
      if (!message.id || documents.has(message.id) || !['user', 'assistant', 'system'].includes(message.role) || typeof message.content !== 'string' || !Number.isFinite(message.timestamp)) throw new Error('文档 ID、角色、正文或时间无效');
      documents.add(message.id);
      for (const image of message.images ?? []) {
        if (typeof image.mimeType !== 'string' || typeof image.base64 !== 'string' || !/^[A-Za-z0-9+/]*={0,2}$/.test(image.base64)) throw new Error('图片数据无效');
      }
    }
  }
  const edges = new Set();
  for (const edge of data.edges) {
    if (!edge.id || edges.has(edge.id) || !nodes.has(edge.source) || !nodes.has(edge.target)) throw new Error('连线 ID 重复或来源会话不存在');
    edges.add(edge.id);
  }
}

// 内容快照不携带布局和流式临时状态，避免布局整理污染内容历史。
function contentOf(data) {
  return {
    nodes: data.nodes.map((node) => {
      const { collapsed, minimized, maximized, _prevWidth, _prevHeight, _prevX, _prevY, ...content } = node.data;
      void collapsed; void minimized; void maximized; void _prevWidth; void _prevHeight; void _prevX; void _prevY;
      return { id: node.id, data: { ...content, done: Boolean(content.done) } };
    }),
    edges: data.edges.map(({ id, source, target, data }) => ({ id, source, target, data })),
    conversations: Object.fromEntries(data.nodes.map(({ id }) => [id, (data.conversations[id]?.messages ?? []).map(({ previousVersions, versionId, ...message }) => {
      void previousVersions; void versionId;
      return message;
    })])),
  };
}

class WorkspaceDatabase {
  constructor(filename, historyDirectory, options = {}) {
    this.filename = filename;
    const exists = fs.existsSync(filename);
    if (!exists && !options.create) throw new Error('工作区文件不存在');
    if (options.create) {
      fs.mkdirSync(path.dirname(filename), { recursive: true });
      // 独占创建，避免文件选择后出现同名文件时误覆盖或误清理用户数据。
      fs.closeSync(fs.openSync(filename, 'wx'));
    }
    this.db = new DatabaseSync(filename);
    try {
      const appId = this.db.prepare('PRAGMA application_id').get().application_id;
      const version = this.db.prepare('PRAGMA user_version').get().user_version;
      if (!options.create && (appId !== APPLICATION_ID || version !== SCHEMA_VERSION)) throw new Error('这不是支持的 CaudalFlow 工作区文件');
      this.db.exec('PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000; PRAGMA journal_mode=DELETE; PRAGMA synchronous=FULL;');
      if (options.create) this.initialize(options.metadata);
      this.metadata = JSON.parse(this.db.prepare('SELECT value FROM workspace_meta WHERE key=?').get('metadata').value);
      fs.mkdirSync(historyDirectory, { recursive: true });
      // ATTACH 配合回滚日志，让工作区和独立历史参与同一事务；不使用破坏跨库原子性的 WAL。
      // 历史绑定工作区身份而非文件路径，同一设备上搬运文件后仍能找回自己的记录。
      this.historyFile = path.join(historyDirectory, `${hash(this.metadata.id)}.sqlite`);
      this.db.prepare('ATTACH DATABASE ? AS personal').run(this.historyFile);
      this.db.exec(`PRAGMA personal.journal_mode=DELETE; PRAGMA personal.synchronous=FULL;
        CREATE TABLE IF NOT EXISTS personal.history (
          id TEXT PRIMARY KEY, created_at INTEGER NOT NULL, label TEXT NOT NULL,
          before_json TEXT NOT NULL, after_json TEXT NOT NULL, bytes INTEGER NOT NULL
        );
        CREATE INDEX IF NOT EXISTS personal.history_time ON history(created_at);`);
    } catch (error) {
      this.db.close();
      if (options.create && fs.existsSync(filename)) fs.unlinkSync(filename);
      throw error;
    }
  }

  initialize(metadata) {
    if (!metadata?.id || !metadata.name) throw new Error('缺少工作区信息');
    this.db.exec(`BEGIN IMMEDIATE;
      PRAGMA application_id=${APPLICATION_ID}; PRAGMA user_version=${SCHEMA_VERSION};
      CREATE TABLE workspace_meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
      CREATE TABLE conversations (id TEXT PRIMARY KEY, ordinal INTEGER NOT NULL, topic TEXT NOT NULL, label TEXT, done INTEGER NOT NULL, color TEXT, metadata_json TEXT NOT NULL);
      CREATE TABLE conversation_layouts (conversation_id TEXT PRIMARY KEY REFERENCES conversations(id) ON DELETE CASCADE, x REAL NOT NULL, y REAL NOT NULL, layout_json TEXT NOT NULL);
      CREATE TABLE documents (id TEXT PRIMARY KEY, conversation_id TEXT NOT NULL REFERENCES conversations(id) ON DELETE CASCADE, role TEXT NOT NULL CHECK(role IN ('user','assistant','system')), created_at INTEGER NOT NULL);
      CREATE INDEX documents_conversation ON documents(conversation_id);
      CREATE TABLE document_versions (id TEXT PRIMARY KEY, document_id TEXT NOT NULL REFERENCES documents(id) ON DELETE CASCADE, content TEXT NOT NULL, reasoning TEXT, created_at INTEGER NOT NULL, fingerprint TEXT NOT NULL, metadata_json TEXT NOT NULL, UNIQUE(document_id,fingerprint), UNIQUE(document_id,id));
      CREATE TABLE conversation_documents (conversation_id TEXT NOT NULL REFERENCES conversations(id) ON DELETE CASCADE, document_id TEXT NOT NULL REFERENCES documents(id) ON DELETE CASCADE, position INTEGER NOT NULL, version_id TEXT NOT NULL, PRIMARY KEY(conversation_id,document_id), UNIQUE(conversation_id,position), FOREIGN KEY(document_id,version_id) REFERENCES document_versions(document_id,id));
      CREATE TABLE assets (id TEXT PRIMARY KEY, mime_type TEXT NOT NULL, bytes BLOB NOT NULL);
      CREATE TABLE version_assets (version_id TEXT NOT NULL REFERENCES document_versions(id) ON DELETE CASCADE, asset_id TEXT NOT NULL REFERENCES assets(id), position INTEGER NOT NULL, PRIMARY KEY(version_id,position));
      CREATE TABLE relations (id TEXT PRIMARY KEY, source_id TEXT NOT NULL REFERENCES conversations(id) ON DELETE CASCADE, target_id TEXT NOT NULL REFERENCES conversations(id) ON DELETE CASCADE, ordinal INTEGER NOT NULL, data_json TEXT NOT NULL);
      CREATE TABLE generation_drafts (document_id TEXT PRIMARY KEY REFERENCES documents(id) ON DELETE CASCADE, content TEXT NOT NULL, reasoning TEXT, updated_at INTEGER NOT NULL, images_json TEXT NOT NULL);`);
    this.db.prepare('INSERT INTO workspace_meta VALUES (?,?)').run('metadata', JSON.stringify(metadata));
    this.db.prepare('INSERT INTO workspace_meta VALUES (?,?)').run('revision', '0');
    this.db.exec('COMMIT');
  }

  get revision() { return Number(this.db.prepare('SELECT value FROM workspace_meta WHERE key=?').get('revision').value); }

  // 只从组织关系读取当前版本；旧版本仍以相同文档 ID 归组，不复制整份会话。
  load() {
    const data = EMPTY();
    for (const row of this.db.prepare('SELECT c.*,l.x,l.y,l.layout_json FROM conversations c JOIN conversation_layouts l ON l.conversation_id=c.id ORDER BY c.ordinal').all()) {
      const layout = JSON.parse(row.layout_json);
      data.nodes.push({ ...layout.node, id: row.id, type: 'chat', position: { x: row.x, y: row.y }, data: { ...JSON.parse(row.metadata_json), ...layout.data, topic: row.topic, ...(row.label !== null ? { label: row.label } : {}), ...(row.color !== null ? { color: row.color } : {}), done: Boolean(row.done) } });
      data.conversations[row.id] = { nodeId: row.id, messages: [], isStreaming: false };
    }
    const images = this.db.prepare('SELECT a.mime_type,a.bytes FROM version_assets va JOIN assets a ON a.id=va.asset_id WHERE va.version_id=? ORDER BY va.position');
    for (const row of this.db.prepare('SELECT d.*,v.id AS version_id,v.content,v.reasoning,v.metadata_json FROM conversation_documents cd JOIN documents d ON d.id=cd.document_id JOIN document_versions v ON v.id=cd.version_id ORDER BY cd.conversation_id,cd.position').all()) {
      const message = { id: row.id, role: row.role, timestamp: row.created_at, versionId: row.version_id, content: row.content, ...JSON.parse(row.metadata_json) };
      if (row.reasoning !== null) message.reasoning = row.reasoning;
      const attached = images.all(row.version_id).map((image) => ({ mimeType: image.mime_type, base64: Buffer.from(image.bytes).toString('base64') }));
      if (attached.length) message.images = attached;
      const draft = this.db.prepare('SELECT * FROM generation_drafts WHERE document_id=?').get(row.id);
      if (draft) {
        message.content = draft.content; message.reasoning = draft.reasoning ?? undefined;
        message.images = JSON.parse(draft.images_json); message.generationStatus = 'interrupted';
      }
      data.conversations[row.conversation_id].messages.push(message);
    }
    for (const row of this.db.prepare('SELECT * FROM relations ORDER BY ordinal').all()) data.edges.push({ ...JSON.parse(row.data_json), id: row.id, source: row.source_id, target: row.target_id });
    return { metadata: this.metadata, revision: this.revision, data };
  }

  // 固定版本只插入不覆盖；相同内容可复用原版本，让撤销不制造伪新版本。
  version(documentId, message, importedTime) {
    const { content, reasoning, timestamp, images = [], id, role, previousVersions, versionId, ...extra } = message;
    void id; void role; void previousVersions; void versionId;
    const fingerprint = hash(JSON.stringify({ content, reasoning: reasoning ?? null, images, extra }));
    const existing = this.db.prepare('SELECT id FROM document_versions WHERE document_id=? AND fingerprint=?').get(documentId, fingerprint);
    if (existing) return existing.id;
    const newId = versionId && !this.db.prepare('SELECT id FROM document_versions WHERE id=?').get(versionId) ? versionId : randomUUID();
    const alreadyVersioned = this.db.prepare('SELECT 1 FROM document_versions WHERE document_id=? LIMIT 1').get(documentId);
    this.db.prepare('INSERT INTO document_versions VALUES (?,?,?,?,?,?,?)').run(newId, documentId, content, reasoning ?? null, importedTime ?? (alreadyVersioned ? Date.now() : timestamp), fingerprint, JSON.stringify(extra));
    images.forEach((image, index) => {
      const bytes = Buffer.from(image.base64, 'base64');
      const assetId = hash(Buffer.concat([Buffer.from(image.mimeType), bytes]));
      this.db.prepare('INSERT OR IGNORE INTO assets VALUES (?,?,?)').run(assetId, image.mimeType, bytes);
      this.db.prepare('INSERT INTO version_assets VALUES (?,?,?)').run(newId, assetId, index);
    });
    return newId;
  }

  // expectedRevision 防止另一窗口或旧请求覆盖更新后的工作区。
  save(data, { expectedRevision, label = '修改内容', history = true, historyBefore, historyAfter } = {}) {
    validateData(data);
    if (expectedRevision !== undefined && expectedRevision !== this.revision) throw new Error('工作区已被其他操作更新，请重新打开后再修改');
    const previous = this.load().data;
    if (historyBefore) validateData(historyBefore);
    if (historyAfter) validateData(historyAfter);
    const before = JSON.stringify(canonical(contentOf(historyBefore ?? previous)));
    const after = JSON.stringify(canonical(contentOf(historyAfter ?? data)));
    const streaming = Object.values(data.conversations).some((conversation) => conversation.isStreaming);
    this.db.exec('BEGIN IMMEDIATE');
    try {
      // 暂时移除当前选用关系，版本内容保持不可变；所有替换在同一事务内对外不可见。
      this.db.exec('DELETE FROM conversation_documents; DELETE FROM relations;');
      const present = new Set(data.nodes.map((node) => node.id));
      for (const row of this.db.prepare('SELECT id FROM conversations').all()) if (!present.has(row.id)) this.db.prepare('DELETE FROM conversations WHERE id=?').run(row.id);
      data.nodes.forEach((node, ordinal) => {
        const { topic, label: nodeLabel, done, color, collapsed, minimized, maximized, _prevWidth, _prevHeight, _prevX, _prevY, ...metadata } = node.data;
        void maximized;
        const { id, data: ignoredData, position, selected, dragging, resizing, measured, ...rest } = node;
        void ignoredData; void position; void selected; void dragging; void resizing; void measured;
        this.db.prepare('INSERT INTO conversations VALUES (?,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET ordinal=excluded.ordinal,topic=excluded.topic,label=excluded.label,done=excluded.done,color=excluded.color,metadata_json=excluded.metadata_json').run(id, ordinal, topic, nodeLabel ?? null, done ? 1 : 0, color ?? null, JSON.stringify(metadata));
        this.db.prepare('INSERT INTO conversation_layouts VALUES (?,?,?,?) ON CONFLICT(conversation_id) DO UPDATE SET x=excluded.x,y=excluded.y,layout_json=excluded.layout_json').run(id, node.position.x, node.position.y, JSON.stringify({ node: rest, data: { collapsed, minimized, _prevWidth, _prevHeight, _prevX, _prevY } }));
        const conversation = data.conversations[id];
        const messages = conversation?.messages ?? [];
        const currentDocuments = new Set(messages.map((message) => message.id));
        for (const row of this.db.prepare('SELECT id FROM documents WHERE conversation_id=?').all()) if (!currentDocuments.has(row.id)) this.db.prepare('DELETE FROM documents WHERE id=?').run(row.id);
        messages.forEach((message, index) => {
          this.db.prepare('INSERT INTO documents VALUES (?,?,?,?) ON CONFLICT(id) DO UPDATE SET role=excluded.role').run(message.id, id, message.role, message.timestamp);
          const owner = this.db.prepare('SELECT conversation_id FROM documents WHERE id=?').get(message.id);
          if (owner.conversation_id !== id) throw new Error('同一文档不能属于两个会话');
          for (const old of message.previousVersions ?? []) this.version(message.id, { ...message, ...old, images: message.images ?? [] }, old.timestamp);
          const generating = conversation?.isStreaming && message.id === (conversation.streamingMessageId ?? messages.at(-1)?.id);
          let selectedVersion;
          if (generating) {
            selectedVersion = this.db.prepare('SELECT id FROM document_versions WHERE document_id=? ORDER BY rowid DESC LIMIT 1').get(message.id)?.id ?? this.version(message.id, { ...message, content: '', reasoning: undefined, images: [] });
            this.db.prepare('INSERT INTO generation_drafts VALUES (?,?,?,?,?) ON CONFLICT(document_id) DO UPDATE SET content=excluded.content,reasoning=excluded.reasoning,updated_at=excluded.updated_at,images_json=excluded.images_json').run(message.id, message.content, message.reasoning ?? null, Date.now(), JSON.stringify(message.images ?? []));
          } else {
            selectedVersion = this.version(message.id, message);
            this.db.prepare('DELETE FROM generation_drafts WHERE document_id=?').run(message.id);
          }
          this.db.prepare('INSERT INTO conversation_documents VALUES (?,?,?,?)').run(id, message.id, index, selectedVersion);
        });
      });
      data.edges.forEach((edge, ordinal) => {
        const { id, source, target, selected, ...rest } = edge;
        void selected;
        this.db.prepare('INSERT INTO relations VALUES (?,?,?,?,?)').run(id, source, target, ordinal, JSON.stringify(rest));
      });
      // 当前未设计固定旧版本引用；保留当前及最近 49 个旧版本，个人历史另有期限。
      for (const row of this.db.prepare('SELECT id FROM documents').all()) {
        this.db.prepare('DELETE FROM document_versions WHERE id IN (SELECT id FROM document_versions WHERE document_id=? AND id NOT IN (SELECT version_id FROM conversation_documents) ORDER BY rowid DESC LIMIT -1 OFFSET 49)').run(row.id);
      }
      if (history && (!streaming || historyAfter) && before !== after) {
        const beforeJson = JSON.stringify(historyBefore ?? previous);
        const afterJson = JSON.stringify(historyAfter ?? data);
        this.db.prepare('INSERT INTO personal.history VALUES (?,?,?,?,?,?)').run(randomUUID(), Date.now(), label, beforeJson, afterJson, Buffer.byteLength(beforeJson) + Buffer.byteLength(afterJson));
        this.pruneHistory();
      }
      // 附件只有在所有功能版本都不再使用时才清理，个人历史自带恢复所需的图片数据。
      this.db.exec('DELETE FROM assets WHERE id NOT IN (SELECT asset_id FROM version_assets)');
      const revision = this.revision + 1;
      this.db.prepare('UPDATE workspace_meta SET value=? WHERE key=?').run(String(revision), 'revision');
      this.metadata = { ...this.metadata, updatedAt: Date.now() };
      this.db.prepare('UPDATE workspace_meta SET value=? WHERE key=?').run(JSON.stringify(this.metadata), 'metadata');
      this.db.exec('COMMIT');
      const versions = Object.fromEntries(this.db.prepare('SELECT document_id,version_id FROM conversation_documents').all().map((row) => [row.document_id, row.version_id]));
      return { revision, versions };
    } catch (error) {
      this.db.exec('ROLLBACK');
      throw error;
    }
  }

  pruneHistory() {
    this.db.prepare('DELETE FROM personal.history WHERE created_at < ?').run(Date.now() - 30 * 86400000);
    const rows = this.db.prepare('SELECT id,bytes FROM personal.history ORDER BY created_at DESC,rowid DESC').all();
    let bytes = 0;
    rows.forEach((row, index) => {
      bytes += row.bytes;
      if (index >= 200 || (bytes > 64 * 1024 * 1024 && index > 0)) this.db.prepare('DELETE FROM personal.history WHERE id=?').run(row.id);
    });
  }

  listHistory() {
    return this.db.prepare('SELECT id,created_at AS createdAt,label,bytes,before_json,after_json FROM personal.history ORDER BY created_at DESC,rowid DESC').all().flatMap(({ before_json, after_json, ...row }) => ['after', 'before'].map((side) => ({ ...row, side, conversations: JSON.parse(side === 'before' ? before_json : after_json).nodes.map((node) => ({ id: node.id, topic: node.data.topic })) })));
  }

  // 恢复不是可撤销操作；保留现有卡片的布局，删除或新增卡片使用历史记录中的布局。
  restoreHistory(id, side = 'after', conversationId) {
    const row = this.db.prepare('SELECT before_json,after_json FROM personal.history WHERE id=?').get(id);
    if (!row) throw new Error('本地历史已不存在');
    let data = JSON.parse(side === 'before' ? row.before_json : row.after_json);
    const currentData = this.load().data;
    const current = new Map(currentData.nodes.map((node) => [node.id, node]));
    if (conversationId) {
      const node = data.nodes.find((item) => item.id === conversationId);
      if (!node) throw new Error('该历史版本中没有此会话');
      const ids = new Set([...currentData.nodes.map((item) => item.id), conversationId]);
      data = {
        nodes: [...currentData.nodes.filter((item) => item.id !== conversationId), node],
        conversations: { ...currentData.conversations, [conversationId]: data.conversations[conversationId] ?? { nodeId: conversationId, messages: [], isStreaming: false } },
        edges: [...currentData.edges.filter((edge) => edge.source !== conversationId && edge.target !== conversationId), ...data.edges.filter((edge) => (edge.source === conversationId || edge.target === conversationId) && ids.has(edge.source) && ids.has(edge.target))],
      };
    }
    data.nodes = data.nodes.map((node) => {
      const layout = current.get(node.id);
      return layout ? { ...node, position: layout.position, style: layout.style, data: { ...node.data, collapsed: layout.data.collapsed, minimized: layout.data.minimized, maximized: false } } : node;
    });
    for (const conversation of Object.values(data.conversations)) { conversation.isStreaming = false; delete conversation.streamingMessageId; }
    this.save(data, { history: false });
    return this.load();
  }

  listVersions(documentId) {
    return this.db.prepare('SELECT id,created_at AS createdAt,substr(content,1,100) AS preview FROM document_versions WHERE document_id=? ORDER BY rowid DESC').all(documentId);
  }

  // 切换版本只读取已保存结果，由上层内容操作选择它，不重新请求模型。
  readVersion(documentId, versionId) {
    const row = this.db.prepare('SELECT d.role,d.created_at AS document_created_at,v.* FROM document_versions v JOIN documents d ON d.id=v.document_id WHERE v.document_id=? AND v.id=?').get(documentId, versionId);
    if (!row) throw new Error('文档版本不存在');
    const images = this.db.prepare('SELECT a.mime_type,a.bytes FROM version_assets va JOIN assets a ON a.id=va.asset_id WHERE va.version_id=? ORDER BY va.position').all(versionId).map((asset) => ({ mimeType: asset.mime_type, base64: Buffer.from(asset.bytes).toString('base64') }));
    return { ...JSON.parse(row.metadata_json), id: documentId, versionId, role: row.role, timestamp: row.document_created_at, content: row.content, ...(row.reasoning !== null ? { reasoning: row.reasoning } : {}), ...(images.length ? { images } : {}) };
  }

  rename(name) {
    if (!name?.trim()) throw new Error('工作区名称不能为空');
    this.metadata = { ...this.metadata, name: name.trim(), updatedAt: Date.now() };
    this.db.prepare('UPDATE workspace_meta SET value=? WHERE key=?').run(JSON.stringify(this.metadata), 'metadata');
    return this.metadata;
  }

  // 生成完整一致的工作区副本；personal 是附加数据库，不会进入 main 的备份。
  exportTo(filename) {
    if (path.resolve(filename) === path.resolve(this.filename)) throw new Error('目标文件不能是当前工作区');
    if (fs.existsSync(filename)) throw new Error('目标文件已存在，请选择新的文件名');
    this.db.prepare('VACUUM main INTO ?').run(filename);
    return filename;
  }

  close() { this.db.close(); }
}

module.exports = { WorkspaceDatabase, validateData, contentOf, APPLICATION_ID, SCHEMA_VERSION, EMPTY };
