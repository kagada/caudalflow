import { thinkingEffortLabel } from '../../services/modelThinking';

// 两个入口共用同一组实际档位，切换按钮明确标出当前选中项。
export function ThinkingEffortControl({ label, options, value, onChange, disabled = false }: {
  label: string; options: string[]; value: string; onChange: (value: string) => void; disabled?: boolean;
}) {
  return <div role="group" aria-label={label} className="flex flex-wrap gap-1 rounded-lg border border-border bg-surface-800 p-1">
    {options.map((option) => <button key={option} type="button" title={option === 'inherit' || option === 'auto' ? '默认' : option} aria-pressed={option === value} disabled={disabled} onClick={() => onChange(option)}
      className={`rounded-md px-2 py-1 text-xs transition-colors disabled:opacity-40 ${option === value ? 'bg-accent-500/15 text-accent-400' : 'text-text-muted hover:bg-surface-700 hover:text-text-primary'}`}>
      {option === 'inherit' ? '默认' : thinkingEffortLabel(option)}
    </button>)}
  </div>;
}
