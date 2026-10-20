// 选中问答或属性时只恢复该范围，不用旧会话整体覆盖后来产生的其他内容。
const layoutKeys = new Set(['collapsed', 'minimized', 'maximized']);
const clone = (value) => JSON.parse(JSON.stringify(value));

function restoreSelection(current, before, after, side, conversationId, selection) {
  if (!['before', 'after'].includes(side)) throw new Error('还原版本无效');
  const source = side === 'before' ? before : after;
  const result = clone(current);
  const sourceNode = source.nodes.find((node) => node.id === conversationId);
  let node = result.nodes.find((item) => item.id === conversationId);
  const oldMessages = before.conversations[conversationId]?.messages ?? [];
  const nextMessages = after.conversations[conversationId]?.messages ?? [];
  if (selection.documentIds) {
    const ids = new Set(selection.documentIds);
    const allowed = new Set([...oldMessages, ...nextMessages].map((message) => message.id));
    if (!ids.size || [...ids].some((id) => !allowed.has(id))) throw new Error('选中文档不属于该记录的会话');
    const questions = new Set([...oldMessages, ...nextMessages].filter((message) => message.role === 'user' && ids.has(message.id)).map((message) => message.id));
    // 新记录有明确问答关联：还原一组问答时，其后来新增的回复也属于该范围。
    for (const message of result.conversations[conversationId]?.messages ?? []) if ((message.replyToId && questions.has(message.replyToId)) || (message.referenceForId && questions.has(message.referenceForId))) ids.add(message.id);
    const sourceMessages = source.conversations[conversationId]?.messages ?? [];
    const wanted = sourceMessages.filter((message) => ids.has(message.id));
    if (!node && wanted.length) {
      if (!sourceNode) throw new Error('来源会话不存在');
      node = clone(sourceNode); result.nodes.push(node);
      result.conversations[conversationId] = { nodeId: conversationId, messages: [], isStreaming: false };
    }
    if (node) {
      const conversation = result.conversations[conversationId] ?? { nodeId: conversationId, messages: [], isStreaming: false };
      const firstSelected = conversation.messages.findIndex((message) => ids.has(message.id));
      const originalSlot = firstSelected < 0 ? undefined : conversation.messages.slice(0, firstSelected).filter((message) => !ids.has(message.id)).length;
      const messages = conversation.messages.filter((message) => !ids.has(message.id));
      for (const message of wanted) {
        const index = sourceMessages.findIndex((item) => item.id === message.id);
        const following = sourceMessages.slice(index + 1).find((item) => messages.some((existing) => existing.id === item.id));
        if (following) messages.splice(messages.findIndex((item) => item.id === following.id), 0, clone(message));
        else {
          const previous = sourceMessages.slice(0, index).findLast((item) => messages.some((existing) => existing.id === item.id));
          messages.splice(previous ? messages.findIndex((item) => item.id === previous.id) + 1 : Math.min(originalSlot ?? index, messages.length), 0, clone(message));
        }
      }
      result.conversations[conversationId] = { ...conversation, messages, isStreaming: false };
    }
  } else if (selection.attributesOnly) {
    if (!node || !sourceNode) throw new Error('会话已不存在，请先还原整个会话');
    const oldData = before.nodes.find((item) => item.id === conversationId)?.data ?? {};
    const nextData = after.nodes.find((item) => item.id === conversationId)?.data ?? {};
    for (const key of new Set([...Object.keys(oldData), ...Object.keys(nextData)])) {
      if (layoutKeys.has(key) || JSON.stringify(oldData[key]) === JSON.stringify(nextData[key])) continue;
      if (Object.hasOwn(sourceNode.data, key)) node.data[key] = clone(sourceNode.data[key]);
      else delete node.data[key];
    }
  } else if (selection.relationIds) {
    const ids = new Set(selection.relationIds);
    const allowed = new Set([...before.edges, ...after.edges].filter((edge) => edge.source === conversationId || edge.target === conversationId).map((edge) => edge.id));
    if (!ids.size || [...ids].some((id) => !allowed.has(id))) throw new Error('选中关系不属于该会话');
    const wanted = source.edges.filter((edge) => ids.has(edge.id));
    const nodes = new Set(result.nodes.map((item) => item.id));
    if (wanted.some((edge) => !nodes.has(edge.source) || !nodes.has(edge.target))) throw new Error('关系端点会话不存在，请先还原相关会话');
    result.edges = [...result.edges.filter((edge) => !ids.has(edge.id)), ...clone(wanted)];
  } else throw new Error('未指定可还原内容');
  return result;
}

export { restoreSelection };
