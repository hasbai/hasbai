import { AI_ORIGIN } from '@hasbai/ai';
import type { ModelOption, Settings } from '../shared/types';
import { boundedBody, HttpError } from './http';

const TTL = 60 * 60 * 1000;
export type Capability = { contextTokens: number | null; source: string; checkedAt: number; inputRatio: number; modelId?: string };
const unknown: Capability = { contextTokens: null, source: 'unknown', checkedAt: 0, inputRatio: 1.2 };
type CatalogModel = { id: string; name: string; type: string; provider?: string; target?: string; context_tokens?: number };

async function catalog(env: Env): Promise<CatalogModel[]> {
 if (!env.AI_SERVICE) throw new HttpError(503, 'AI 服务未配置');
 let response: Response;
 try { response = await env.AI_SERVICE.fetch(AI_ORIGIN + '/internal/models', {method: 'GET', redirect: 'manual', signal: AbortSignal.timeout(10000)}); }
 catch { throw new HttpError(502, 'AI 平台模型列表暂时不可用，请重试'); }
 if (!response.ok) { await response.body?.cancel(); throw new HttpError(502, 'AI 平台模型列表暂时不可用，请重试'); }
 let body: {data?: CatalogModel[]};
 try { body = JSON.parse(new TextDecoder().decode(await boundedBody(response, 262144))); }
 catch { throw new HttpError(502, 'AI 平台模型列表无效'); }
 if (!body || !Array.isArray(body.data) || body.data.some(m => !m || typeof m.id !== 'string' || typeof m.name !== 'string' || typeof m.type !== 'string')) throw new HttpError(502, 'AI 平台模型列表无效');
 return body.data.filter(m => m.type === 'chat');
}
/** Context size comes from the discovered catalog; explicit upstream errors can only lower it. It never gates routing. */
export async function capabilities(env: Env, _ctx: Pick<ExecutionContext, 'waitUntil'>, modelId = 'default'): Promise<Capability> {
 const entry = (await catalog(env).catch(() => [])).find(m => m.id === modelId);
 return capability(env, entry?.target ?? modelId, entry?.context_tokens);
}
async function capability(env: Env, key: string, contextTokens?: number): Promise<Capability> {
 const cached = await env.DB.prepare('SELECT value_json,expires_at FROM model_capabilities WHERE id=?').bind(key).first<{value_json: string; expires_at: number}>();
 const feedback = cached && cached.expires_at > Date.now() ? JSON.parse(cached.value_json) as Capability : undefined;
 const limit = feedback?.source === 'upstream:limit' && Number.isSafeInteger(feedback.contextTokens) ? feedback.contextTokens : null;
 if (limit !== null && (contextTokens === undefined || limit < contextTokens)) return {...feedback!, modelId: key};
 if (contextTokens !== undefined) return {contextTokens, source: 'catalog:context', checkedAt: Date.now(), inputRatio: unknown.inputRatio, modelId: key};
 return {...unknown, modelId: key};
}
export async function modelOptions(env: Env, ctx: Pick<ExecutionContext, 'waitUntil'>): Promise<ModelOption[]> {
 const models = await catalog(env);
 return Promise.all(models.map(async m => ({
  id: m.id, name: m.name, ...(typeof m.provider === 'string' ? { provider: m.provider } : {}), available: true, contextTokens: (await capability(env, m.target ?? m.id, m.context_tokens)).contextTokens,
  parameters: {topK: true, penalties: true, thinking: true, topKMax: 1000},
 })));
}
export async function validateModel(env: Env, ctx: Pick<ExecutionContext, 'waitUntil'>, modelId: string) {
 if (!(await modelOptions(env, ctx)).some(m => m.id === modelId && m.available)) throw new HttpError(400, '模型不可用，请重新选择');
}
export function modelInput(settings: Settings) {
 return { model: settings.modelId, min_p: settings.minP, repetition_penalty: settings.repetitionPenalty, temperature: settings.temperature, top_p: settings.topP, cache_prompt: true, chat_template_kwargs: { enable_thinking: settings.thinkingEnabled }, reasoning_effort: settings.thinkingEnabled ? settings.reasoningEffort : 'none', reasoning_format: 'deepseek', ...(settings.topK ? { top_k: settings.topK } : {}), frequency_penalty: settings.frequencyPenalty, presence_penalty: settings.presencePenalty, stream_options: { include_usage: true } };
}
/** Explicit upstream capacity is cached; generation compresses history before retrying. */
export async function recordFeedback(env: Env, capability: Capability, feedback: { model?: string; contextLimit?: number }) {
 const limit = feedback.contextLimit;
 if (!Number.isSafeInteger(limit) || limit! < 1024 || (capability.contextTokens !== null && limit! >= capability.contextTokens)) return;
 const value: Capability = { ...capability, contextTokens: limit!, source: 'upstream:limit', checkedAt: Date.now() };
 await env.DB.prepare("INSERT INTO model_capabilities(id,value_json,expires_at) VALUES(?,?,?) ON CONFLICT(id) DO UPDATE SET value_json=json_set(excluded.value_json,'$.contextTokens',min(coalesce(json_extract(value_json,'$.contextTokens'),?),?)),expires_at=excluded.expires_at").bind(capability.modelId ?? 'default',JSON.stringify(value),Date.now()+TTL,limit,limit).run();
}
