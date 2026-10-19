import { telegramApi, telegramCommand, telegramText, type TelegramMessage } from '@hasbai/messaging';
import { directCommand } from '../shared/commands';
import type { AgentActivity } from '../shared/types';
import { HttpError } from './http';

const commands=[
 {command:'help',description:'查看命令和绑定说明',usage:''},
 {command:'start',description:'连接酒馆私聊',usage:'<绑定码>'},
 {command:'bind',description:'连接当前群或话题',usage:'<绑定码>'},
 {command:'id',description:'查看对话、话题和个人 ID',usage:''},
 {command:'status',description:'查看当前会话状态和上下文',usage:''},
 {command:'compress',description:'压缩当前会话上下文',usage:''},
 {command:'ooc',description:'向酒馆发送非角色指令',usage:'<指令，可换行接对白>'}
];
export const TELEGRAM_COMMANDS=commands.map(({command,description})=>({command,description}));
export function telegramHelp(username:string,group=false){
 return ['酒馆 Telegram 命令',...commands.map(c=>`/${c.command}${group?'@'+username:''}${c.usage?' '+c.usage:''} — ${c.description}`),'在酒馆设置中生成绑定码，或输入 /id 显示的对话 ID 绑定。','先连接个人私聊，再绑定群；群和话题各自使用独立会话。','群内 /status、/compress、/ooc 仅绑定账号可用。'].join('\n');
}
export function telegramControl(m:TelegramMessage,username:string){
 const command=telegramCommand(m,username);if(!command)return;
 const direct=directCommand('/'+command.name);
 if(direct&&!command.argument)return {kind:direct,content:'/'+direct};
 if(command.name==='ooc'&&command.argument)return {kind:'ooc' as const,content:telegramText({...m,text:''})+'\n/ooc '+command.argument};
}
export function commandReceipt(activity:AgentActivity){
 if(activity.status!=='completed')return `${activity.kind==='compression'?'上下文压缩':'状态查询'}未完成，请在酒馆查看执行记录。`;
 const result=activity.result as {state?:unknown;context?:{estimatedTokens:number;contextTokens:number|null};before?:{estimatedTokens:number};after?:{estimatedTokens:number}};
 if(activity.kind==='compression')return `上下文已压缩。${result.before&&result.after?'\n估算用量：'+result.before.estimatedTokens+' → '+result.after.estimatedTokens+' tokens':''}`;
 return ['当前会话状态',JSON.stringify(result.state??{},null,2),...(result.context?['上下文估算：'+result.context.estimatedTokens+' / '+(result.context.contextTokens??'未知')+' tokens']:[])].join('\n');
}
export async function syncTelegramCommands(env:Env){
 const routes=await env.DB.prepare('SELECT DISTINCT chat_id FROM channel_routes WHERE active=1').all<{chat_id:number}>();
 const scopes:Record<string,unknown>[]=[{type:'default'},{type:'all_private_chats'},{type:'all_group_chats'},...routes.results.map(r=>({type:'chat',chat_id:r.chat_id}))];
 for(const scope of scopes){
  await telegramApi(env.TELEGRAM_BOT_TOKEN,'setMyCommands',{commands:TELEGRAM_COMMANDS,scope,language_code:''});
  const actual=await telegramApi<typeof TELEGRAM_COMMANDS>(env.TELEGRAM_BOT_TOKEN,'getMyCommands',{scope,language_code:''});
  if(actual.length!==TELEGRAM_COMMANDS.length||actual.some((c,i)=>c.command!==TELEGRAM_COMMANDS[i].command||c.description!==TELEGRAM_COMMANDS[i].description))throw new HttpError(502,'Telegram 命令菜单核验失败');
 }
 return {commands:TELEGRAM_COMMANDS,verifiedScopes:scopes.length};
}
