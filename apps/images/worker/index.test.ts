import {beforeEach,expect,it,vi} from 'vitest';
import {verifyUserToken} from '@hasbai/auth/server';
import {query,type ImageRow} from './database';
import worker from './index';
vi.mock('@hasbai/auth/server',()=>({verifyUserToken:vi.fn()}));vi.mock('./database',()=>({query:vi.fn()}));
const id='c51f7180-6795-4a3a-8ec6-060ebc3fe98b',png=new Uint8Array([137,80,78,71,13,10,26,10]);
let row:ImageRow;const put=vi.fn(),get=vi.fn(),remove=vi.fn();const env={IMAGES:{put,get,delete:remove},VERSION:{id:'test'},ASSETS:{fetch:vi.fn()},DATABASE_URL:'fixture',AIG_IMAGE_RUN_TOKEN:'fixture'} as unknown as Env;
const call=(path:string,method='GET',body?:BodyInit,headers:Record<string,string>={})=>worker.fetch(new Request('https://images.test'+path,{method,body,headers:{Authorization:'Bearer fixture',...headers}}),env);
beforeEach(()=>{vi.clearAllMocks();row={id,name:'图片',sha256:'0'.repeat(64),content_type:'image/png',size:8,ready:true,owner:'other',source:'upload',model:null,created_at:'2026-10-20T00:00:00Z',deleted_at:null};vi.mocked(verifyUserToken).mockResolvedValue({sub:'user',username:'月石',permissions:[]});vi.mocked(query).mockImplementation(async()=>[row]);put.mockResolvedValue(undefined);remove.mockResolvedValue(undefined);get.mockImplementation(async()=>({body:new Blob([png]).stream(),httpEtag:'"etag"'}));});
it('requires verified users for uploads and rejects cross-origin writes and unsafe files before storage',async()=>{
 vi.mocked(verifyUserToken).mockRejectedValueOnce(Error('invalid'));expect((await call('/api/images','POST',png)).status).toBe(401);
 expect((await call('/api/images','POST',png,{Origin:'https://evil.test'})).status).toBe(403);expect((await call('/api/images','POST','<svg/>')).status).toBe(415);expect((await call('/api/images','POST',new Uint8Array(10*1024*1024+1))).status).toBe(413);expect(put).not.toHaveBeenCalled();expect(query).not.toHaveBeenCalled();
});
it('completes abandoned uploads with the same bytes without changing ownership and reuses ready assets',async()=>{
 row.ready=false;put.mockImplementation(async()=>{expect(query).toHaveBeenCalledTimes(1);});const saved=await call('/api/images','POST',png);expect(saved.status).toBe(200);expect(await saved.json()).toMatchObject({id,url:'https://images.hasbai.xyz/images/'+id});expect(query).toHaveBeenLastCalledWith(env,'UPDATE public.image SET ready=true WHERE id=$1 AND deleted_at IS NULL RETURNING id',[id]);expect(vi.mocked(query).mock.calls[0][1]).toContain('SET sha256=excluded.sha256');expect(put).toHaveBeenCalledWith(id,png,expect.any(Object));
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
it('shows public metadata but only enables management for the owner or administrator',async()=>{
 const other=await call('/api/images/'+id);expect(await other.json()).toMatchObject({id,can_manage:false,deleting:false});
 row.owner='user';expect(await (await call('/api/images/'+id)).json()).toMatchObject({can_manage:true});
 vi.mocked(verifyUserToken).mockResolvedValue({sub:'admin',permissions:['images.all:all']});row.owner='other';expect(await (await call('/api/images/'+id)).json()).toMatchObject({can_manage:true});
 vi.mocked(query).mockResolvedValueOnce([]);expect((await call('/api/images/'+id)).status).toBe(404);
});
it('tombstones before R2 deletion, retains authorization on failure, and allows retry',async()=>{
 row.owner='user';remove.mockRejectedValueOnce(Error('R2 unavailable'));
 expect((await call('/api/images/'+id,'DELETE')).status).toBe(503);
 expect(query).toHaveBeenCalledTimes(1);expect(vi.mocked(query).mock.calls[0][1]).toContain('SET deleted_at=COALESCE');expect(vi.mocked(query).mock.calls[0][2]).toEqual([id,false,'user']);
 row.deleted_at='2026-10-20T00:00:00Z';expect(await (await call('/api/images/'+id)).json()).toMatchObject({can_manage:true,deleting:true});
 expect((await call('/api/images/'+id,'DELETE')).status).toBe(204);expect(query).toHaveBeenLastCalledWith(env,'DELETE FROM public.image WHERE id=$1 AND deleted_at IS NOT NULL',[id]);expect(remove).toHaveBeenCalledTimes(2);
});
it('does not remove R2 without an authorized tombstone and retries a failed final database delete',async()=>{
 vi.mocked(query).mockResolvedValueOnce([]);expect((await call('/api/images/'+id,'DELETE')).status).toBe(404);expect(remove).not.toHaveBeenCalled();
 vi.mocked(query).mockResolvedValueOnce([row]).mockRejectedValueOnce(Error('database failed'));expect((await call('/api/images/'+id,'DELETE')).status).toBe(503);expect(remove).toHaveBeenCalledTimes(1);
 expect((await call('/api/images/'+id,'DELETE')).status).toBe(204);
});
it('does not resurrect a tombstone from a duplicate upload',async()=>{
 vi.mocked(query).mockResolvedValueOnce([]);expect((await call('/api/images','POST',png)).status).toBe(409);expect(put).not.toHaveBeenCalled();
 expect(vi.mocked(query).mock.calls[0][1]).toContain('WHERE public.image.deleted_at IS NULL');
});
it('rejects deleted images before original, thumbnail, display, HEAD and download reads',async()=>{
 vi.mocked(query).mockResolvedValue([]);
 for(const suffix of ['', '?variant=thumb','?variant=display','?download=1']){
  expect((await call('/images/'+id+suffix)).status).toBe(404);expect((await call('/images/'+id+suffix,'HEAD')).status).toBe(404);
 }
 expect(get).not.toHaveBeenCalled();
});
it('downloads original bytes and MIME with an encoded attachment filename',async()=>{
 row.name='雨夜"\r\n.webp';const r=await call('/images/'+id+'?download=1&variant=thumb');expect(r.status).toBe(200);expect(new Uint8Array(await r.arrayBuffer())).toEqual(png);expect(r.headers.get('Content-Type')).toBe('image/png');expect(r.headers.get('Content-Disposition')).toContain('attachment;');expect(r.headers.get('Content-Disposition')).toContain("filename*=UTF-8''%E9%9B%A8%E5%A4%9C%22.png");expect(r.headers.get('Cache-Control')).toBe('no-store');
});

it('cleans a late upload when deletion commits before upload finalization',async()=>{
 row.ready=false;let stored=false;
 put.mockImplementation(async()=>{stored=true;});
 vi.mocked(query).mockResolvedValueOnce([row]).mockResolvedValueOnce([]);
 const response=await call('/api/images','POST',png);expect(stored).toBe(true);expect(response.status).toBe(409);expect(remove).toHaveBeenCalledWith(id);expect(query).toHaveBeenLastCalledWith(env,'UPDATE public.image SET ready=true WHERE id=$1 AND deleted_at IS NULL RETURNING id',[id]);
});
