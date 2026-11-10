import {afterEach, expect, it, vi} from 'vitest';
import {inference} from './inference';
import {inferCalls,stubUpstream} from './fixture';
const env = {CLOUDFLARE_ACCOUNT_ID:'account', AIG_GATEWAY_ID:'default', AIG_RUN_TOKEN:'fixture', CF_AI_MANAGEMENT_TOKEN:'manage', DEFAULT_CHAT_MODEL:'', TRANSLATE_MODEL:''} as unknown as Env;
const who = {app:'tavern' as const, username:'用户名😀', requestId:'request'};
afterEach(()=>vi.unstubAllGlobals());
it.each([200,400,429,307])('preserves raw %i status, streaming and metrics without redirects or retries', async status=>{
 const upstream=new Response('data: first\n\n',{status,headers:{'content-type':'text/event-stream','cf-aig-log-id':'log','location':'https://elsewhere.test','set-cookie':'upstream=secret'}});
 const all=stubUpstream(()=>upstream),call={mock:{get calls(){return inferCalls(all);}}};
 const signal=new AbortController().signal;
 const response=await inference(env,'roleplay',{model:'custom-main/qwen3',messages:[{role:'user',content:'你好'}],stream:true,tools:[{function:{name:'tool'}}]},who,signal);
 expect(response.status).toBe(status);expect(response.headers.get('cf-aig-log-id')).toBe('log');expect(response.headers.has('set-cookie')).toBe(false);expect(response.headers.has('location')).toBe(false);expect(response.body).not.toBeNull();
 const [url,options]=call.mock.calls[0] as [string,any];expect(url).toBe('https://gateway.ai.cloudflare.com/v1/account/default/compat/chat/completions');expect(options.redirect).toBe('manual');expect(options.signal).toBeInstanceOf(AbortSignal);expect(JSON.parse(options.body).model).toBe('custom-main/qwen3');expect(options.headers['cf-aig-byok-alias']).toBe('default');expect(JSON.parse(options.headers['cf-aig-metadata'])).toEqual({app:'tavern',username:'用户名😀',task:'roleplay'});expect(options.headers['cf-aig-event-id']).toBe('request');expect(options.headers['cf-aig-max-attempts']).toBe('1');expect(options.headers['cf-aig-collect-log-payload']).toBe('true');expect(call.mock.calls).toHaveLength(1);expect(await response.text()).toBe('data: first\n\n');
});
it('translates with the discovered default model and sends the provider passthrough BYOK alias for images',async()=>{
 const call=stubUpstream();
 await inference(env,'translate',{model:'other'}, {...who,app:'blog'},new AbortController().signal);
 const [translate]=inferCalls(call);expect(translate[0]).toContain('/default/compat/');expect(JSON.parse(String(translate[1]?.body)).model).toBe('custom-main/qwen3');
 await inference(env,'character-avatar',{model:'gpt-image-2.5-flare'}, {...who,app:'images'},new AbortController().signal);
 const image=call.mock.calls.at(-1)!;expect(image[0]).toContain('/default/custom-codex/images/generations');expect(new Headers(image[1]?.headers).get('cf-aig-byok-alias')).toBe('default');
});
it('rejects unknown models and application/task combinations before spending tokens',async()=>{
 const call=stubUpstream();
 await expect(inference(env,'image-generation',{model:'evil'},{...who,app:'images'},new AbortController().signal)).rejects.toThrow('未知图片模型');
 await expect(inference(env,'translate',{},who,new AbortController().signal)).rejects.toThrow('未知 AI 用途');expect(inferCalls(call)).toHaveLength(0);
});
it('keeps Workers AI embeddings inside the same Worker and Gateway with verified attribution',async()=>{
 const run=vi.fn().mockResolvedValue({data:[[1,2]]}),signal=new AbortController().signal;
 const response=await inference({...env,AI:{run}} as unknown as Env,'embedding',{text:['灯塔']},who,signal);
 expect(await response.json()).toEqual({data:[[1,2]]});expect(run).toHaveBeenCalledWith('@cf/baai/bge-m3',{text:['灯塔']},expect.objectContaining({signal,gateway:expect.objectContaining({id:'default',eventId:'request',metadata:{app:'tavern',username:'用户名😀',task:'embedding'}})}));
});
it('forwards cancellation and does not retry network failures',async()=>{
 const abort=new AbortController(),call=stubUpstream((_url,options)=>new Promise<Response>((_,reject)=>options.signal!.addEventListener('abort',()=>reject(Error('aborted')),{once:true})));
 const pending=inference(env,'roleplay',{},who,abort.signal);await vi.waitFor(()=>expect(inferCalls(call)).toHaveLength(1));abort.abort();await expect(pending).rejects.toThrow('aborted');expect(inferCalls(call)).toHaveLength(1);
});

it.each([['custom-main/chat-b','custom-main/chat-b'],['default','custom-main/qwen3'],[undefined,'custom-main/qwen3'],['rp','custom-main/qwen3'],['dynamic/rp','custom-main/qwen3'],['translate','custom-main/qwen3']])('routes selected chat model %s to %s without changing the task attribution', async (model,expected) => {
 const call=stubUpstream();
 await inference(env,'roleplay',{model},who,new AbortController().signal);
 const [,init]=inferCalls(call)[0];expect(JSON.parse(String(init?.body)).model).toBe(expected);
 expect(JSON.parse((init?.headers as Record<string,string>)['cf-aig-metadata']).task).toBe('roleplay');
});
it('honors pinned default and translate models only when they were discovered',async()=>{
 const call=stubUpstream();
 await inference({...env,DEFAULT_CHAT_MODEL:'custom-main/chat-b',TRANSLATE_MODEL:'custom-gone/x'} as unknown as Env,'roleplay',{},who,new AbortController().signal);
 await inference({...env,DEFAULT_CHAT_MODEL:'custom-main/chat-b',TRANSLATE_MODEL:'custom-gone/x'} as unknown as Env,'translate',{},{...who,app:'blog'},new AbortController().signal);
 expect(inferCalls(call).map(([,init])=>JSON.parse(String(init?.body)).model)).toEqual(['custom-main/chat-b','custom-main/chat-b']);
});
it('rejects unknown chat models instead of silently using the default',async()=>{
 const call=stubUpstream();
 await expect(inference(env,'roleplay',{model:'custom-evil/model'},who,new AbortController().signal)).rejects.toThrow('未知对话模型');
 expect(inferCalls(call)).toHaveLength(0);
});
it('fails closed when the pinned default model was not discovered',async()=>{
 const call=stubUpstream();
 await expect(inference({...env,DEFAULT_CHAT_MODEL:'custom-gone/x'} as unknown as Env,'roleplay',{},who,new AbortController().signal)).rejects.toThrow('默认对话模型未被发现');
 expect(inferCalls(call)).toHaveLength(0);
});
it('keeps explicitly named models usable and omits default when the pinned default is missing',async()=>{
 const call=stubUpstream(),pinned={...env,DEFAULT_CHAT_MODEL:'custom-gone/x'} as unknown as Env;
 await inference(pinned,'roleplay',{model:'custom-main/chat-b'},who,new AbortController().signal);
 expect(JSON.parse(String(inferCalls(call)[0][1]?.body)).model).toBe('custom-main/chat-b');
 const {modelList}=await import('./models');const list=await (await modelList(pinned)).json() as {data:{id:string}[]};
 expect(list.data.map(m=>m.id)).not.toContain('default');expect(list.data.map(m=>m.id)).toContain('custom-main/chat-b');
});
