import { useState } from 'react';
import { useSettingsStore } from '../../stores/settingsStore';
import { DEFAULT_BUILTIN_PROMPTS, type BuiltinPromptKey } from '../../services/builtinPrompts';

const labels: Record<BuiltinPromptKey, string> = { referenceSummary: '引用背景摘要', conversationTitle: '会话自动标题', chatSystem: '普通问答系统提示' };

// 保存和恢复默认都是显式操作；旧引用快照不会因为修改提示词而被重写。
export function BuiltinPromptSettings() {
  const prompts = useSettingsStore((state) => state.builtinPrompts);
  const [selected, setSelected] = useState<BuiltinPromptKey>('referenceSummary');
  const [draft, setDraft] = useState(prompts.referenceSummary);
  const [saved, setSaved] = useState(false);
  return <section aria-label="内置提示词" className="space-y-4 p-5 text-text-primary">
    <h3 className="text-lg font-semibold">内置提示词</h3>
    <div className="flex flex-wrap gap-2">{(Object.keys(labels) as BuiltinPromptKey[]).map((key) => <button key={key} aria-pressed={selected === key} onClick={() => { setSelected(key); setDraft(prompts[key]); setSaved(false); }} className={`rounded-lg border border-border px-3 py-2 text-sm ${selected === key ? 'bg-accent-500/15 text-accent-400' : 'hover:bg-surface-800'}`}>{labels[key]}</button>)}</div>
    <label className="block text-sm">{labels[selected]}<textarea aria-label="内置提示词内容" value={draft} onChange={(event) => { setDraft(event.target.value); setSaved(false); }} rows={11} className="mt-2 w-full rounded-lg border border-border bg-surface-800 p-3 text-sm leading-6" /></label>
    {selected === 'referenceSummary' && <p className="text-sm leading-6 text-text-muted">{'{{sourceChars}}'} 为原文字符数，{'{{maxChars}}'} 为程序计算的摘要上限。目前上限最多 300 字，长对话目标约为原文的 20%；超长结果会再压缩一次，仍超长则报错，不直接截断。提示词修改后会使用新的缓存，已发送的引用保持原样。</p>}
    <div className="flex items-center gap-3"><button disabled={!draft.trim()} className="rounded-lg bg-accent-600 px-4 py-2 text-white disabled:opacity-40" onClick={() => { useSettingsStore.getState().setBuiltinPrompt(selected, draft); setSaved(true); }}>保存提示词</button>
      <button className="rounded-lg border border-border px-4 py-2" onClick={() => { setDraft(DEFAULT_BUILTIN_PROMPTS[selected]); useSettingsStore.getState().setBuiltinPrompt(selected, DEFAULT_BUILTIN_PROMPTS[selected]); setSaved(true); }}>恢复默认</button>
      {saved && <span role="status" className="text-sm text-green-500">已保存</span>}</div>
  </section>;
}
