import {afterEach,beforeEach,expect,it,vi} from 'vitest';
vi.mock('cloudflare:workers',()=>({WorkerEntrypoint:class{constructor(public ctx:unknown,public env:Env){}}}));
vi.mock('@hasbai/auth/server',()=>({verifyUserToken:vi.fn()}));
import {verifyUserToken} from '@hasbai/auth/server';
import worker,{InferenceService} from './index';
import {inferCalls,stubUpstream} from './fixture';
const env={CLOUDFLARE_ACCOUNT_ID:'account',AIG_GATEWAY_ID:'default',AIG_RUN_TOKEN:'run-fixture',DEFAULT_CHAT_MODEL:'',TRANSLATE_MODEL:'',CF_AI_MANAGEMENT_TOKEN:'manage-fixture',ASSETS:{fetch:vi.fn(async()=>new Response('page'))}} as unknown as Env;
function call(path:string,method='GET',input?:unknown,token='user',extra={}){return worker.fetch(new Request('https://ai.hasbai.xyz'+path,{method,headers:{...(token?{Authorization:'Bearer '+token}:{}),...extra},...(input?{body:JSON.stringify(input)}:{})}),env);}
beforeEach(()=>{vi.mocked(verifyUserToken).mockResolvedValue({sub:'auth0|user',username:'verified-profile'});});
afterEach(()=>{vi.unstubAllGlobals();vi.clearAllMocks();});
it('requires verified user JWT for all public AI and admin APIs',async()=>{
 expect((await call('/v1/models','GET',undefined,'')).status).toBe(401);
 vi.mocked(verifyUserToken).mockRejectedValue(Error('invalid signature or audience'));
 expect((await call('/v1/models')).status).toBe(401);expect((await call('/api/admin/providers')).status).toBe(401);
});
it('lets ordinary users infer, fixes routing and obtains identity only from verified claims',async()=>{
 const fetch=stubUpstream(()=>new Response('data: [DONE]\n\n',{headers:{'Content-Type':'text/event-stream'}}));
 expect((await call('/v1/chat/completions','POST',{model:'custom-main/qwen3',messages:[{role:'user',content:'hi'}],username:'spoofed',stream:true},'user',{'X-AI-Attribution':'{"username":"spoofed"}','cf-aig-authorization':'evil'})).status).toBe(200);
 const options=inferCalls(fetch)[0][1] as any;expect(JSON.parse(options.headers['cf-aig-metadata'])).toEqual({app:'ai',username:'verified-profile',task:'roleplay'});expect(options.headers['cf-aig-authorization']).toBe('Bearer run-fixture');
 expect((await call('/api/admin/providers')).status).toBe(403);expect(inferCalls(fetch)).toHaveLength(1);
});
it('does not accept role claims as a substitute for the native admin permission',async()=>{
 vi.mocked(verifyUserToken).mockResolvedValue({sub:'auth0|user',role:'superadmin',_roles:['superadmin']});expect((await call('/api/admin/providers')).status).toBe(403);
});
it('permits AI management only with ai.all:all',async()=>{
 vi.mocked(verifyUserToken).mockResolvedValue({sub:'auth0|admin',permissions:['ai.all:all']});vi.stubGlobal('fetch',vi.fn().mockResolvedValue(Response.json({success:true,result:[]})));
 expect((await call('/api/admin/providers')).status).toBe(200);
});
it('never exposes its trusted internal entrypoint over HTTP',async()=>{expect((await call('/internal/roleplay','POST',{messages:[]},'')).status).toBe(404);});
it('rejects unsupported public models without invoking any upstream',async()=>{
 const fetch=stubUpstream();expect((await call('/v1/chat/completions','POST',{model:'custom-evil/model',messages:[]})).status).toBe(400);expect(inferCalls(fetch)).toHaveLength(0);
});
it('makes named service calls without user tokens while enforcing app/task mapping',async()=>{
 const service=new InferenceService({} as ExecutionContext,env);
 const fetch=stubUpstream();
 const req=(app:string)=>new Request('https://ai.hasbai.xyz/internal/roleplay',{method:'POST',headers:{'X-AI-Attribution':JSON.stringify({app,username:'verified-profile',requestId:'round'})},body:'{}'});
 expect((await service.fetch(req('tavern'))).status).toBe(200);expect((await service.fetch(req('blog'))).status).toBe(400);expect(inferCalls(fetch)).toHaveLength(1);
});

it('shares one typed model catalog between authenticated public callers and service bindings', async () => {
 stubUpstream();
 const publicResponse=await call('/v1/models');expect(publicResponse.status).toBe(200);
 const service=new InferenceService({} as ExecutionContext,env);
 const internal=await service.fetch(new Request('https://ai.hasbai.xyz/internal/models'));
 expect(await internal.json()).toEqual(await publicResponse.json());
 expect((await call('/internal/models')).status).toBe(404);
});

it('lists discovered chat models, a default entry and fixed image/embedding models without provider details', async () => {
 stubUpstream();
 const body=await (await call('/v1/models')).json() as {data:{id:string;type:string;target?:string;context_tokens?:number}[]};
 expect(body.data.map(m=>m.id)).toEqual(['default','custom-main/qwen3','custom-main/chat-b','gpt-image-2.5-flare','gpt-image-2.5-sunburst','@cf/baai/bge-m3']);
 expect(body.data[0]).toMatchObject({target:'custom-main/qwen3',context_tokens:32768});expect(JSON.stringify(body)).not.toContain('example.com');
});
