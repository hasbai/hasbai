import { MODEL_ID } from '@hasbai/ai';
import { HttpError } from './http';
import { cloudflare } from './management';

export type ChatModel = {id: string; name: string; type: 'chat'; context_tokens?: number};
const FRESH = 5 * 60_000, STALE = 60 * 60_000, MAX_BODY = 256 * 1024, MAX_MODELS = 200;
// Provider /models lists mix modalities; only chat models enter the catalog.
const NOT_CHAT = /image|embed|bge|whisper|tts|rerank|moderation/i;
type Entry = {at: number; models: ChatModel[]};
const providers = new Map<string, Entry>();
let catalog: Entry | undefined, flight: {gen: number; promise: Promise<ChatModel[]>} | undefined, generation = 0, failure: {at: number; error: HttpError} | undefined;
const RETRY = 30_000;

/** Admin provider writes change what exists upstream, so the next read rediscovers. */
export function invalidateCatalog() { catalog = undefined; failure = undefined; generation++; }
export function resetDiscovery() { providers.clear(); catalog = undefined; flight = undefined; failure = undefined; generation++; }

async function bounded(response: Response): Promise<string> {
  const reader = response.body?.getReader(); if (!reader) return '';
  const decoder = new TextDecoder(); let bytes = 0, text = '';
  try {
    for (;;) {
      const {done, value} = await reader.read(); if (done) break;
      bytes += value.length; if (bytes > MAX_BODY) throw new Error('too large');
      text += decoder.decode(value, {stream: true});
    }
    return text + decoder.decode();
  } finally { await reader.cancel().catch(() => {}); }
}
function contextTokens(row: Record<string, unknown>) {
  const value = row.context_length ?? row.max_model_len;
  return Number.isSafeInteger(value) && (value as number) >= 1024 ? value as number : undefined;
}
async function fromProvider(env: Env, slug: string): Promise<ChatModel[]> {
  const key = slug.startsWith('custom-') ? slug : 'custom-' + slug;
  const response = await fetch(`https://gateway.ai.cloudflare.com/v1/${env.CLOUDFLARE_ACCOUNT_ID}/${env.AIG_GATEWAY_ID}/${key}/models`, {
    redirect: 'manual', signal: AbortSignal.timeout(5000),
    headers: {'cf-aig-authorization': `Bearer ${env.AIG_RUN_TOKEN}`, 'cf-aig-byok-alias': 'default', 'cf-aig-collect-log': 'false', 'cf-aig-max-attempts': '1'},
  });
  if (!response.ok) { await response.body?.cancel(); throw new Error('provider unavailable'); }
  const body = JSON.parse(await bounded(response)) as {data?: unknown};
  if (!Array.isArray(body.data)) throw new Error('invalid model list');
  const models: ChatModel[] = [];
  for (const row of body.data.slice(0, MAX_MODELS)) {
    if (!row || typeof row !== 'object') continue;
    const {id} = row as {id?: unknown};
    const full = `${key}/${id}`;
    if (typeof id !== 'string' || !MODEL_ID.test(full) || NOT_CHAT.test(id)) continue;
    const context = contextTokens(row as Record<string, unknown>);
    models.push({id: full, name: id, type: 'chat', ...(context ? {context_tokens: context} : {})});
  }
  return models;
}
async function refresh(env: Env): Promise<ChatModel[]> {
  if (!env.AIG_RUN_TOKEN) throw new HttpError(503, 'AI 服务未配置');
  const started = generation;
  let result;
  try { result = await cloudflare(env, 'GET', 'custom-providers?page=1&per_page=100', undefined, 5000); }
  catch { throw new HttpError(503, '模型目录暂不可用，请稍后重试'); }
  const raw = result.result ?? result.data;
  const rows = Array.isArray(raw) ? raw : (raw as {providers?: unknown} | undefined)?.providers;
  const slugs = (Array.isArray(rows) ? rows : []).filter((row): row is {slug: string; enable?: boolean} => !!row && typeof row.slug === 'string' && /^[a-zA-Z0-9_-]+$/.test(row.slug) && row.enable !== false).map(row => row.slug);
  const now = Date.now();
  await Promise.all(slugs.map(async slug => {
    try { providers.set(slug, {at: now, models: await fromProvider(env, slug)}); } catch { /* keep the last good list below */ }
  }));
  for (const slug of [...providers.keys()]) if (!slugs.includes(slug)) providers.delete(slug);
  const models = slugs.flatMap(slug => { const entry = providers.get(slug); return entry && now - entry.at <= STALE ? entry.models : []; });
  if (slugs.length && !models.length) throw new HttpError(503, '模型目录暂不可用，请稍后重试');
  // An admin write during this refresh made the result stale before it was stored.
  if (started === generation) catalog = {at: now, models};
  return models;
}
/** Discovered chat models of every enabled custom provider, shared across concurrent callers. */
export async function discoverModels(env: Env): Promise<ChatModel[]> {
  if (catalog && Date.now() - catalog.at < FRESH) return catalog.models;
  const usable = () => catalog && Date.now() - catalog.at <= STALE ? catalog.models : undefined;
  // After a failed refresh, do not make every request wait for the same failing upstream.
  if (failure && Date.now() - failure.at < RETRY) { const stale = usable(); if (stale) return stale; throw failure.error; }
  // A refresh begun before an admin write may have used the old configuration; do not join it.
  if (!flight || flight.gen !== generation) {
    const current: typeof flight = {gen: generation, promise: refresh(env).finally(() => { if (flight === current) flight = undefined; })};
    flight = current;
  }
  const joined = flight;
  try { const models = await joined.promise; if (joined.gen === generation) failure = undefined; return models; }
  catch (error) {
    const wrapped = error instanceof HttpError ? error : new HttpError(503, '模型目录暂不可用，请稍后重试');
    if (joined.gen === generation) failure = {at: Date.now(), error: wrapped};
    const stale = usable(); if (stale) return stale;
    throw wrapped;
  }
}
