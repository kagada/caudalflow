// 保留原生输入的键盘和标签行为，统一会话与模型默认设置的开关外形。
export function ToggleSwitch({ label, checked, disabled, onChange }: {
  label: string; checked: boolean; disabled?: boolean; onChange: (checked: boolean) => void;
}) {
  return <label className={`relative inline-flex h-6 w-11 shrink-0 ${disabled ? 'cursor-not-allowed opacity-40' : 'cursor-pointer'}`}>
    <input type="checkbox" role="switch" aria-label={label} checked={checked} disabled={disabled} onChange={(event) => onChange(event.target.checked)} className="peer sr-only" />
    <span aria-hidden="true" className="absolute inset-0 rounded-full bg-slate-400 transition-colors peer-checked:bg-blue-500 peer-focus-visible:ring-2 peer-focus-visible:ring-blue-400 peer-focus-visible:ring-offset-2" />
    <span aria-hidden="true" className="pointer-events-none absolute left-0.5 top-0.5 h-5 w-5 rounded-full bg-white shadow-sm transition-transform peer-checked:translate-x-5" />
  </label>;
}
