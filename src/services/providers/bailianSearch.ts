import { isBailianEndpoint } from './thinking';
import { apiFetch } from './transport';

// 只认接口明确返回的能力；缺失、格式错误都保留未知状态。
export function reportedWebSearchSupport(features: unknown): boolean | undefined {
  if (!Array.isArray(features) || features.some((feature) => typeof feature !== 'string')) return undefined;
  return features.includes('web-search');
}

// 兼容模型列表通常只有 ID，另向同源百炼目录读取能力，不拼接任何型号规则。
export async function fetchBailianSearchCapabilities(endpoint: string, apiKey: string): Promise<Map<string, boolean>> {
  const capabilities = new Map<string, boolean>();
  if (!isBailianEndpoint(endpoint)) return capabilities;
  const url = new URL(endpoint);
  url.pathname = '/api/v1/models';
  url.search = '';
  url.searchParams.set('page_size', '100');
  const signal = AbortSignal.timeout(15000);
  let received = 0;
  try {
    for (let page = 1; page <= 100; page++) {
      url.searchParams.set('page_no', String(page));
      const response = await apiFetch(url.toString(), { headers: { Authorization: `Bearer ${apiKey.trim()}` }, signal });
      if (!response.ok) break;
      const data = await response.json();
      const output = data?.output;
      if (data.success === false || !Array.isArray(output?.models)) break;
      for (const model of output.models) {
        const supported = reportedWebSearchSupport(model?.features);
        if (typeof model?.model === 'string' && supported !== undefined) capabilities.set(model.model, supported);
      }
      received += output.models.length;
      if (!output.models.length || typeof output.total !== 'number' || received >= output.total) break;
    }
  } catch { /* 能力查询失败不影响已有聊天配置，也不能误报为不支持。 */ }
  return capabilities;
}
