import type { ImageAsset,ImageModel } from '@hasbai/images';
export function createApi(token:()=>Promise<string>){
 async function response(path:string,init:RequestInit={}){const headers=new Headers(init.headers);headers.set('Authorization','Bearer '+await token());const r=await fetch('/api/'+path,{...init,headers});if(!r.ok){const e=await r.json().catch(()=>({})) as {message?:string};throw Error(e.message||'请求失败，请重试');}return r;}
 return {
  me:async()=> (await response('me')).json() as Promise<{admin:boolean}>,
  list:async(q:string,page:number,scope:string)=>(await response('images?'+new URLSearchParams({q,page:String(page),scope}))).json() as Promise<{images:ImageAsset[];hasMore:boolean}>,
  upload:async(file:File)=>(await response('images',{method:'POST',headers:{'X-Image-Name':encodeURIComponent(file.name)},body:file})).json() as Promise<ImageAsset>,
  generate:async(prompt:string,model:ImageModel,signal:AbortSignal)=>(await response('generate',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({prompt,model}),signal})).json() as Promise<ImageAsset>,
  get:async(id:string)=>(await response('images/'+encodeURIComponent(id))).json() as Promise<ImageAsset & {can_manage:boolean;deleting:boolean}>,
  remove:async(id:string)=>{await response('images/'+encodeURIComponent(id),{method:'DELETE'});},
  rename:async(id:string,name:string)=>(await response('images/'+id,{method:'PATCH',headers:{'Content-Type':'application/json'},body:JSON.stringify({name})})).json() as Promise<ImageAsset>,
 };
}
export type Api=ReturnType<typeof createApi>;

export const previewUrl=(image:ImageAsset,variant:'thumb'|'display')=>image.url+'?variant='+variant;
export const detailUrl=(id:string)=>'/library/'+encodeURIComponent(id);
