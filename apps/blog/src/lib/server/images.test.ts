import {expect,it,vi} from 'vitest';
import {blogHttp} from './http';
it('preserves image URLs and forwards uploads, authentication and conditional reads to the image service',async()=>{
 const fetch=vi.fn(async(request:Request)=>new Response(request.method==='POST'?await request.arrayBuffer():'image',{headers:{'Content-Type':'image/png',ETag:'"image"'}}));
 const platform={env:{IMAGE_SERVICE:{fetch}}} as unknown as App.Platform;
 const data=new Uint8Array([1,2,3]);const uploaded=await blogHttp.request('/api/images',{method:'POST',headers:{Authorization:'Bearer user','X-Image-Name':'test'},body:data},{platform});
 expect(new Uint8Array(await uploaded.arrayBuffer())).toEqual(data);expect(fetch.mock.calls[0][0].headers.get('Authorization')).toBe('Bearer user');expect(fetch.mock.calls[0][0].headers.get('X-Image-Name')).toBe('test');
 const read=await blogHttp.request('/images/old-id',{headers:{'If-None-Match':'"image"'}},{platform});expect(await read.text()).toBe('image');expect(fetch.mock.calls[1][0].url).toContain('/images/old-id');expect(fetch.mock.calls[1][0].headers.get('If-None-Match')).toBe('"image"');expect(read.headers.get('ETag')).toBe('"image"');
});
it('preserves image service failures',async()=>{
 const platform={env:{IMAGE_SERVICE:{fetch:async()=>Response.json({message:'无上传权限'},{status:403})}}} as unknown as App.Platform;
 expect((await blogHttp.request('/api/images',{method:'POST'},{platform})).status).toBe(403);
});
