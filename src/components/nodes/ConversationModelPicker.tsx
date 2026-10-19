import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Check, ChevronDown, Settings2 } from 'lucide-react';
import { useModelStore } from '../../stores/modelStore';
import { useFlowStore } from '../../stores/flowStore';
import { useSettingsStore } from '../../stores/settingsStore';
import { openSettingsWindow } from '../../services/settingsWindow';

// 会话选项只写入可迁移的公开标识，弹层放到画布外避免被卡片裁切。
export function ConversationModelPicker({ nodeId, disabled }: { nodeId: string; disabled: boolean }) {
  const selection = useFlowStore((state) => state.nodes.find((node) => node.id === nodeId)?.data.modelSelection);
  const { providers, defaultModel } = useModelStore();
  const legacy = useSettingsStore((state) => state.llmConfig);
  const current = selection ?? defaultModel;
  const name = current ? providers.find((provider) => provider.id === current.providerId)?.models.find((model) => model.id === current.modelId)?.name ?? current.modelId : legacy.model || legacy.providerName;
  const [position, setPosition] = useState<{ top: number; left: number } | null>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const panel = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!position) return;
    const close = (event: MouseEvent) => { if (!panel.current?.contains(event.target as Node) && !trigger.current?.contains(event.target as Node)) setPosition(null); };
    const escape = (event: KeyboardEvent) => { if (event.key === 'Escape') { setPosition(null); trigger.current?.focus(); } };
    document.addEventListener('mousedown', close); document.addEventListener('keydown', escape);
    return () => { document.removeEventListener('mousedown', close); document.removeEventListener('keydown', escape); };
  }, [position]);
  return <>
    <button ref={trigger} disabled={disabled} aria-label="会话模型设置" aria-expanded={!!position} onClick={() => {
      const rect = trigger.current!.getBoundingClientRect();
      setPosition(position ? null : { top: rect.top - 8, left: Math.max(8, Math.min(rect.left, window.innerWidth - 308)) });
    }} className="flex min-w-0 max-w-full items-center gap-1 rounded-full bg-surface-700/60 px-3 py-1.5 text-xs text-text-secondary hover:text-text-primary disabled:opacity-40"><span className="truncate">{selection ? '' : '默认 · '}{name}</span><ChevronDown size={12} className="shrink-0" /></button>
    {position && createPortal(<div ref={panel} role="dialog" aria-label="选择会话模型" className="nowheel nodrag nopan fixed z-[12000] w-[300px] rounded-2xl border border-border bg-surface-900 p-2 shadow-2xl text-text-primary" style={{ left: position.left, bottom: window.innerHeight - position.top }}>
      <p className="px-3 py-2 text-xs text-text-muted">此会话使用的模型</p>
      <div className="max-h-[40vh] overflow-y-auto"><button className="flex w-full items-center justify-between rounded-lg px-3 py-2 text-left text-sm hover:bg-surface-800" onClick={() => { useFlowStore.getState().updateNodeData(nodeId, { modelSelection: undefined }); setPosition(null); }}>跟随默认模型{!selection && <Check size={14} />}</button>
      {selection && !providers.some((provider) => provider.enabled && provider.id === selection.providerId && provider.models.some((model) => model.enabled && model.id === selection.modelId)) && <p role="alert" className="px-3 py-2 text-xs text-amber-500">{selection.providerName} / {selection.modelId} 未配置或未启用，请前往模型管理补充。</p>}
      {providers.filter((provider) => provider.enabled).map((provider) => <div key={provider.id}><p className="px-3 pt-3 pb-1 text-xs text-text-muted">{provider.name}</p>{provider.models.filter((model) => model.enabled).map((model) => <button key={model.id} className="flex w-full items-center justify-between gap-2 rounded-lg px-3 py-2 text-left text-sm hover:bg-surface-800" onClick={() => { useFlowStore.getState().updateNodeData(nodeId, { modelSelection: { providerId: provider.id, providerName: provider.name, modelId: model.id } }); setPosition(null); }}><span className="min-w-0 truncate" title={model.id}>{model.name}</span>{selection?.providerId === provider.id && selection.modelId === model.id && <Check size={14} />}</button>)}</div>)}
      </div><button className="mt-2 flex w-full items-center gap-2 border-t border-border px-3 pt-3 pb-2 text-xs text-text-secondary" onClick={() => {
        setPosition(null);
        if (location.protocol === 'app:') void openSettingsWindow('models').catch(() => useSettingsStore.getState().setShowSettings(true));
        else { useSettingsStore.getState().setShowSettings(true); window.dispatchEvent(new CustomEvent('caudalflow:settings-section', { detail: 'models' })); }
      }}><Settings2 size={14} />模型管理</button>
    </div>, document.body)}
  </>;
}
