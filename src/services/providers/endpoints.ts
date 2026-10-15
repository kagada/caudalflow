// 聊天、连接测试和模型列表共用地址规则，避免同一份设置请求到不同路径。
export function resolveOpenAIEndpoint(endpoint: string, resource: 'chat/completions' | 'models'): string {
  const url = new URL(endpoint.trim());
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.hash) {
    throw new Error('Please enter an HTTP(S) API URL without credentials or a fragment.');
  }
  let path = url.pathname.replace(/\/+$/, '');
  path = path.replace(/\/(chat\/completions|models)$/, '');
  // 裸域名默认使用 /v1；已填写的版本号或网关前缀保持原样。
  if (!path) path = '/v1';
  url.pathname = `${path}/${resource}`;
  return url.toString();
}
