import { verifyUserToken } from '@hasbai/auth/server';
import { hasPermission } from '@hasbai/auth/config';
import { boundedImage, imageType, imageUrl, imageModels, type ImageAsset } from '@hasbai/images';
import { query, type ImageRow } from './database';
import { generate } from './generation';
import { media } from './media';
class HttpError extends Error { constructor(public status:number,message:string){super(message);} }
const columns='id,name,sha256,content_type,size,ready,owner,source,model,created_at,deleted_at';
function asset(row:ImageRow):ImageAsset{return {id:row.id,name:row.name,content_type:row.content_type,size:row.size,created_at:row.created_at,model:row.model,url:imageUrl(row.id)};}
const json=(data:unknown,status=200)=>Response.json(data,{status,headers:{'Cache-Control':'no-store'}});
export async function saveImage(env:Env,bytes:Uint8Array,type:string,name:string,owner:string,source='upload',model:string|null=null){
 const sha=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',Uint8Array.from(bytes)))).map(n=>n.toString(16).padStart(2,'0')).join('');
 // An abandoned concurrent upload can be completed with the same verified bytes.
 const [row]=await query<ImageRow>(env,`INSERT INTO public.image(name,sha256,content_type,size,owner,source,model) VALUES($1,$2,$3,$4,$5,$6,$7) ON CONFLICT(sha256) DO UPDATE SET sha256=excluded.sha256 WHERE public.image.deleted_at IS NULL RETURNING ${columns}`,[name,sha,type,bytes.length,owner,source,model]);
 if(!row)throw new HttpError(409,'相同图片正在删除，请完成删除后重试');
 if(!row.ready){await env.IMAGES.put(row.id,bytes,{httpMetadata:{contentType:type,cacheControl:'public,max-age=31536000,immutable'},customMetadata:{sha256:sha}});const completed=await query(env,'UPDATE public.image SET ready=true WHERE id=$1 AND deleted_at IS NULL RETURNING id',[row.id]);if(!completed.length){await env.IMAGES.delete(row.id);throw new HttpError(409,'图片已删除，请重新上传');}}
 return asset(row);
}
export default {async fetch(request:Request,env:Env):Promise<Response>{
 const url=new URL(request.url),p=url.pathname;
 try{
  if(p==='/health'||p==='/api/version')return json({ok:true,service:'images',id:env.VERSION.id});
  const match=p.match(/^\/images\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/i);
  if(match&&(request.method==='GET'||request.method==='HEAD')){
   const [row]=await query<ImageRow>(env,`SELECT ${columns} FROM public.image WHERE id=$1 AND ready AND deleted_at IS NULL`,[match[1]]);if(!row)throw new HttpError(404,'图片不存在');
   return await media(request,env,row);
  }
  if(p.startsWith('/images/'))throw new HttpError(404,'图片不存在');
  if(!p.startsWith('/api/'))return env.ASSETS.fetch(request);
  let user;try{user=await verifyUserToken(request.headers.get('Authorization')?.match(/^Bearer (\S+)$/)?.[1]??'');}catch{throw new HttpError(401,'请先登录');}
  if(request.method!=='GET'&&request.headers.has('Origin')&&request.headers.get('Origin')!==url.origin)throw new HttpError(403,'请求来源无效');
  const admin=hasPermission(user,'images.all:all'),owner=user.sub!;
  if(p==='/api/me'&&request.method==='GET')return json({admin});
  if(p==='/api/images'&&request.method==='GET'){
   const page=Number(url.searchParams.get('page')??'1'),search=(url.searchParams.get('q')??'').trim().slice(0,240);if(!Number.isInteger(page)||page<1||page>10000)throw new HttpError(400,'页码无效');
   const all=admin&&url.searchParams.get('scope')==='all';
   const rows=await query<ImageRow>(env,`SELECT ${columns} FROM public.image WHERE ready AND deleted_at IS NULL AND ($1::boolean OR owner=$2) AND name ILIKE $3 ORDER BY created_at DESC,id LIMIT 49 OFFSET $4`,[all,owner,`%${search}%`,(page-1)*48]);
   return json({images:rows.slice(0,48).map(asset),hasMore:rows.length>48});
  }
  if(p==='/api/images'&&request.method==='POST'){
   let bytes;try{bytes=await boundedImage(request);}catch(e){throw new HttpError(413,(e as Error).message);}const type=imageType(bytes);if(!type)throw new HttpError(415,'支持 PNG、JPEG、WebP 和 GIF 图片');
   let name;try{name=decodeURIComponent(request.headers.get('X-Image-Name')??'图片').trim().slice(0,240)||'图片';}catch{throw new HttpError(400,'图片名称无效');}
   return json(await saveImage(env,bytes,type,name,owner));
  }
  if(p==='/api/generate'&&request.method==='POST'){
   const raw=await boundedImage(request);if(raw.length>16_384)throw new HttpError(413,'生成请求过大');
   const value=JSON.parse(new TextDecoder().decode(raw)) as {prompt?:unknown;kind?:unknown;model?:unknown};
   if(typeof value.prompt!=='string'||!value.prompt.trim()||value.prompt.length>1800)throw new HttpError(400,'请填写不超过 1800 字的图片描述');
   const model=value.model??'gpt-image-2.5-flare';if(!imageModels.some(item=>item.id===model))throw new HttpError(400,'请选择 Flare 或 Sunburst 模型');
   const kind=value.kind??'image';if(kind!=='image'&&kind!=='avatar'&&kind!=='portrait')throw new HttpError(400,'图片用途无效');
   const username=typeof user.username==='string'?user.username.trim():'';if(!username||username===owner)throw new HttpError(401,'账户名称未更新，请重新登录');
   let image;try{image=await generate(env,value.prompt,model as typeof imageModels[number]['id'],kind,username,request.signal);}catch{throw new HttpError(request.signal.aborted?499:502,request.signal.aborted?'生成已取消':'AI 图片生成失败，请重试');}
   return json(await saveImage(env,image.bytes,image.type,value.prompt.trim().slice(0,240),owner,'ai',model as string));
  }
  const rename=p.match(/^\/api\/images\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/i);
  if(rename&&request.method==='GET'){
   const [row]=await query<ImageRow>(env,`SELECT ${columns} FROM public.image WHERE id=$1 AND ready AND (deleted_at IS NULL OR $2::boolean OR owner=$3)`,[rename[1],admin,owner]);
   if(!row)throw new HttpError(404,'图片不存在');
   return json({...asset(row),can_manage:admin||row.owner===owner,deleting:!!row.deleted_at});
  }
  if(rename&&request.method==='DELETE'){
   // A committed tombstone makes cleanup retryable without exposing missing bytes.
   const [row]=await query<ImageRow>(env,`UPDATE public.image SET deleted_at=COALESCE(deleted_at,now()) WHERE id=$1 AND ($2::boolean OR owner=$3) RETURNING ${columns}`,[rename[1],admin,owner]);
   if(!row)throw new HttpError(404,'图片不存在或无管理权限');
   await env.IMAGES.delete(row.id);
   await query(env,'DELETE FROM public.image WHERE id=$1 AND deleted_at IS NOT NULL',[row.id]);
   return new Response(null,{status:204,headers:{'Cache-Control':'no-store'}});
  }
  if(rename&&request.method==='PATCH'){
   const raw=await boundedImage(request);if(raw.length>2048)throw new HttpError(413,'名称过长');const value=JSON.parse(new TextDecoder().decode(raw)) as {name?:unknown};if(typeof value.name!=='string'||!value.name.trim()||value.name.length>240)throw new HttpError(400,'请填写不超过 240 字的名称');
   const [row]=await query<ImageRow>(env,`UPDATE public.image SET name=$1 WHERE id=$2 AND ready AND deleted_at IS NULL AND ($3::boolean OR owner=$4) RETURNING ${columns}`,[value.name.trim(),rename[1],admin,owner]);if(!row)throw new HttpError(404,'图片不存在或无管理权限');return json(asset(row));
  }
  throw new HttpError(404,'接口不存在');
 }catch(error){return json({message:error instanceof HttpError?error.message:'图片服务暂时不可用'},error instanceof HttpError?error.status:503);}
}};
