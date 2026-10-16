import type { ChatMessage, Conversation, ReferenceSource } from '../types/chat';
import { effectiveReferenceSources, referenceRanges, type HighlightRange } from './referenceHighlights';

export interface ReferenceBacklink {
  nodeId: string;
  questionId: string;
  question: string;
  sources: ReferenceSource[];
}
export interface MessageBacklink extends ReferenceBacklink { ranges: HighlightRange[]; quote: string }
export type BacklinkInput = string | ChatMessage;

// 选择稳定的消息对象，其他会话流式输出时不重建来源正文和菜单。
export function selectBacklinkInputs(conversations: Record<string, Conversation>, workspaceId: string, sourceNodeId: string): BacklinkInput[] {
  const result: BacklinkInput[] = [];
  for (const conversation of Object.values(conversations)) {
    for (const message of conversation.messages) {
      if (message.kind !== 'reference' || !message.reference?.sources.some((source) => source.workspaceId === workspaceId && source.conversationId === sourceNodeId)) continue;
      const question = conversation.messages.find((item) => item.id === message.referenceForId && item.role === 'user');
      if (question) result.push(conversation.nodeId, message, question);
    }
  }
  return result;
}

// 同一问题的多条、重叠引用只占一项，原始来源范围各自保留。
export function buildBacklinks(inputs: BacklinkInput[], workspaceId: string, sourceNodeId: string): ReferenceBacklink[] {
  const grouped = new Map<string, ReferenceBacklink>();
  for (let index = 0; index < inputs.length; index += 3) {
    const nodeId = inputs[index] as string;
    const reference = (inputs[index + 1] as ChatMessage).reference!;
    const question = inputs[index + 2] as ChatMessage;
    const key = JSON.stringify([nodeId, question.id]);
    const item = grouped.get(key) ?? { nodeId, questionId: question.id, question: question.content || '图片提问', sources: [] };
    item.sources.push(...effectiveReferenceSources(reference).filter((source) => source.workspaceId === workspaceId && source.conversationId === sourceNodeId));
    grouped.set(key, item);
  }
  return [...grouped.values()];
}

export function messageBacklinks(message: ChatMessage, backlinks: ReferenceBacklink[]): MessageBacklink[] {
  return backlinks.flatMap((item) => {
    const ranges = referenceRanges(message, item.sources).filter((range) => range.end > range.start);
    return ranges.length ? [{ ...item, ranges, quote: [...new Set(ranges.map((range) => message.content.slice(range.start, range.end)))].join(' … ') }] : [];
  });
}

export function blockBacklinks(backlinks: MessageBacklink[], start: number, end: number): MessageBacklink[] {
  return backlinks.filter((item) => item.ranges.some((range) => range.start < end && range.end > start));
}
