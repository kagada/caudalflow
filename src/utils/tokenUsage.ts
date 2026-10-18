import type { ChatMessage, RequestUsage, TokenUsage } from '../types/chat';

// 同一请求的多次用量回报更新原记录，撤销或切换版本时保留已经发生的消耗。
export function mergeUsage(...lists: (RequestUsage[] | undefined)[]): RequestUsage[] {
  const records = new Map<string, RequestUsage>();
  for (const list of lists) for (const record of list ?? []) {
    const previous = records.get(record.id);
    records.set(record.id, previous && previous.status !== 'pending' && record.status === 'pending' ? previous : { ...previous, ...record });
  }
  return [...records.values()];
}

// 只累加服务商实际返回的字段，用报告数量区分“零用量”和“没有数据”。
export function sumUsage(records: RequestUsage[], field: keyof TokenUsage) {
  const unique = mergeUsage(records);
  const reported = unique.filter((record) => Number.isSafeInteger(record[field]) && record[field]! >= 0);
  return { tokens: reported.reduce((sum, record) => sum + record[field]!, 0), reported: reported.length, requests: unique.length };
}

// 消息展示本次回答；选用旧版本时按版本关联查找，累计仍由会话记录承担。
export function answerUsage(message: ChatMessage | undefined, isStreaming = false): RequestUsage | undefined {
  if (!message) return;
  const records = mergeUsage(message.usage).filter((record) => record.purpose === 'answer');
  const latest = records.at(-1);
  if (isStreaming || message.versionId === undefined) return latest;
  // 请求刚结束、正文尚未落盘时，先显示这次请求已回报的用量。
  if (latest && latest.versionId === undefined && latest.status !== 'interrupted') return latest;
  const selected = records.findLast((record) => record.versionId === message.versionId);
  if (selected) return selected;
  return records.some((record) => record.versionId !== undefined) ? undefined : latest;
}
