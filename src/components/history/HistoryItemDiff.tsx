import type { ChatMessage } from '../../types/chat';
import type { HistoryItem, HistorySection } from '../../services/storage/historyView';
import { RawTextDiff } from './RawTextDiff';

function images(message?: ChatMessage) { return message?.images ?? []; }

function ImageSide({ message, other }: { message?: ChatMessage; other?: ChatMessage }) {
  const entries = images(message);
  return <div className="flex flex-wrap items-start gap-3 p-3">{!entries.length && <span className="text-xs text-text-muted">无附件图片</span>}{entries.map((image, index) => <figure key={index} className="max-w-44">
    <img src={`data:${image.mimeType};base64,${image.base64}`} alt={`附件图片 ${index + 1}`} className="max-h-40 max-w-full rounded border border-border object-contain" />
    <figcaption className="mt-1 text-xs text-text-muted">图片 {index + 1} · {images(other).some((entry) => entry.base64 === image.base64 && entry.mimeType === image.mimeType) ? '未修改' : '此侧独有'} · {image.mimeType}</figcaption>
  </figure>)}</div>;
}

function Section({ section }: { section: HistorySection }) {
  const imageChanged = JSON.stringify(images(section.before)) !== JSON.stringify(images(section.after));
  const hasImages = images(section.before).length + images(section.after).length > 0;
  const changed = section.beforeText !== section.afterText || imageChanged || Boolean(section.before) !== Boolean(section.after);
  return <details open={changed} className="mb-3 overflow-hidden rounded-lg border border-border">
    <summary className="cursor-pointer bg-surface-800 px-3 py-2 text-sm font-medium">{section.title} <span className="text-xs font-normal text-text-muted">{changed ? '有变化' : '未修改，作为背景'}</span></summary>
    {section.before || section.after ? <div className="grid grid-cols-2 divide-x divide-border px-3 py-1 text-xs text-text-muted"><span>{section.before ? '原文' : '此侧不存在'}</span><span>{section.after ? '原文' : '此侧不存在'}</span></div> : null}
    <RawTextDiff before={section.beforeText} after={section.afterText} />
    {hasImages && <div className="border-t border-border"><p className="px-3 pt-2 text-xs text-text-secondary">附件图片：{imageChanged ? !images(section.before).length ? '新增' : !images(section.after).length ? '移除' : '替换或调整' : '未修改'}</p><div className="grid grid-cols-2 divide-x divide-border"><ImageSide message={section.before} other={section.after} /><ImageSide message={section.after} other={section.before} /></div></div>}
  </details>;
}

// 问题、其图片与回复按同一组查看，实际文本差异仍保留独立文档边界。
export function HistoryItemDiff({ item }: { item: HistoryItem }) {
  return <div className="p-4">
    {item.inferred && <p className="mb-3 text-xs text-text-muted">旧记录未保存明确的问答关联，此处按历史消息顺序组织；不会改写原记录。</p>}
    {item.sections.map((section) => <Section key={section.id} section={section} />)}
  </div>;
}
