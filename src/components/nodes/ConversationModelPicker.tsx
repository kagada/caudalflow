import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Check, ChevronDown, Settings2 } from 'lucide-react';
import { useModelStore } from '../../stores/modelStore';
import { useFlowStore } from '../../stores/flowStore';
import { useSettingsStore } from '../../stores/settingsStore';
import { openModelSettings } from '../../services/modelSettings';
import { resolveModelConfig } from '../../services/modelConfig';
import { thinkingEffortLabel, thinkingEffortOptions } from '../../services/modelThinking';
import { ThinkingEffortControl } from '../ui/ThinkingEffortControl';

// 会话选项只写入可迁移的公开标识，弹层放到画布外避免被卡片裁切。
export function ConversationModelPicker({ nodeId, disabled }: { nodeId: string; disabled: boolean }) {
  const selection = useFlowStore((state) => state.nodes.find((node) => node.id === nodeId)?.data.modelSelection);
  const override = useFlowStore((state) => state.nodes.find((node) => node.id === nodeId)?.data.thinkingEffort);
  const { providers, defaultModel } = useModelStore();
  const legacy = useSettingsStore((state) => state.llmConfig);
  const current = selection ?? defaultModel;
  // 括号始终说明默认模型，不能因会话另选了模型而改成当前会话的名称。
  const defaultModelName = defaultModel ? providers.find((provider) => provider.id === defaultModel.providerId)?.models.find((model) => model.id === defaultModel.modelId)?.name ?? defaultModel.modelId : legacy.model || legacy.providerName;
  // 显示与发送使用同一可用性判断；保留原选择供重新启用后恢复，但不能显示为可用模型。
  let available = true;
  let resolved;
  try { resolved = resolveModelConfig(nodeId); } catch { available = false; }
  const effective = current ?? { providerId: legacy.providerId, modelId: legacy.model };
  const model = providers.find((provider) => provider.id === effective.providerId)?.models.find((item) => item.id === effective.modelId);
  const options = thinkingEffortOptions(model);
  // 会话统一保留一个“默认”入口，避免与模型配置里的默认选项重复。
  const sessionOptions = options.filter((option) => option !== 'auto');
  const effort = resolved?.thinkingMode === 'disabled' || !resolved?.thinkingMode ? 'none' : resolved.thinkingEffort ?? 'auto';
  // 按实际模型显示名称；是否跟随默认只在菜单中表示，不混入模型名。
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
    }} className="flex min-w-0 max-w-full items-center gap-1 rounded-full bg-surface-700/60 px-3 py-1.5 text-xs text-text-secondary hover:text-text-primary disabled:opacity-40"><span className="truncate">{available ? name : '未设置模型'}</span>{available && model && <small aria-label="当前思考强度" className="shrink-0 text-[10px] text-text-muted">{thinkingEffortLabel(effort)}</small>}<ChevronDown size={12} className="shrink-0" /></button>
    {position && createPortal(<div ref={panel} role="dialog" aria-label="选择会话模型" className="nowheel nodrag nopan fixed z-[12000] w-[300px] rounded-2xl border border-border bg-surface-900 p-2 shadow-2xl text-text-primary" style={{ left: position.left, bottom: window.innerHeight - position.top }}>
      <p className="px-3 py-2 text-xs text-text-muted">此会话使用的模型</p>
      <div className="max-h-[40vh] overflow-y-auto"><button aria-label="默认" className="flex w-full items-center justify-between rounded-lg px-3 py-2 text-left text-sm hover:bg-surface-800" onClick={() => { useFlowStore.getState().updateNodeData(nodeId, { modelSelection: undefined }); setPosition(null); }}><span className="flex min-w-0 items-center gap-1"><span>默认</span><small title={defaultModelName} className="truncate text-xs text-text-muted">({defaultModelName})</small></span>{!selection && <Check size={14} />}</button>
      {selection && !providers.some((provider) => provider.enabled && provider.id === selection.providerId && provider.models.some((model) => model.enabled && model.id === selection.modelId)) && <p role="alert" className="px-3 py-2 text-xs text-amber-500">{selection.providerName} / {selection.modelId} 未配置或未启用，请前往模型管理补充。</p>}
      {providers.filter((provider) => provider.enabled).map((provider) => <div key={provider.id}><p className="px-3 pt-3 pb-1 text-xs text-text-muted">{provider.name}</p>{provider.models.filter((model) => model.enabled).map((model) => <button key={model.id} className="flex w-full items-center justify-between gap-2 rounded-lg px-3 py-2 text-left text-sm hover:bg-surface-800" onClick={() => { useFlowStore.getState().updateNodeData(nodeId, { modelSelection: { providerId: provider.id, providerName: provider.name, modelId: model.id } }); setPosition(null); }}><span className="min-w-0 truncate" title={model.id}>{model.name}</span>{selection?.providerId === provider.id && selection.modelId === model.id && <Check size={14} />}</button>)}</div>)}
      </div>
      {model && <div className="mt-2 space-y-2 border-t border-border px-2 pt-3 pb-2">
        <p className="text-xs text-text-muted">思考强度</p>
        <ThinkingEffortControl label="会话思考强度" options={['inherit', ...sessionOptions]} value={override && sessionOptions.includes(override) ? override : 'inherit'} disabled={!available || disabled} onChange={(value) => useFlowStore.getState().updateNodeData(nodeId, { thinkingEffort: value === 'inherit' ? undefined : value })} />
        {!model.effort && <p className="text-[10px] text-text-muted">获取模型列表后可读取支持的强度档位。</p>}
      </div>}
      <button className="mt-2 flex w-full items-center gap-2 border-t border-border px-3 pt-3 pb-2 text-xs text-text-secondary" onClick={() => {
        setPosition(null);
        void openModelSettings();
      }}><Settings2 size={14} />模型管理</button>
    </div>, document.body)}
  </>;
}
