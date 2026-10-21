import { beforeEach, afterEach, expect, it, vi } from 'vitest';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync, readdirSync } from 'node:fs';
import { addressed, splitTelegram, telegramApi, telegramUpdate, TelegramError, type TelegramUpdate } from '@hasbai/messaging';
import { bindChannel, bindChannelId, channelApi, channelCode, type ChannelRoute } from './channels';
import { INBOX_SCHEMA, MessageInbox } from './message-inbox';
import { telegramWebhook } from './telegram-webhook';
import { DEFAULT_SETTINGS, type AgentActivity } from '../shared/types';
import { TELEGRAM_COMMANDS, telegramHelp } from './telegram-commands';
import { userPrompt } from '../shared/commands';
import { telegramEdit } from './telegram-edit';
vi.mock('cloudflare:workers',()=>({DurableObject:class {constructor(public ctx:DurableObjectState,public env:Env){}}}));

let db:DatabaseSync,env:Env,databases:Map<string,DatabaseSync>,inboxes:Map<string,MessageInbox>,modelCalls:ReturnType<typeof vi.fn<(name:string,request:Request)=>Promise<Response>>>,fetcher:ReturnType<typeof vi.fn<(url:string|URL|Request,options?:RequestInit)=>Promise<Response>>>,busy:boolean,accepted:boolean;
const reactions=vi.fn<(url:string|URL|Request,options?:RequestInit)=>Promise<Response>>();
const user={sub:'auth0|owner',username:'月石',email:'owner',admin:false};
const other={sub:'auth0|other',username:'其他',email:'other',admin:true};
const views=new Map<string,{session:{generationId:string|null};messages:Record<string,unknown>[];activities?:AgentActivity[]} >();
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
 db.prepare('INSERT INTO characters SELECT ?,?,name,description,creator,tags_json,card_json,format,source,source_url,source_id,original_key,original_filename,avatar_key,avatar_type,content_hash,created_at,avatar_image_id,portrait_image_id FROM characters WHERE id=?').run('other-card',other.sub,'card');
 databases=new Map();inboxes=new Map();views.clear();busy=false;accepted=true;
 modelCalls=vi.fn(async(name:string,request:Request)=>{
  const data=await request.json() as {requestId:string;content:string};
  if(busy)return new Response('{}',{status:409});
  if(data.content==='/status'||data.content==='/compress'){
   const prior=views.get(name);views.set(name,{session:{generationId:null},messages:prior?.messages??[],activities:[...(prior?.activities??[]),{id:data.requestId,messageId:null,ordinal:0,kind:data.content==='/status'?'status':'compression',title:'命令',status:'completed',result:data.content==='/status'?{state:{scene:'港城'},context:{estimatedTokens:400,contextTokens:32000}}:{before:{estimatedTokens:400},after:{estimatedTokens:100}},createdAt:1}]});return Response.json({ok:true});
  }
  if(accepted){const prior=views.get(name);if(!prior?.messages.some(m=>m.requestId===data.requestId))views.set(name,{session:{generationId:null},messages:[...(prior?.messages??[]),{id:data.requestId,role:'assistant',content:'你好。',status:'completed',finishReason:'stop',requestId:data.requestId}]});}
  return new Response('data: {}\n\n',{headers:{'Content-Type':'text/event-stream'}});
 });
 env=Object.assign({} as Env,{TELEGRAM_BOT_TOKEN:'test-token',TELEGRAM_WEBHOOK_SECRET:'test-secret',TELEGRAM_BOT_USERNAME:'saki_main_bot',PROMPTS:{get:async()=>null},DB:{prepare:statement,batch:async(stmts:D1PreparedStatement[])=>{db.exec('BEGIN');try{const result=[];for(const s of stmts)result.push(await s.run());db.exec('COMMIT');return result;}catch(e){db.exec('ROLLBACK');throw e;}}},MESSAGE_INBOX:{getByName:(key:string)=>inbox(key)},SESSIONS:{getByName:(key:string)=>({fetch:(req:Request)=>modelCalls(key,req),invoke:async(_owner:string,_id:string,method:string,data:Record<string,unknown>)=>{const view=views.get(key)??{session:{generationId:null},messages:[]};return JSON.stringify({ok:true,value:method==='read'?view:method==='progress'?{message:view.messages.find(m=>m.role==='assistant'&&m.requestId===data.requestId)??null,generating:!!view.session.generationId}:{ok:true}});}})}});
 fetcher=vi.fn(async()=>Response.json({ok:true,result:{message_id:42,status:'administrator'}}));reactions.mockReset().mockResolvedValue(Response.json({ok:true,result:true}));vi.stubGlobal('fetch',(url:string|URL|Request,options?:RequestInit)=>String(url).endsWith('/setMessageReaction')?reactions(url,options):fetcher(url,options));
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
it('generates an explicitly addressed group command and binds through the signed webhook before replying to mentions',async()=>{
 await bind();const c=await code('group');expect(c.command).toBe('/bind@saki_main_bot '+c.code);expect(c.command).toMatch(/^[\x20-\x7e]+$/);
 const post=(u:TelegramUpdate)=>telegramWebhook(new Request('https://test/api/messaging/telegram/webhook',{method:'POST',headers:{'x-telegram-bot-api-secret-token':'test-secret'},body:JSON.stringify(u)}),env);
 const binding=update(20,-1,10);binding.message.text=c.command;expect((await post(binding)).status).toBe(200);
 const group=db.prepare("SELECT * FROM channel_routes WHERE thread_key='[-1,10]'").get() as ChannelRoute;
 expect(group).toMatchObject({owner:user.sub,chat_id:-1,thread_id:10,active:1});expect(db.prepare('SELECT count(*) n FROM channel_codes').get()?.n).toBe(0);
 expect(fetcher).toHaveBeenCalledWith(expect.stringContaining('/sendMessage'),expect.objectContaining({body:expect.stringContaining('已连接酒馆')}));
 fetcher.mockClear();await post(update(21,-1,10));await inbox(group.thread_key).alarm();
 expect(modelCalls).toHaveBeenCalledTimes(1);expect(fetcher).toHaveBeenCalledWith(expect.stringContaining('/sendMessage'),expect.objectContaining({body:expect.stringContaining('你好。')}));
 await post(update(22,-1,11));expect(databases.has('[-1,11]')).toBe(false);
});
it('scopes cards, routes, status, revocation and resolution to authenticated owner',async()=>{
 await expect(channelCode(env,other,{kind:'private',characterId:'card'})).rejects.toThrow('角色不存在');
 const b=await bind();expect((await(await api('/api/messaging/telegram','GET',other))!.json() as {routes:unknown[]}).routes).toEqual([]);
 for(const [path,method] of [[`/${b.id}`,'DELETE'],[`/${b.id}/status`,'GET'],[`/${b.id}/resolve`,'POST']])await expect(api('/api/messaging/telegram'+path,method,other,{action:'skip'})).rejects.toThrow('绑定不存在');
});
function mockChat(type='supergroup',botStatus='member',memberStatus='administrator'){
 fetcher.mockImplementation(async(url,options)=>{const body=JSON.parse(String(options?.body??'{}'));if(String(url).endsWith('/getChat'))return Response.json({ok:true,result:{id:body.chat_id,type,is_forum:type==='supergroup'}});if(String(url).endsWith('/getMe'))return Response.json({ok:true,result:{id:99}});return Response.json({ok:true,result:{status:body.user_id===99?botStatus:memberStatus}});});
}
it('binds only an already owner-linked private Telegram ID and rejects forged IDs',async()=>{
 db.prepare('INSERT INTO telegram_accounts VALUES(?,?,?)').run(12,user.sub,user.username);mockChat('private');
 for(const chatId of [0,'x',1.5,'9007199254740992'])await expect(bindChannelId(env,user,{chatId})).rejects.toThrow('有效');
 await expect(bindChannelId(env,user,{chatId:13})).rejects.toThrow('本人');await expect(bindChannelId(env,other,{chatId:12})).rejects.toThrow('本人');
 await expect(bindChannelId(env,user,{chatId:12,threadId:1})).rejects.toThrow('话题群');
 const b=await bindChannelId(env,user,{chatId:'12',characterId:'card'});expect(route(b.id)).toMatchObject({owner:user.sub,chat_id:12,thread_id:0});
});
it('verifies group membership and linked administrator identity for ID binding without consuming pending codes',async()=>{
 await bind();await code('group');mockChat();const b=await bindChannelId(env,user,{chatId:'-100123',threadId:'10',characterId:'card'});
 expect(route(b.id)).toMatchObject({chat_id:-100123,thread_id:10,owner:user.sub});expect(db.prepare('SELECT count(*) n FROM channel_codes').get()?.n).toBe(1);
 expect(db.prepare('SELECT settings_json FROM sessions WHERE id=?').get(b.sessionId)?.settings_json).not.toContain('私人');
 mockChat('supergroup','left');await expect(bindChannelId(env,user,{chatId:-2})).rejects.toThrow('加入');mockChat('supergroup','member','member');await expect(bindChannelId(env,user,{chatId:-2})).rejects.toThrow('管理员');
 mockChat('channel');await expect(bindChannelId(env,user,{chatId:-2})).rejects.toThrow('仅支持');expect(db.prepare('SELECT count(*) n FROM channel_routes').get()?.n).toBe(2);
});
it('checks another linked account when Telegram explicitly rejects the first, but preserves transient failures',async()=>{
 await bind();db.prepare('INSERT INTO telegram_accounts VALUES(?,?,?)').run(13,user.sub,user.username);mockChat();const normal=fetcher.getMockImplementation()!;
 fetcher.mockImplementation(async(url,options)=>{const body=JSON.parse(String(options?.body??'{}'));if(String(url).endsWith('/getChatMember')&&body.user_id===12)return Response.json({ok:false},{status:400});return normal(url,options);});
 const b=await bindChannelId(env,user,{chatId:-3,characterId:'card'});expect(route(b.id).owner).toBe(user.sub);
 fetcher.mockImplementation(async(url,options)=>{const body=JSON.parse(String(options?.body??'{}'));if(String(url).endsWith('/getChatMember')&&body.user_id===12)throw new TelegramError('uncertain');return normal(url,options);});
 await expect(bindChannelId(env,user,{chatId:-4,characterId:'card'})).rejects.toMatchObject({kind:'uncertain'});
});
it('restricts menu synchronization to administrators and verifies the fixed menu in each scope',async()=>{
 await bind();await expect(api('/api/messaging/telegram/commands','POST')).rejects.toThrow('管理员');expect(fetcher).not.toHaveBeenCalled();
 fetcher.mockImplementation(async url=>Response.json({ok:true,result:String(url).endsWith('/getMyCommands')?TELEGRAM_COMMANDS:true}));
 const r=await api('/api/messaging/telegram/commands','POST',{...user,admin:true});expect(await r!.json()).toMatchObject({commands:TELEGRAM_COMMANDS,verifiedScopes:4});expect(fetcher).toHaveBeenCalledTimes(8);
 for(const c of TELEGRAM_COMMANDS)expect(telegramHelp('saki_main_bot',true)).toContain('/'+c.command+'@saki_main_bot');
});
const webhook=(u:TelegramUpdate)=>telegramWebhook(new Request('https://test/api/messaging/telegram/webhook',{method:'POST',headers:{'x-telegram-bot-api-secret-token':'test-secret'},body:JSON.stringify(u)}),env);
it('provides help, IDs and usage without model input and ignores commands for another bot',async()=>{
 for(const text of ['/help@saki_main_bot','/start','/bind@saki_main_bot','/id@saki_main_bot','/ooc@saki_main_bot']){const u=update(10,-1,10);u.message.text=text;await webhook(u);}
 expect(fetcher).toHaveBeenCalledTimes(5);expect(modelCalls).not.toHaveBeenCalled();
 const texts=fetcher.mock.calls.map(call=>JSON.parse(String(call[1]?.body)).text);expect(texts.join('\n')).toContain('对话 ID：-1');expect(texts.join('\n')).toContain('/compress@saki_main_bot');
 const u=update();u.message.text='/help@other';await webhook(u);expect(fetcher).toHaveBeenCalledTimes(5);
});
it('runs native status/compression commands once through persistent activities and preserves background messages',async()=>{
 await bind();const b=await bind('group',-1),bg=update(30,-1);bg.message.text='群聊背景';await inbox(b.key).receive(b.id,bg);
 for(const [i,name]of ['status','compress'].entries()){const u=update(40+i,-1);u.message.text='/'+name+'@saki_main_bot';await webhook(u);await inbox(b.key,true).alarm();await webhook(u);await inbox(b.key,true).alarm();}
 expect(modelCalls).toHaveBeenCalledTimes(2);expect(databases.get(b.key)!.prepare('SELECT count(*) n FROM inbox_background').get()?.n).toBe(1);
 expect(databases.get(b.key)!.prepare('SELECT phase FROM inbox_jobs ORDER BY update_id').all()).toEqual([{phase:'done'},{phase:'done'}]);
 expect(fetcher.mock.calls.map(c=>JSON.parse(String(c[1]?.body)).text).join('\n')).toContain('上下文已压缩');expect(fetcher.mock.calls.map(c=>JSON.parse(String(c[1]?.body)).text).join('\n')).toContain('港城');
});
it('waits for command activity completion and delivers a terminal failure instead of requeueing forever',async()=>{
 const b=await bind(),u=update();u.message.text='/compress';
 modelCalls.mockImplementationOnce(async(name,request)=>{const d=await request.json() as {requestId:string};views.set(name,{session:{generationId:d.requestId},messages:[],activities:[{id:d.requestId,messageId:null,ordinal:0,kind:'compression',title:'压缩',status:'running',createdAt:1}]});return Response.json({ok:true});});
 await webhook(u);await inbox(b.key).alarm();expect(fetcher).not.toHaveBeenCalled();const view=[...views.values()][0];view.session.generationId=null;view.activities![0].status='error';
 await inbox(b.key,true).alarm();expect(modelCalls).toHaveBeenCalledTimes(1);expect(databases.get(b.key)!.prepare('SELECT phase FROM inbox_jobs').get()?.phase).toBe('done');expect(fetcher.mock.calls.map(c=>JSON.parse(String(c[1]?.body)).text).join()).toContain('未完成');
});
it('keeps OOC on its own instruction line with speaker identity and denies other members control of the session',async()=>{
 await bind();const b=await bind('group',-1),u=update(30,-1);u.message.text='/ooc@saki_main_bot 放慢节奏\n我走到窗边';
 await webhook(u);const content=String(databases.get(b.key)!.prepare('SELECT text FROM inbox_jobs').get()?.text);await inbox(b.key).alarm();expect(content).toContain('@member:');expect(content).not.toContain('"speaker"');expect(userPrompt(content)).toContain('[OOC：');expect(userPrompt(content)).toContain('放慢节奏');expect(userPrompt(content)).toContain('我走到窗边');
 const outsider=update(31,-1);outsider.message.from.id=13;outsider.message.text='/status@saki_main_bot';await webhook(outsider);await inbox(b.key).alarm();expect(modelCalls).toHaveBeenCalledTimes(1);expect(fetcher.mock.calls.map(c=>JSON.parse(String(c[1]?.body)).text).join()).toContain('绑定账号');
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
it('shows pending prose as a preview and replaces it with a failure receipt if generation fails',async()=>{
 const b=await bind(),object=inbox(b.key);accepted=false;await object.receive(b.id,update());const job=databases.get(b.key)!.prepare('SELECT * FROM inbox_jobs').get()!;
 const key=JSON.stringify([user.sub,b.sessionId]);views.set(key,{session:{generationId:'running'},messages:[{requestId:job.request_id,role:'assistant',status:'pending',content:'半稿'}]});await object.alarm();expect(fetcher).toHaveBeenCalledTimes(1);
 views.set(key,{session:{generationId:null},messages:[{requestId:job.request_id,role:'assistant',status:'aborted',finishReason:'interrupted',content:'半稿'}]});await inbox(b.key,true).alarm();expect(fetcher).toHaveBeenCalledTimes(2);expect(JSON.parse(String(fetcher.mock.calls[1][1]?.body)).text).toContain('回复未完成');expect((await object.status(b.id)).jobs[0].phase).toBe('attention');await expect(object.resolve(b.id,'retry')).rejects.toThrow('未完成');expect((await object.status(b.id)).jobs[0].phase).toBe('attention');
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
it('retries a failed revocation stop with the durable UUID after object restart',async()=>{
 const b=await bind();await inbox(b.key).receive(b.id,update());const local=databases.get(b.key)!;local.prepare("UPDATE inbox_jobs SET phase='generating'").run();const id=local.prepare('SELECT request_id FROM inbox_jobs').get()!.request_id;
 const stop=vi.fn<(owner:string,id:string,method:string,data:Record<string,unknown>)=>Promise<string>>().mockRejectedValueOnce(new Error('temporary storage failure')).mockResolvedValue(JSON.stringify({ok:true,value:{ok:true}}));
 Object.assign(env.SESSIONS,{getByName:()=>({invoke:stop})});
 await expect(api('/api/messaging/telegram/'+b.id,'DELETE')).rejects.toThrow('temporary');expect(db.prepare('SELECT active FROM channel_routes').get()?.active).toBe(0);
 inbox(b.key,true);await api('/api/messaging/telegram/'+b.id,'DELETE');expect(stop).toHaveBeenCalledTimes(2);expect(stop.mock.calls.every(call=>call[3].requestId===id)).toBe(true);expect(db.prepare('SELECT count(*) AS n FROM channel_routes').get()?.n).toBe(0);
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

it('reacts after durable ingress and streams a native reply by editing the same message before completion',async()=>{
 const b=await bind(),object=inbox(b.key),u=update(500);u.message.message_id=17;accepted=false;
 reactions.mockImplementation(async(_url,options)=>{expect(databases.get(b.key)!.prepare('SELECT message_id FROM inbox_sources').get()?.message_id).toBe(17);expect(JSON.parse(String(options?.body))).toMatchObject({message_id:17,reaction:[{type:'emoji',emoji:'👀'}]});return Response.json({ok:true,result:true});});
 await object.receive(b.id,u);expect(reactions).toHaveBeenCalledTimes(1);expect(modelCalls).not.toHaveBeenCalled();
 const job=databases.get(b.key)!.prepare('SELECT * FROM inbox_jobs').get()!,key=JSON.stringify([user.sub,b.sessionId]);
 views.set(key,{session:{generationId:'running'},messages:[{role:'assistant',requestId:job.request_id,status:'pending',content:'第一段'}]});await object.alarm();
 expect(JSON.parse(String(fetcher.mock.calls[0][1]?.body))).toMatchObject({text:'第一段',reply_parameters:{message_id:17}});expect((await object.status(b.id)).jobs[0].phase).toBe('generating');
 views.get(key)!.messages[0].content='第一段，第二段';await inbox(b.key,true).alarm();expect(String(fetcher.mock.calls[1][0])).toContain('/editMessageText');expect(JSON.parse(String(fetcher.mock.calls[1][1]?.body))).toMatchObject({message_id:42,text:'第一段，第二段'});
 Object.assign(views.get(key)!.messages[0],{status:'completed',finishReason:'stop',content:'第一段，第二段。'});views.get(key)!.session.generationId=null;await object.alarm();expect((await object.status(b.id)).jobs).toEqual([]);expect(fetcher.mock.calls.filter(c=>String(c[0]).endsWith('/sendMessage'))).toHaveLength(1);
});
it('does not block generation on a rejected reaction and keeps legacy tasks without guessing a reply ID',async()=>{
 const b=await bind();reactions.mockRejectedValueOnce(new Error('reaction unavailable'));await inbox(b.key).receive(b.id,update(600));const local=databases.get(b.key)!;local.prepare('DELETE FROM inbox_sources').run();await inbox(b.key,true).alarm();expect(modelCalls).toHaveBeenCalledTimes(1);expect(JSON.parse(String(fetcher.mock.calls[0][1]?.body))).not.toHaveProperty('reply_parameters');
});
it('replays edits with known IDs after uncertain results and accepts Telegram not-modified acknowledgements',async()=>{
 fetcher.mockResolvedValueOnce(Response.json({ok:false,description:'Bad Request: message is not modified'},{status:400}));await expect(telegramEdit('test-token',12,42,'正文')).resolves.toBeUndefined();
 fetcher.mockRejectedValueOnce(new Error('lost response'));await expect(telegramEdit('test-token',12,42,'正文')).rejects.toMatchObject({kind:'retry'});
 const b=await bind();await inbox(b.key).receive(b.id,update(700));const local=databases.get(b.key)!;local.prepare("UPDATE inbox_jobs SET phase='sending'").run();local.prepare("INSERT INTO inbox_chunks VALUES(700,0,'正文','sending',42)").run();fetcher.mockClear();await inbox(b.key,true).alarm();expect(String(fetcher.mock.calls[0][0])).toContain('/editMessageText');expect((await inbox(b.key).status(b.id)).jobs).toEqual([]);
});

it('never resends an uncertain preview creation after a crash even if the durable draft grew',async()=>{
 const b=await bind(),object=inbox(b.key);accepted=false;await object.receive(b.id,update(800));const local=databases.get(b.key)!,job=local.prepare('SELECT * FROM inbox_jobs').get()!;local.prepare("UPDATE inbox_jobs SET phase='generating'").run();local.prepare("INSERT INTO inbox_chunks VALUES(800,0,'旧草稿','sending',NULL)").run();
 views.set(JSON.stringify([user.sub,b.sessionId]),{session:{generationId:'running'},messages:[{role:'assistant',requestId:job.request_id,status:'pending',content:'旧草稿继续增长'}]});await inbox(b.key,true).alarm();expect(fetcher).not.toHaveBeenCalled();expect((await object.status(b.id)).jobs[0].phase).toBe('attention');
});

it('resumes pending generation after explicit preview retry and delivers its final content',async()=>{
 const b=await bind(),object=inbox(b.key);accepted=false;await object.receive(b.id,update(900));const local=databases.get(b.key)!,job=local.prepare('SELECT * FROM inbox_jobs').get()!,key=JSON.stringify([user.sub,b.sessionId]);
 views.set(key,{session:{generationId:'running'},messages:[{role:'assistant',requestId:job.request_id,status:'pending',content:'第一段'}]});fetcher.mockRejectedValueOnce(new Error('send result lost'));await object.alarm();expect((await object.status(b.id)).jobs[0].phase).toBe('attention');
 await object.resolve(b.id,'retry');views.get(key)!.messages[0].content='第一段还在增长';await object.alarm();expect((await object.status(b.id)).jobs[0].phase).toBe('generating');
 Object.assign(views.get(key)!.messages[0],{status:'completed',finishReason:'stop',content:'第一段还在增长，结束。'});await object.alarm();expect((await object.status(b.id)).jobs).toEqual([]);expect(JSON.parse(String(fetcher.mock.calls.at(-1)![1]?.body)).text).toBe('第一段还在增长，结束。');expect(modelCalls).toHaveBeenCalledTimes(1);
});
it('drops unsent long preview chunks after generation fails and preserves an unknown creation result',async()=>{
 const b=await bind(),object=inbox(b.key);accepted=false;await object.receive(b.id,update(901));const local=databases.get(b.key)!,job=local.prepare('SELECT * FROM inbox_jobs').get()!,key=JSON.stringify([user.sub,b.sessionId]);
 views.set(key,{session:{generationId:'running'},messages:[{role:'assistant',requestId:job.request_id,status:'pending',content:'😀'.repeat(2100)}]});fetcher.mockResolvedValueOnce(Response.json({ok:true,result:{message_id:42}})).mockResolvedValueOnce(Response.json({ok:false,parameters:{retry_after:1}},{status:429}));await object.alarm();expect(local.prepare('SELECT count(*) n FROM inbox_chunks').get()?.n).toBe(2);
 local.prepare("DELETE FROM test_meta WHERE key='notBefore'").run();Object.assign(views.get(key)!.messages[0],{status:'error',finishReason:'upstream'});fetcher.mockClear();await object.alarm();expect(fetcher).toHaveBeenCalledTimes(1);expect(String(fetcher.mock.calls[0][0])).toContain('/editMessageText');expect(local.prepare('SELECT count(*) n FROM inbox_chunks').get()?.n).toBe(1);
 local.prepare("UPDATE inbox_chunks SET telegram_id=NULL,state='sending'").run();local.prepare("UPDATE inbox_jobs SET phase='generating'").run();fetcher.mockClear();await object.alarm();expect(fetcher).not.toHaveBeenCalled();expect((await object.status(b.id)).jobs[0].error).toContain('结果不明');
});
