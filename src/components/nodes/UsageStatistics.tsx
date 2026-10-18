import type { RequestUsage, TokenUsage } from '../../types/chat';
import { mergeUsage, sumUsage } from '../../utils/tokenUsage';

const purposes: Record<RequestUsage['purpose'], string> = { answer: '回答', reference_summary: '引用摘要', summary_compression: '摘要压缩', title: '自动标题' };
const statuses: Record<RequestUsage['status'], string> = { pending: '请求中', complete: '完成', failed: '失败', interrupted: '中断' };
const fields: [keyof TokenUsage, string][] = [['inputTokens', '输入'], ['outputTokens', '输出'], ['cachedInputTokens', '缓存命中']];

// 汇总服务商报告值，逐次展示请求明细，缺失数据独立于实际零值。
export function UsageStatistics({ usage, label, showEmpty = false, onAccent = false }: { usage?: RequestUsage[]; label: string; showEmpty?: boolean; onAccent?: boolean }) {
  const records = mergeUsage(usage);
  if (!records.length && !showEmpty) return null;
  const value = (field: keyof TokenUsage) => {
    const total = sumUsage(records, field);
    if (!total.reported) return records.length && records.every((record) => record.status === 'pending') ? '统计中' : '未提供';
    return `${total.reported < total.requests ? '≥ ' : ''}${total.tokens.toLocaleString()}`;
  };
  return <details data-token-usage className={`nowheel nodrag nopan my-2 text-xs leading-5 ${onAccent ? 'text-white/80' : 'text-text-muted'}`}>
    <summary className="cursor-pointer select-none" title="缓存命中属于输入 token 的一部分；≥ 表示部分请求已提供用量。">
      {label} · {fields.map(([field, name]) => `${name} ${value(field)}`).join(' · ')} token
    </summary>
    <div className="mt-2 max-h-48 space-y-2 overflow-auto rounded border border-border bg-surface-800 p-2 text-text-secondary">
      <p>{records.length ? `共 ${records.length} 次请求，缓存命中包含在输入中。` : '接口用量：未提供。'}</p>
      {records.map((record) => <div key={record.id} className="border-t border-border pt-1">
        <div>{purposes[record.purpose]} · {record.model} · {statuses[record.status]}</div>
        <div>{fields.map(([field, name]) => `${name} ${record[field] === undefined ? '未提供' : record[field]!.toLocaleString()}`).join(' · ')}</div>
      </div>)}
    </div>
  </details>;
}
