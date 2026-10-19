import { useRef, useState } from 'react';
import { Eye, EyeOff, Plus, RefreshCw, X } from 'lucide-react';
import { useModelStore } from '../../stores/modelStore';
import { fetchModels, testConnection } from '../../services/providers/api';
import type { ManagedModel } from '../../types/chat';

const field = 'w-full rounded-xl border border-border bg-surface-800 px-3 py-2 text-sm focus:outline-none focus:border-accent-500';
const button = 'rounded-lg border border-border px-3 py-2 text-sm hover:bg-surface-700 disabled:opacity-40';

// 供应商配置只写本机目录，同步仅提供候选项，启用状态由用户决定。
export function ModelManagement() {
  const { providers, updateProvider, defaultModel, setDefaultModel } = useModelStore();
  const provider = providers[0];
  const [visible, setVisible] = useState(false);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState('');
  const [dialog, setDialog] = useState(false);
  const [candidates, setCandidates] = useState<ManagedModel[]>([]);
  const [search, setSearch] = useState('');
  const [manual, setManual] = useState(false);
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
        for (const model of fetched) if (!entries.has(model.id)) entries.set(model.id, { ...model, enabled: false });
        setCandidates([...entries.values()]); setSearch(''); setDialog(true);
        if (!fetched.length) setResult('端点未返回模型，可使用 + 手动添加。');
      } else {
        const response = await testConnection(provider.endpoint, provider.apiKey, testModel);
        if (current === version.current) setResult(response.success ? '连接成功：模型已返回有效回复。' : `连接失败：${response.message}`);
      }
    } catch (error) {
      if (current === version.current) setResult(`同步失败：${error instanceof Error ? error.message : String(error)}。可以使用 + 手动添加模型。`);
    } finally { setBusy(false); }
  }

  function addModel() {
    const id = modelId.trim();
    if (!id) return;
    if (provider.models.some((model) => model.id === id)) { setResult('该模型 ID 已存在，请在列表中启用。'); return; }
    updateProvider(provider.id, { models: [...provider.models, { id, name: modelName.trim() || id, enabled: true }] });
    setTestModel(id); setManual(false); setModelId(''); setModelName(''); setResult('模型已添加并启用，可测试连接或设为默认模型。');
  }

  return <div className="flex min-h-full flex-col sm:flex-row">
    <aside className="border-b sm:border-b-0 sm:border-r border-border p-4 sm:w-48 shrink-0"><p className="mb-3 text-xs text-text-muted">供应商</p><button aria-pressed="true" className="w-full rounded-xl bg-accent-500/10 p-3 text-left text-sm text-accent-400">DeepSeek <span className="float-right">{provider.enabled ? '●' : '○'}</span></button></aside>
    <section className="min-w-0 flex-1 p-5 space-y-5">
      <header className="flex items-center justify-between"><h3 className="font-semibold">DeepSeek · 深度求索</h3><label className="flex gap-2 text-sm"><input type="checkbox" checked={provider.enabled} onChange={(e) => change(provider.id, { enabled: e.target.checked })} />启用供应商</label></header>
      <p className="text-xs text-text-muted">API 密钥和地址仅保存在这台电脑，不写入 workspace。换电脑后重新配置相同供应商和模型 ID 即可继续会话。</p>
      <label className="block space-y-2 text-sm">API 密钥<div className="flex gap-2"><input aria-label="供应商 API 密钥" type={visible ? 'text' : 'password'} value={provider.apiKey} onChange={(e) => change(provider.id, { apiKey: e.target.value })} className={field} autoComplete="off" /><button className={button} aria-label={visible ? '隐藏密钥' : '显示密钥'} onClick={() => setVisible(!visible)}>{visible ? <EyeOff size={16} /> : <Eye size={16} />}</button></div></label>
      <label className="block space-y-2 text-sm">API 地址<input aria-label="供应商 API 地址" className={field} value={provider.endpoint} onChange={(e) => change(provider.id, { endpoint: e.target.value })} placeholder="https://api.deepseek.com" /></label>
      <div className="flex gap-2"><input aria-label="测试模型 ID" className={field} placeholder="输入用于测试的模型 ID" value={testModel} onChange={(e) => { version.current++; setResult(''); setTestModel(e.target.value); }} /><button className={`${button} shrink-0`} disabled={busy || !provider.endpoint.trim() || !provider.apiKey.trim() || !testModel.trim()} onClick={() => void request(false)}>测试连接</button></div>
      {result && <p role="status" className="text-sm text-accent-400 break-words">{result}</p>}
      <div className="flex items-center gap-2"><h4 className="flex-1 font-medium">模型 <span className="text-text-muted text-xs">{provider.models.filter((model) => model.enabled).length} 个已启用</span></h4><button className={`${button} flex items-center gap-2`} disabled={busy || !provider.endpoint.trim() || !provider.apiKey.trim()} onClick={() => void request(true)}><RefreshCw size={14} className={busy ? 'animate-spin' : ''} />同步模型</button><button aria-label="手动添加模型" className={button} onClick={() => { setManual(!manual); setResult(''); }}><Plus size={16} /></button></div>
      {manual && <div className="rounded-xl border border-border p-3 space-y-3"><input aria-label="新模型 ID" className={field} placeholder="模型 ID（必填）" value={modelId} onChange={(e) => setModelId(e.target.value)} /><input aria-label="新模型名称" className={field} placeholder="模型名称（可选）" value={modelName} onChange={(e) => setModelName(e.target.value)} /><button className={button} disabled={!modelId.trim()} onClick={addModel}>添加并启用</button></div>}
      <div className="rounded-xl border border-border divide-y divide-border">{!provider.models.length && <p className="p-5 text-sm text-text-muted">暂无模型。同步模型后选择启用，或点击 + 手动添加。</p>}{provider.models.map((model) => <div key={model.id} className="flex items-center gap-3 p-3"><label className="flex min-w-0 flex-1 items-center gap-3"><input aria-label={`启用 ${model.id}`} type="checkbox" checked={model.enabled} onChange={(e) => updateProvider(provider.id, { models: provider.models.map((item) => item.id === model.id ? { ...item, enabled: e.target.checked } : item) })} /><span className="min-w-0"><span className="block truncate text-sm">{model.name}</span><span className="block truncate text-xs text-text-muted">{model.id}</span></span></label><button className={button} disabled={!model.enabled || !provider.enabled} onClick={() => setDefaultModel({ providerId: provider.id, providerName: provider.name, modelId: model.id })}>{defaultModel?.providerId === provider.id && defaultModel.modelId === model.id ? '默认模型' : '设为默认'}</button></div>)}</div>
      <p className="text-xs text-text-muted">未指定模型的会话使用默认模型。关闭已选模型后，会话保留选择并提示重新启用。</p>
      {dialog && <div className="fixed inset-0 z-[12000] flex items-center justify-center bg-black/50 p-5" onKeyDown={(e) => { if (e.key === 'Escape') setDialog(false); }}><div role="dialog" aria-modal="true" aria-label="选择同步模型" className="w-full max-w-xl rounded-2xl border border-border bg-surface-900 p-5 shadow-2xl space-y-4"><header className="flex justify-between font-semibold">DeepSeek 模型 · {candidates.length}<button aria-label="关闭模型选择" onClick={() => setDialog(false)}><X size={18} /></button></header><input autoFocus aria-label="搜索模型" className={field} placeholder="搜索模型…" value={search} onChange={(e) => setSearch(e.target.value)} /><div className="max-h-72 overflow-y-auto space-y-2">{candidates.filter((model) => `${model.id} ${model.name}`.toLowerCase().includes(search.toLowerCase())).map((model) => <label key={model.id} className={`flex gap-3 rounded-xl p-3 ${model.enabled ? 'bg-accent-500/10' : 'bg-surface-800'}`}><input type="checkbox" checked={model.enabled} onChange={(e) => setCandidates((items) => items.map((item) => item.id === model.id ? { ...item, enabled: e.target.checked } : item))} /><span className="min-w-0 text-sm break-all">{model.name}<small className="block text-text-muted">{model.id}</small></span></label>)}</div><footer className="flex justify-end gap-2"><button className={button} onClick={() => setDialog(false)}>取消</button><button className={button} onClick={() => { updateProvider(provider.id, { models: candidates }); setDialog(false); }}>保存选择</button></footer></div></div>}
    </section>
  </div>;
}
