import { sseData } from '../../shared/sse';
import type { StreamEvent, Message } from '../../shared/types';
export function createApi(token:()=>Promise<string>) {
 async function response(path:string,init:RequestInit={}) {const headers=new Headers(init.headers);headers.set('Authorization','Bearer '+await token());const r=await fetch('/api/'+path,{...init,headers});if(!r.ok){const data=await r.json().catch(()=>({})) as {message?:string};throw new Error(data.message||`请求失败 (${r.status})`);}return r;}
 async function request<T>(path:string,method='GET',value?:unknown,signal?:AbortSignal):Promise<T> {return (await response(path,{method,signal,...(value!==undefined?{headers:{'Content-Type':'application/json'},body:JSON.stringify(value)}:{})})).json() as Promise<T>;}
 async function upload<T>(path:string,file:File):Promise<T> {if(file.size>12*1024*1024)throw new Error('文件超过 12 MB');return (await response(path,{method:'POST',headers:{'X-Filename':encodeURIComponent(file.name)},body:file})).json() as Promise<T>;}
 async function download(path:string,filename:string) {const r=await response(path);const blob=await r.blob();const url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download=filename;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);}
 async function avatar(id:string) {const r=await response(`characters/${id}/avatar`,{cache:'no-store'});return URL.createObjectURL(await r.blob());}
 async function avatarDraft(prompt:string,signal:AbortSignal) {return (await response('characters/avatar/generate',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({prompt}),signal})).blob();}
 async function saveCharacter<T>(card:unknown,id?:string,avatar?:File):Promise<T> {
  if(!avatar)return request<T>(id?'characters/'+id:'characters',id?'PATCH':'POST',id?{card}:card);
  const form=new FormData();form.set('card',JSON.stringify(card));form.set('avatar',avatar);
  return (await response(id?'characters/'+id:'characters',{method:id?'PATCH':'POST',body:form})).json() as Promise<T>;
 }
 async function generate(id:string,value:unknown,event:(e:StreamEvent)=>void,signal:AbortSignal) {
  const r=await response(`sessions/${id}/generate`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(value),signal});
  if(r.headers.get('Content-Type')?.includes('application/json')) {const replay=await r.json() as {message?:Message;ok?:boolean};if(replay.message)event({type:'done',message:replay.message});else if(!replay.ok)throw Error('命令响应无效');return;}
  if(!r.body)throw new Error('生成响应为空');let done=false;
  for await(const data of sseData(r.body,signal)){const e=JSON.parse(data) as StreamEvent;event(e);if(e.type==='done')done=true;}
  if(!done)throw new Error('连接中断，已保存的内容可刷新恢复');
 }
 return {request,upload,download,avatar,avatarDraft,saveCharacter,generate};
}
export type Api=ReturnType<typeof createApi>;
