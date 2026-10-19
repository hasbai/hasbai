import { beforeEach, afterEach, expect, it, vi } from 'vitest';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync, readdirSync } from 'node:fs';
import { addressed, splitTelegram, telegramApi, telegramUpdate, TelegramError, type TelegramUpdate } from '@hasbai/messaging';
import { bindChannel, channelApi, channelCode, type ChannelRoute } from './channels';
import { INBOX_SCHEMA, MessageInbox } from './message-inbox';
import { telegramWebhook } from './telegram-webhook';
import { DEFAULT_SETTINGS } from '../shared/types';
vi.mock('cloudflare:workers',()=>({DurableObject:class {constructor(public ctx:DurableObjectState,public env:Env){}}}));

let db:DatabaseSync,env:Env,databases:Map<string,DatabaseSync>,inboxes:Map<string,MessageInbox>,modelCalls:ReturnType<typeof vi.fn<(name:string,request:Request)=>Promise<Response>>>,fetcher:ReturnType<typeof vi.fn<()=>Promise<Response>>>,busy:boolean,accepted:boolean;
const user={sub:'auth0|owner',username:'月石',email:'owner',admin:false};
const other={sub:'auth0|other',username:'其他',email:'other',admin:true};
const views=new Map<string,{session:{generationId:string|null};messages:Record<string,unknown>[]} >();
function statement(sql:string,values:unknown[]=[]):D1PreparedStatement{return {bind:(...v:unknown[])=>statement(sql,v),first:async()=>db.prepare(sql).get(...values as never[])??null,all:async()=>({results:db.prepare(sql).all(...values as never[])}),run:async()=>({meta:{changes:Number(db.prepare(sql).run(...values as never[]).changes)}})} as D1PreparedStatement;}
function inbox(key:string,fresh=false){
 if(!fresh&&inboxes.has(key))return inboxes.get(key)!;
 let local=databases.get(key);if(!local){local=new DatabaseSync(':memory:');databases.set(key,local);}const storageDb=local;
 const storage={sql:{exec:(sql:string,...v:unknown[])=>{if(sql===INBOX_SCHEMA){storageDb.exec(sql);return {toArray:()=>[]};}const rows=storageDb.prepare(sql).all(...v as never[]);return {toArray:()=>rows};}},transactionSync:<T>(f:()=>T)=>{storageDb.exec('BEGIN');try{const result=f();storageDb.exec('COMMIT');return result;}catch(e){storageDb.exec('ROLLBACK');throw e;}},setAlarm:vi.fn(async()=>{})};
 storageDb.exec('CREATE TABLE IF NOT EXISTS test_meta(key TEXT PRIMARY KEY,value TEXT)');
 Object.assign(storage,{get:async(key:string)=>{const row=storageDb.prepare('SELECT value FROM test_meta WHERE key=?').get(key);return row?JSON.parse(String(row.value)):undefined;},put:async(key:string,value:unknown)=>{storageDb.prepare('INSERT OR REPLACE INTO test_meta VALUES(?,?)').run(key,JSON.stringify(value));}});
 const object=new MessageInbox({storage} as unknown as DurableObjectState,env);inboxes.set(key,object);return object;
}
const update=(id=1,chat=12,thread?:number):TelegramUpdate=>({update_id:id,message:{message_id:id,chat:{id:chat,type:chat>0?'private':'supergroup'},from:{id:12,first_name:'用户',username:'member'},text:chat>0?'你好':'@saki_main_bot 你好',...(thread?{message_thread_id:thread}:{})}});
async function code(kind:'private'|'group'='private',who=user){return channelCode(env,who,{kind,characterId:'card'});}
async function bind(kind:'private'|'group'='private',chat=12,thread?:number){const c=await code(kind);return bindChannel(env,update(1,chat,thread).message,c.code,kind);}
function route(id:string){return db.prepare('SELECT * FROM channel_routes WHERE id=?').get(id) as ChannelRoute;}
async function api(path:string,method='GET',who=user,data:Record<string,unknown>={}){return channelApi(new Request('https://test'+path,{method}),env,who,path,async()=>data);}
beforeEach(()=>{
 db=new DatabaseSync(':memory:');for(const n of readdirSync(new URL('../migrations',import.meta.url)).filter(n=>n.endsWith('.sql')).sort())db.exec(readFileSync(new URL('../migrations/'+n,import.meta.url),'utf8'));
 db.prepare('INSERT INTO characters(id,owner,name,description,creator,tags_json,card_json,format,source,source_url,source_id,original_key,original_filename,content_hash,created_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)').run('card',user.sub,'角色','','','[]','{"name":"角色"}','V1','','','','original','card.json','hash',1);
 db.prepare('INSERT INTO settings VALUES(?,?)').run(user.sub,JSON.stringify({...DEFAULT_SETTINGS,persona:'私人身份',systemPrompt:'私人提示'}));
 db.prepare('INSERT INTO characters SELECT ?,?,name,description,creator,tags_json,card_json,format,source,source_url,source_id,original_key,original_filename,avatar_key,avatar_type,content_hash,created_at FROM characters WHERE id=?').run('other-card',other.sub,'card');
 databases=new Map();inboxes=new Map();views.clear();busy=false;accepted=true;
 modelCalls=vi.fn(async(name:string,request:Request)=>{
  const data=await request.json() as {requestId:string;content:string};
  if(busy)return new Response('{}',{status:409});
  if(accepted){const prior=views.get(name);if(!prior?.messages.some(m=>m.requestId===data.requestId))views.set(name,{session:{generationId:null},messages:[...(prior?.messages??[]),{id:data.requestId,role:'assistant',content:'你好。',status:'completed',finishReason:'stop',requestId:data.requestId}]});}
  return new Response('data: {}\n\n',{headers:{'Content-Type':'text/event-stream'}});
 });
 env=Object.assign({} as Env,{TELEGRAM_BOT_TOKEN:'test-token',TELEGRAM_WEBHOOK_SECRET:'test-secret',TELEGRAM_BOT_USERNAME:'saki_main_bot',PROMPTS:{get:async()=>null},DB:{prepare:statement,batch:async(stmts:D1PreparedStatement[])=>{db.exec('BEGIN');try{const result=[];for(const s of stmts)result.push(await s.run());db.exec('COMMIT');return result;}catch(e){db.exec('ROLLBACK');throw e;}}},MESSAGE_INBOX:{getByName:(key:string)=>inbox(key)},SESSIONS:{getByName:(key:string)=>({fetch:(req:Request)=>modelCalls(key,req),invoke:async(_owner:string,_id:string,method:string)=>JSON.stringify({ok:true,value:method==='read'?views.get(key)??{session:{generationId:null},messages:[]}:{ok:true}})})}});
 fetcher=vi.fn(async()=>Response.json({ok:true,result:{message_id:42,status:'administrator'}}));vi.stubGlobal('fetch',fetcher);
});
afterEach(()=>{db.close();for(const local of databases.values())local.close();vi.unstubAllGlobals();vi.clearAllMocks();});
it('isolates browser private settings and atomically consumes one-time expiring codes',async()=>{
 const c=await code();await bindChannel(env,update().message,c.code,'private');
 await expect(bindChannel(env,update().message,c.code,'private')).rejects.toThrow('无效或已过期');
 const row=db.prepare('SELECT * FROM sessions').get()!;expect(String(row.settings_json)).not.toContain('私人');expect(row.owner).toBe(user.sub);
 const expired=await code();db.prepare('UPDATE channel_codes SET expires_at=0').run();await expect(bindChannel(env,update(2,13).message,expired.code,'private')).rejects.toThrow('已过期');
});
it('requires an owner-linked Telegram account and group administrator before group/topic binding',async()=>{
 const c=await code('group');await expect(bindChannel(env,update(2,-1).message,c.code,'group')).rejects.toThrow('先在私聊');
 await bind();fetcher.mockResolvedValueOnce(Response.json({ok:true,result:{status:'member'}}));await expect(bindChannel(env,update(2,-1).message,c.code,'group')).rejects.toThrow('群管理员');
 const group=await bindChannel(env,update(2,-1,10).message,c.code,'group');const topic=await bind('group',-1,11);expect(group.sessionId).not.toBe(topic.sessionId);expect(db.prepare('SELECT count(*) AS n FROM sessions').get()?.n).toBe(3);
});
it('scopes cards, routes, status, revocation and resolution to authenticated owner',async()=>{
 await expect(channelCode(env,other,{kind:'private',characterId:'card'})).rejects.toThrow('角色不存在');
 const b=await bind();expect((await(await api('/api/messaging/telegram','GET',other))!.json() as {routes:unknown[]}).routes).toEqual([]);
 for(const [path,method] of [[`/${b.id}`,'DELETE'],[`/${b.id}/status`,'GET'],[`/${b.id}/resolve`,'POST']])await expect(api('/api/messaging/telegram'+path,method,other,{action:'skip'})).rejects.toThrow('绑定不存在');
});
it('cannot take over an already linked Telegram account with another owner code',async()=>{
 await bind();const c=await channelCode(env,other,{kind:'private',characterId:'other-card'});
 await expect(bindChannel(env,update().message,c.code,'private')).rejects.toThrow('已有绑定');
});
it('preserves old mention/reply/private triggers and well-formed Unicode chunks',()=>{
 const m=update(1,-1).message;expect(addressed(m,'saki_main_bot')).toBe(true);m.text='@saki_main_bot_other';expect(addressed(m,'saki_main_bot')).toBe(false);
 m.reply_to_message={from:{id:1,is_bot:true,username:'saki_main_bot'}};expect(addressed(m,'saki_main_bot')).toBe(true);m.reply_to_message.from!.username='another';expect(addressed(m,'saki_main_bot')).toBe(false);
 const original='字'.repeat(3999)+'😀'.repeat(4000);const parts=splitTelegram(original);expect(parts.join('')).toBe(original);expect(parts.every(s=>s.length<=4000&&!/^[\uDC00-\uDFFF]|[\uD800-\uDBFF]$/.test(s))).toBe(true);
 expect(telegramUpdate({update_id:1,message:{...m,from:{id:0}}})).toBeUndefined();
});
it('persists before acknowledgement, deduplicates updates and resumes fixed request IDs after object restart',async()=>{
 const b=await bind(),object=inbox(b.key);await Promise.all([object.receive(b.id,update()),object.receive(b.id,update())]);
 expect(databases.get(b.key)!.prepare('SELECT count(*) AS n FROM inbox_jobs').get()?.n).toBe(1);
 const persisted=databases.get(b.key)!.prepare('SELECT request_id FROM inbox_jobs').get()!.request_id;
 await inbox(b.key,true).alarm();expect(modelCalls).toHaveBeenCalledTimes(1);expect(fetcher).toHaveBeenCalledTimes(1);
 expect(persisted).toMatch(/^[a-f0-9-]{36}$/);
 await inbox(b.key,true).receive(b.id,update());await inbox(b.key).alarm();expect(modelCalls).toHaveBeenCalledTimes(1);
});
it('stores background group messages without generating until addressed and preserves speaker IDs',async()=>{
 await bind();const b=await bind('group',-1),u=update(2,-1);u.message.text='普通群聊';await inbox(b.key).receive(b.id,u);await inbox(b.key).alarm();expect(modelCalls).not.toHaveBeenCalled();
 await inbox(b.key).receive(b.id,update(3,-1));await inbox(b.key).alarm();const local=databases.get(b.key)!;expect(local.prepare('SELECT phase FROM inbox_jobs').get()?.phase).toBe('done');
 expect(local.prepare('SELECT count(*) AS n FROM inbox_background').get()?.n).toBe(0);
});
it('retries a busy Tavern session using the same UUID and processes queued inputs in order',async()=>{
 const b=await bind(),object=inbox(b.key);await object.receive(b.id,update());await object.receive(b.id,update(2));busy=true;await object.alarm();
 const local=databases.get(b.key)!,id=local.prepare('SELECT request_id FROM inbox_jobs WHERE update_id=1').get()?.request_id;
 expect(local.prepare('SELECT phase FROM inbox_jobs WHERE update_id=1').get()?.phase).toBe('queued');busy=false;await object.alarm();await object.alarm();expect(modelCalls).toHaveBeenCalledTimes(3);expect(local.prepare('SELECT request_id FROM inbox_jobs WHERE update_id=1').get()?.request_id).toBe(id);
});
it('waits for durable successful Tavern terminal state and never delivers partial/error text',async()=>{
 const b=await bind(),object=inbox(b.key);accepted=false;await object.receive(b.id,update());const job=databases.get(b.key)!.prepare('SELECT * FROM inbox_jobs').get()!;
 const key=JSON.stringify([user.sub,b.sessionId]);views.set(key,{session:{generationId:'running'},messages:[{requestId:job.request_id,role:'assistant',status:'pending',content:'半稿'}]});await object.alarm();expect(fetcher).not.toHaveBeenCalled();
 views.set(key,{session:{generationId:null},messages:[{requestId:job.request_id,role:'assistant',status:'aborted',finishReason:'interrupted',content:'半稿'}]});await inbox(b.key,true).alarm();expect(fetcher).not.toHaveBeenCalled();expect((await object.status(b.id)).jobs[0].phase).toBe('attention');await expect(object.resolve(b.id,'retry')).rejects.toThrow('未完成');expect((await object.status(b.id)).jobs[0].phase).toBe('attention');
});
it('stops on uncertain delivery, survives restart and explicitly retries only unsent chunks',async()=>{
 const b=await bind(),object=inbox(b.key);await object.receive(b.id,update());fetcher.mockRejectedValueOnce(new Error('URL with secret must never escape'));
 await object.alarm();expect((await object.status(b.id)).jobs[0].error).toContain('结果不明');await inbox(b.key,true).alarm();expect(fetcher).toHaveBeenCalledTimes(1);
 await inbox(b.key).resolve(b.id,'retry');await inbox(b.key).alarm();expect(fetcher).toHaveBeenCalledTimes(2);expect(modelCalls).toHaveBeenCalledTimes(1);expect((await inbox(b.key).status(b.id)).jobs).toEqual([]);
});
it('marks crashed in-flight sends uncertain instead of automatically duplicating them',async()=>{
 const b=await bind(),object=inbox(b.key);await object.receive(b.id,update());const local=databases.get(b.key)!;local.prepare("UPDATE inbox_jobs SET phase='sending'").run();local.prepare("INSERT INTO inbox_chunks(update_id,ordinal,text,state) VALUES(1,0,'已发但未保存','sending')").run();
 await inbox(b.key,true).alarm();expect(fetcher).not.toHaveBeenCalled();expect((await object.status(b.id)).jobs[0].phase).toBe('attention');
});
it('honors Telegram 429 retry_after without regenerating or losing prior delivery receipts',async()=>{
 const b=await bind(),object=inbox(b.key);await object.receive(b.id,update());fetcher.mockResolvedValueOnce(Response.json({ok:false,parameters:{retry_after:3}},{status:429}));await object.alarm();expect((await object.status(b.id)).jobs[0].phase).toBe('sending');await object.receive(b.id,update(2));await inbox(b.key,true).alarm();expect(fetcher).toHaveBeenCalledTimes(1);databases.get(b.key)!.prepare("DELETE FROM test_meta WHERE key='notBefore'").run();await inbox(b.key).alarm();expect(modelCalls).toHaveBeenCalledTimes(1);expect((await object.status(b.id)).jobs[0].update_id).toBe(2);
});
it('revokes queued work and cannot send to a removed binding',async()=>{
 const b=await bind();await inbox(b.key).receive(b.id,update());await api('/api/messaging/telegram/'+b.id,'DELETE');await inbox(b.key,true).alarm();expect(modelCalls).not.toHaveBeenCalled();expect(fetcher).not.toHaveBeenCalled();expect(db.prepare('SELECT count(*) AS n FROM channel_routes').get()?.n).toBe(0);
});
it('unbinds a deleted Tavern session with pending work and permits a fresh binding',async()=>{
 const b=await bind();await inbox(b.key).receive(b.id,update());databases.get(b.key)!.prepare("UPDATE inbox_jobs SET phase='generating'").run();
 Object.assign(env.SESSIONS,{getByName:()=>({invoke:async()=>JSON.stringify({ok:false,status:404,message:'会话不存在'})})});
 await api('/api/messaging/telegram/'+b.id,'DELETE');expect(db.prepare('SELECT count(*) AS n FROM channel_routes').get()?.n).toBe(0);
 const fresh=await bind();expect(fresh.sessionId).not.toBe(b.sessionId);
});
it('rejects bad webhook secrets, malformed oversized input and ignores commands for other bots',async()=>{
 const req=(data:unknown,secret='test-secret')=>new Request('https://test/api/messaging/telegram/webhook',{method:'POST',headers:{'x-telegram-bot-api-secret-token':secret},body:JSON.stringify(data)});
 expect((await telegramWebhook(req(update(),'bad'),env)).status).toBe(403);expect((await telegramWebhook(req({}),env)).status).toBe(200);
 const b=await bind(),u=update();u.message.text='/search@other hello';await telegramWebhook(req(u),env);await inbox(b.key).alarm();expect(modelCalls).not.toHaveBeenCalled();
 await expect(telegramWebhook(req('x'.repeat(70000)),env)).rejects.toThrow('大小超限');
});
it('redacts transport failures and records negative API responses as failed sends',async()=>{
 fetcher.mockRejectedValueOnce(new Error('test-token'));await expect(telegramApi('test-token','sendMessage',{})).rejects.toEqual(new TelegramError('uncertain'));
 fetcher.mockResolvedValueOnce(Response.json({ok:false},{status:403}));await expect(telegramApi('test-token','sendMessage',{})).rejects.toMatchObject({kind:'rejected'});
});
