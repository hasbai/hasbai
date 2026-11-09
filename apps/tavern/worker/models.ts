import { AI_ORIGIN } from '@hasbai/ai';
import type { ModelOption, Settings } from '../shared/types';
import { boundedBody, HttpError } from './http';

const TTL = 5 * 60 * 1000;
export type Capability = { contextTokens: number | null; source: string; checkedAt: number; inputRatio: number; modelId?: string };
const unknown: Capability = { contextTokens: null, source: 'unknown', checkedAt: 0, inputRatio: 1.2 };

/** Context discovery is best effort. It never gates routing or parameter forwarding. */
export async function capabilities(env: Env, ctx: Pick<ExecutionContext, 'waitUntil'>, modelId = 'rp'): Promise<Capability> {
 if (modelId !== 'rp') {
  const cached = await env.DB.prepare('SELECT value_json,expires_at FROM model_capabilities WHERE id=?').bind(modelId).first<{value_json: string; expires_at: number}>();
  return cached && cached.expires_at > Date.now() ? {...JSON.parse(cached.value_json), modelId} : {...unknown, modelId};
 }
 const cached = await env.DB.prepare("SELECT value_json,expires_at FROM model_capabilities WHERE id='rp'").first<{ value_json: string; expires_at: number }>();
 const value = cached ? JSON.parse(cached.value_json) as Capability : unknown;
 const usable = ['llama.cpp:n_ctx', 'upstream:limit'].includes(value.source) && Number.isSafeInteger(value.contextTokens) && value.contextTokens! >= 1024;
 if (!cached || cached.expires_at <= Date.now() || !usable) ctx.waitUntil(refreshContext(env).catch(() => {}));
 return usable ? value : unknown;
}
async function refreshContext(env: Env) {
 const response = await fetch('https://llama.hasbai.xyz/props', { redirect: 'error', signal: AbortSignal.timeout(1500) });
 if (!response.ok || !response.body) { await response.body?.cancel(); return; }
 const reader = response.body.getReader(); let bytes = 0, text = ''; const decoder = new TextDecoder();
 try { for (;;) { const { value, done } = await reader.read(); if (done) break; bytes += value.length; if (bytes > 65536) return; text += decoder.decode(value, { stream: true }); } text += decoder.decode(); }
 finally { await reader.cancel().catch(() => {}); }
 const props = JSON.parse(text) as { default_generation_settings?: { n_ctx?: number } };
 const contextTokens = props.default_generation_settings?.n_ctx;
 if (!Number.isSafeInteger(contextTokens) || contextTokens! < 1024) return;
 const value: Capability = { contextTokens: contextTokens!, source: 'llama.cpp:n_ctx', checkedAt: Date.now(), inputRatio: 1.2 };
 await env.DB.prepare("INSERT INTO model_capabilities(id,value_json,expires_at) VALUES(?,?,?) ON CONFLICT(id) DO UPDATE SET value_json=excluded.value_json,expires_at=excluded.expires_at WHERE NOT(json_extract(value_json,'$.source')='upstream:limit' AND expires_at>? AND json_extract(value_json,'$.contextTokens')<?)").bind('rp', JSON.stringify(value), Date.now() + TTL, Date.now(), contextTokens).run();
}
export async function modelOptions(env: Env, ctx: Pick<ExecutionContext, 'waitUntil'>): Promise<ModelOption[]> {
 if (!env.AI_SERVICE) throw new HttpError(503, 'AI 服务未配置');
 let response: Response;
 try { response = await env.AI_SERVICE.fetch(AI_ORIGIN + '/internal/models', {method: 'GET', redirect: 'manual', signal: AbortSignal.timeout(10000)}); }
 catch { throw new HttpError(502, 'AI 平台模型列表暂时不可用，请重试'); }
 if (!response.ok) { await response.body?.cancel(); throw new HttpError(502, 'AI 平台模型列表暂时不可用，请重试'); }
 let catalog: {data?: {id: string; name: string; type: string}[]};
 try { catalog = JSON.parse(new TextDecoder().decode(await boundedBody(response, 65536))); }
 catch { throw new HttpError(502, 'AI 平台模型列表无效'); }
 if (!catalog || !Array.isArray(catalog.data) || catalog.data.some(m => !m || typeof m.id !== 'string' || typeof m.name !== 'string' || typeof m.type !== 'string')) throw new HttpError(502, 'AI 平台模型列表无效');
 return Promise.all(catalog.data.filter(m => m.type === 'chat').map(async m => ({
  id: m.id, name: m.name, available: true, contextTokens: (await capabilities(env, ctx, m.id)).contextTokens,
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
 await env.DB.prepare("INSERT INTO model_capabilities(id,value_json,expires_at) VALUES(?,?,?) ON CONFLICT(id) DO UPDATE SET value_json=json_set(excluded.value_json,'$.contextTokens',min(coalesce(json_extract(value_json,'$.contextTokens'),?),?)),expires_at=excluded.expires_at").bind(capability.modelId ?? 'rp',JSON.stringify(value),Date.now()+TTL,limit,limit).run();
}
