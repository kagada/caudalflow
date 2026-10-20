import { resolveOpenAIEndpoint } from './endpoints';
import type { ModelEffort } from '../../types/chat';
import { apiFetch } from './transport';
import { fetchBailianSearchCapabilities, reportedWebSearchSupport } from './bailianSearch';

export interface ModelInfo {
  id: string;
  name: string;
  effort?: ModelEffort;
  webSearchSupported?: boolean;
}

function authHeaders(apiKey: string): Record<string, string> {
  return apiKey.trim() ? { Authorization: `Bearer ${apiKey.trim()}` } : {};
}

// 将服务商错误带回设置面板，模型列表失败不再伪装成空列表。
async function responseError(response: Response): Promise<Error> {
  const data = await response.json().catch(() => null);
  const detail = data?.error?.message;
  return new Error(typeof detail === 'string' ? `HTTP ${response.status}: ${detail}` : `HTTP ${response.status}`);
}

export async function fetchModels(endpoint: string, apiKey: string): Promise<ModelInfo[]> {
  const response = await apiFetch(resolveOpenAIEndpoint(endpoint, 'models'), {
    headers: authHeaders(apiKey),
    signal: AbortSignal.timeout(15000),
  });
  if (!response.ok) throw await responseError(response);
  const data = await response.json();
  const entries: unknown = Array.isArray(data) ? data : data.data;
  if (!Array.isArray(entries)) throw new Error('The API did not return a model list.');
  const models: ModelInfo[] = entries.flatMap((entry: unknown) => {
    if (!entry || typeof entry !== 'object') return [];
    const model = entry as { id?: unknown; name?: unknown; features?: unknown; effort?: { supported_levels?: unknown; default_level?: unknown } };
    const id = typeof model.id === 'string' ? model.id : typeof model.name === 'string' ? model.name : '';
    // 能力只取服务端明确报告的档位，兼容缺少元信息的模型列表。
    const levels = Array.isArray(model.effort?.supported_levels) ? [...new Set(model.effort.supported_levels.filter((level): level is string => typeof level === 'string' && !!level.trim() && !['none', 'auto'].includes(level)))] : [];
    const defaultLevel = typeof model.effort?.default_level === 'string' && levels.includes(model.effort.default_level) ? model.effort.default_level : undefined;
    const webSearchSupported = reportedWebSearchSupport(model.features);
    return id ? [{ id, name: typeof model.name === 'string' ? model.name : id, ...(webSearchSupported !== undefined ? { webSearchSupported } : {}), ...(levels.length ? { effort: { supportedLevels: levels, ...(defaultLevel ? { defaultLevel } : {}) } } : {}) }] : [];
  });
  const capabilities = models.some((model) => model.webSearchSupported === undefined) ? await fetchBailianSearchCapabilities(endpoint, apiKey) : new Map<string, boolean>();
  return models.map((model) => model.webSearchSupported === undefined && capabilities.has(model.id) ? { ...model, webSearchSupported: capabilities.get(model.id) } : model);
}

// 连接测试只验证地址、鉴权和接口格式，不生成回复，也不依赖选择具体模型。
export async function testConnection(endpoint: string, apiKey: string): Promise<{ success: boolean; message: string }> {
  try {
    const response = await apiFetch(resolveOpenAIEndpoint(endpoint, 'models'), {
      headers: authHeaders(apiKey),
      signal: AbortSignal.timeout(20000),
    });
    if (!response.ok) throw await responseError(response);
    const data = await response.json();
    if (!Array.isArray(data) && !Array.isArray(data?.data)) {
      return { success: false, message: '接口没有返回有效的模型目录。' };
    }
    return { success: true, message: 'Connection successful' };
  } catch (error) {
    return { success: false, message: error instanceof Error ? error.message : 'Connection failed' };
  }
}
