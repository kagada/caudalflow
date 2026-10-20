import type { LLMConfig } from '../../types/chat';
import { apiFetch } from './transport';
import type { StreamCallbacks } from './types';

// 只声明已接入的官方模型能力，第三方兼容接口不能据名称推断搜索可用。
export function supportsWebSearch(config: Pick<LLMConfig, 'providerId' | 'endpoint' | 'model'>): boolean {
  try {
    const url = new URL(config.endpoint.trim());
    return config.providerId === 'deepseek' && url.origin === 'https://api.deepseek.com'
      && /^deepseek-(chat|reasoner|flash|pro|v4(?:\.1)?-(?:flash|pro)(?:-\d+)?)$/.test(config.model);
  } catch { return false; }
}

export const webTools = [
  { type: 'function', function: { name: 'web_search', description: '搜索实时网页。仅在需要最新资料、核实事实或用户明确要求联网时使用，普通知识问题直接回答。', parameters: { type: 'object', properties: { query: { type: 'string', description: '搜索词，最多128个字符' } }, required: ['query'] } } },
  { type: 'function', function: { name: 'web_fetch', description: '读取搜索结果中的网页，摘要不足时使用。', parameters: { type: 'object', properties: { url: { type: 'string' } }, required: ['url'] } } },
];

export interface ToolCall { id: string; type: 'function'; function: { name: string; arguments: string } }

// 工具只能访问官方接口；限制资料量，并把网页视作资料而非指令。
export async function executeWebTool(call: ToolCall, config: LLMConfig, signal: AbortSignal, sources: Set<string>, debug?: StreamCallbacks['onDebug']): Promise<string> {
  const args = JSON.parse(call.function.arguments);
  let resource: string;
  let body: Record<string, unknown>;
  if (call.function.name === 'web_search') {
    if (typeof args.query !== 'string' || !args.query.trim() || [...args.query].length > 128) throw new Error('搜索词必须为1至128个字符。');
    resource = 'search'; body = { query: args.query, count: 5 };
  } else if (call.function.name === 'web_fetch') {
    if (typeof args.url !== 'string' || !sources.has(args.url)) throw new Error('只能读取本轮搜索返回的网页。');
    resource = 'fetch'; body = { url: args.url };
  } else throw new Error('模型请求了不支持的工具。');
  debug?.({ stage: '联网接口请求', data: { toolCallId: call.id, url: `https://api.deepseek.com/v1/tools/${resource}`, body } });
  const response = await apiFetch(`https://api.deepseek.com/v1/tools/${resource}`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${config.apiKey.trim()}` },
    body: JSON.stringify(body), signal: AbortSignal.any([signal, AbortSignal.timeout(30000)]),
  });
  if (!response.ok) {
    debug?.({ stage: '联网接口错误', data: { toolCallId: call.id, status: response.status, body: await response.clone().text() } });
    throw new Error(`联网${resource === 'search' ? '搜索' : '读取网页'}失败（${response.status}）。`);
  }
  const data = await response.json();
  debug?.({ stage: '联网接口原始返回', data: { toolCallId: call.id, status: response.status, body: data } });
  if (resource === 'search') {
    if (!Array.isArray(data.results)) throw new Error('搜索接口返回格式错误。');
    const results = data.results.slice(0, 5).map((item: Record<string, unknown>) => {
      const url = typeof item.url === 'string' && /^https?:\/\//.test(item.url) ? item.url : '';
      if (url) sources.add(url);
      return { title: String(item.title ?? '').slice(0, 500), url, date: item.date, summary: String(item.summary ?? item.snippet ?? '').slice(0, 4000) };
    });
    return JSON.stringify({ results });
  }
  if (typeof data.content !== 'string') throw new Error('网页接口返回格式错误。');
  return JSON.stringify({ title: String(data.title ?? '').slice(0, 500), content: data.content.slice(0, 18000) });
}
