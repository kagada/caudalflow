import { useChatStore } from '../stores/chatStore';
import { useFlowStore } from '../stores/flowStore';
import { generateTitle } from './llm';
import { isSqliteStorage } from './storage/client';
import { recordFirstQuestion } from './storage/runtime';

// 所有提问入口共用首次命名与保存边界，标题请求不阻塞正文回答。
export function prepareFirstQuestion(nodeId: string, context: string): void {
  const messages = useChatStore.getState().getMessages(nodeId);
  const questions = messages.filter((message) => message.role === 'user');
  const question = questions[0];
  if (questions.length !== 1 || !question || messages.some((message) => message.role === 'assistant')) return;
  const node = useFlowStore.getState().nodes.find((item) => item.id === nodeId);
  if (!node) return;
  const canName = node.data.titleSource === 'pending' || (!node.data.titleSource && (
    ['New Chat', '新建对话', '新建会话'].includes(node.data.topic) ||
    node.data.topic === node.data.branchText || Boolean(node.data.mergeAction)
  ));
  const titleContent = question.content || messages.find((message) => message.reference)?.reference?.quote || '';
  const temporary = titleContent.replace(/\s+/g, ' ').trim().slice(0, 24) || '图片提问';
  if (canName) useFlowStore.getState().updateNodeData(nodeId, { topic: temporary, titleSource: 'temporary' });
  if (isSqliteStorage()) recordFirstQuestion(nodeId);
  if (!canName) return;

  queueMicrotask(() => {
    // 撤销、切换工作区或删除可能发生在请求发出前，也要检查归属。
    const stillCurrent = () => {
      const current = useFlowStore.getState().nodes.find((item) => item.id === nodeId);
      const first = useChatStore.getState().getMessages(nodeId).find((item) => item.role === 'user');
      return current?.data.titleSource === 'temporary' && current.data.topic === temporary &&
        first?.id === question.id && first.content === question.content;
    };
    if (!stillCurrent()) return;
    generateTitle(titleContent || '请根据所附图片概括主题', context, (title) => {
      if (stillCurrent()) useFlowStore.getState().updateNodeData(nodeId, { topic: title, titleSource: 'generated' });
    }, { nodeId });
  });
}
