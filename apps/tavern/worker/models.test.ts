import { beforeEach, afterEach, it, expect, vi } from 'vitest';
import { DatabaseSync } from 'node:sqlite';
import { capabilities, modelInput, recordFeedback, modelOptions, validateModel } from './models';
import { DEFAULT_SETTINGS, SAMPLING_TEMPLATES } from '../shared/types';
import { explicitContextLimit, errorFeedback } from './generation';
let db: DatabaseSync, env: Env, work: Promise<unknown>[];
const ctx = { waitUntil: (p: Promise<unknown>) => { work.push(p); } };
function stmt(sql: string, values: unknown[] = []): D1PreparedStatement { return { bind: (...v: unknown[]) => stmt(sql, v), first: async () => db.prepare(sql).get(...values as never[]) ?? null, run: async () => { db.prepare(sql).run(...values as never[]); return { meta: { changes: 1 } }; } } as D1PreparedStatement; }
const catalogBody = { data: [
 { id: 'default', name: '平台默认 · qwen3', type: 'chat', target: 'custom-main/qwen3', context_tokens: 32768 },
 { id: 'custom-main/qwen3', name: 'qwen3', type: 'chat', context_tokens: 32768 },
 { id: 'custom-main/chat-b', name: 'chat-b', type: 'chat' },
 { id: 'gpt-image-2.5-flare', name: 'Flare', type: 'image' },
] };
beforeEach(() => { db = new DatabaseSync(':memory:'); db.exec('CREATE TABLE model_capabilities(id TEXT PRIMARY KEY,value_json TEXT,expires_at INTEGER)'); work = []; env = { DB: { prepare: stmt }, AI_SERVICE: { fetch: vi.fn(async () => Response.json(catalogBody)) } } as unknown as Env; });
afterEach(async () => { await Promise.all(work); db.close(); vi.unstubAllGlobals(); });
it('lists only discovered chat models with catalog context and forwards sampling and thinking', async () => {
 expect(await modelOptions(env,ctx)).toMatchObject([{id:'default',available:true,contextTokens:32768,parameters:{topK:true,thinking:true}},{id:'custom-main/qwen3',contextTokens:32768},{id:'custom-main/chat-b',contextTokens:null}]);
 expect(modelInput({...DEFAULT_SETTINGS,topK:20,thinkingEnabled:false})).toMatchObject({model:'default',top_k:20,top_p:0.8,chat_template_kwargs:{enable_thinking:false},presence_penalty:1.5,frequency_penalty:0});
 expect(modelInput({...DEFAULT_SETTINGS,thinkingEnabled:true})).toMatchObject({chat_template_kwargs:{enable_thinking:true},reasoning_effort:'low',reasoning_format:'deepseek'});expect(modelInput(DEFAULT_SETTINGS)).toHaveProperty('reasoning_effort','none');expect(modelInput({...DEFAULT_SETTINGS,topK:0})).not.toHaveProperty('top_k');
 expect(modelInput({...DEFAULT_SETTINGS,modelId:'custom-main/chat-b'})).toHaveProperty('model','custom-main/chat-b');
});
it.each(['low','medium','high'] as const)('forwards selected %s effort only when thinking is enabled',effort=>{
 expect(modelInput({...DEFAULT_SETTINGS,thinkingEnabled:true,reasoningEffort:effort})).toMatchObject({chat_template_kwargs:{enable_thinking:true},reasoning_effort:effort});
 expect(modelInput({...DEFAULT_SETTINGS,thinkingEnabled:false,reasoningEffort:effort})).toMatchObject({chat_template_kwargs:{enable_thinking:false},reasoning_effort:'none'});
});
it('resolves default to its target for context and treats unknown context as unknown', async () => {
 expect(await capabilities(env,ctx)).toMatchObject({contextTokens:32768,source:'catalog:context',modelId:'custom-main/qwen3'});
 expect(await capabilities(env,ctx,'custom-main/chat-b')).toMatchObject({contextTokens:null,source:'unknown',modelId:'custom-main/chat-b'});
 vi.mocked(env.AI_SERVICE.fetch).mockRejectedValue(new Error('down'));
 expect((await capabilities(env,ctx,'default')).contextTokens).toBeNull();
});
it('uses explicit upstream limits without automatically retrying inference', async () => {
 expect(explicitContextLimit('maximum context length is 8192 tokens')).toBe(8192);expect(explicitContextLimit('you used 8192 prompt tokens')).toBeUndefined();
 const known=await capabilities(env,ctx);
 await errorFeedback(env,known,{error:{message:'maximum context length is 8192 tokens'}});expect((await capabilities(env,ctx)).contextTokens).toBe(8192);
 await recordFeedback(env,known,{contextLimit:4096});expect((await capabilities(env,ctx)).contextTokens).toBe(4096);
 await recordFeedback(env,known,{contextLimit:16384});expect((await capabilities(env,ctx)).contextTokens).toBe(4096);
});
it.each(['thinking','instruct'] as const)('forwards all six %s template values without changes',mode=>{
 const t=SAMPLING_TEMPLATES[mode];
 expect(modelInput({...DEFAULT_SETTINGS,...t,thinkingEnabled:mode==='thinking'})).toMatchObject({temperature:t.temperature,top_p:t.topP,top_k:t.topK,min_p:t.minP,presence_penalty:t.presencePenalty,repetition_penalty:t.repetitionPenalty});
});

it('validates selections against the platform catalog and never falls back on discovery failure', async () => {
 await expect(validateModel(env,ctx,'default')).resolves.toBeUndefined();
 await expect(validateModel(env,ctx,'custom-main/chat-b')).resolves.toBeUndefined();
 await expect(validateModel(env,ctx,'gpt-image-2.5-flare')).rejects.toThrow('模型不可用');
 await expect(validateModel(env,ctx,'rp')).rejects.toThrow('模型不可用');
 vi.mocked(env.AI_SERVICE.fetch).mockResolvedValue(new Response('unavailable',{status:503}));
 await expect(modelOptions(env,ctx)).rejects.toThrow('模型列表暂时不可用');
 vi.mocked(env.AI_SERVICE.fetch).mockResolvedValue(Response.json({data:'invalid'}));
 await expect(modelOptions(env,ctx)).rejects.toThrow('模型列表无效');
});
it('keeps context feedback keyed by upstream target, shared by default and the explicit model', async () => {
 const selected=await capabilities(env,ctx,'custom-main/chat-b');await recordFeedback(env,selected,{contextLimit:4096});
 expect((await capabilities(env,ctx,'custom-main/chat-b')).contextTokens).toBe(4096);
 expect((await capabilities(env,ctx,'default')).contextTokens).toBe(32768);
 await recordFeedback(env,await capabilities(env,ctx,'default'),{contextLimit:8192});
 expect((await capabilities(env,ctx,'custom-main/qwen3')).contextTokens).toBe(8192);
});
