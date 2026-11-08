import {afterEach,expect,it,vi} from 'vitest';
import {manage} from './management';
const env={CLOUDFLARE_ACCOUNT_ID:'account',CF_AI_MANAGEMENT_TOKEN:'management-fixture'} as unknown as Env;
const request=(path:string,method='GET',body?:unknown)=>new Request('https://ai.hasbai.xyz/api/admin/'+path,{method,...(body?{body:JSON.stringify(body)}:{})});
afterEach(()=>vi.unstubAllGlobals());
it('returns only safe provider fields and discards sensitive headers on list and mutation responses',async()=>{
 const row={id:'id',name:'provider',slug:'slug',base_url:'https://example.com',headers:'{"Authorization":"secret"}',secret:'secret'};
 const call=vi.fn().mockResolvedValue(Response.json({success:true,result:[row],result_info:{page:1,total_pages:2}}));vi.stubGlobal('fetch',call);
 const response=await manage(request('providers'),env);expect(await response.json()).toEqual({result:[{id:'id',name:'provider',slug:'slug',base_url:'https://example.com'}],result_info:{page:1,total_pages:2}});expect(response.headers.get('cache-control')).toBe('no-store');
});
it.each([['providers','POST',{name:'name',slug:'slug',base_url:'https://example.com'}],['providers/id','PATCH',{enable:false}],['providers/id','DELETE',undefined],['gateways/default/keys','POST',{provider_slug:'custom-codex',alias:'default',default_config:true,secret:'key-fixture'}],['gateways/default/keys/id','PUT',{secret:'new-fixture'}],['gateways/default/keys/id','DELETE',undefined]] as const)('implements %s %s without returning secrets',async(path,method,value)=>{
 const call=vi.fn().mockResolvedValue(Response.json({success:true,result:{id:'id',secret:'should-never-return',secret_preview:'masked',headers:'credential'}}));vi.stubGlobal('fetch',call);
 const response=await manage(request(path,method,value),env);expect(await response.json()).toEqual({result:{id:'id'}});
 const [url,options]=call.mock.calls[0];expect(url).toContain(path.startsWith('providers')?'/custom-providers':'/gateways/default/provider_configs');expect(options.method).toBe(method);expect(options.headers.Authorization).toBe('Bearer management-fixture');expect(options.redirect).toBe('manual');if(value)expect(JSON.parse(options.body)).toEqual(value);
});
it('does not echo upstream errors that may include submitted keys',async()=>{
 vi.stubGlobal('fetch',vi.fn().mockResolvedValue(Response.json({errors:[{message:'your secret key-fixture is invalid'}]},{status:400})));
 await expect(manage(request('gateways/default/keys','POST',{provider_slug:'openai',alias:'default',default_config:true,secret:'key-fixture'}),env)).rejects.toThrow('Cloudflare 管理请求失败');
});
it.each([{name:'bad',slug:'slug',base_url:'http://example.com'},{name:'bad',slug:'slug',base_url:'https://user:secret@example.com'},{name:'bad',slug:'slug',base_url:'https://example.com?key=secret'}])('rejects credential-bearing or insecure provider URLs',async value=>{
 const call=vi.fn();vi.stubGlobal('fetch',call);await expect(manage(request('providers','POST',value),env)).rejects.toThrow('字段无效');expect(call).not.toHaveBeenCalled();
});
it('does not permit alias mutation through key rotation',async()=>{
 const call=vi.fn();vi.stubGlobal('fetch',call);await expect(manage(request('gateways/default/keys/id','PUT',{secret:'key',alias:'other'}),env)).rejects.toThrow('字段无效');expect(call).not.toHaveBeenCalled();
});
