const path = require('node:path');
const { pathToFileURL } = require('node:url');

const APP_ORIGIN = 'app://caudalflow';

// 只向用户配置的 HTTP 接口转发必要请求头，不把桌面会话和文件权限交给网页。
async function proxyAPI(request, fetchRemote) {
  const url = new URL(request.url);
  const target = new URL(url.searchParams.get('url'));
  if (!['https:', 'http:'].includes(target.protocol) || target.username || target.password) {
    return new Response('Invalid API URL', { status: 400 });
  }
  if (!['GET', 'POST'].includes(request.method)) return new Response('Method not allowed', { status: 405 });
  const headers = new Headers();
  for (const name of ['content-type', 'authorization', 'accept']) {
    const value = request.headers.get(name);
    if (value) headers.set(name, value);
  }
  return fetchRemote(target.toString(), {
    method: request.method,
    headers,
    body: request.method === 'POST' ? await request.arrayBuffer() : undefined,
    signal: request.signal,
    redirect: 'error',
    credentials: 'omit',
  });
}

// 使用固定来源提供界面与流式 API，既保留本地存储，也不占用任何 HTTP 端口。
function createProtocolHandler(distDir, fetchRemote) {
  return async (request) => {
    try {
      const url = new URL(request.url);
      if (url.host !== 'caudalflow') return new Response('Forbidden', { status: 403 });
      if (request.initiatorOrigin && request.initiatorOrigin !== APP_ORIGIN) return new Response('Forbidden', { status: 403 });
      if (url.pathname === '/api/proxy') return await proxyAPI(request, fetchRemote);
      if (url.pathname.startsWith('/api/')) {
        return Response.json({ error: '此功能需要额外的 Agent 后端；桌面版节点聊天可直接使用自定义 API。' }, { status: 503 });
      }
      if (!['GET', 'HEAD'].includes(request.method)) return new Response('Method not allowed', { status: 405 });
      const pathname = decodeURIComponent(url.pathname === '/' ? '/index.html' : url.pathname);
      const file = path.resolve(distDir, `.${pathname}`);
      const relative = path.relative(distDir, file);
      if (!relative || relative.startsWith('..') || path.isAbsolute(relative)) return new Response('Forbidden', { status: 403 });
      const response = await fetchRemote(pathToFileURL(file).toString());
      if (relative === 'index.html') {
        const headers = new Headers(response.headers);
        headers.set('Content-Security-Policy', "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob: https: http:; connect-src 'self'; font-src 'self' data:; object-src 'none'; base-uri 'self'; frame-src 'none'");
        return new Response(response.body, { status: response.status, headers });
      }
      return response;
    } catch (error) {
      return Response.json({ error: { message: error instanceof Error ? error.message : 'Desktop request failed' } }, { status: 502 });
    }
  };
}

module.exports = { APP_ORIGIN, createProtocolHandler };
