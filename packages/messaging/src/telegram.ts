/** Transport only: no account, persona, model or memory logic. */
export type TelegramUser = { id:number; is_bot?:boolean; username?:string; first_name?:string; last_name?:string };
export type TelegramMessage = {
 message_id:number; message_thread_id?:number; chat:{id:number;type:'private'|'group'|'supergroup'};
 from:TelegramUser; text:string; reply_to_message?:{from?:TelegramUser;text?:string;caption?:string};
};
export type TelegramUpdate = {update_id:number;message:TelegramMessage};
export function telegramUpdate(raw:unknown):TelegramUpdate|undefined {
 if(!raw||typeof raw!=='object')return;
 const u=raw as TelegramUpdate,m=u.message;
 if(!Number.isSafeInteger(u.update_id)||u.update_id<0||!m||!Number.isSafeInteger(m.message_id)||m.message_id<=0||!m.from||!Number.isSafeInteger(m.from.id)||m.from.id<=0||m.from.is_bot||!m.chat||!Number.isSafeInteger(m.chat.id)||!['private','group','supergroup'].includes(m.chat.type)||typeof m.text!=='string'||!m.text.trim()||m.text.length>16000)return;
 if(m.chat.type==='private'&&m.chat.id!==m.from.id)return;
 if(m.message_thread_id!==undefined&&(!Number.isSafeInteger(m.message_thread_id)||m.message_thread_id<=0))return;
 return u;
}
export const telegramThread=(m:TelegramMessage)=>JSON.stringify([m.chat.id,m.message_thread_id??0]);
export function addressed(m:TelegramMessage,username:string) {
 const name=username.toLowerCase();
 return m.chat.type==='private'||m.reply_to_message?.from?.is_bot===true&&m.reply_to_message.from.username?.toLowerCase()===name||m.text.match(/@[a-zA-Z0-9_]+/g)?.some(s=>s.slice(1).toLowerCase()===name)===true;
}
export function telegramCommand(m:TelegramMessage,username:string) {
 const match=m.text.trim().match(/^\/([a-zA-Z_]+)(?:@([a-zA-Z0-9_]+))?(?:\s+([\s\S]*))?$/);
 if(!match||match[2]&&match[2].toLowerCase()!==username.toLowerCase())return;
 return {name:match[1].toLowerCase(),argument:(match[3]??'').trim()};
}
export function telegramText(m:TelegramMessage) {
 const name=m.from.username?'@'+m.from.username:[m.from.first_name,m.from.last_name].filter(Boolean).join(' ')||String(m.from.id);
 return JSON.stringify({speaker:{id:m.from.id,name},text:m.text,...(m.reply_to_message?{replyTo:{speaker:m.reply_to_message.from?.username??m.reply_to_message.from?.first_name??'',text:(m.reply_to_message.text??m.reply_to_message.caption??'').slice(0,200)}}:{})});
}
export function splitTelegram(text:string,limit=4000):string[] {
 const result:string[]=[];let rest=text;
 while(rest.length>limit){let cut=rest.lastIndexOf('\n',limit);if(cut<limit/2)cut=limit;if(/[\uD800-\uDBFF]/.test(rest[cut-1]))cut--;result.push(rest.slice(0,cut));rest=rest.slice(cut);}
 if(rest)result.push(rest);return result;
}
export class TelegramError extends Error {
 constructor(public kind:'retry'|'rejected'|'uncertain',public retryAfter=30){super('Telegram 请求未完成');}
}
export async function telegramApi<T>(token:string,method:string,body:Record<string,unknown>):Promise<T> {
 let response:Response;
 try{response=await fetch(`https://api.telegram.org/bot${token}/${method}`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body),signal:AbortSignal.timeout(15000)});}catch{throw new TelegramError('uncertain');}
 let data:{ok:boolean;result:T;parameters?:{retry_after?:number}};
 try{data=await response.json();}catch{throw new TelegramError('uncertain');}
 if(response.status===429)throw new TelegramError('retry',Math.min(3600,Math.max(1,data.parameters?.retry_after??30)));
 if(!response.ok||!data.ok)throw new TelegramError(response.status>=500?'uncertain':'rejected');
 return data.result;
}
export async function secretMatches(provided:string,expected:string):Promise<boolean> {
 if(!expected)return false;
 const encoder=new TextEncoder(),key=await crypto.subtle.importKey('raw',encoder.encode(expected),{name:'HMAC',hash:'SHA-256'},false,['sign','verify']);
 const signature=await crypto.subtle.sign('HMAC',key,encoder.encode(expected));
 return crypto.subtle.verify('HMAC',key,signature,encoder.encode(provided));
}
