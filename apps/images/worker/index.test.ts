import {beforeEach,expect,it,vi} from 'vitest';
import {verifyUserToken} from '@hasbai/auth/server';
import {query,type ImageRow} from './database';
import worker from './index';
vi.mock('@hasbai/auth/server',()=>({verifyUserToken:vi.fn()}));vi.mock('./database',()=>({query:vi.fn()}));
const id='c51f7180-6795-4a3a-8ec6-060ebc3fe98b',png=new Uint8Array([137,80,78,71,13,10,26,10]);
let row:ImageRow;const put=vi.fn(),get=vi.fn();const env={IMAGES:{put,get},VERSION:{id:'test'},ASSETS:{fetch:vi.fn()},DATABASE_URL:'fixture',AIG_IMAGE_RUN_TOKEN:'fixture'} as unknown as Env;
const call=(path:string,method='GET',body?:BodyInit,headers:Record<string,string>={})=>worker.fetch(new Request('https://images.test'+path,{method,body,headers:{Authorization:'Bearer fixture',...headers}}),env);
beforeEach(()=>{vi.clearAllMocks();row={id,name:'图片',sha256:'0'.repeat(64),content_type:'image/png',size:8,ready:true,owner:'other',source:'upload',model:null,created_at:'2026-10-20T00:00:00Z'};vi.mocked(verifyUserToken).mockResolvedValue({sub:'user',username:'月石',permissions:[]});vi.mocked(query).mockImplementation(async()=>[row]);put.mockResolvedValue(undefined);get.mockResolvedValue({body:new Blob([png]).stream(),httpEtag:'"etag"'});});
it('requires verified users for uploads and rejects cross-origin writes and unsafe files before storage',async()=>{
 vi.mocked(verifyUserToken).mockRejectedValueOnce(Error('invalid'));expect((await call('/api/images','POST',png)).status).toBe(401);
 expect((await call('/api/images','POST',png,{Origin:'https://evil.test'})).status).toBe(403);expect((await call('/api/images','POST','<svg/>')).status).toBe(415);expect((await call('/api/images','POST',new Uint8Array(10*1024*1024+1))).status).toBe(413);expect(put).not.toHaveBeenCalled();expect(query).not.toHaveBeenCalled();
});
it('completes abandoned uploads with the same bytes without changing ownership and reuses ready assets',async()=>{
 row.ready=false;put.mockImplementation(async()=>{expect(query).toHaveBeenCalledTimes(1);});const saved=await call('/api/images','POST',png);expect(saved.status).toBe(200);expect(await saved.json()).toMatchObject({id,url:'https://images.hasbai.xyz/images/'+id});expect(query).toHaveBeenLastCalledWith(env,'UPDATE public.image SET ready=true WHERE id=$1',[id]);expect(vi.mocked(query).mock.calls[0][1]).toContain('SET sha256=excluded.sha256');expect(put).toHaveBeenCalledWith(id,png,expect.any(Object));
 row.ready=true;put.mockClear();expect((await call('/api/images','POST',png)).status).toBe(200);expect(put).not.toHaveBeenCalled();
});
it('does not mark failed R2 writes ready',async()=>{row.ready=false;put.mockRejectedValueOnce(Error('R2 failed'));expect((await call('/api/images','POST',png)).status).toBe(503);expect(query).toHaveBeenCalledTimes(1);});
it('enforces owner filters for ordinary users and returns only public asset fields',async()=>{
 const response=await call('/api/images?scope=all&q=旅人');expect(vi.mocked(query).mock.calls[0][2]).toEqual([false,'user','%旅人%',0]);const body=await response.json() as {images:unknown[]};expect(body.images[0]).not.toHaveProperty('owner');expect(body.images[0]).not.toHaveProperty('sha256');
 await call('/api/images/'+id,'PATCH',JSON.stringify({name:'新名称'}));expect(vi.mocked(query).mock.calls.at(-1)![2]).toEqual(['新名称',id,false,'user']);
 vi.mocked(verifyUserToken).mockResolvedValue({sub:'admin',permissions:['images.all:all']});await call('/api/images?scope=all');expect(vi.mocked(query).mock.calls.at(-1)![2]?.[0]).toBe(true);
});
it('serves immutable public bytes and HEAD/conditional reads without authentication',async()=>{
 vi.mocked(verifyUserToken).mockRejectedValue(Error('anonymous'));const r=await call('/images/'+id);expect(r.status).toBe(200);expect(new Uint8Array(await r.arrayBuffer())).toEqual(png);expect(r.headers.get('Cache-Control')).toContain('immutable');expect((await call('/images/'+id,'HEAD')).status).toBe(200);const cached=await call('/images/'+id,'GET',undefined,{'If-None-Match':'"etag"'});expect(cached.status).toBe(304);expect(await cached.text()).toBe('');expect(verifyUserToken).not.toHaveBeenCalled();
});
