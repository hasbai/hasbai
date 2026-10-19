import { directCommand } from '../shared/commands';
import type { AgentActivity, ContextUsage } from '../shared/types';
import { sessionContext, contextUsage } from './session-context';
import { summarizeWithModel, validSummary } from './context';
import { DurableObject } from 'cloudflare:workers';
import { SessionStore, SESSION_SCHEMA } from './session-store';
import { storyMessages } from './agent';
import { body, HttpError, json } from './http';
import { currentMessages, getSession, message, ownedBooks, session, settings, type MessageRow, type SessionRow } from './store';
import { generate } from './generation';
import { modelInput } from './models';
import { string } from '../shared/cards';

export const sessionName=(owner:string,id:string)=>JSON.stringify([owner,id]);
export const sessionStub=(env:Env,owner:string,id:string)=>(env.SESSIONS as DurableObjectNamespace<TavernSession>).getByName(sessionName(owner,id));
export class TavernSession extends DurableObject<Env> {
 private store?:SessionStore;
 private loading?:Promise<SessionStore>;
 private syncing?:Promise<void>;
 private mutating=false;
 private removed?:{owner:string;id:string};
 private recoveryId?:string;
 private active?:{requestId:string;id:string;abort:AbortController};
 constructor(ctx:DurableObjectState,env:Env){super(ctx,env);}
 private hasSchema(){return this.ctx.storage.sql.exec("SELECT name FROM sqlite_master WHERE type='table' AND name='sessions'").toArray().length>0;}
 /** A settled task must not require object eviction to recover an uncommitted turn. */
 private recoverIdle(store:SessionStore){if(!this.active&&this.recoveryId){store.recover(this.recoveryId);this.recoveryId=undefined;}}
 private available(store:SessionStore){if(this.removed||this.store!==store||store.deleted())throw new HttpError(404,'会话不存在');}
 private async load(owner:string,id:string):Promise<SessionStore>{
  if(this.removed)throw new HttpError(404,'会话不存在');
  if(this.store){if(this.store.id!==id||this.store.directory()?.owner!==owner||this.store.deleted())throw new HttpError(404,'会话不存在');this.recoverIdle(this.store);return this.store;}
  if(this.loading){await this.loading;return this.load(owner,id);}
  this.loading=(async()=>{
   const directory=await getSession(this.env,owner,id);if(directory.deleted_at)throw new HttpError(404,'会话不存在');
   this.ctx.storage.sql.exec(SESSION_SCHEMA);
   const store=new SessionStore(this.ctx.storage,id);
   if(!store.exists()){
    // Frozen before reading messages: every old mutation checks this existing generation fence.
    const fence='do:'+id,now=Date.now();
    const frozen=await this.env.DB.prepare("UPDATE sessions SET storage_backend='do',generation_id=?,generation_until=? WHERE owner=? AND id=? AND deleted_at IS NULL AND (storage_backend='do' OR generation_id IS NULL OR generation_until<=?)").bind(fence,Number.MAX_SAFE_INTEGER,owner,id,now).run();
    if(!frozen.meta.changes){const old=await getSession(this.env,owner,id);if(old.deleted_at)throw new HttpError(404,'会话不存在');throw new HttpError(409,'请先停止生成');}
    await this.env.DB.prepare("UPDATE messages SET status='aborted',finish_reason='interrupted',candidates_json=NULL WHERE session_id=? AND status='pending'").bind(id).run();
    const row=await getSession(this.env,owner,id);
    const messages=(await this.env.DB.prepare('SELECT * FROM messages WHERE session_id=? ORDER BY ordinal,created_at,id').bind(id).all<MessageRow>()).results;
    store.import(row,messages);
   }
   if(store.directory()?.owner!==owner)throw new HttpError(404,'会话不存在');
   if(store.deleted())throw new HttpError(404,'会话不存在');store.recover();this.store=store;await this.scheduleSync();return store;
  })();
  try{return await this.loading;}finally{this.loading=undefined;}
 }
 private async scheduleSync(){if(!this.removed)await this.ctx.storage.setAlarm(Date.now()+1000);}
 /** Keep the retry alarm until the final atomic deletion also removes it. */
 private async purge(store:SessionStore){
  const row=store.directory();
  const result=await this.env.DB.prepare("UPDATE sessions SET deleted_at=COALESCE(deleted_at,?),book_ids_json='[]' WHERE id=? AND owner=? AND storage_backend='do'").bind(Date.now(),row.id,row.owner).run();
  if(!result.meta.changes)throw new Error('会话删除同步失败');
  await this.ctx.storage.deleteAll();
  this.removed={owner:row.owner,id:row.id};this.store=undefined;this.loading=undefined;
 }
 /** Directory writes are serialized, and their revision stays durable until D1 acknowledges it. */
 private async sync(){
  if(this.mutating){await this.scheduleSync();return;}
  if(this.syncing)return this.syncing;
  this.syncing=(async()=>{
   const store=this.store;if(!store)return;
   for(;;){const meta=store.syncState();if(meta.deleted){await this.purge(store);return;}if(meta.revision===meta.synced_revision)return;const row=store.directory();
    const result=await this.env.DB.prepare("UPDATE sessions SET title=?,settings_json=?,book_ids_json=?,updated_at=? WHERE id=? AND owner=? AND storage_backend='do' AND deleted_at IS NULL").bind(row.title,row.settings_json,row.book_ids_json,row.updated_at,row.id,row.owner).run();
    if(!result.meta.changes)throw new Error('会话目录同步失败');store.synced(meta.revision);
   }
  })();
  try{await this.syncing;}finally{this.syncing=undefined;}
 }
 private async settled(id:string){if(this.active?.id===id){this.recoveryId=id;this.active=undefined;if(this.store)this.recoverIdle(this.store);}if(this.removed||this.store?.deleted())return;await this.scheduleSync();this.ctx.waitUntil(this.sync().catch(()=>{}));}
 async alarm(){
  if(this.removed)return;
  if(!this.store){if(!this.hasSchema())return;const row=this.ctx.storage.sql.exec<SessionRow & Record<string,SqlStorageValue>>('SELECT * FROM sessions LIMIT 1').toArray()[0];if(!row)return;const stored=new SessionStore(this.ctx.storage,row.id);if(stored.deleted())this.store=stored;else await this.load(row.owner,row.id);}
  try{await this.sync();}catch{await this.ctx.storage.setAlarm(Date.now()+10000);}
 }
 private async read(owner:string,id:string){const store=await this.load(owner,id);const context=await sessionContext(this.env,this.ctx,owner,store,async()=>{throw Error('只读请求不能调用模型');});this.available(store);return {session:{...session(store.get(),true),state:store.state()},messages:currentMessages(store.messages()),activities:store.activities(),context:contextUsage(context)};}
 private async stopRequest(owner:string,id:string,requestId:string){
  if(!/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i.test(requestId))throw new HttpError(400,'请求 ID 无效');
  const store=await this.load(owner,id);store.cancelRequest(requestId);
  const active=this.active;if(active?.requestId===requestId){if(store.owns(active.id))store.stop(active.id);active.abort.abort();}
  return {ok:true};
 }
 private async stop(owner:string,id:string,generationId:string){
  if(!this.store){
   const old=await getSession(this.env,owner,id);
   if(old.storage_backend==='d1'&&old.generation_id&&(old.generation_until??0)>Date.now()){
    if(old.generation_id!==generationId)throw new HttpError(409,'生成状态已改变');
    const stopped=await this.env.DB.prepare("UPDATE messages SET status='aborted',finish_reason='stopped' WHERE session_id=? AND id=? AND status='pending' AND EXISTS(SELECT 1 FROM sessions WHERE id=? AND owner=? AND storage_backend='d1' AND generation_id=?)").bind(id,generationId,id,owner,generationId).run();
    if(!stopped.meta.changes)throw new HttpError(409,'生成状态已改变');return {ok:true};
   }
  }
  const store=await this.load(owner,id);store.stop(generationId);if(this.active?.id===generationId)this.active.abort.abort();return {ok:true};
 }
 /** Older outer Worker versions may still send transport-cancel RPCs during deployment. */
 async cancel(owner:string,id:string,_requestId:string){await this.load(owner,id);}
 private async update(owner:string,id:string,data:Record<string,unknown>){
  const store=await this.load(owner,id),row=store.idle(),opts=data.settings?settings(data.settings):settings(JSON.parse(row.settings_json));
  const ids=data.bookIds??JSON.parse(row.book_ids_json);await ownedBooks(this.env,owner,ids);if(data.settings)modelInput(opts);
  const title=data.title===undefined?row.title:string(data.title).trim();if(!title||title.length>120)throw new HttpError(400,'会话名称无效');
  // Reserve old and new bindings before the DO commits; a failed sync never releases a live reference.
  const union=[...new Set([...JSON.parse(row.book_ids_json),...(ids as string[])])];
  store.dirty();await this.scheduleSync();
  const reserved=await this.env.DB.prepare("UPDATE sessions SET book_ids_json=? WHERE id=? AND owner=? AND deleted_at IS NULL AND (SELECT count(*) FROM worldbooks WHERE owner=? AND id IN(SELECT value FROM json_each(?)))=?").bind(JSON.stringify(union),id,owner,owner,JSON.stringify(ids),(ids as string[]).length).run();
  if(!reserved.meta.changes)throw new HttpError(409,'世界书状态已改变，请重试');
  store.update(JSON.stringify(opts),JSON.stringify(ids),title);await this.scheduleSync();return session(store.get(),true);
 }
 private async changeMessage(owner:string,id:string,data:Record<string,unknown>){
  const store=await this.load(owner,id);if(this.active)throw new HttpError(409,'请先停止生成');
  const action=data.action;if(action!=='edit'&&action!=='delete')throw new HttpError(400,'消息操作无效');
  const content=string(data.content).trim();if(action==='edit'&&(!content||content.length>24000))throw new HttpError(400,'消息需为 1–24000 字符');
  const hadSummary=await validSummary(store.get().summary_json,storyMessages(store.messages()));
  store.truncate(string(data.messageId),action,content);await this.scheduleSync();
  if(hadSummary&&!store.get().summary_json&&storyMessages(store.messages()).length&&string(data.username).trim())await this.command(owner,id,{content:'/compress',requestId:crypto.randomUUID(),username:data.username},true);
  return {ok:true};
 }
 private async command(owner:string,id:string,data:Record<string,unknown>,waitForCompletion=false){
  const store=await this.load(owner,id),command=directCommand(string(data.content));
  if(!command)throw new HttpError(400,'命令无效');
  const requestId=string(data.requestId);if(!/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i.test(requestId))throw new HttpError(400,'请求 ID 无效');
  if(store.activities().some(a=>a.id===requestId))return {ok:true};
  const context=await sessionContext(this.env,this.ctx,owner,store,messages=>summarizeWithModel(this.env,string(data.username),requestId,settings(JSON.parse(store.get().settings_json)),messages,abort.signal));
  this.available(store);if(store.activities().some(a=>a.id===requestId))return {ok:true};if(store.cancelled(requestId))throw new HttpError(409,'命令已停止');
  const abort=new AbortController(),value:AgentActivity={id:requestId,messageId:null,ordinal:Math.max(-1,...store.messages().map(m=>m.ordinal)),kind:command==='compress'?'compression':'status',title:command==='compress'?'压缩上下文':'当前状态',status:'running',createdAt:Date.now()};
  if(command==='status'){store.activity({...value,status:'completed',result:{state:store.state(),context:contextUsage(context),generationId:store.get().generation_id}});return {ok:true};}
  if(this.active||!store.claim(requestId,Date.now()))throw new HttpError(409,'请先停止生成');
  try{store.activity(value);}catch(error){store.release(requestId);throw error;}this.active={id:requestId,requestId,abort};
  const timer=setInterval(()=>{if(!store.renew(requestId))abort.abort();},1000);
  const work=(async()=>{try{
   const before=contextUsage(context);await context.compress();
   if(abort.signal.aborted||!store.owns(requestId))throw Error('压缩已停止');
   store.transaction(()=>{store.saveCheckpoint(requestId,JSON.stringify(context.summary));store.activity({...value,status:'completed',result:{summary:context.summary,before,after:contextUsage(context)}});});
  }catch(error){store.activity({...value,status:abort.signal.aborted?'stopped':'error',error:(error as Error).message});}
  finally{clearInterval(timer);try{store.release(requestId);}finally{await this.settled(requestId);}}})();
  this.ctx.waitUntil(work);if(waitForCompletion)await work;return {ok:true};
 }
 private async remove(owner:string,id:string){
  if(this.active)throw new HttpError(409,'请先停止生成');
  if(this.loading)await this.loading;
  const directory=await getSession(this.env,owner,id);
  if(this.removed){if(this.removed.owner!==owner||this.removed.id!==id)throw new HttpError(404,'会话不存在');return {ok:true};}
  let store=this.store;
  if(!store&&this.hasSchema()){const stored=new SessionStore(this.ctx.storage,id);if(stored.exists())store=stored.deleted()?stored:await this.load(owner,id);}
  if(!store){
   if(directory.deleted_at){await this.ctx.storage.deleteAll();this.removed={owner,id};return {ok:true};}
   store=await this.load(owner,id);
  }
  if(store.id!==id||store.directory()?.owner!==owner)throw new HttpError(404,'会话不存在');
  this.store=store;if(!store.deleted()){this.recoverIdle(store);store.remove();}await this.scheduleSync();await this.purge(store);return {ok:true};
 }
 private async export(owner:string,id:string){const store=await this.load(owner,id),row=store.get();return {row,messages:store.messages(),snapshots:store.snapshots()};}
 async invoke(owner:string,id:string,method:SessionMethod,data:Record<string,unknown>={}){
  const mutation=['update','changeMessage','command','remove'].includes(method);
  try{
   if(method!=='stop'&&method!=='remove')await this.load(owner,id);
   if(mutation){if(this.mutating||this.syncing)throw new HttpError(409,'会话状态已改变，请重试');this.mutating=true;}
   let value!:SessionResults[SessionMethod];
   try{
    switch(method){
     case 'read':value=await this.read(owner,id);break;
     case 'stop':value=data.requestId!==undefined?await this.stopRequest(owner,id,string(data.requestId)):await this.stop(owner,id,string(data.generationId));break;
     case 'update':value=await this.update(owner,id,data);break;
     case 'changeMessage':value=await this.changeMessage(owner,id,data);break;
     case 'command':value=await this.command(owner,id,data);break;
     case 'remove':value=await this.remove(owner,id);break;
     case 'export':value=await this.export(owner,id);break;
    }
   }finally{if(mutation)this.mutating=false;}
   if(mutation&&method!=='remove')await this.sync().catch(()=>{});
   return JSON.stringify({ok:true,value});
  }catch(e){if(e instanceof HttpError)return JSON.stringify({ok:false,status:e.status,message:e.message});throw e;}
 }
 async fetch(request:Request){
  try{
   const owner=request.headers.get('X-Tavern-Owner')??'',id=request.headers.get('X-Tavern-Session')??'',username=decodeURIComponent(request.headers.get('X-Tavern-Username')??'');
   const store=await this.load(owner,id),data=await body(request);this.available(store);if(this.mutating)throw new HttpError(409,'会话状态已改变，请重试');
   if(directCommand(string(data.content)))return json(await this.command(owner,id,{...data,username}));
   return await generate(request,this.env,this.ctx,owner,id,data,username,store,(id)=>this.settled(id),(assistantId,abort)=>{this.active={requestId:String(data.requestId),id:assistantId,abort};},()=>{this.available(store);if(this.mutating)throw new HttpError(409,'会话状态已改变，请重试');});
  }catch(e){if(e instanceof HttpError)return json({message:e.message},e.status);throw e;}
 }
}

export type SessionResults={
 read:{session:ReturnType<typeof session>;messages:ReturnType<typeof message>[];activities:AgentActivity[];context:ContextUsage};
 stop:{ok:boolean};update:ReturnType<typeof session>;changeMessage:{ok:boolean};command:{ok:boolean};remove:{ok:boolean};
 export:{row:SessionRow;messages:ReturnType<typeof message>[];snapshots:ReturnType<SessionStore['snapshots']>};
};
export type SessionMethod=keyof SessionResults;
export async function callSession<K extends SessionMethod>(env:Env,owner:string,id:string,method:K,data:Record<string,unknown>={}):Promise<SessionResults[K]>{
 const result=JSON.parse(await sessionStub(env,owner,id).invoke(owner,id,method,data)) as {ok:boolean;status:number;message:string;value:unknown};
 if(!result.ok)throw new HttpError(result.status,result.message);return result.value as SessionResults[K];
}
