import { identity } from './auth';
import { failure, HttpError } from './http';
import { handleMcp } from './mcp';

export { WechatOwner } from './owner-object';

export default {
  async fetch(request: Request, env: Env) {
    try {
      const path = new URL(request.url).pathname;
      if (path === '/health' && request.method === 'GET') return Response.json({ ok: true, service: 'wechat', version: env.VERSION?.id });
      if (path !== '/mcp') throw new HttpError(404, '接口不存在');
      const sub = await identity(request);
      return await handleMcp(request, env.OWNERS.getByName(sub));
    } catch (error) { return failure(error); }
  },
} satisfies ExportedHandler<Env>;
