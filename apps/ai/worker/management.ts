import { z } from 'zod';
import { invalidateCatalog } from './discovery';
import { HttpError } from './http';

const slug = z.string().regex(/^[a-zA-Z0-9_-]+$/).max(128);
const provider = z.object({
  name: z.string().trim().min(1).max(200), slug,
  base_url: z.url().refine(value => {const u = new URL(value); return u.protocol === 'https:' && !u.username && !u.password && !u.search && !u.hash;}, '使用不含凭据的 HTTPS 地址'),
  description: z.string().max(2000).optional(), enable: z.boolean().optional(),
}).strict();
const key = z.object({provider_slug: slug, alias: slug, default_config: z.boolean(), secret: z.string().min(1).max(16384)}).strict();
const rotation = z.object({secret: z.string().min(1).max(16384)}).strict();
const providerFields = ['id', 'name', 'slug', 'base_url', 'description', 'enable', 'created_at', 'modified_at'];
// Do not return provider headers, provider secrets, previews or complete API envelopes.
const keyFields = ['id', 'provider_slug', 'alias', 'default_config', 'gateway_id', 'modified_at', 'last_used_at'];
const pick = (value: Record<string, unknown>, fields: string[]) => Object.fromEntries(fields.filter(name => name in value).map(name => [name, value[name]]));
type Envelope = {success: boolean; result?: unknown; data?: unknown; result_info?: unknown};
export async function cloudflare(env: Env, method: string, suffix: string, value?: unknown, timeout = 20000): Promise<Envelope> {
  if (!env.CF_AI_MANAGEMENT_TOKEN) throw new HttpError(503, 'AI 管理服务未配置');
  const response = await fetch(`https://api.cloudflare.com/client/v4/accounts/${env.CLOUDFLARE_ACCOUNT_ID}/ai-gateway/${suffix}`, {
    method, redirect: 'manual', signal: AbortSignal.timeout(timeout),
    headers: {'Authorization': `Bearer ${env.CF_AI_MANAGEMENT_TOKEN}`, 'Content-Type': 'application/json'},
    ...(value === undefined ? {} : {body: JSON.stringify(value)}),
  });
  // Cloudflare validation errors may echo submitted credentials.
  if (!response.ok) {
    await response.body?.cancel();
    const status = [400, 404, 409, 429].includes(response.status) ? response.status : 502;
    throw new HttpError(status, status === 409 ? '配置已存在' : status === 404 ? '配置不存在' : status === 429 ? '请求过于频繁，请稍后重试' : 'Cloudflare 管理请求失败，请检查配置和权限');
  }
  const result = await response.json() as Envelope;
  if (result.success !== true) throw new HttpError(502, 'Cloudflare 管理请求失败');
  return result;
}
async function parse<T>(request: Request, schema: z.ZodType<T>): Promise<T> {
  let value; try {value = await request.json();} catch {throw new HttpError(400, 'JSON 格式无效');}
  const parsed = schema.safeParse(value);
  if (!parsed.success) throw new HttpError(400, '配置字段无效');
  return parsed.data;
}
export async function manage(request: Request, env: Env) {
  const url = new URL(request.url), path = url.pathname.slice('/api/admin/'.length), method = request.method;
  let suffix: string, schema: z.ZodType | undefined, fields: string[], collection: string | undefined;
  if (path === 'gateways' && method === 'GET') {suffix = 'gateways'; fields = ['id']; collection = 'gateways';}
  else if (/^providers(?:\/[a-zA-Z0-9_-]+)?$/.test(path)) {
    const id = path.split('/')[1]; suffix = 'custom-providers' + (id ? '/' + id : ''); fields = providerFields; collection = id ? undefined : 'providers';
    if (!id && method === 'POST') schema = provider;
    else if (id && method === 'PATCH') schema = provider.partial().refine(value => Object.keys(value).length > 0);
    else if (!(method === 'GET' || (id && method === 'DELETE'))) throw new HttpError(405, '请求方法无效');
  } else {
    const match = path.match(/^gateways\/([a-zA-Z0-9_-]+)\/keys(?:\/([a-zA-Z0-9_-]+))?$/);
    if (!match) throw new HttpError(404, '接口不存在');
    suffix = `gateways/${match[1]}/provider_configs` + (match[2] ? '/' + match[2] : ''); fields = keyFields; collection = match[2] ? undefined : 'keys';
    if (!match[2] && method === 'POST') schema = key;
    else if (match[2] && method === 'PUT') schema = rotation;
    else if (!(method === 'GET' || (match[2] && method === 'DELETE'))) throw new HttpError(405, '请求方法无效');
  }
  if (method === 'GET' && collection) {
    const page = Number(url.searchParams.get('page') || 1);
    if (!Number.isSafeInteger(page) || page < 1) throw new HttpError(400, '页码无效');
    suffix += `?page=${page}&per_page=100`;
  }
  const result = await cloudflare(env, method, suffix, schema ? await parse(request, schema) : undefined);
  if (method !== 'GET' && (suffix.startsWith('custom-providers') || suffix.includes('/provider_configs'))) invalidateCatalog();
  const raw = result.result ?? result.data;
  const rows = Array.isArray(raw) ? raw : collection && raw && typeof raw === 'object' ? (raw as Record<string, unknown>)[collection] : undefined;
  const sanitized = Array.isArray(rows) ? rows.map(row => pick(row, fields)) : raw && typeof raw === 'object' ? pick(raw as Record<string, unknown>, fields) : null;
  return Response.json({result: sanitized, ...(result.result_info ? {result_info: result.result_info} : {})}, {headers: {'Cache-Control': 'no-store'}});
}
