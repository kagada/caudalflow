// 共用 SQLite 业务：平台只提供异步 SQL 接口，不在这里访问 Node 或安卓文件系统。
import { decodeBase64, encodeBase64, utf8Length } from './bytes.mjs';
import { restoreSelection } from './historyRestore.mjs';
const APPLICATION_ID = 0x43464c57;
const SCHEMA_VERSION = 4;
const EMPTY = () => ({ nodes: [], edges: [], conversations: {} });
const canonical = (value) => Array.isArray(value) ? value.map(canonical) : value && typeof value === 'object' ? Object.fromEntries(Object.keys(value).sort().filter((key) => value[key] !== undefined).map((key) => [key, canonical(value[key])])) : value;
// 请求用量按 ID 合并，内容恢复时保留已经发生的消耗。
const mergeUsage = (...lists) => {
    const records = new Map();
    for (const list of lists)
        for (const record of list ?? []) {
            const previous = records.get(record.id);
            records.set(record.id, previous && previous.status !== 'pending' && record.status === 'pending' ? previous : { ...previous, ...record });
        }
    return [...records.values()];
};
const usageJson = (records) => records.length ? JSON.stringify(records) : null;
const readUsage = (json) => JSON.parse(json ?? '[]').map((record) => record.status === 'pending' ? { ...record, status: 'interrupted' } : record);
// 回答占位符没有可恢复的内容；思考或图片本身也算有效内容。
const isEmptyAnswer = (message) => message.role === 'assistant' && (message.kind ?? 'message') === 'message'
    && !message.content.trim() && !message.reasoning?.trim() && !message.images?.length;
// 版本只比较可变化的内容，类型固定归文档，不为正文额外保存指纹。
const versionContent = (message) => canonical({
    content: message.kind === 'reference' ? message.reference.summary : message.content,
    reasoning: message.reasoning ?? null, images: message.images ?? [],
    reference: message.reference ? { ...message.reference, sources: message.reference.sources.map((source) => ({ ...source, images: source.images ?? [] })) } : undefined,
    referenceForId: message.referenceForId, replyToId: message.replyToId,
    triggeredBy: message.triggeredBy, generationStatus: message.generationStatus,
});
// 入口校验失败就中止整次写入，不用“空工作区”覆盖损坏或不兼容的数据。
function validateData(data) {
    if (!data || !Array.isArray(data.nodes) || !Array.isArray(data.edges) || !data.conversations || typeof data.conversations !== 'object')
        throw new Error('工作区数据格式无效');
    const nodes = new Set();
    const documents = new Set();
    for (const node of data.nodes) {
        if (!node.id || nodes.has(node.id) || typeof node.data?.topic !== 'string' || !Number.isFinite(node.position?.x) || !Number.isFinite(node.position?.y))
            throw new Error('会话 ID、标题或位置无效');
        nodes.add(node.id);
        for (const message of data.conversations[node.id]?.messages ?? []) {
            if (!message.id || documents.has(message.id) || !['user', 'assistant', 'system'].includes(message.role) || typeof message.content !== 'string' || !Number.isFinite(message.timestamp))
                throw new Error('文档 ID、角色、正文或时间无效');
            if (!['message', 'reference'].includes(message.kind ?? 'message'))
                throw new Error('文档类型无效');
            if (message.versionId !== undefined && (!Number.isSafeInteger(message.versionId) || message.versionId <= 0))
                throw new Error('文档版本 ID 无效');
            if (message.kind === 'reference') {
                const reference = message.reference;
                if (message.role !== 'system' || !reference || typeof reference.id !== 'string' || typeof reference.summary !== 'string' || typeof reference.quote !== 'string' ||
                    !Array.isArray(reference.sources) || !reference.sources.length || !reference.sources.every((source) => source && typeof source.workspaceId === 'string' &&
                    typeof source.conversationId === 'string' && typeof source.documentId === 'string' && typeof source.title === 'string' && typeof source.documentText === 'string' &&
                    (source.versionId === undefined || (Number.isSafeInteger(source.versionId) && source.versionId > 0)) &&
                    Number.isInteger(source.start) && Number.isInteger(source.length) && source.start >= 0 && source.length >= 0 && source.start + source.length <= source.documentText.length))
                    throw new Error('引用快照或来源位置无效');
            }
            documents.add(message.id);
            for (const image of message.images ?? []) {
                if (typeof image.mimeType !== 'string' || typeof image.base64 !== 'string' || !/^[A-Za-z0-9+/]*={0,2}$/.test(image.base64))
                    throw new Error('图片数据无效');
            }
        }
    }
    const edges = new Set();
    for (const edge of data.edges) {
        if (!edge.id || edges.has(edge.id) || !nodes.has(edge.source) || !nodes.has(edge.target))
            throw new Error('连线 ID 重复或来源会话不存在');
        edges.add(edge.id);
    }
}
// 内容快照不携带布局和流式临时状态，避免布局整理污染内容历史。
function contentOf(data) {
    return {
        nodes: data.nodes.map((node) => {
            const { collapsed, minimized, maximized, ...content } = node.data;
            void collapsed;
            void minimized;
            void maximized;
            return { id: node.id, data: { ...content, done: Boolean(content.done) } };
        }),
        edges: data.edges.map(({ id, source, target, data }) => ({ id, source, target, data })),
        conversations: Object.fromEntries(data.nodes.map(({ id }) => [id, (data.conversations[id]?.messages ?? []).map(({ previousVersions, versionId, usage, ...message }) => {
                void previousVersions;
                void versionId;
                void usage;
                return { ...message, kind: message.kind ?? 'message' };
            })])),
    };
}
// 数据库独立验证初始化的后续变化，不能因渲染进程请求合并就跨过其他修改。
function isInitializationStep(before, after, id) {
    const oldNode = before.nodes.find((node) => node.id === id);
    const nextNode = after.nodes.find((node) => node.id === id);
    if (!oldNode || !nextNode)
        return false;
    const oldMessages = before.conversations[id]?.messages ?? [];
    const nextMessages = after.conversations[id]?.messages ?? [];
    const questions = oldMessages.filter((message) => message.role === 'user');
    if (questions.length !== 1 || nextMessages.filter((message) => message.role === 'user').length !== 1)
        return false;
    const title = oldNode.data.titleSource === 'temporary' && nextNode.data.titleSource === 'generated';
    const oldAnswers = oldMessages.filter((message) => message.role === 'assistant');
    const nextAnswers = nextMessages.filter((message) => message.role === 'assistant');
    const reply = oldAnswers.length === 0 && nextAnswers.length === 1 && (!nextAnswers[0].replyToId || nextAnswers[0].replyToId === questions[0].id);
    if (!title && !reply)
        return false;
    const normalized = JSON.parse(JSON.stringify(after));
    if (title)
        normalized.nodes.find((node) => node.id === id).data = { ...nextNode.data, topic: oldNode.data.topic, titleSource: oldNode.data.titleSource };
    if (reply)
        normalized.conversations[id].messages = nextMessages.filter((message) => message.id !== nextAnswers[0].id);
    return JSON.stringify(canonical(contentOf(before))) === JSON.stringify(canonical(contentOf(normalized)));
}
class WorkspaceDatabase {
    constructor(database) { this.db = database; }
    // 平台负责连接和文件路径，共用部分保留格式升级、历史和数据规则。
    async open(options = {}) {
        const appId = (await this.db.get('PRAGMA application_id')).application_id;
        const version = (await this.db.get('PRAGMA user_version')).user_version;
        if (!options.create && appId !== APPLICATION_ID)
            throw new Error('这不是支持的 CaudalFlow 工作区文件');
        if (!options.create && version !== SCHEMA_VERSION && version !== 3)
            throw new Error('工作区文件版本不受支持，请新建工作区或选择新版文件');
        await this.db.query('PRAGMA busy_timeout=5000');
        await this.db.query('PRAGMA journal_mode=DELETE');
        await this.db.exec('PRAGMA foreign_keys=ON;\nPRAGMA synchronous=FULL;');
        if (options.create)
            await this.initialize(options.metadata);
        else if (version === 3) {
            await this.db.exec('BEGIN IMMEDIATE');
            try {
                await this.db.exec('ALTER TABLE conversations ADD COLUMN usage_json TEXT;\nALTER TABLE documents ADD COLUMN usage_json TEXT;\nPRAGMA user_version=4;');
                await this.db.exec('COMMIT');
            }
            catch (error) {
                await this.db.exec('ROLLBACK');
                throw error;
            }
        }
        this.metadata = JSON.parse((await this.db.get('SELECT value FROM workspace_meta WHERE key=?', ['metadata'])).value);
        this.historyFile = await options.historyFile(this.metadata.id);
        await this.db.run('ATTACH DATABASE ? AS personal', [this.historyFile]);
        await this.db.query('PRAGMA personal.journal_mode=DELETE');
        await this.db.exec(`PRAGMA personal.synchronous=FULL;
      CREATE TABLE IF NOT EXISTS personal.history (id TEXT PRIMARY KEY, created_at INTEGER NOT NULL, label TEXT NOT NULL, before_json TEXT NOT NULL, after_json TEXT NOT NULL, bytes INTEGER NOT NULL);
      CREATE INDEX IF NOT EXISTS personal.history_time ON history(created_at);`);
        return this;
    }
    async initialize(metadata) {
        if (!metadata?.id || !metadata.name)
            throw new Error('缺少工作区信息');
        await this.db.exec('BEGIN IMMEDIATE');
        try {
        (await this.db.exec(`PRAGMA application_id=${APPLICATION_ID};
      PRAGMA user_version=${SCHEMA_VERSION};
      CREATE TABLE workspace_meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
      CREATE TABLE conversations (id TEXT PRIMARY KEY, ordinal INTEGER NOT NULL, topic TEXT NOT NULL, label TEXT, done INTEGER NOT NULL, color TEXT, metadata_json TEXT NOT NULL, usage_json TEXT);
      CREATE TABLE conversation_layouts (
        conversation_id TEXT PRIMARY KEY REFERENCES conversations(id) ON DELETE CASCADE,
        x REAL NOT NULL, y REAL NOT NULL, width REAL NOT NULL CHECK(width>0), height REAL NOT NULL CHECK(height>0),
        z_index INTEGER NOT NULL, collapsed INTEGER NOT NULL, minimized INTEGER NOT NULL);
      CREATE TABLE documents (
        id TEXT PRIMARY KEY, conversation_id TEXT NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
        position INTEGER NOT NULL, role TEXT NOT NULL CHECK(role IN ('user','assistant','system')),
        kind TEXT NOT NULL DEFAULT 'message' CHECK(kind IN ('message','reference')),
        content TEXT NOT NULL, reasoning TEXT, created_at INTEGER NOT NULL,
        current_version_id INTEGER REFERENCES document_versions(id) DEFERRABLE INITIALLY DEFERRED,
        reply_to_id TEXT, triggered_by TEXT, reference_for_id TEXT, generation_status TEXT, usage_json TEXT,
        UNIQUE(conversation_id,position));
      CREATE TABLE document_versions (
        id INTEGER PRIMARY KEY AUTOINCREMENT, document_id TEXT NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
        content TEXT NOT NULL, reasoning TEXT, created_at INTEGER NOT NULL,
        reply_to_id TEXT, triggered_by TEXT, reference_for_id TEXT, generation_status TEXT);
      CREATE INDEX document_versions_document ON document_versions(document_id);
      CREATE TABLE attachments (id INTEGER PRIMARY KEY, mime_type TEXT NOT NULL, bytes BLOB NOT NULL);
      CREATE TABLE version_attachments (version_id INTEGER NOT NULL REFERENCES document_versions(id) ON DELETE CASCADE, attachment_id INTEGER NOT NULL REFERENCES attachments(id), position INTEGER NOT NULL, PRIMARY KEY(version_id,position));
      CREATE TABLE document_references (
        version_id INTEGER PRIMARY KEY REFERENCES document_versions(id) ON DELETE CASCADE,
        reference_id TEXT NOT NULL, snapshot_key TEXT NOT NULL, summary TEXT NOT NULL, quote TEXT NOT NULL,
        created_at INTEGER NOT NULL, summary_input_json TEXT);
      CREATE TABLE reference_sources (
        version_id INTEGER NOT NULL REFERENCES document_references(version_id) ON DELETE CASCADE, position INTEGER NOT NULL,
        workspace_id TEXT NOT NULL, conversation_id TEXT NOT NULL, document_id TEXT NOT NULL, source_version_id INTEGER,
        title TEXT NOT NULL, document_text TEXT NOT NULL, start INTEGER NOT NULL, length INTEGER NOT NULL,
        PRIMARY KEY(version_id,position));
      CREATE TABLE reference_source_attachments (
        version_id INTEGER NOT NULL, source_position INTEGER NOT NULL, position INTEGER NOT NULL,
        attachment_id INTEGER NOT NULL REFERENCES attachments(id), PRIMARY KEY(version_id,source_position,position),
        FOREIGN KEY(version_id,source_position) REFERENCES reference_sources(version_id,position) ON DELETE CASCADE);
      CREATE TABLE relations (id TEXT PRIMARY KEY, source_id TEXT NOT NULL REFERENCES conversations(id) ON DELETE CASCADE, target_id TEXT NOT NULL REFERENCES conversations(id) ON DELETE CASCADE, position INTEGER NOT NULL, label TEXT);
      CREATE TABLE reference_summaries (key TEXT PRIMARY KEY, summary TEXT NOT NULL, created_at INTEGER NOT NULL);
      CREATE TABLE generation_drafts (document_id TEXT PRIMARY KEY REFERENCES documents(id) ON DELETE CASCADE, content TEXT NOT NULL, reasoning TEXT, updated_at INTEGER NOT NULL, images_json TEXT NOT NULL);`));
        (await this.db.run('INSERT INTO workspace_meta VALUES (?,?)', ['metadata', JSON.stringify(metadata)]));
        (await this.db.run('INSERT INTO workspace_meta VALUES (?,?)', ['revision', '0']));
        (await this.db.exec('COMMIT'));
        } catch (error) { await this.rollback(error); throw error; }
    }
    async readRevision() { return Number((await this.db.get('SELECT value FROM workspace_meta WHERE key=?', ['revision'])).value); }
    async referenceCacheGet(key) {
        if (typeof key !== 'string' || !/^[A-Za-z0-9_-]{22}$/.test(key))
            throw new Error('摘要标识无效');
        return (await this.db.get('SELECT summary FROM reference_summaries WHERE key=?', [key]))?.summary ?? null;
    }
    async referenceCachePut(key, summary) {
        if (typeof key !== 'string' || !/^[A-Za-z0-9_-]{22}$/.test(key) || typeof summary !== 'string' || !summary.trim() || summary.length > 200000)
            throw new Error('摘要内容无效');
        (await this.db.run('INSERT OR REPLACE INTO reference_summaries VALUES (?,?,?)', [key, summary, Date.now()]));
        (await this.db.exec('DELETE FROM reference_summaries WHERE key IN (SELECT key FROM reference_summaries ORDER BY created_at DESC,rowid DESC LIMIT -1 OFFSET 500)'));
        return true;
    }
    // 当前正文与顺序直接属于文档，画布默认类型不逐条存储。
    async load() {
        const data = EMPTY();
        for (const row of (await this.db.query('SELECT c.*,l.x,l.y,l.width,l.height,l.z_index,l.collapsed,l.minimized FROM conversations c JOIN conversation_layouts l ON l.conversation_id=c.id ORDER BY c.ordinal', []))) {
            data.nodes.push({ id: row.id, type: 'chat', position: { x: row.x, y: row.y }, style: { width: row.width, height: row.height }, zIndex: row.z_index,
                data: { ...JSON.parse(row.metadata_json), collapsed: Boolean(row.collapsed), minimized: Boolean(row.minimized), maximized: false, topic: row.topic, ...(row.label !== null ? { label: row.label } : {}), ...(row.color !== null ? { color: row.color } : {}), done: Boolean(row.done) } });
            const usage = readUsage(row.usage_json);
            data.conversations[row.id] = { nodeId: row.id, messages: [], isStreaming: false, ...(usage.length ? { usage } : {}) };
        }
        for (const row of (await this.db.query('SELECT *,current_version_id AS version_id FROM documents ORDER BY conversation_id,position', []))) {
            const message = (await this.messageFromRow(row, row.id, row.created_at));
            const draft = (await this.db.get('SELECT * FROM generation_drafts WHERE document_id=?', [row.id]));
            if (draft) {
                message.content = draft.content;
                message.reasoning = draft.reasoning ?? undefined;
                message.images = JSON.parse(draft.images_json);
                message.generationStatus = 'interrupted';
            }
            data.conversations[row.conversation_id].messages.push(message);
        }
        for (const row of (await this.db.query('SELECT * FROM relations ORDER BY position', [])))
            data.edges.push({ id: row.id, source: row.source_id, target: row.target_id,
                sourceHandle: 'right', targetHandle: 'left', type: 'topic', data: row.label === null ? {} : { label: row.label } });
        return { metadata: this.metadata, revision: (await this.readRevision()), data };
    }
    // 引用主体和来源独立读取，来源被删除后，保留的原文和图片仍可使用。
    async messageFromRow(row, documentId, timestamp) {
        const message = { id: documentId, role: row.role, kind: row.kind, timestamp, ...(row.version_id !== null ? { versionId: row.version_id } : {}), content: row.content };
        const usage = readUsage(row.usage_json);
        if (usage.length)
            message.usage = usage;
        for (const [column, property] of [['reasoning', 'reasoning'], ['reply_to_id', 'replyToId'], ['triggered_by', 'triggeredBy'], ['reference_for_id', 'referenceForId'], ['generation_status', 'generationStatus']]) {
            if (row[column] !== null)
                message[property] = row[column];
        }
        const images = (await this.db.query('SELECT a.mime_type,a.bytes FROM version_attachments va JOIN attachments a ON a.id=va.attachment_id WHERE va.version_id=? ORDER BY va.position', [row.version_id]));
        if (images.length)
            message.images = images.map((image) => ({ mimeType: image.mime_type, base64: encodeBase64(image.bytes) }));
        if (row.kind === 'reference') {
            const reference = (await this.db.get('SELECT * FROM document_references WHERE version_id=?', [row.version_id]));
            if (!reference)
                throw new Error('引用内容不存在');
            const sources = (await Promise.all((await this.db.query('SELECT * FROM reference_sources WHERE version_id=? ORDER BY position', [row.version_id])).map(async (source) => {
                const sourceImages = (await this.db.query('SELECT a.mime_type,a.bytes FROM reference_source_attachments ra JOIN attachments a ON a.id=ra.attachment_id WHERE ra.version_id=? AND ra.source_position=? ORDER BY ra.position', [row.version_id, source.position]));
                return { workspaceId: source.workspace_id, conversationId: source.conversation_id, documentId: source.document_id,
                    ...(source.source_version_id !== null ? { versionId: source.source_version_id } : {}), title: source.title,
                    documentText: source.document_text, start: source.start, length: source.length,
                    ...(sourceImages.length ? { images: sourceImages.map((image) => ({ mimeType: image.mime_type, base64: encodeBase64(image.bytes) })) } : {}) };
            })));
            message.reference = { id: reference.reference_id, snapshotKey: reference.snapshot_key, summary: reference.summary,
                quote: reference.quote, createdAt: reference.created_at, sources,
                ...(reference.summary_input_json !== null ? { summaryInput: JSON.parse(reference.summary_input_json) } : {}) };
            message.content = reference.summary;
        }
        return message;
    }
    // 整数 ID 只负责关联，附件按实际字节复用，不把长哈希当主键。
    async attachment(image) {
        const bytes = decodeBase64(image.base64);
        const existing = (await this.db.get('SELECT id FROM attachments WHERE mime_type=? AND bytes=?', [image.mimeType, bytes]));
        return existing?.id ?? (await this.db.run('INSERT INTO attachments(mime_type,bytes) VALUES (?,?)', [image.mimeType, bytes])).lastInsertRowid;
    }
    // 只比较实际内容；当前版本优先，避免重复保存和撤销产生伪新版本。
    async version(documentId, message, importedTime) {
        const expected = JSON.stringify(versionContent(message));
        const candidates = (await this.db.query(`SELECT v.*,v.id AS version_id,d.role,d.kind FROM document_versions v JOIN documents d ON d.id=v.document_id
      WHERE document_id=? AND v.content=? AND v.reasoning IS ? AND v.reply_to_id IS ? AND v.triggered_by IS ? AND v.reference_for_id IS ? AND v.generation_status IS ?
      ORDER BY (v.id=?) DESC,v.id DESC`, [documentId, message.kind === 'reference' ? '' : message.content,
            message.reasoning ?? null, message.replyToId ?? null, message.triggeredBy ?? null, message.referenceForId ?? null, message.generationStatus ?? null, message.versionId ?? null]));
        for (const row of candidates) {
            if (JSON.stringify(versionContent((await this.messageFromRow(row, documentId, message.timestamp)))) === expected)
                return row.id;
        }
        // 只阻止新回答产生空版本；已有版本仍可选用，导入的旧历史也必须原样保留。
        if (importedTime === undefined && isEmptyAnswer(message))
            return null;
        // 撤销可恢复被清理的原编号；已占用编号绝不重绑到另一篇文档。
        const preferredId = message.versionId && !(await this.db.get('SELECT id FROM document_versions WHERE id=?', [message.versionId])) ? message.versionId : null;
        const alreadyVersioned = (await this.db.get('SELECT 1 FROM document_versions WHERE document_id=? LIMIT 1', [documentId]));
        const newId = Number((await this.db.run('INSERT INTO document_versions VALUES (?,?,?,?,?,?,?,?,?)', [preferredId, documentId,
            message.kind === 'reference' ? '' : message.content, message.reasoning ?? null, importedTime ?? (alreadyVersioned ? Date.now() : message.timestamp),
            message.replyToId ?? null, message.triggeredBy ?? null, message.referenceForId ?? null, message.generationStatus ?? null])).lastInsertRowid);
        for (const [index, image] of ((message.images ?? [])).entries()) {
            (await this.db.run('INSERT INTO version_attachments VALUES (?,?,?)', [newId, (await this.attachment(image)), index]));
        }
        if (message.kind === 'reference') {
            const reference = message.reference;
            (await this.db.run('INSERT INTO document_references VALUES (?,?,?,?,?,?,?)', [newId, reference.id, reference.snapshotKey, reference.summary, reference.quote, reference.createdAt,
                reference.summaryInput === undefined ? null : JSON.stringify(reference.summaryInput)]));
            for (const [index, source] of (reference.sources).entries()) {
                (await this.db.run('INSERT INTO reference_sources VALUES (?,?,?,?,?,?,?,?,?,?)', [newId, index, source.workspaceId, source.conversationId, source.documentId, source.versionId ?? null, source.title, source.documentText, source.start, source.length]));
                for (const [position, image] of ((source.images ?? [])).entries()) {
                    (await this.db.run('INSERT INTO reference_source_attachments VALUES (?,?,?,?)', [newId, index, position, (await this.attachment(image))]));
                }
            }
        }
        return newId;
    }
    // expectedRevision 防止另一窗口或旧请求覆盖更新后的工作区。
    async save(data, { expectedRevision, label = '修改内容', history = true, historyBefore, historyAfter, mergeCreationId, mergeInitializationId } = {}) {
        validateData(data);
        if (expectedRevision !== undefined && expectedRevision !== (await this.readRevision()))
            throw new Error('工作区已被其他操作更新，请重新打开后再修改');
        const previous = (await this.load()).data;
        if (historyBefore)
            validateData(historyBefore);
        if (historyAfter)
            validateData(historyAfter);
        const before = JSON.stringify(canonical(contentOf(historyBefore ?? previous)));
        const after = JSON.stringify(canonical(contentOf(historyAfter ?? data)));
        const streaming = Object.values(data.conversations).some((conversation) => conversation.isStreaming);
        (await this.db.exec('BEGIN IMMEDIATE'));
        try {
            // 临时腾出位置，允许消息插入和交换而不触发顺序唯一约束。
            (await this.db.exec('UPDATE documents SET position=-position-1;\nDELETE FROM relations;'));
            const present = new Set(data.nodes.map((node) => node.id));
            for (const row of (await this.db.query('SELECT id FROM conversations', [])))
                if (!present.has(row.id))
                    (await this.db.run('DELETE FROM conversations WHERE id=?', [row.id]));
            for (const [ordinal, node] of (data.nodes).entries()) {
                const { topic, label: nodeLabel, done, color, collapsed, minimized, maximized, ...metadata } = node.data;
                void maximized;
                const id = node.id;
                const previousUsage = (await this.db.get('SELECT usage_json FROM conversations WHERE id=?', [id]))?.usage_json;
                const usage = mergeUsage(JSON.parse(previousUsage ?? '[]'), data.conversations[id]?.usage, ...(data.conversations[id]?.messages ?? []).map((message) => message.usage));
                (await this.db.run('INSERT INTO conversations VALUES (?,?,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET ordinal=excluded.ordinal,topic=excluded.topic,label=excluded.label,done=excluded.done,color=excluded.color,metadata_json=excluded.metadata_json,usage_json=excluded.usage_json', [id, ordinal, topic, nodeLabel ?? null, done ? 1 : 0, color ?? null, JSON.stringify(metadata), usageJson(usage)]));
                const width = Number.isFinite(node.style?.width) && node.style.width > 0 ? node.style.width : 400;
                const height = Number.isFinite(node.style?.height) && node.style.height > 0 ? node.style.height : 500;
                (await this.db.run(`INSERT INTO conversation_layouts VALUES (?,?,?,?,?,?,?,?) ON CONFLICT(conversation_id) DO UPDATE SET
          x=excluded.x,y=excluded.y,width=excluded.width,height=excluded.height,z_index=excluded.z_index,collapsed=excluded.collapsed,minimized=excluded.minimized`, [id, node.position.x, node.position.y, width, height, node.zIndex ?? 0, collapsed ? 1 : 0, minimized ? 1 : 0]));
                const conversation = data.conversations[id];
                const messages = conversation?.messages ?? [];
                const currentDocuments = new Set(messages.map((message) => message.id));
                for (const row of (await this.db.query('SELECT id FROM documents WHERE conversation_id=?', [id])))
                    if (!currentDocuments.has(row.id))
                        (await this.db.run('DELETE FROM documents WHERE id=?', [row.id]));
                for (const [index, message] of (messages).entries()) {
                    (await this.db.run('INSERT INTO documents(id,conversation_id,position,role,kind,content,created_at) VALUES (?,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET role=excluded.role', [message.id, id, index, message.role, message.kind ?? 'message', '', message.timestamp]));
                    const owner = (await this.db.get('SELECT conversation_id,kind,current_version_id,usage_json FROM documents WHERE id=?', [message.id]));
                    if (owner.conversation_id !== id)
                        throw new Error('同一文档不能属于两个会话');
                    if (owner.kind !== (message.kind ?? 'message'))
                        throw new Error('已有文档不能改变类型');
                    for (const old of message.previousVersions ?? [])
                        (await this.version(message.id, { ...message, ...old, images: message.images ?? [] }, old.timestamp));
                    const generating = conversation?.isStreaming && message.id === (conversation.streamingMessageId ?? messages.at(-1)?.id);
                    let selectedVersion;
                    if (generating) {
                        // 重生成以当前选中版本为基线，不能误取最近创建的其他版本。
                        // 首次生成只有草稿，不为尚未产生内容的回答创建空版本。
                        selectedVersion = owner.current_version_id;
                        (await this.db.run('INSERT INTO generation_drafts VALUES (?,?,?,?,?) ON CONFLICT(document_id) DO UPDATE SET content=excluded.content,reasoning=excluded.reasoning,updated_at=excluded.updated_at,images_json=excluded.images_json', [message.id, message.content, message.reasoning ?? null, Date.now(), JSON.stringify(message.images ?? [])]));
                    }
                    else {
                        selectedVersion = (await this.version(message.id, message));
                        (await this.db.run('DELETE FROM generation_drafts WHERE document_id=?', [message.id]));
                    }
                    const saved = selectedVersion === null ? { content: '', reasoning: null, reply_to_id: message.replyToId ?? null,
                        triggered_by: message.triggeredBy ?? null, reference_for_id: message.referenceForId ?? null,
                        generation_status: message.generationStatus ?? null } : (await this.db.get('SELECT * FROM document_versions WHERE id=?', [selectedVersion]));
                    let documentUsage = mergeUsage(JSON.parse(owner.usage_json ?? '[]'), message.usage);
                    const latestAnswer = documentUsage.findLast((record) => record.purpose === 'answer');
                    // 完成的回答用量绑定实际保存版本，重生成累计与版本展示分别读取。
                    if (!generating && selectedVersion !== null && latestAnswer && latestAnswer.versionId === undefined && latestAnswer.status !== 'pending'
                        && (latestAnswer.status !== 'interrupted' || selectedVersion !== owner.current_version_id)) {
                        documentUsage = documentUsage.map((record) => record.id === latestAnswer.id ? { ...record, versionId: selectedVersion } : record);
                    }
                    (await this.db.run('UPDATE documents SET position=?,content=?,reasoning=?,current_version_id=?,reply_to_id=?,triggered_by=?,reference_for_id=?,generation_status=?,usage_json=? WHERE id=?', [index, saved.content, saved.reasoning, selectedVersion, saved.reply_to_id, saved.triggered_by, saved.reference_for_id, saved.generation_status, usageJson(documentUsage), message.id]));
                }
            }
            for (const [ordinal, edge] of (data.edges).entries()) {
                (await this.db.run('INSERT INTO relations VALUES (?,?,?,?,?)', [edge.id, edge.source, edge.target, ordinal, edge.data?.label ?? null]));
            }
            // 当前未设计固定旧版本引用；保留当前及最近 49 个旧版本，个人历史另有期限。
            for (const row of (await this.db.query('SELECT id FROM documents', []))) {
                (await this.db.run('DELETE FROM document_versions WHERE id IN (SELECT id FROM document_versions WHERE document_id=? AND id NOT IN (SELECT current_version_id FROM documents WHERE current_version_id IS NOT NULL) ORDER BY id DESC LIMIT -1 OFFSET 49)', [row.id]));
            }
            if (history && (!streaming || historyAfter) && before !== after) {
                let beforeJson = JSON.stringify(historyBefore ?? previous);
                const afterJson = JSON.stringify(historyAfter ?? data);
                // 合并必须重新核对数据库里最后一条记录，不能跨越其他操作或改写旧回答。
                let mergedHistoryId;
                const last = (mergeCreationId || mergeInitializationId) && (await this.db.get('SELECT * FROM personal.history ORDER BY created_at DESC,rowid DESC LIMIT 1', []));
                if (mergeInitializationId && last && ['创建会话并提问', '首次提问'].includes(last.label) &&
                    JSON.stringify(canonical(contentOf(JSON.parse(last.after_json)))) === before &&
                    isInitializationStep(historyBefore ?? previous, historyAfter ?? data, mergeInitializationId)) {
                    beforeJson = last.before_json;
                    mergedHistoryId = last.id;
                    label = last.label;
                }
                else if (mergeCreationId && last?.label === '创建会话或分支') {
                    const start = JSON.parse(last.before_json);
                    const created = JSON.parse(last.after_json);
                    const currentBefore = historyBefore ?? previous;
                    const currentAfter = historyAfter ?? data;
                    const key = (value) => JSON.stringify(canonical(contentOf(value)));
                    const without = (value) => ({ ...value, nodes: value.nodes.filter((node) => node.id !== mergeCreationId), edges: value.edges.filter((edge) => edge.source !== mergeCreationId && edge.target !== mergeCreationId) });
                    const questions = (currentAfter.conversations[mergeCreationId]?.messages ?? []).filter((message) => message.role !== 'system');
                    if (!start.nodes.some((node) => node.id === mergeCreationId) && created.nodes.some((node) => node.id === mergeCreationId) &&
                        !(created.conversations[mergeCreationId]?.messages ?? []).some((message) => message.role !== 'system') &&
                        questions.length === 1 && questions[0].role === 'user' &&
                        key(created) === key(currentBefore) && key(without(created)) === key(start) && key(without(currentBefore)) === key(without(currentAfter)) &&
                        JSON.stringify(canonical(contentOf(currentBefore).edges)) === JSON.stringify(canonical(contentOf(currentAfter).edges))) {
                        beforeJson = last.before_json;
                        mergedHistoryId = last.id;
                    }
                }
                const bytes = utf8Length(beforeJson) + utf8Length(afterJson);
                if (mergedHistoryId)
                    (await this.db.run('UPDATE personal.history SET created_at=?,label=?,before_json=?,after_json=?,bytes=? WHERE id=?', [Date.now(), label, beforeJson, afterJson, bytes, mergedHistoryId]));
                else
                    (await this.db.run('INSERT INTO personal.history VALUES (?,?,?,?,?,?)', [crypto.randomUUID(), Date.now(), label, beforeJson, afterJson, bytes]));
                (await this.pruneHistory());
            }
            // 附件只有在所有功能版本都不再使用时才清理，个人历史自带恢复所需的图片数据。
            (await this.db.exec('DELETE FROM attachments WHERE id NOT IN (SELECT attachment_id FROM version_attachments UNION SELECT attachment_id FROM reference_source_attachments)'));
            const revision = (await this.readRevision()) + 1;
            (await this.db.run('UPDATE workspace_meta SET value=? WHERE key=?', [String(revision), 'revision']));
            const metadata = { ...this.metadata, updatedAt: Date.now() };
            (await this.db.run('UPDATE workspace_meta SET value=? WHERE key=?', [JSON.stringify(metadata), 'metadata']));
            (await this.db.exec('COMMIT'));
            this.metadata = metadata;
            const versions = Object.fromEntries((await this.db.query('SELECT id,current_version_id FROM documents', [])).map((row) => [row.id, row.current_version_id]));
            const usage = Object.fromEntries((await this.db.query('SELECT id,usage_json FROM conversations', [])).map((row) => [row.id, JSON.parse(row.usage_json ?? '[]')]));
            const documentUsage = Object.fromEntries((await this.db.query('SELECT id,usage_json FROM documents', [])).map((row) => [row.id, JSON.parse(row.usage_json ?? '[]')]));
            return { revision, versions, usage, documentUsage };
        }
        catch (error) {
            await this.rollback(error);
            throw error;
        }
    }
    async pruneHistory() {
        (await this.db.run('DELETE FROM personal.history WHERE created_at < ?', [Date.now() - 30 * 86400000]));
        const rows = (await this.db.query('SELECT id,bytes FROM personal.history ORDER BY created_at DESC,rowid DESC', []));
        let bytes = 0;
        for (const [index, row] of (rows).entries()) {
            bytes += row.bytes;
            if (index >= 200 || (bytes > 64 * 1024 * 1024 && index > 0))
                (await this.db.run('DELETE FROM personal.history WHERE id=?', [row.id]));
        }
    }
    async listHistory() {
        // 列表只返回元信息；选中记录后才读取快照，避免把全部历史和图片一次传给界面。
        return (await this.db.query('SELECT id,created_at AS createdAt,label,bytes FROM personal.history ORDER BY created_at DESC,rowid DESC', []));
    }
    async readHistory(id) {
        const row = (await this.db.get('SELECT id,created_at AS createdAt,label,bytes,before_json,after_json FROM personal.history WHERE id=?', [id]));
        if (!row)
            throw new Error('本地历史已被清理或不存在');
        const { before_json, after_json, ...entry } = row;
        return { ...entry, before: JSON.parse(before_json), after: JSON.parse(after_json) };
    }
    // 恢复不是可撤销操作；保留现有卡片的布局，删除或新增卡片使用历史记录中的布局。
    async restoreHistory(id, side = 'after', conversationId, selection) {
        if (!['before', 'after'].includes(side))
            throw new Error('还原版本无效');
        const row = (await this.db.get('SELECT before_json,after_json FROM personal.history WHERE id=?', [id]));
        if (!row)
            throw new Error('本地历史已不存在');
        let data = JSON.parse(side === 'before' ? row.before_json : row.after_json);
        const currentData = (await this.load()).data;
        const current = new Map(currentData.nodes.map((node) => [node.id, node]));
        if (conversationId && selection) {
            data = restoreSelection(currentData, JSON.parse(row.before_json), JSON.parse(row.after_json), side, conversationId, selection);
        }
        else if (conversationId) {
            const node = data.nodes.find((item) => item.id === conversationId);
            const recorded = [...JSON.parse(row.before_json).nodes, ...JSON.parse(row.after_json).nodes].some((item) => item.id === conversationId);
            if (!recorded)
                throw new Error('该记录不涉及此会话');
            const ids = new Set([...currentData.nodes.map((item) => item.id), conversationId]);
            data = {
                nodes: [...currentData.nodes.filter((item) => item.id !== conversationId), ...(node ? [node] : [])],
                conversations: { ...currentData.conversations, ...(node ? { [conversationId]: data.conversations[conversationId] ?? { nodeId: conversationId, messages: [], isStreaming: false } } : {}) },
                edges: [...currentData.edges.filter((edge) => edge.source !== conversationId && edge.target !== conversationId), ...(node ? data.edges.filter((edge) => (edge.source === conversationId || edge.target === conversationId) && ids.has(edge.source) && ids.has(edge.target)) : [])],
            };
            if (!node)
                delete data.conversations[conversationId];
        }
        data.nodes = data.nodes.map((node) => {
            const layout = current.get(node.id);
            return layout ? { ...node, position: layout.position, style: layout.style, data: { ...node.data, collapsed: layout.data.collapsed, minimized: layout.data.minimized, maximized: false } } : node;
        });
        for (const conversation of Object.values(data.conversations)) {
            conversation.isStreaming = false;
            delete conversation.streamingMessageId;
        }
        (await this.save(data, { history: false }));
        return (await this.load());
    }
    async listVersions(documentId) {
        const rows = await this.db.query(`SELECT v.id,v.created_at AS createdAt,COALESCE(r.summary,v.content) AS content,v.reasoning,
            EXISTS (SELECT 1 FROM version_attachments a WHERE a.version_id=v.id) AS hasImages
            FROM document_versions v LEFT JOIN document_references r ON r.version_id=v.id WHERE v.document_id=? ORDER BY v.id DESC`, [documentId]);
        // 只有思考或图片的回答也有内容，列表中显示它实际保留的内容。
        return rows.map(({ id, createdAt, content, reasoning, hasImages }) => ({ id, createdAt,
            preview: (content.trim() ? content : reasoning?.trim() ? reasoning : hasImages ? '图片' : '').slice(0, 100) }));
    }
    // 切换版本只读取已保存结果，由上层内容操作选择它，不重新请求模型。
    async readVersion(documentId, versionId) {
        if (!Number.isSafeInteger(versionId) || versionId <= 0)
            throw new Error('文档版本 ID 无效');
        const row = (await this.db.get('SELECT d.role,d.kind,d.usage_json,d.created_at AS document_created_at,v.*,v.id AS version_id FROM document_versions v JOIN documents d ON d.id=v.document_id WHERE v.document_id=? AND v.id=?', [documentId, versionId]));
        if (!row)
            throw new Error('文档版本不存在');
        return (await this.messageFromRow(row, documentId, row.document_created_at));
    }
    async rename(name) {
        if (!name?.trim())
            throw new Error('工作区名称不能为空');
        const metadata = { ...this.metadata, name: name.trim(), updatedAt: Date.now() };
        (await this.db.run('UPDATE workspace_meta SET value=? WHERE key=?', [JSON.stringify(metadata), 'metadata']));
        this.metadata = metadata;
        return this.metadata;
    }
    // 回滚失败后禁止继续写入，保留两个错误供界面报告，避免沿用不确定的事务状态。
    async rollback(error) {
        try { await this.db.exec('ROLLBACK'); }
        catch (rollbackError) {
            this.broken = true;
            throw new AggregateError([error, rollbackError], '事务失败且回滚失败，请重新打开工作区');
        }
    }
    // 导出前的平台路径检查不属于业务规则，完整副本仅包含 main 库。
    async exportTo(filename) { (await this.db.run('VACUUM main INTO ?', [filename])); return filename; }
    async clearHistory() { (await this.db.exec('DELETE FROM personal.history')); return true; }
    async close() { (await this.db.close()); }
}
export { WorkspaceDatabase, validateData, contentOf, APPLICATION_ID, SCHEMA_VERSION, EMPTY };
