import { secretMatches, telegramUpdate, telegramCommand, telegramApi, telegramThread } from '@hasbai/messaging';
import { bindChannel, inboxStub, type ChannelRoute } from './channels';
import { boundedBody, HttpError, json } from './http';

export async function telegramWebhook(request:Request,env:Env){
 if(!env.TELEGRAM_WEBHOOK_SECRET||!env.TELEGRAM_BOT_TOKEN)return json({message:'Telegram 尚未配置'},503);
 if(!await secretMatches(request.headers.get('x-telegram-bot-api-secret-token')??'',env.TELEGRAM_WEBHOOK_SECRET))return json({message:'无效签名'},403);
 let raw:unknown;try{raw=JSON.parse(new TextDecoder().decode(await boundedBody(request,65536)));}catch(error){if(error instanceof HttpError)throw error;return json({ok:true});}
 const update=telegramUpdate(raw);if(!update)return json({ok:true});
 const m=update.message,command=telegramCommand(m,env.TELEGRAM_BOT_USERNAME);
 if(command&&(command.name==='start'||command.name==='bind')&&command.argument){
  let notice='';
  try{await bindChannel(env,m,command.argument,command.name==='start'?'private':'group');notice='已连接酒馆。接下来的对话使用独立的 Tavern 会话。';}catch(error){if(error instanceof HttpError)notice=error.message;else throw error;}
  // Binding confirmations contain no private dialogue and are safe to repeat.
  try{await telegramApi(env.TELEGRAM_BOT_TOKEN,'sendMessage',{chat_id:m.chat.id,...(m.message_thread_id?{message_thread_id:m.message_thread_id}:{}),text:notice});}catch{console.error(JSON.stringify({event:'telegram_binding_notice_failed'}));}
  return json({ok:true});
 }
 // Legacy Saki commands and commands addressed to other bots never become model input.
 if(m.text.trim().startsWith('/'))return json({ok:true});
 const route=await env.DB.prepare('SELECT * FROM channel_routes WHERE thread_key=? AND active=1').bind(telegramThread(m)).first<ChannelRoute>();
 if(!route)return json({ok:true});
 await inboxStub(env,route.thread_key).receive(route.id,update);
 return json({ok:true});
}
