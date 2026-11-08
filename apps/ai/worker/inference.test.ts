import {afterEach, expect, it, vi} from 'vitest';
import {inference} from './inference';
const env = {CLOUDFLARE_ACCOUNT_ID:'account', AIG_GATEWAY_ID:'default', AIG_RUN_TOKEN:'fixture'} as unknown as Env;
const who = {app:'tavern' as const, username:'用户名😀', requestId:'request'};
afterEach(()=>vi.unstubAllGlobals());
it.each([200,400,429,307])('preserves raw %i status, streaming and metrics without redirects or retries', async status=>{
 const upstream=new Response('data: first\n\n',{status,headers:{'content-type':'text/event-stream','cf-aig-log-id':'log','location':'https://elsewhere.test','set-cookie':'upstream=secret'}});
 const call=vi.fn().mockResolvedValue(upstream);vi.stubGlobal('fetch',call);
 const signal=new AbortController().signal;
 const response=await inference(env,'roleplay',{model:'rp',messages:[{role:'user',content:'你好'}],stream:true,tools:[{function:{name:'tool'}}]},who,signal);
 expect(response.status).toBe(status);expect(response.headers.get('cf-aig-log-id')).toBe('log');expect(response.headers.has('set-cookie')).toBe(false);expect(response.headers.has('location')).toBe(false);expect(response.body).not.toBeNull();
 const [url,options]=call.mock.calls[0];expect(url).toBe('https://gateway.ai.cloudflare.com/v1/account/default/compat/chat/completions');expect(options.redirect).toBe('manual');expect(options.signal).toBeInstanceOf(AbortSignal);expect(JSON.parse(options.body).model).toBe('dynamic/rp');expect(JSON.parse(options.headers['cf-aig-metadata'])).toEqual({app:'tavern',username:'用户名😀',task:'roleplay'});expect(options.headers['cf-aig-event-id']).toBe('request');expect(options.headers['cf-aig-max-attempts']).toBe('1');expect(options.headers['cf-aig-collect-log-payload']).toBe('true');expect(call).toHaveBeenCalledOnce();expect(await response.text()).toBe('data: first\n\n');
});
it('uses the live default translate route and the provider passthrough BYOK alias only for images',async()=>{
 const call=vi.fn(async(_url:string,_options:RequestInit)=>new Response('{}'));vi.stubGlobal('fetch',call);
 await inference(env,'translate',{model:'other'}, {...who,app:'blog'},new AbortController().signal);
 expect(call.mock.calls[0][0]).toContain('/default/compat/');expect(JSON.parse(String(call.mock.calls[0][1].body)).model).toBe('dynamic/translate');expect(call.mock.calls[0][1].headers).not.toHaveProperty('cf-aig-byok-alias');
 await inference(env,'character-avatar',{model:'gpt-image-2.5-flare'}, {...who,app:'images'},new AbortController().signal);
 expect(call.mock.calls[1][0]).toContain('/default/custom-codex/images/generations');expect(new Headers(call.mock.calls[1][1].headers).get('cf-aig-byok-alias')).toBe('default');
});
it('rejects unknown models and application/task combinations before spending tokens',async()=>{
 const call=vi.fn();vi.stubGlobal('fetch',call);
 await expect(inference(env,'image-generation',{model:'evil'},{...who,app:'images'},new AbortController().signal)).rejects.toThrow('未知图片模型');
 await expect(inference(env,'translate',{},who,new AbortController().signal)).rejects.toThrow('未知 AI 用途');expect(call).not.toHaveBeenCalled();
});
it('keeps Workers AI embeddings inside the same Worker and Gateway with verified attribution',async()=>{
 const run=vi.fn().mockResolvedValue({data:[[1,2]]}),signal=new AbortController().signal;
 const response=await inference({...env,AI:{run}} as unknown as Env,'embedding',{text:['灯塔']},who,signal);
 expect(await response.json()).toEqual({data:[[1,2]]});expect(run).toHaveBeenCalledWith('@cf/baai/bge-m3',{text:['灯塔']},expect.objectContaining({signal,gateway:expect.objectContaining({id:'default',eventId:'request',metadata:{app:'tavern',username:'用户名😀',task:'embedding'}})}));
});
it('forwards cancellation and does not retry network failures',async()=>{
 const abort=new AbortController(),call=vi.fn((_url,options)=>new Promise((_,reject)=>options.signal.addEventListener('abort',()=>reject(Error('aborted')),{once:true})));vi.stubGlobal('fetch',call);
 const pending=inference(env,'roleplay',{},who,abort.signal);abort.abort();await expect(pending).rejects.toThrow('aborted');expect(call).toHaveBeenCalledOnce();
});

it.each(['rp','translate','dynamic/rp'])('routes selected chat model %s without changing the task attribution', async model => {
 const call=vi.fn().mockResolvedValue(new Response('{}'));vi.stubGlobal('fetch',call);
 await inference(env,'roleplay',{model},who,new AbortController().signal);
 expect(JSON.parse(call.mock.calls[0][1].body).model).toBe(model==='translate'?'dynamic/translate':'dynamic/rp');
 expect(JSON.parse(call.mock.calls[0][1].headers['cf-aig-metadata']).task).toBe('roleplay');
});
it('rejects unknown chat models instead of silently using RP',async()=>{
 const call=vi.fn();vi.stubGlobal('fetch',call);
 await expect(inference(env,'roleplay',{model:'unknown'},who,new AbortController().signal)).rejects.toThrow('未知对话模型');
 expect(call).not.toHaveBeenCalled();
});
