import type { RequestUsage, TokenUsage } from '../../types/chat';
import { mergeUsage, sumUsage } from '../../utils/tokenUsage';

const fields: [keyof TokenUsage, string][] = [['inputTokens', '输入'], ['outputTokens', '输出'], ['cachedInputTokens', '缓存命中']];

// 用量作为辅助信息直接展示，跨消息选中正文时跳过这一行。
export function UsageStatistics({ usage, label, showEmpty = false }: { usage?: RequestUsage[]; label: string; showEmpty?: boolean }) {
  const records = mergeUsage(usage);
  if (!records.length && !showEmpty) return null;
  const value = (field: keyof TokenUsage) => {
    const total = sumUsage(records, field);
    if (!total.reported) return records.length && records.every((record) => record.status === 'pending') ? '统计中' : '未提供';
    return `${total.reported < total.requests ? '≥ ' : ''}${total.tokens.toLocaleString()}`;
  };
  return <div data-token-usage className="nowheel nodrag nopan select-none my-2 text-xs leading-5 text-text-muted" title="缓存命中属于输入 token 的一部分；≥ 表示部分请求已提供用量。">
    {label} · {fields.map(([field, name]) => `${name} ${value(field)}`).join(' · ')} token
  </div>;
}
