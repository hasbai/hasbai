import { WorkerEntrypoint } from 'cloudflare:workers';
import { identity } from './auth';
import { failure, HttpError } from './http';
import { inference, validateTask, type Attribution } from './inference';
import { manage } from './management';

/** Only explicitly configured service bindings can reach this entrypoint. */
export class InferenceService extends WorkerEntrypoint<Env> {
  async fetch(request: Request) {
    try {
      const path = new URL(request.url).pathname;
      if (request.method !== 'POST' || !path.startsWith('/internal/')) throw new HttpError(404, '接口不存在');
      const who = JSON.parse(request.headers.get('X-AI-Attribution') || 'null');
      if (!who || !['tavern', 'blog', 'images'].includes(who.app) || typeof who.username !== 'string' || !who.username.trim()) throw new HttpError(400, '缺少调用归属');
      const task = path.slice('/internal/'.length); validateTask(task, who.app);
      return await inference(this.env, task, await body(request), {...who, requestId: who.requestId || crypto.randomUUID()}, request.signal);
    } catch (error) { return failure(error); }
  }
}
export async function body(request: Request): Promise<Record<string, unknown>> {
  let value: unknown; try { value = await request.json(); } catch { throw new HttpError(400, 'JSON 格式无效'); }
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new HttpError(400, '请求必须是 JSON 对象');
  return value as Record<string, unknown>;
}
export default {
  async fetch(request: Request, env: Env) {
    try {
      const path = new URL(request.url).pathname;
      if (path === '/health' && request.method === 'GET') return Response.json({ok: true, service: 'ai', version: env.VERSION?.id});
      if (path.startsWith('/internal/')) throw new HttpError(404, '接口不存在');
      if (!path.startsWith('/api/') && !path.startsWith('/v1/')) return env.ASSETS.fetch(request);
      const user = await identity(request);
      if (path === '/api/me' && request.method === 'GET') return Response.json(user, {headers: {'Cache-Control': 'no-store'}});
      if (path.startsWith('/api/admin/')) {
        if (!user.admin) throw new HttpError(403, '仅 Super Admin 可管理 AI 服务');
        return await manage(request, env);
      }
      if (path === '/v1/models' && request.method === 'GET') return Response.json({object: 'list', data: ['rp', 'translate', 'gpt-image-2.5-flare', 'gpt-image-2.5-sunburst', '@cf/baai/bge-m3'].map(id => ({id, object: 'model', owned_by: 'hasbai'}))});
      if (request.method !== 'POST') throw new HttpError(404, '接口不存在');
      const input = await body(request);
      let task: string;
      if (path === '/v1/chat/completions') {
        if (!['rp', 'translate'].includes(String(input.model))) throw new HttpError(400, '未知对话模型');
        task = input.model === 'translate' ? 'translate' : 'roleplay';
        if (!Array.isArray(input.messages) || !input.messages.length) throw new HttpError(400, '缺少对话消息');
      } else if (path === '/v1/images/generations') task = 'image-generation';
      else if (path === '/v1/embeddings') {
        if (input.model !== '@cf/baai/bge-m3') throw new HttpError(400, '未知向量模型');
        task = 'embedding'; input.text = typeof input.input === 'string' ? [input.input] : input.input;
      } else throw new HttpError(404, '接口不存在');
      validateTask(task, 'ai');
      const who: Attribution = {app: 'ai', username: user.username, requestId: crypto.randomUUID()};
      const result = await inference(env, task, input, who, request.signal);
      if (task !== 'embedding' || !result.ok) return result;
      const value = await result.json() as {data: number[][]};
      return Response.json({object: 'list', model: '@cf/baai/bge-m3', data: value.data.map((embedding, index) => ({object: 'embedding', index, embedding}))}, {headers: {'Cache-Control': 'no-store'}});
    } catch (error) { return failure(error); }
  },
} satisfies ExportedHandler<Env>;
