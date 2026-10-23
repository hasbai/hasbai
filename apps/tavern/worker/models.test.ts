import { beforeEach, afterEach, it, expect, vi } from 'vitest';
import { DatabaseSync } from 'node:sqlite';
import { capabilities, modelInput, recordFeedback, modelOptions } from './models';
import { DEFAULT_SETTINGS, SAMPLING_TEMPLATES } from '../shared/types';
import { explicitContextLimit, errorFeedback } from './generation';
let db: DatabaseSync, env: Env, work: Promise<unknown>[];
const ctx = { waitUntil: (p: Promise<unknown>) => { work.push(p); } };
function stmt(sql: string, values: unknown[] = []): D1PreparedStatement { return { bind: (...v: unknown[]) => stmt(sql, v), first: async () => db.prepare(sql).get(...values as never[]) ?? null, run: async () => { db.prepare(sql).run(...values as never[]); return { meta: { changes: 1 } }; } } as D1PreparedStatement; }
beforeEach(() => { db = new DatabaseSync(':memory:'); db.exec('CREATE TABLE model_capabilities(id TEXT PRIMARY KEY,value_json TEXT,expires_at INTEGER)'); work = []; env = { DB: { prepare: stmt } } as Env; vi.stubGlobal('fetch', vi.fn(async () => Response.json({ default_generation_settings: { n_ctx: 32768 } }))); });
afterEach(async () => { await Promise.all(work); db.close(); vi.unstubAllGlobals(); });
it('always exposes RP and forwards sampling and thinking without route or schema checks', async () => {
 expect(await modelOptions(env,ctx)).toMatchObject([{id:'rp',available:true,contextTokens:null,parameters:{topK:true,thinking:true}}]);
 expect(modelInput({...DEFAULT_SETTINGS,topK:20,thinkingEnabled:false})).toMatchObject({top_k:20,top_p:0.8,chat_template_kwargs:{enable_thinking:false},presence_penalty:1.5,frequency_penalty:0});
 expect(modelInput({...DEFAULT_SETTINGS,thinkingEnabled:true})).toMatchObject({chat_template_kwargs:{enable_thinking:true},reasoning_effort:'low',reasoning_format:'deepseek'});expect(modelInput(DEFAULT_SETTINGS)).toHaveProperty('reasoning_effort','none');expect(modelInput({...DEFAULT_SETTINGS,topK:0})).not.toHaveProperty('top_k');
 expect(()=>modelInput({...DEFAULT_SETTINGS,modelId:'other'})).toThrow('模型不可用');
});
it.each(['low','medium','high'] as const)('forwards selected %s effort only when thinking is enabled',effort=>{
 expect(modelInput({...DEFAULT_SETTINGS,thinkingEnabled:true,reasoningEffort:effort})).toMatchObject({chat_template_kwargs:{enable_thinking:true},reasoning_effort:effort});
 expect(modelInput({...DEFAULT_SETTINGS,thinkingEnabled:false,reasoningEffort:effort})).toMatchObject({chat_template_kwargs:{enable_thinking:false},reasoning_effort:'none'});
});
it('discovers actual 32K then 16K runtime capacity in the background, without credentials', async () => {
 expect((await capabilities(env,ctx)).contextTokens).toBeNull();await Promise.all(work);expect((await capabilities(env,ctx)).contextTokens).toBe(32768);
 expect(fetch).toHaveBeenCalledTimes(1);expect(fetch).toHaveBeenCalledWith('https://llama.hasbai.xyz/props',expect.objectContaining({redirect:'error'}));expect(vi.mocked(fetch).mock.calls[0][1]).not.toHaveProperty('headers');
 db.exec('UPDATE model_capabilities SET expires_at=0');vi.mocked(fetch).mockResolvedValue(Response.json({default_generation_settings:{n_ctx:16384}}));
 expect((await capabilities(env,ctx)).contextTokens).toBe(32768);await Promise.all(work);expect((await capabilities(env,ctx)).contextTokens).toBe(16384);
});
it('failed or unknown discovery does not block RP or parameter forwarding', async () => {
 vi.mocked(fetch).mockRejectedValue(new Error('unavailable'));expect((await capabilities(env,ctx)).contextTokens).toBeNull();await Promise.all(work);
 expect(await modelOptions(env,ctx)).toMatchObject([{available:true,contextTokens:null}]);expect(modelInput(DEFAULT_SETTINGS)).toHaveProperty('chat_template_kwargs.enable_thinking',false);
});
it('uses explicit upstream limits without automatically retrying inference', async () => {
 expect(explicitContextLimit('maximum context length is 8192 tokens')).toBe(8192);expect(explicitContextLimit('you used 8192 prompt tokens')).toBeUndefined();
 const c=await capabilities(env,ctx);await Promise.all(work);const known=await capabilities(env,ctx);
 await errorFeedback(env,known,{error:{message:'maximum context length is 8192 tokens'}});expect((await capabilities(env,ctx)).contextTokens).toBe(8192);
 await recordFeedback(env,c,{contextLimit:4096});expect((await capabilities(env,ctx)).contextTokens).toBe(4096);
});

it('keeps a smaller explicit limit whether props finishes before or after the error',async()=>{
 const cold=await capabilities(env,ctx);await Promise.all(work);await recordFeedback(env,cold,{contextLimit:8192});expect((await capabilities(env,ctx)).contextTokens).toBe(8192);
 db.exec('DELETE FROM model_capabilities');let release:()=>void=()=>{};vi.mocked(fetch).mockImplementation(()=>new Promise<Response>(r=>release=()=>r(Response.json({default_generation_settings:{n_ctx:32768}}))));
 const unknown=await capabilities(env,ctx);await recordFeedback(env,unknown,{contextLimit:16384});release();await Promise.all(work);expect((await capabilities(env,ctx)).contextTokens).toBe(16384);
});

it.each(['thinking','instruct'] as const)('forwards all six %s template values without changes',mode=>{
 const t=SAMPLING_TEMPLATES[mode];
 expect(modelInput({...DEFAULT_SETTINGS,...t,thinkingEnabled:mode==='thinking'})).toMatchObject({temperature:t.temperature,top_p:t.topP,top_k:t.topK,min_p:t.minP,presence_penalty:t.presencePenalty,repetition_penalty:t.repetitionPenalty});
});
