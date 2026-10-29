/** Only fixed route labels enter custom logs. Never log URL/query/header/body data. */
function routeLabel(request: Request): string {
  const path = new URL(request.url).pathname;
  if (path === '/health') return '/health';
  if (path.startsWith('/sub/')) return '/sub/:token';
  if (path.startsWith('/images/')) return '/images/:id';
  if (path === '/api') return '/api';
  const groups = ['version', 'me', 'admin', 'v1', 'v2', 'images', 'generate', 'settings',
    'prompts', 'discover', 'install', 'characters', 'worldbooks', 'sessions', 'channels',
    'telegram', 'mcp', 'locales', 'content', 'public', 'translate'];
  const group = path.split('/')[2];
  return path.startsWith('/api/') && groups.includes(group) ? `/api/${group}/*` : '/:route';
}

/** Measures response readiness; never buffers a streaming response or waits for its body. */
export async function observeRequest(
  request: Request,
  service: string,
  version: string | undefined,
  run: () => Promise<Response>,
): Promise<Response> {
  const started = performance.now();
  let status = 500;
  try {
    const response = await run();
    status = response.status;
    return response;
  } finally {
    const level = status >= 500 ? 'error' : status >= 400 ? 'warn' : 'info';
    const entry = {
      event: 'http_request', service, version: version ?? 'local', level,
      method: ['GET', 'HEAD', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'].includes(request.method)
        ? request.method : 'OTHER',
      route: routeLabel(request), status,
      response_ready_ms: Math.round((performance.now() - started) * 100) / 100,
    };
    console[level](entry);
  }
}
