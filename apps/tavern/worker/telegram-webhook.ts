import { secretMatches, telegramUpdate, telegramCommand, telegramApi, telegramThread } from '@hasbai/messaging';
import { bindChannel, inboxStub, type ChannelRoute } from './channels';
import { boundedBody, HttpError, json } from './http';
import { telegramControl, telegramHelp } from './telegram-commands';

async function notice(env:Env,m:NonNullable<ReturnType<typeof telegramUpdate>>['message'],text:string){
 try{await telegramApi(env.TELEGRAM_BOT_TOKEN,'sendMessage',{chat_id:m.chat.id,...(m.message_thread_id?{message_thread_id:m.message_thread_id}:{}),text});}catch{console.error(JSON.stringify({event:'telegram_notice_failed'}));}
}

export async function telegramWebhook(request:Request,env:Env){
 if(!env.TELEGRAM_WEBHOOK_SECRET||!env.TELEGRAM_BOT_TOKEN)return json({message:'Telegram 尚未配置'},503);
 if(!await secretMatches(request.headers.get('x-telegram-bot-api-secret-token')??'',env.TELEGRAM_WEBHOOK_SECRET))return json({message:'无效签名'},403);
 let raw:unknown;try{raw=JSON.parse(new TextDecoder().decode(await boundedBody(request,65536)));}catch(error){if(error instanceof HttpError)throw error;return json({ok:true});}
 const update=telegramUpdate(raw);if(!update)return json({ok:true});
 const m=update.message,command=telegramCommand(m,env.TELEGRAM_BOT_USERNAME);
 if(command&&(command.name==='start'||command.name==='bind')&&command.argument){
  let text='';
  try{await bindChannel(env,m,command.argument,command.name==='start'?'private':'group');text='已连接酒馆。接下来的对话使用独立的 Tavern 会话。';}catch(error){if(error instanceof HttpError)text=error.message;else throw error;}
  // Binding confirmations contain no private dialogue and are safe to repeat.
  await notice(env,m,text);
  return json({ok:true});
 }
 if(command&&['help','start','bind'].includes(command.name)){await notice(env,m,telegramHelp(env.TELEGRAM_BOT_USERNAME,m.chat.type!=='private'));return json({ok:true});}
 if(command?.name==='id'){await notice(env,m,`对话 ID：${m.chat.id}\n话题 ID：${m.message_thread_id??0}\n个人 ID：${m.from.id}`);return json({ok:true});}
 const control=telegramControl(m,env.TELEGRAM_BOT_USERNAME);
 if(m.text.trim().startsWith('/')&&!control){
  if(command)await notice(env,m,telegramHelp(env.TELEGRAM_BOT_USERNAME,m.chat.type!=='private'));
  return json({ok:true});
 }
 const route=await env.DB.prepare('SELECT * FROM channel_routes WHERE thread_key=? AND active=1').bind(telegramThread(m)).first<ChannelRoute>();
 if(!route){if(control)await notice(env,m,'当前对话尚未绑定，请发送 /help 查看连接方式。');return json({ok:true});}
 if(control&&!await env.DB.prepare('SELECT user_id FROM telegram_accounts WHERE user_id=? AND owner=?').bind(m.from.id,route.owner).first()){
  await notice(env,m,'仅此会话的绑定账号可以执行酒馆命令。');return json({ok:true});
 }
 await inboxStub(env,route.thread_key).receive(route.id,update);
 return json({ok:true});
}
