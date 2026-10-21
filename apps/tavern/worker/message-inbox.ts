import { DurableObject } from 'cloudflare:workers';
import { addressed, splitTelegram, telegramApi, TelegramError, telegramText, type TelegramUpdate } from '@hasbai/messaging';
import { callSession, sessionStub } from './session-object';
import { type ChannelRoute } from './channels';
import { HttpError } from './http';
import { directCommand } from '../shared/commands';
import { commandReceipt, telegramControl } from './telegram-commands';
import { telegramEdit } from './telegram-edit';
import { telegramDialogue } from '../shared/telegram-input';

export const INBOX_SCHEMA=`
CREATE TABLE IF NOT EXISTS inbox_jobs (
 update_id INTEGER PRIMARY KEY, route_id TEXT NOT NULL, request_id TEXT NOT NULL,
 sender_id INTEGER NOT NULL, text TEXT NOT NULL, phase TEXT NOT NULL,
 received_at INTEGER NOT NULL, error TEXT
);
CREATE TABLE IF NOT EXISTS inbox_chunks (
 update_id INTEGER NOT NULL, ordinal INTEGER NOT NULL, text TEXT NOT NULL,
 state TEXT NOT NULL DEFAULT 'ready', telegram_id INTEGER,
 PRIMARY KEY(update_id,ordinal)
);
CREATE TABLE IF NOT EXISTS inbox_background (update_id INTEGER PRIMARY KEY, text TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS inbox_seen (update_id INTEGER PRIMARY KEY, received_at INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS inbox_stops (route_id TEXT NOT NULL, request_id TEXT NOT NULL, PRIMARY KEY(route_id,request_id));
CREATE TABLE IF NOT EXISTS inbox_sources (update_id INTEGER PRIMARY KEY, message_id INTEGER NOT NULL);
`;
type Job={update_id:number;route_id:string;request_id:string;sender_id:number;text:string;phase:'queued'|'generating'|'sending'|'done'|'attention'|'cancelled';received_at:number;error:string|null};
type Chunk={ordinal:number;text:string;state:'ready'|'sending'|'sent';telegram_id:number|null};
export class MessageInbox extends DurableObject<Env> {
 private working=false;
 private init(){this.ctx.storage.sql.exec(INBOX_SCHEMA);}
 private first<T extends Record<string,SqlStorageValue>>(sql:string,...v:SqlStorageValue[]){return this.ctx.storage.sql.exec<T>(sql,...v).toArray()[0];}
 async receive(routeId:string,update:TelegramUpdate){
  this.init();
  const route=await this.env.DB.prepare('SELECT * FROM channel_routes WHERE id=? AND active=1').bind(routeId).first<ChannelRoute>();
  if(!route)return {accepted:false};
  const m=update.message,id=update.update_id;
  if(this.first('SELECT update_id FROM inbox_jobs WHERE update_id=?',id)||this.first('SELECT update_id FROM inbox_seen WHERE update_id=?',id))return {accepted:true};
  const control=telegramControl(m,this.env.TELEGRAM_BOT_USERNAME);
  if(!control&&!addressed(m,this.env.TELEGRAM_BOT_USERNAME)){
   this.ctx.storage.transactionSync(()=>{this.ctx.storage.sql.exec('INSERT OR IGNORE INTO inbox_seen VALUES(?,?)',id,Date.now());this.ctx.storage.sql.exec('INSERT OR IGNORE INTO inbox_background VALUES(?,?)',id,telegramText(m));this.ctx.storage.sql.exec('DELETE FROM inbox_background WHERE update_id NOT IN (SELECT update_id FROM inbox_background ORDER BY update_id DESC LIMIT 100)');this.ctx.storage.sql.exec('DELETE FROM inbox_seen WHERE received_at<?',Date.now()-7*86400000);});
   return {accepted:true};
  }
  const now=Date.now();
  const rate=this.first<{n:number}>('SELECT count(*) AS n FROM inbox_jobs WHERE received_at>? AND sender_id=?',now-60000,m.from.id)?.n??0;
  const group=this.first<{n:number}>('SELECT count(*) AS n FROM inbox_jobs WHERE received_at>?',now-60000)?.n??0;
  if(rate>=15||group>=60)return {accepted:false};
  const background=this.ctx.storage.sql.exec<{text:string}>('SELECT text FROM inbox_background ORDER BY update_id').toArray();
  let text=telegramDialogue(control?.content??telegramText(m));
  // Latest original input is always retained; oldest unsent background is dropped first.
  if(!control)for(let i=background.length-1;i>=0;i--){const next=telegramDialogue(background[i].text)+'\n'+text;if(next.length>23500)break;text=next;}
  await this.ctx.storage.setAlarm(now+100);
  this.ctx.storage.transactionSync(()=>{
   if(this.first('SELECT update_id FROM inbox_jobs WHERE update_id=?',id))return;
   this.ctx.storage.sql.exec("INSERT OR IGNORE INTO inbox_jobs VALUES(?,?,?,?,?,'queued',?,NULL)",id,route.id,crypto.randomUUID(),m.from.id,text,now);
   this.ctx.storage.sql.exec('INSERT OR IGNORE INTO inbox_sources VALUES(?,?)',id,m.message_id);
   if(!control)this.ctx.storage.sql.exec('DELETE FROM inbox_background');
  });
  await this.react(update);
  return {accepted:true};
 }
 private async react(update:TelegramUpdate){try{await telegramApi(this.env.TELEGRAM_BOT_TOKEN,'setMessageReaction',{chat_id:update.message.chat.id,message_id:update.message.message_id,reaction:[{type:'emoji',emoji:'👀'}]});}catch{console.warn(JSON.stringify({event:'telegram_reaction_failed',updateId:update.update_id}));}}
 async status(routeId:string){
  this.init();return {jobs:this.ctx.storage.sql.exec<{update_id:number;phase:string;error:string|null}>("SELECT update_id,phase,error FROM inbox_jobs WHERE route_id=? AND phase NOT IN ('done','cancelled') ORDER BY update_id",routeId).toArray()};
 }
 async resolve(routeId:string,action:'retry'|'skip'){
  this.init();const job=this.first<Job>("SELECT * FROM inbox_jobs WHERE route_id=? AND phase='attention' ORDER BY update_id LIMIT 1",routeId);
  if(!job)return {ok:true};
  if(action==='retry'&&(job.error==='Tavern 回复未完成，请在酒馆查看'||!this.first('SELECT update_id FROM inbox_chunks WHERE update_id=?',job.update_id)))throw new HttpError(409,'此回复未完成，请跳过后在酒馆查看');
  if(action==='skip')this.ctx.storage.sql.exec("UPDATE inbox_jobs SET phase='cancelled',text='' WHERE update_id=?",job.update_id);
  else this.ctx.storage.transactionSync(()=>{this.ctx.storage.sql.exec("UPDATE inbox_chunks SET state='ready' WHERE update_id=? AND state='sending'",job.update_id);this.ctx.storage.sql.exec("UPDATE inbox_jobs SET phase='generating',error=NULL WHERE update_id=?",job.update_id);});
  await this.ctx.storage.setAlarm(Date.now()+100);return {ok:true};
 }
 async revoke(routeId:string){
  this.init();
  // The route is already inactive before this RPC; no later job may enter sendMessage.
  this.ctx.storage.transactionSync(()=>{
   this.ctx.storage.sql.exec("INSERT OR IGNORE INTO inbox_stops SELECT route_id,request_id FROM inbox_jobs WHERE route_id=? AND phase='generating'",routeId);
   this.ctx.storage.sql.exec("UPDATE inbox_jobs SET phase='cancelled' WHERE route_id=? AND phase NOT IN ('done','cancelled')",routeId);
  });
  this.ctx.storage.sql.exec('DELETE FROM inbox_background');
  const route=await this.env.DB.prepare('SELECT * FROM channel_routes WHERE id=?').bind(routeId).first<ChannelRoute>();
  if(route)for(const stop of this.ctx.storage.sql.exec<{request_id:string}>('SELECT request_id FROM inbox_stops WHERE route_id=?',routeId).toArray()){
   try{await callSession(this.env,route.owner,route.session_id,'stop',{requestId:stop.request_id});}catch(error){if(!(error instanceof HttpError&&error.status===404))throw error;}
   this.ctx.storage.sql.exec('DELETE FROM inbox_stops WHERE route_id=? AND request_id=?',routeId,stop.request_id);
  }
  return {ok:true};
 }
 async alarm(){
  this.init();if(this.working){await this.ctx.storage.setAlarm(Date.now()+5000);return;}this.working=true;
  const job=this.first<Job>("SELECT * FROM inbox_jobs WHERE phase NOT IN ('done','cancelled') ORDER BY update_id LIMIT 1");
  try{
   if(!job||job.phase==='attention')return;
   const notBefore=await this.ctx.storage.get<number>('notBefore');
   if(notBefore&&notBefore>Date.now()){await this.ctx.storage.setAlarm(notBefore);return;}
   // Persist the recovery wakeup before crossing a service/model boundary.
   await this.ctx.storage.setAlarm(Date.now()+5000);
   const route=await this.env.DB.prepare('SELECT * FROM channel_routes WHERE id=? AND active=1').bind(job.route_id).first<ChannelRoute>();
   if(!route){this.ctx.storage.sql.exec("UPDATE inbox_jobs SET phase='cancelled' WHERE update_id=?",job.update_id);return;}
   if(job.phase==='queued'){
    if(this.first<{phase:string}>('SELECT phase FROM inbox_jobs WHERE update_id=?',job.update_id)?.phase==='cancelled')return;
    this.ctx.storage.sql.exec("UPDATE inbox_jobs SET phase='generating' WHERE update_id=?",job.update_id);
    const response=await sessionStub(this.env,route.owner,route.session_id).fetch(new Request('https://session/generate',{method:'POST',headers:{'Content-Type':'application/json','X-Tavern-Owner':route.owner,'X-Tavern-Session':route.session_id,'X-Tavern-Username':encodeURIComponent(route.username)},body:JSON.stringify({requestId:job.request_id,content:telegramDialogue(job.text)})}));
    // Detach only the viewer; the normal Tavern generation remains durable.
    await response.body?.cancel();
    if(response.status===409){this.ctx.storage.sql.exec("UPDATE inbox_jobs SET phase='queued' WHERE update_id=? AND phase='generating'",job.update_id);return;}
    if(!response.ok){this.fail(job,'Tavern 未接受此消息');return;}
    job.phase='generating';
   }
   if(job.phase==='generating'){
    const command=directCommand(job.text);
    const progress=command?null:await callSession(this.env,route.owner,route.session_id,'progress',{requestId:job.request_id});
    const view=command?await callSession(this.env,route.owner,route.session_id,'read'):null;
    const activity=view?.activities?.find(a=>a.id===job.request_id),result=progress?.message;
    if(!result&&!activity){
     // A crash before acceptance is safe to replay with the persisted request UUID.
     if(!(progress?.generating??view?.session.generationId))this.ctx.storage.sql.exec("UPDATE inbox_jobs SET phase='queued' WHERE update_id=? AND phase='generating'",job.update_id);
     return;
    }
    if(activity?.status==='running')return;
    if(result?.status==='pending'){if(result.content){this.render(job,result.content);await this.deliver(job,route,'generating');}return;}
    if(result&&(result.status!=='completed'||result.finishReason!=='stop')){
     const uncertain=this.first('SELECT update_id FROM inbox_chunks WHERE update_id=? AND state=\'sending\' AND telegram_id IS NULL',job.update_id);
     if(uncertain){this.fail(job,'发送结果不明，请确认后重试或跳过');return;}
     this.ctx.storage.sql.exec('DELETE FROM inbox_chunks WHERE update_id=? AND telegram_id IS NULL',job.update_id);
     this.ctx.storage.sql.exec("UPDATE inbox_chunks SET text='回复未完成，请在酒馆查看。',state='ready' WHERE update_id=? AND telegram_id IS NOT NULL",job.update_id);
     await this.deliver(job,route,'generating');this.fail(job,'Tavern 回复未完成，请在酒馆查看');return;
    }
    const text=activity?commandReceipt(activity):result!.content;
    this.ctx.storage.transactionSync(()=>{
     if(this.first<{phase:string}>('SELECT phase FROM inbox_jobs WHERE update_id=?',job.update_id)?.phase==='cancelled')return;
     this.render(job,text);
     this.ctx.storage.sql.exec("UPDATE inbox_jobs SET phase='sending' WHERE update_id=?",job.update_id);
    });
   }
   await this.deliver(job,route);
  }catch(error){
   if(job&&error instanceof TelegramError){
    if(error.kind==='retry'){this.ctx.storage.sql.exec("UPDATE inbox_chunks SET state='ready' WHERE update_id=? AND state='sending'",job.update_id);const until=Date.now()+error.retryAfter*1000;await this.ctx.storage.put('notBefore',until);await this.ctx.storage.setAlarm(until);}
    else this.fail(job,error.kind==='uncertain'?'发送结果不明，请确认后重试或跳过':'Telegram 拒绝发送，请处理后重试或跳过');
   }else if(job&&error instanceof HttpError&&error.status===404)this.fail(job,'酒馆会话已删除，请跳过并重新绑定');
   else console.error(JSON.stringify({event:'message_inbox_retry',updateId:job?.update_id}));
  }finally{
   this.working=false;
   // Bound receipt retention without removing any queued or unresolved work.
   this.ctx.storage.sql.exec("DELETE FROM inbox_chunks WHERE update_id IN (SELECT update_id FROM inbox_jobs WHERE phase IN ('done','cancelled') AND received_at<?)",Date.now()-7*86400000);
   this.ctx.storage.sql.exec("DELETE FROM inbox_sources WHERE update_id IN (SELECT update_id FROM inbox_jobs WHERE phase IN ('done','cancelled') AND received_at<?)",Date.now()-7*86400000);
   this.ctx.storage.sql.exec("DELETE FROM inbox_jobs WHERE phase IN ('done','cancelled') AND received_at<?",Date.now()-7*86400000);
   const next=this.first<{phase:string}>("SELECT phase FROM inbox_jobs WHERE phase NOT IN ('done','cancelled') ORDER BY update_id LIMIT 1");
   if(next&&next.phase!=='attention')await this.ctx.storage.setAlarm(Math.max(Date.now()+(next.phase==='generating'?1000:5000),await this.ctx.storage.get<number>('notBefore')??0));
  }
 }
 private fail(job:Job,error:string){this.ctx.storage.sql.exec("UPDATE inbox_jobs SET phase='attention',error=? WHERE update_id=? AND phase!='cancelled'",error,job.update_id);}
 private render(job:Job,text:string){
  if(this.first<{phase:string}>('SELECT phase FROM inbox_jobs WHERE update_id=?',job.update_id)?.phase==='cancelled')return;
  splitTelegram(text).forEach((text,ordinal)=>this.ctx.storage.sql.exec("INSERT INTO inbox_chunks(update_id,ordinal,text) VALUES(?,?,?) ON CONFLICT(update_id,ordinal) DO UPDATE SET text=excluded.text,state=CASE WHEN inbox_chunks.state='sending' AND inbox_chunks.telegram_id IS NULL THEN 'sending' WHEN inbox_chunks.text=excluded.text THEN inbox_chunks.state ELSE 'ready' END",job.update_id,ordinal,text));
 }
 private async deliver(job:Job,route:ChannelRoute,phase='sending'){
  if(this.first<{phase:string}>('SELECT phase FROM inbox_jobs WHERE update_id=?',job.update_id)?.phase!==phase)return;
  const chunks=this.ctx.storage.sql.exec<Chunk>('SELECT ordinal,text,state,telegram_id FROM inbox_chunks WHERE update_id=? ORDER BY ordinal',job.update_id).toArray();
  for(const chunk of chunks){
   if(chunk.state==='sent')continue;
   if(chunk.state==='sending'&&chunk.telegram_id===null){this.fail(job,'发送结果不明，请确认后重试或跳过');return;}
   if(!await this.env.DB.prepare('SELECT id FROM channel_routes WHERE id=? AND active=1').bind(route.id).first())return;
   if(this.first<{phase:string}>('SELECT phase FROM inbox_jobs WHERE update_id=?',job.update_id)?.phase!==phase)return;
   this.ctx.storage.sql.exec("UPDATE inbox_chunks SET state='sending' WHERE update_id=? AND ordinal=?",job.update_id,chunk.ordinal);
   const source=this.first<{message_id:number}>('SELECT message_id FROM inbox_sources WHERE update_id=?',job.update_id);
   let messageId=chunk.telegram_id;
   if(messageId!==null)await telegramEdit(this.env.TELEGRAM_BOT_TOKEN,route.chat_id,messageId,chunk.text);
   else messageId=(await telegramApi<{message_id:number}>(this.env.TELEGRAM_BOT_TOKEN,'sendMessage',{chat_id:route.chat_id,...(route.thread_id?{message_thread_id:route.thread_id}:{}),...(source?{reply_parameters:{message_id:source.message_id}}:{}),text:chunk.text})).message_id;
   this.ctx.storage.sql.exec("UPDATE inbox_chunks SET state='sent',telegram_id=? WHERE update_id=? AND ordinal=?",messageId,job.update_id,chunk.ordinal);
  }
  if(phase==='sending')this.ctx.storage.sql.exec("UPDATE inbox_jobs SET phase='done',text='' WHERE update_id=? AND phase='sending'",job.update_id);
 }
}
