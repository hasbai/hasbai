import {afterEach,beforeEach,expect,it,vi} from 'vitest';
import {discoverModels,invalidateCatalog,resetDiscovery} from './discovery';
import {stubUpstream} from './fixture';
const env={CLOUDFLARE_ACCOUNT_ID:'account',AIG_GATEWAY_ID:'default',AIG_RUN_TOKEN:'run',CF_AI_MANAGEMENT_TOKEN:'manage'} as unknown as Env;
beforeEach(()=>vi.useFakeTimers({toFake:['Date']}));
afterEach(()=>{vi.useRealTimers();vi.unstubAllGlobals();resetDiscovery();});
it('discovers chat models of enabled providers through the Gateway, skipping other modalities',async()=>{
 const call=stubUpstream();
 expect(await discoverModels(env)).toEqual([{id:'custom-main/qwen3',name:'qwen3',provider:'main',type:'chat',context_tokens:32768},{id:'custom-main/chat-b',name:'chat-b',provider:'main',type:'chat'}]);
 const [url,init]=call.mock.calls.find(([u])=>String(u).endsWith('/models'))!;
 expect(url).toBe('https://gateway.ai.cloudflare.com/v1/account/default/custom-main/models');
 expect(init).toMatchObject({redirect:'manual',headers:{'cf-aig-authorization':'Bearer run','cf-aig-byok-alias':'default','cf-aig-collect-log':'false'}});
});
it('caches for five minutes, shares in-flight refreshes and rediscovers after provider writes',async()=>{
 const call=stubUpstream();
 await Promise.all([discoverModels(env),discoverModels(env)]);await discoverModels(env);expect(call).toHaveBeenCalledTimes(2);
 invalidateCatalog();await discoverModels(env);expect(call).toHaveBeenCalledTimes(4);
 vi.setSystemTime(Date.now()+5*60_000+1);await discoverModels(env);expect(call).toHaveBeenCalledTimes(6);
});
it('keeps the last good list when a provider fails and omits providers that were never reachable',async()=>{
 stubUpstream(undefined,{main:{data:[{id:'a'}]},down:new Response('no',{status:500})});
 expect((await discoverModels(env)).map(m=>m.id)).toEqual(['custom-main/a']);
 const call=stubUpstream(undefined,{main:{data:[{id:'a'}]}});await discoverModels(env);
 vi.setSystemTime(Date.now()+6*60_000);
 vi.mocked(fetch).mockImplementation(async url=>String(url).includes('api.cloudflare.com')?Response.json({success:true,result:[{slug:'main',enable:true}]}):new Response('x',{status:502}));
 expect((await discoverModels(env)).map(m=>m.id)).toEqual(['custom-main/a']);expect(call).toBeDefined();
});
it('fails closed when every enabled provider is unreachable and nothing is cached',async()=>{
 stubUpstream(undefined,{main:new Response('no',{status:500})});
 await expect(discoverModels(env)).rejects.toThrow('模型目录暂不可用');
});
it('serves the stale catalog for an hour when Cloudflare management is unavailable',async()=>{
 stubUpstream();await discoverModels(env);vi.setSystemTime(Date.now()+10*60_000);
 vi.stubGlobal('fetch',vi.fn(async()=>new Response('',{status:500})));
 expect((await discoverModels(env)).length).toBe(2);
 vi.setSystemTime(Date.now()+61*60_000);await expect(discoverModels(env)).rejects.toThrow();
});
it('bounds oversized or malformed provider responses and unsafe ids',async()=>{
 stubUpstream(undefined,{big:new Response('x'.repeat(300*1024)),bad:Response.json({data:[{id:'../evil bad'},{id:7},{id:'ok:1'}]})});
 expect((await discoverModels(env)).map(m=>m.id)).toEqual(['custom-bad/ok:1']);
});
it('does not retry a failing upstream on every request and recovers after the backoff',async()=>{
 const call=stubUpstream();await discoverModels(env);vi.setSystemTime(Date.now()+6*60_000);
 call.mockImplementation(async()=>new Response('',{status:500}));
 await discoverModels(env);const failed=call.mock.calls.length;await discoverModels(env);await discoverModels(env);expect(call.mock.calls.length).toBe(failed);
 vi.setSystemTime(Date.now()+31_000);await discoverModels(env);expect(call.mock.calls.length).toBeGreaterThan(failed);
});
it('does not store a refresh that an admin write overtook',async()=>{
 const call=stubUpstream();let release!:()=>void;const gate=new Promise<void>(r=>release=r);
 const original=call.getMockImplementation()!;call.mockImplementation(async(url,init)=>{if(String(url).includes('api.cloudflare.com'))await gate;return original(url,init);});
 const pending=discoverModels(env);invalidateCatalog();release();await pending;
 call.mockImplementation(original);const before=call.mock.calls.length;await discoverModels(env);expect(call.mock.calls.length).toBeGreaterThan(before);
});
it('drops models whose combined id is not a valid model id',async()=>{
 stubUpstream(undefined,{main:{data:[{id:'a'.repeat(250)},{id:'ok'}]}});
 expect((await discoverModels(env)).map(m=>m.id)).toEqual(['custom-main/ok']);
});
it('does not let a refresh from before an admin write set the failure backoff or serve post-write callers',async()=>{
 const call=stubUpstream();let release!:()=>void;const gate=new Promise<void>(r=>release=r);const ok=call.getMockImplementation()!;
 call.mockImplementation(async(url,init)=>{if(String(url).includes('api.cloudflare.com')){await gate;return new Response('',{status:500});}return ok(url,init);});
 const old=discoverModels(env).catch(()=>undefined);invalidateCatalog();call.mockImplementation(ok);
 expect((await discoverModels(env)).length).toBe(2);release();await old;
 expect((await discoverModels(env)).length).toBe(2);
});
