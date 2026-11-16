import {afterEach,expect,it,vi} from 'vitest';
import {manage} from './management';
import {routeModels} from './routes';
const env={CLOUDFLARE_ACCOUNT_ID:'account',AIG_GATEWAY_ID:'default',CF_AI_MANAGEMENT_TOKEN:'fixture'} as unknown as Env;
const request=(path:string,method='GET',value?:unknown)=>new Request('https://ai.test/api/admin/gateways/default/routes'+path,{method,...(value?{body:JSON.stringify(value)}:{})});
const elements=[{id:'start',type:'start',outputs:{next:{elementId:'model'}}},{id:'model',type:'model',properties:{provider:'custom-main',model:'chat',timeout:60000,retries:0},outputs:{success:{elementId:'end'},fallback:{elementId:'end'}}},{id:'end',type:'end',outputs:{}}];
afterEach(()=>vi.unstubAllGlobals());
it('exposes only deployed routes in the public catalog without configuration',async()=>{
 vi.stubGlobal('fetch',vi.fn().mockResolvedValue(Response.json({success:true,data:{routes:[{id:'a',name:'rp',deployment:{version_id:'v1'},elements,headers:{secret:'private'}},{id:'b',name:'draft'}]}})));
 expect(await routeModels(env)).toEqual([{id:'dynamic/rp',name:'rp',provider:'动态路由',type:'chat'}]);
});
it('sanitizes nested route properties and version data that may contain credentials',async()=>{
 vi.stubGlobal('fetch',vi.fn().mockResolvedValue(Response.json({success:true,result:{id:'route',name:'rp',elements:[elements[0],{...elements[1],properties:{...elements[1].properties,apiKey:'private',headers:{authorization:'secret'}}},elements[2]],version:{data:'private'},headers:{secret:'private'}}})));
 const result=await (await manage(request(''),env)).json() as {result:{elements:unknown[]}};expect(JSON.stringify(result)).not.toMatch(/private|secret|apiKey|authorization/);expect(result.result.elements).toEqual(elements);
});
it.each([['','POST',{name:'rp',elements}],['/route/versions','POST',{elements}],['/route/deployments','POST',{version_id:'v0'}],['/route','DELETE',undefined]] as const)('manages route %s %s with explicit deploy',async(path,method,value)=>{
 const call=vi.fn().mockResolvedValue(Response.json({success:true,result:{id:'route',name:'rp',version_id:'v1'}}));vi.stubGlobal('fetch',call);await manage(request(path,method,value),env);expect(call.mock.calls[0][0]).toContain('/gateways/default/routes'+path);expect(call.mock.calls[0][1].method).toBe(method);if(value)expect(JSON.parse(call.mock.calls[0][1].body)).toEqual(value);expect(call).toHaveBeenCalledTimes(1);
});
it('rejects broken graph edges before calling Cloudflare',async()=>{
 const call=vi.fn();vi.stubGlobal('fetch',call);await expect(manage(request('','POST',{name:'rp',elements:[{...elements[0],outputs:{next:{elementId:'missing'}}},elements[2]]}),env)).rejects.toThrow('配置字段无效');expect(call).not.toHaveBeenCalled();
});

it.each([false,true])('reads real Cloudflare version.data graph (serialized=%s)',async serialized=>{const call=vi.fn().mockResolvedValue(Response.json({success:true,data:{routes:[{id:'route',name:'rp',version:{data:serialized?JSON.stringify(elements):elements},deployment:{version_id:'v1'}}]}}));vi.stubGlobal('fetch',call);expect(await (await manage(request(''),env)).json()).toMatchObject({result:[{elements,deployment:{version_id:'v1'}}]});});
