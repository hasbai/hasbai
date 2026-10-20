import { avatarImage, MAX_AVATAR_BYTES, type AvatarImage } from '../shared/avatar';
import { MAX_JSON_BYTES, object } from '../shared/cards';
import { body, boundedBody, HttpError } from './http';
import { publicPng } from '@hasbai/images/png';
import type { ImageAsset } from '@hasbai/images';
export type CharacterImages={avatarImageId?:string;portraitImageId?:string};
function imageId(value:unknown):string|undefined{
 if(value===undefined||value===null)return;
 if(typeof value!=='string'||!/^([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/i.test(value))throw new HttpError(400,'图片引用无效');return value;
}
function serviceRequest(request:Request,path:string,init:RequestInit={}){
 const url=new URL(request.url);url.pathname=path;url.search='';const headers=new Headers(init.headers);headers.set('Authorization',request.headers.get('Authorization')??'');
 return new Request(url,{...init,headers,signal:request.signal});
}
export async function uploadCharacterImage(request:Request,env:Env,image:AvatarImage,name:string){
 const response=await env.IMAGE_SERVICE.fetch(serviceRequest(request,'/api/images',{method:'POST',headers:{'Content-Type':image.type,'X-Image-Name':encodeURIComponent(name)},body:Uint8Array.from(publicPng(image.bytes))}));
 if(!response.ok)throw new HttpError(502,'图片保存到图床失败，请重试');return (await response.json() as ImageAsset).id;
}
export async function characterImages(request:Request,env:Env,value:Record<string,unknown>):Promise<CharacterImages>{
 const result:CharacterImages={avatarImageId:imageId(value.avatarImageId),portraitImageId:imageId(value.portraitImageId)};
 for(const id of Object.values(result).filter(Boolean)){
  const response=await env.IMAGE_SERVICE.fetch(serviceRequest(request,'/images/'+id,{method:'HEAD'}));if(!response.ok)throw new HttpError(400,'图床图片不存在');
 }
 return result;
}

export async function characterForm(request:Request,env:Env):Promise<{card:Record<string,unknown>;images:CharacterImages}>{
 const bytes=await boundedBody(request,MAX_JSON_BYTES+MAX_AVATAR_BYTES*2+64*1024);
 let card:Record<string,unknown>,images:CharacterImages;const uploads:{kind:'avatar'|'portrait';image:AvatarImage}[]=[];
 try{
  const form=await new Response(Uint8Array.from(bytes),{headers:{'Content-Type':request.headers.get('Content-Type')??''}}).formData();
  const raw=form.get('card');if(typeof raw!=='string'||new TextEncoder().encode(raw).length>MAX_JSON_BYTES)throw Error('角色表单无效');card=object(JSON.parse(raw));
  images=await characterImages(request,env,{avatarImageId:form.get('avatarImageId'),portraitImageId:form.get('portraitImageId')});
  for(const kind of ['avatar','portrait'] as const){const file=form.get(kind);if(file!==null){if(!(file instanceof File))throw Error('角色图片无效');uploads.push({kind,image:avatarImage(new Uint8Array(await file.arrayBuffer()))});}}
 }catch(error){if(error instanceof HttpError)throw error;throw new HttpError(400,(error as Error).message);}
 for(const {kind,image} of uploads)images[kind==='avatar'?'avatarImageId':'portraitImageId']=await uploadCharacterImage(request,env,image,kind==='avatar'?'角色头像':'角色立绘');
 return {card,images};
}
export async function generateCharacterImage(request:Request,env:Env,kind:'avatar'|'portrait'){
 const data=await body(request);if(typeof data.prompt!=='string'||!data.prompt.trim()||data.prompt.length>1800)throw new HttpError(400,'请填写不超过 1800 字的图片描述');
 const response=await env.IMAGE_SERVICE.fetch(serviceRequest(request,'/api/generate',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({prompt:data.prompt,kind,model:kind==='avatar'?'gpt-image-2.5-flare':'gpt-image-2.5-sunburst'})}));
 return new Response(response.body,{status:response.status,headers:{'Content-Type':'application/json','Cache-Control':'no-store'}});
}
