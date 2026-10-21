import { TelegramError } from '@hasbai/messaging';

/** Known message IDs make edits replayable, including an acknowledged but lost edit. */
export async function telegramEdit(token:string,chatId:number,messageId:number,text:string){
 let response:Response;
 try{response=await fetch(`https://api.telegram.org/bot${token}/editMessageText`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({chat_id:chatId,message_id:messageId,text}),signal:AbortSignal.timeout(15000)});}catch{throw new TelegramError('retry',2);}
 let data:{ok:boolean;description?:string;parameters?:{retry_after?:number}};
 try{data=await response.json();}catch{throw new TelegramError('retry',2);}
 if(response.ok&&data.ok||response.status===400&&data.description?.includes('message is not modified'))return;
 if(response.status===429)throw new TelegramError('retry',Math.min(3600,Math.max(1,data.parameters?.retry_after??30)));
 throw new TelegramError(response.status>=500?'retry':'rejected',2);
}
