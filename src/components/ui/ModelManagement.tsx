import { useRef, useState, type ReactNode } from 'react';
import { Eye, EyeOff, Plus, RefreshCw, Trash2, X } from 'lucide-react';
import { useModelStore } from '../../stores/modelStore';
import { fetchModels, testConnection } from '../../services/providers/api';
import type { ManagedModel } from '../../types/chat';
import { ThinkingEffortControl } from './ThinkingEffortControl';
import { defaultThinkingEffort, thinkingEffortOptions } from '../../services/modelThinking';
import { useSettingsStore } from '../../stores/settingsStore';

const field = 'w-full rounded-xl border border-border bg-surface-800 px-3 py-2 text-sm focus:outline-none focus:border-accent-500';
const button = 'rounded-lg border border-border px-3 py-2 text-sm hover:bg-surface-700 disabled:opacity-40';

// 模型列表和自定模型共用独立弹窗，保持关闭方式、间距和操作位置一致。
function ModelDialog({ title, label, onClose, children }: { title: string; label: string; onClose: () => void; children: ReactNode }) {
  return <div className="fixed inset-0 z-[12000] flex items-center justify-center bg-black/50 p-5" onKeyDown={(event) => { if (event.key === 'Escape') { event.stopPropagation(); onClose(); } }}>
    <div role="dialog" aria-modal="true" aria-label={label} className="w-full max-w-xl max-h-[calc(100vh-2.5rem)] overflow-y-auto rounded-2xl border border-border bg-surface-900 p-5 shadow-2xl space-y-4">
      <header className="flex items-center justify-between font-semibold">{title}<button aria-label={`关闭${label}`} onClick={onClose}><X size={18} /></button></header>
      {children}
    </div>
  </div>;
}

// 每个供应商独立挂载编辑表单，切换时丢弃尚未保存的弹窗和旧请求结果。
export function ModelManagement() {
  const providers = useModelStore((state) => state.providers);
  const [selectedId, setSelectedId] = useState(providers[0].id);
  const providerId = providers.some((provider) => provider.id === selectedId) ? selectedId : providers[0].id;
  return <div className="flex min-h-full flex-col sm:flex-row">
    <aside className="border-b sm:border-b-0 sm:border-r border-border p-4 sm:w-48 shrink-0">
      <p className="mb-3 text-xs text-text-muted">供应商</p>
      {providers.map((provider) => <button key={provider.id} aria-label={`供应商 ${provider.name}`} aria-pressed={provider.id === providerId} onClick={() => setSelectedId(provider.id)}
        className={`mb-2 w-full rounded-xl p-3 text-left text-sm ${provider.id === providerId ? 'bg-accent-500/10 text-accent-400' : 'text-text-secondary hover:bg-surface-800'}`}>
        {provider.name}<span className="float-right">{provider.enabled ? '●' : '○'}</span>
      </button>)}
    </aside>
    <ProviderModelSettings key={providerId} providerId={providerId} />
  </div>;
}

// 供应商配置只写本机目录，同步仅提供候选项，启用状态由用户决定。
function ProviderModelSettings({ providerId }: { providerId: string }) {
  const { providers, updateProvider, defaultModel, setDefaultModel } = useModelStore();
  const provider = providers.find((item) => item.id === providerId)!;
  const legacy = useSettingsStore((state) => state.llmConfig);
  const [visible, setVisible] = useState(false);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState('');
  const [dialog, setDialog] = useState(false);
  const [candidates, setCandidates] = useState<ManagedModel[]>([]);
  const [selectedModels, setSelectedModels] = useState<string[]>([]);
  const [search, setSearch] = useState('');
  const [manual, setManual] = useState(false);
  const [manualError, setManualError] = useState('');
  const [modelId, setModelId] = useState('');
  const [modelName, setModelName] = useState('');
  const [testModel, setTestModel] = useState(provider.models[0]?.id ?? '');
  const version = useRef(0);
  const change: typeof updateProvider = (id, changes) => { version.current++; setResult(''); updateProvider(id, changes); };

  // 丢弃地址或密钥修改前发起的请求结果，避免把旧端点的模型写入新配置。
  async function request(sync: boolean) {
    const current = version.current;
    setBusy(true); setResult('');
    try {
      if (sync) {
        const fetched = await fetchModels(provider.endpoint, provider.apiKey);
        if (current !== version.current) return;
        const entries = new Map(provider.models.map((model) => [model.id, model]));
        // 已添加的模型也更新能力信息，同时保留用户名称、默认强度及启用状态。
        for (const model of fetched) {
          const existing = entries.get(model.id);
          entries.set(model.id, { ...existing, ...model, effort: model.effort, name: existing?.name ?? model.name, enabled: existing?.enabled ?? false,
            defaultThinkingEffort: existing?.defaultThinkingEffort });
        }
        setCandidates([...entries.values()]); setSelectedModels(provider.models.map((model) => model.id)); setSearch(''); setDialog(true);
        if (!fetched.length) setResult('端点未返回模型，可使用“自定模型”添加。');
      } else {
        const response = await testConnection(provider.endpoint, provider.apiKey, testModel);
        if (current === version.current) setResult(response.success ? '连接成功：模型已返回有效回复。' : `连接失败：${response.message}`);
      }
    } catch (error) {
      if (current === version.current) setResult(`获取模型列表失败：${error instanceof Error ? error.message : String(error)}。可以使用“自定模型”添加。`);
    } finally { setBusy(false); }
  }

  function addModel() {
    const id = modelId.trim();
    if (!id) return;
    if (provider.models.some((model) => model.id === id)) { setManualError('该模型 ID 已存在，请在列表中启用。'); return; }
    updateProvider(provider.id, { models: [...provider.models, { id, name: modelName.trim() || id, enabled: true }] });
    setTestModel(id); setManual(false); setModelId(''); setModelName(''); setResult('模型已添加并启用，可测试连接或设为默认模型。');
  }

  // 弹窗只决定哪些模型加入外层，已加入模型的启用状态由外层独立维护。
  function saveModelSelection() {
    const models = candidates.filter((model) => selectedModels.includes(model.id)).map((model) => ({ ...model, enabled: provider.models.find((existing) => existing.id === model.id)?.enabled ?? true }));
    updateProvider(provider.id, { models });
    if (!models.some((model) => model.id === testModel)) setTestModel(models[0]?.id ?? '');
    setDialog(false);
  }

  // 删除只移除本机目录项；会话保存的模型标识保留，重新添加后可继续使用。
  function deleteModel(id: string) {
    const models = provider.models.filter((model) => model.id !== id);
    updateProvider(provider.id, { models });
    if (testModel === id) setTestModel(models[0]?.id ?? '');
  }

  return <section className="min-w-0 flex-1 p-5 space-y-5">
      <header className="flex items-center justify-between"><h3 className="font-semibold">{provider.id === 'deepseek' ? 'DeepSeek · 深度求索' : provider.name}</h3><label className="flex gap-2 text-sm"><input type="checkbox" checked={provider.enabled} onChange={(e) => change(provider.id, { enabled: e.target.checked })} />启用供应商</label></header>
      <p className="text-xs text-text-muted">API 密钥和地址仅保存在这台电脑，不写入 workspace。换电脑后重新配置相同供应商和模型 ID 即可继续会话。</p>
      <label className="block space-y-2 text-sm">API 密钥<div className="flex gap-2"><input aria-label="供应商 API 密钥" type={visible ? 'text' : 'password'} value={provider.apiKey} onChange={(e) => change(provider.id, { apiKey: e.target.value })} className={field} autoComplete="off" /><button className={button} aria-label={visible ? '隐藏密钥' : '显示密钥'} onClick={() => setVisible(!visible)}>{visible ? <EyeOff size={16} /> : <Eye size={16} />}</button></div></label>
      <label className="block space-y-2 text-sm">API 地址<input aria-label="供应商 API 地址" className={field} value={provider.endpoint} onChange={(e) => change(provider.id, { endpoint: e.target.value })} placeholder={provider.id === 'bailian' ? 'https://dashscope.aliyuncs.com/compatible-mode/v1' : 'https://api.deepseek.com'} /></label>
      <div className="flex gap-2"><input aria-label="测试模型 ID" className={field} placeholder="输入用于测试的模型 ID" value={testModel} onChange={(e) => { version.current++; setResult(''); setTestModel(e.target.value); }} /><button className={`${button} shrink-0`} disabled={busy || !provider.endpoint.trim() || !provider.apiKey.trim() || !testModel.trim()} onClick={() => void request(false)}>测试连接</button></div>
      {result && <p role="status" className="text-sm text-accent-400 break-words">{result}</p>}
      <div className="flex items-center gap-2"><h4 className="flex-1 font-medium">模型 <span className="text-text-muted text-xs">{provider.models.filter((model) => model.enabled).length} 个已启用</span></h4><button className={`${button} flex items-center gap-2`} disabled={busy || !provider.endpoint.trim() || !provider.apiKey.trim()} onClick={() => void request(true)}><RefreshCw size={14} className={busy ? 'animate-spin' : ''} />模型列表</button><button aria-label="自定模型" className={`${button} flex items-center gap-2`} onClick={() => { setManual(true); setModelId(''); setModelName(''); setManualError(''); setResult(''); }}><Plus size={16} />自定模型</button></div>
      {manual && <ModelDialog title="自定模型" label="自定模型" onClose={() => setManual(false)}>
        <form className="space-y-4" onSubmit={(event) => { event.preventDefault(); addModel(); }}>
          <label className="block space-y-2 text-sm">模型 ID（必填）<input autoFocus aria-label="新模型 ID" className={field} placeholder="输入模型 ID" value={modelId} onChange={(event) => { setModelId(event.target.value); setManualError(''); }} /></label>
          <label className="block space-y-2 text-sm">模型名称（可选）<input aria-label="新模型名称" className={field} placeholder="默认使用模型 ID" value={modelName} onChange={(event) => setModelName(event.target.value)} /></label>
          {manualError && <p role="alert" className="text-sm text-red-400">{manualError}</p>}
          <footer className="flex justify-end gap-2"><button type="button" className={button} onClick={() => setManual(false)}>取消</button><button type="submit" className={button} disabled={!modelId.trim()}>添加并启用</button></footer>
        </form>
      </ModelDialog>}
      <div className="rounded-xl border border-border divide-y divide-border">{!provider.models.length && <p className="p-5 text-sm text-text-muted">暂无模型。打开“模型列表”选择启用，或通过“自定模型”添加。</p>}{provider.models.map((model) => <div key={model.id} className="flex flex-wrap items-center gap-3 p-3"><label className="flex min-w-0 flex-1 items-center gap-3"><input aria-label={`启用 ${model.id}`} type="checkbox" checked={model.enabled} onChange={(e) => updateProvider(provider.id, { models: provider.models.map((item) => item.id === model.id ? { ...item, enabled: e.target.checked } : item) })} /><span className="min-w-0"><span className="block truncate text-sm">{model.name}</span><span className="block truncate text-xs text-text-muted">{model.id}</span></span></label><div className="shrink-0 space-y-1"><span className="block text-[10px] text-text-muted">默认思考强度</span><ThinkingEffortControl label={`${model.id} 默认思考强度`} options={thinkingEffortOptions(model)} value={defaultThinkingEffort(model, legacy)} onChange={(effort) => updateProvider(provider.id, { models: provider.models.map((item) => item.id === model.id ? { ...item, defaultThinkingEffort: effort } : item) })} /></div><button className={button} disabled={!model.enabled || !provider.enabled} onClick={() => setDefaultModel({ providerId: provider.id, providerName: provider.name, modelId: model.id })}>{defaultModel?.providerId === provider.id && defaultModel.modelId === model.id ? '默认模型' : '设为默认'}</button><button aria-label={`删除模型 ${model.id}`} title="删除模型" className="rounded-lg p-2 text-text-muted hover:bg-red-500/10 hover:text-red-400" onClick={() => deleteModel(model.id)}><Trash2 size={16} /></button></div>)}</div>
      <p className="text-xs text-text-muted">未指定模型的会话使用默认模型，未单独设置强度时使用该模型的默认思考强度。重新获取模型列表可更新可选强度。关闭已选模型后，会话保留选择并提示重新启用。</p>
      {dialog && <ModelDialog title={`${provider.name} 模型 · ${candidates.length}`} label="模型列表" onClose={() => setDialog(false)}>
        <input autoFocus aria-label="搜索模型" className={field} placeholder="搜索模型…" value={search} onChange={(event) => setSearch(event.target.value)} />
        <div className="flex items-center justify-between text-xs text-text-muted"><span>已选择 {selectedModels.length} 个</span><button className="hover:text-text-primary" onClick={() => setSelectedModels([])}>清空选择</button></div>
        <div className="max-h-72 overflow-y-auto space-y-2">{candidates.filter((model) => `${model.id} ${model.name}`.toLowerCase().includes(search.toLowerCase())).map((model) => <label key={model.id} className={`flex gap-3 rounded-xl p-3 ${selectedModels.includes(model.id) ? 'bg-accent-500/10' : 'bg-surface-800'}`}><input type="checkbox" checked={selectedModels.includes(model.id)} onChange={(event) => setSelectedModels((ids) => event.target.checked ? [...ids, model.id] : ids.filter((id) => id !== model.id))} /><span className="min-w-0 text-sm break-all">{model.name}<small className="block text-text-muted">{model.id}</small></span></label>)}</div>
        <footer className="flex justify-end gap-2"><button className={button} onClick={() => setDialog(false)}>取消</button><button className={button} onClick={saveModelSelection}>保存选择</button></footer>
      </ModelDialog>}
    </section>;
}
