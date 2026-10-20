import {beforeEach,expect,it,vi} from 'vitest';
import {media} from './media';
import type {ImageRow} from './database';
const row:ImageRow={id:'fixture',name:'图片',sha256:'abc',size:100,content_type:'image/png',owner:'user',source:'upload',model:null,ready:true,created_at:'2026-10-20',deleted_at:null};
const transform=vi.fn(),output=vi.fn(),input=vi.fn(),match=vi.fn(),put=vi.fn();
const env={IMAGES:{get:vi.fn(async()=>({body:new Blob(['original']).stream(),httpEtag:'"source"'}))},IMAGE_TRANSFORM:{input}} as unknown as Env;
const request=(query='',method='GET',headers={})=>new Request('https://images.test/images/fixture'+query,{method,headers});
beforeEach(()=>{vi.clearAllMocks();vi.stubGlobal('caches',{open:async()=>({match,put})});input.mockReturnValue({transform});transform.mockReturnValue({output});output.mockResolvedValue({response:()=>new Response('webp',{headers:{'Content-Type':'image/webp'}})});match.mockResolvedValue(undefined);put.mockResolvedValue(undefined);});
it('uses bounded WebP sizes, caches transformed bytes, and keeps client revalidation',async()=>{
 for(const variant of ['thumb','display']){
  const r=await media(request('?variant='+variant),env,row);expect(r.headers.get('Content-Type')).toBe('image/webp');expect(r.headers.get('Cache-Control')).toContain('must-revalidate');expect(r.headers.get('ETag')).toBe('"'+variant+'-v1-abc"');expect(await r.text()).toBe('webp');
 }
 expect(transform).toHaveBeenNthCalledWith(1,{width:640,height:480,fit:'scale-down'});expect(transform).toHaveBeenNthCalledWith(2,{width:1920,height:1920,fit:'scale-down'});expect(output).toHaveBeenCalledWith({format:'image/webp',quality:80,anim:true});expect(put).toHaveBeenCalledTimes(2);
});
it('serves cached transforms without reencoding and respects conditional and HEAD reads',async()=>{
 match.mockImplementation(async()=>new Response('cached',{headers:{'Content-Type':'image/webp','Cache-Control':'public,max-age=86400'}}));
 const r=await media(request('?variant=thumb'),env,row);expect(await r.text()).toBe('cached');expect(input).not.toHaveBeenCalled();expect(r.headers.get('Cache-Control')).toContain('must-revalidate');
 const head=await media(request('?variant=thumb','HEAD'),env,row);expect(await head.text()).toBe('');
 const unchanged=await media(request('?variant=thumb','GET',{'If-None-Match':'"thumb-v1-abc"'}),env,row);expect(unchanged.status).toBe(304);
});
it('rejects arbitrary variants and propagates transform failures to the Worker error handler',async()=>{
 expect((await media(request('?variant=huge'),env,row)).status).toBe(400);expect(input).not.toHaveBeenCalled();output.mockRejectedValueOnce(Error('transform failed'));await expect(media(request('?variant=thumb'),env,row)).rejects.toThrow('transform failed');
});
