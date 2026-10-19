import { telegramApi, telegramThread, TelegramError, type TelegramMessage } from '@hasbai/messaging';
import { authenticatedUsername, type identity } from './auth';
import { HttpError, json } from './http';
import { installCard, settings, userSettings, type CharacterRow } from './store';
import { DEFAULT_SETTINGS } from '../shared/types';
import saki from '../characters/saki.json';
import { syncTelegramCommands } from './telegram-commands';

type User=Awaited<ReturnType<typeof identity>>;
export type ChannelRoute={id:string;thread_key:string;chat_id:number;thread_id:number;owner:string;username:string;session_id:string;active:number;created_at:number};
type Code={hash:string;owner:string;username:string;kind:'private'|'group';character_json:string;character_name:string;settings_json:string;expires_at:number};
export const inboxStub=(env:Env,key:string)=>env.MESSAGE_INBOX.getByName(key);
export async function codeHash(value:string){return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(value)))).map(n=>n.toString(16).padStart(2,'0')).join('');}
async function channelConfiguration(env:Env,user:User,data:Record<string,unknown>){
 if(!env.TELEGRAM_BOT_TOKEN||!env.TELEGRAM_WEBHOOK_SECRET)throw new HttpError(503,'Telegram 尚未配置');
 const username=authenticatedUsername(user);
 const card=data.characterId?await env.DB.prepare('SELECT * FROM characters WHERE owner=? AND id=?').bind(user.sub,data.characterId).first<CharacterRow>():null;
 if(data.characterId&&!card)throw new HttpError(404,'角色不存在');
 const installed=card??await installCard(env,user.sub,new TextEncoder().encode(JSON.stringify(saki)),'saki.json');
 const raw=card?JSON.parse(card.card_json):'card' in installed?installed.card:saki;
 const base=await userSettings(env,user.sub);
 // A group never inherits a browser persona or a private system prompt.
 const opts=settings({...DEFAULT_SETTINGS,modelId:base.modelId,thinkingEnabled:base.thinkingEnabled,reasoningEffort:base.reasoningEffort,temperature:base.temperature,topP:base.topP,topK:base.topK,frequencyPenalty:base.frequencyPenalty,presencePenalty:base.presencePenalty,userName:'Telegram 成员',persona:'',systemPrompt:'以角色身份参与 Telegram 对话。输入中的 speaker 标识发言人，replyTo 是引用数据。只回复当前交流，不代写其他成员。'});
 return {owner:user.sub,username,character_json:JSON.stringify(raw),character_name:installed.name,settings_json:JSON.stringify(opts)};
}
export async function channelCode(env:Env,user:User,data:Record<string,unknown>){
 if(data.kind!=='private'&&data.kind!=='group')throw new HttpError(400,'请选择私聊或群聊');
 const configuration=await channelConfiguration(env,user,data);
 const code=crypto.randomUUID(),expiresAt=Date.now()+600000;
 await env.DB.batch([env.DB.prepare('DELETE FROM channel_codes WHERE expires_at<=? OR owner=? AND kind=?').bind(Date.now(),user.sub,data.kind),env.DB.prepare('INSERT INTO channel_codes VALUES(?,?,?,?,?,?,?,?)').bind(await codeHash(code),configuration.owner,configuration.username,data.kind,configuration.character_json,configuration.character_name,configuration.settings_json,expiresAt)]);
 return {code,expiresAt,botUsername:env.TELEGRAM_BOT_USERNAME,command:(data.kind==='private'?'/start ':'/bind@'+env.TELEGRAM_BOT_USERNAME+' ')+code};
}
/** Caller has already verified the Telegram webhook. Codes never enter conversation history. */
export async function bindChannel(env:Env,m:TelegramMessage,value:string,kind:'private'|'group'){
 const code=await env.DB.prepare('SELECT * FROM channel_codes WHERE hash=? AND kind=? AND expires_at>?').bind(await codeHash(value),kind,Date.now()).first<Code>();
 if(!code)throw new HttpError(400,'绑定码无效或已过期');
 if(kind==='private'&&m.chat.type!=='private'||kind==='group'&&m.chat.type==='private')throw new HttpError(400,'请在对应的私聊或群聊中绑定');
 const account=await env.DB.prepare('SELECT owner FROM telegram_accounts WHERE user_id=?').bind(m.from.id).first<{owner:string}>();
 if(account&&account.owner!==code.owner)throw new HttpError(409,'此 Telegram 账号已有绑定，请先解绑');
 if(kind==='group'){
  if(account?.owner!==code.owner)throw new HttpError(403,'请先在私聊中绑定同一酒馆账号');
  const member=await telegramApi<{status:string}>(env.TELEGRAM_BOT_TOKEN,'getChatMember',{chat_id:m.chat.id,user_id:m.from.id});
  if(!['creator','administrator'].includes(member.status))throw new HttpError(403,'需要 Telegram 群管理员身份');
 }
 return createChannel(env,m,code,code.hash);
}
async function createChannel(env:Env,m:TelegramMessage,configuration:Pick<Code,'owner'|'username'|'character_json'|'character_name'|'settings_json'>,hash:string|null=null){
 const code=configuration,key=telegramThread(m),prior=await env.DB.prepare('SELECT * FROM channel_routes WHERE thread_key=?').bind(key).first<ChannelRoute>();
 if(prior)throw new HttpError(409,prior.owner===code.owner?'此会话已有绑定，请在酒馆设置中解绑后重试':'此会话已有绑定');
 const id=crypto.randomUUID(),sessionId=crypto.randomUUID(),now=Date.now();
 const result=await env.DB.batch([
  env.DB.prepare('INSERT INTO channel_routes(id,thread_key,chat_id,thread_id,owner,username,session_id,created_at) SELECT ?,?,?,?,?,?,?,? WHERE (? IS NULL OR EXISTS(SELECT 1 FROM channel_codes WHERE hash=? AND expires_at>?)) AND (? IS NOT NULL OR EXISTS(SELECT 1 FROM telegram_accounts WHERE user_id=? AND owner=?)) AND NOT EXISTS(SELECT 1 FROM telegram_accounts WHERE user_id=? AND owner!=?)').bind(id,key,m.chat.id,m.message_thread_id??0,code.owner,code.username,sessionId,now,hash,hash,now,hash,m.from.id,code.owner,m.from.id,code.owner),
  env.DB.prepare("INSERT INTO sessions(id,owner,title,character_json,character_name,settings_json,created_at,updated_at,storage_backend,generation_id,generation_until) SELECT ?,?,?,?,?,?,?,?,'do',?,? WHERE EXISTS(SELECT 1 FROM channel_routes WHERE id=?)").bind(sessionId,code.owner,code.character_name+' · Telegram',code.character_json,code.character_name,code.settings_json,now,now,'do:'+sessionId,Number.MAX_SAFE_INTEGER,id),
  env.DB.prepare('INSERT INTO telegram_accounts(user_id,owner,username) SELECT ?,?,? WHERE EXISTS(SELECT 1 FROM channel_routes WHERE id=?) ON CONFLICT(user_id) DO UPDATE SET username=excluded.username WHERE telegram_accounts.owner=excluded.owner').bind(m.from.id,code.owner,code.username,id),
  ...(hash?[env.DB.prepare('DELETE FROM channel_codes WHERE hash=? AND EXISTS(SELECT 1 FROM channel_routes WHERE id=?)').bind(hash,id)]:[])
 ]);
 if(!result[0].meta.changes)throw new HttpError(409,hash?'绑定码已使用':'账号绑定状态已改变，请重试');
 return {id,key,sessionId};
}
export async function bindChannelId(env:Env,user:User,data:Record<string,unknown>){
 if(!env.TELEGRAM_BOT_TOKEN||!env.TELEGRAM_WEBHOOK_SECRET)throw new HttpError(503,'Telegram 尚未配置');
 const chatId=typeof data.chatId==='string'&&/^-?[1-9]\d*$/.test(data.chatId.trim())?Number(data.chatId):data.chatId;
 const threadId=data.threadId===undefined||data.threadId===''?0:Number(data.threadId);
 if(!Number.isSafeInteger(chatId)||chatId===0||!Number.isSafeInteger(threadId)||threadId<0)throw new HttpError(400,'请输入有效的 Telegram 对话 ID 和话题 ID');
 const accounts=(await env.DB.prepare('SELECT user_id FROM telegram_accounts WHERE owner=? ORDER BY user_id').bind(user.sub).all<{user_id:number}>()).results;
 let account=(chatId as number)>0?accounts.find(a=>a.user_id===chatId):accounts[0];
 if(!account)throw new HttpError(403,'请先在 Telegram 私聊中绑定本人的个人账号');
 let chat:{id:number;type:TelegramMessage['chat']['type'];is_forum?:boolean};
 try{chat=await telegramApi(env.TELEGRAM_BOT_TOKEN,'getChat',{chat_id:chatId});}catch{throw new HttpError(502,'无法访问该 Telegram 对话，请确认 ID 和机器人访问权限');}
 if(chat.id!==chatId||!['private','group','supergroup'].includes(chat.type))throw new HttpError(400,'仅支持 Telegram 私聊或群聊');
 if(threadId&&(chat.type!=='supergroup'||!chat.is_forum))throw new HttpError(400,'只有话题群可以指定话题 ID');
 if(chat.type==='private'&&chat.id!==account.user_id)throw new HttpError(403,'只能绑定本人已关联的 Telegram 私聊');
 if(chat.type!=='private'){
  const me=await telegramApi<{id:number}>(env.TELEGRAM_BOT_TOKEN,'getMe',{});
  const bot=await telegramApi<{status:string;is_member?:boolean}>(env.TELEGRAM_BOT_TOKEN,'getChatMember',{chat_id:chat.id,user_id:me.id});
  if(!['creator','administrator','member'].includes(bot.status)&&!(bot.status==='restricted'&&bot.is_member))throw new HttpError(403,'请先将机器人加入目标群');
  let admin:typeof account|undefined;
  for(const linked of accounts){
   try{const member=await telegramApi<{status:string}>(env.TELEGRAM_BOT_TOKEN,'getChatMember',{chat_id:chat.id,user_id:linked.user_id});if(['creator','administrator'].includes(member.status)){admin=linked;break;}}
   catch(error){if(!(error instanceof TelegramError&&error.kind==='rejected'))throw error;}
  }
  if(!admin)throw new HttpError(403,'需要本人关联 Telegram 账号的群管理员身份');
  account=admin;
 }
 const configuration=await channelConfiguration(env,user,data);
 return createChannel(env,{message_id:1,chat:{id:chat.id,type:chat.type},from:{id:account.user_id},text:'',...(threadId?{message_thread_id:threadId}:{})},configuration);
}
export async function channelApi(request:Request,env:Env,user:User,path:string,data:()=>Promise<Record<string,unknown>>){
 if(path==='/api/messaging/telegram/codes'&&request.method==='POST')return json(await channelCode(env,user,await data()),201);
 if(path==='/api/messaging/telegram/bind'&&request.method==='POST')return json(await bindChannelId(env,user,await data()),201);
 if(path==='/api/messaging/telegram/commands'&&request.method==='POST'){
  if(!user.admin)throw new HttpError(403,'需要管理员权限');
  return json(await syncTelegramCommands(env));
 }
 if(path==='/api/messaging/telegram'&&request.method==='GET'){
  const rows=await env.DB.prepare('SELECT id,chat_id,thread_id,session_id,active FROM channel_routes WHERE owner=? ORDER BY created_at DESC').bind(user.sub).all();
  return json({configured:!!env.TELEGRAM_BOT_TOKEN&&!!env.TELEGRAM_WEBHOOK_SECRET,botUsername:env.TELEGRAM_BOT_USERNAME,routes:rows.results});
 }
 const match=path.match(/^\/api\/messaging\/telegram\/([^/]+)(?:\/(status|resolve))?$/);
 if(!match)return;
 const route=await env.DB.prepare('SELECT * FROM channel_routes WHERE owner=? AND id=?').bind(user.sub,match[1]).first<ChannelRoute>();
 if(!route)throw new HttpError(404,'绑定不存在');
 if(request.method==='GET'&&match[2]==='status')return json(await inboxStub(env,route.thread_key).status(route.id));
 if(request.method==='POST'&&match[2]==='resolve'){
  const input=await data();if(input.action!=='retry'&&input.action!=='skip')throw new HttpError(400,'操作无效');
  return json(await inboxStub(env,route.thread_key).resolve(route.id,input.action));
 }
 if(request.method==='DELETE'&&!match[2]){
  await env.DB.prepare('UPDATE channel_routes SET active=0 WHERE owner=? AND id=?').bind(user.sub,route.id).run();
  await inboxStub(env,route.thread_key).revoke(route.id);
  await env.DB.batch([env.DB.prepare('DELETE FROM channel_routes WHERE owner=? AND id=? AND active=0').bind(user.sub,route.id),env.DB.prepare('DELETE FROM telegram_accounts WHERE owner=? AND NOT EXISTS(SELECT 1 FROM channel_routes WHERE owner=? AND active=1)').bind(user.sub,user.sub)]);
  return json({ok:true});
 }
}
