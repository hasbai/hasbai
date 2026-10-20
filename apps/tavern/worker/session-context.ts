import { parseBook } from '../shared/cards';
import type { ContextUsage } from '../shared/types';
import { ConversationContext } from './context';
import { stateContext, storyMessages } from './agent';
import { ownedBooks, settings } from './store';
import { readPrompts } from './prompts';
import { capabilities } from './models';
import type { SessionStore } from './session-store';
export function contextUsage(context:ConversationContext):ContextUsage {
 const prompt=context.prompt();return {estimatedTokens:prompt.estimatedTokens,contextTokens:context.contextTokens,inputRatio:context.options.inputRatio,summaryTokens:prompt.budget.summaryTokens,coveredMessages:context.summary?.covered.length??0,includedMessages:prompt.budget.includedMessages};
}
export async function telegramSession(env:Env,owner:string,id:string){return !!await env.DB.prepare('SELECT id FROM channel_routes WHERE owner=? AND session_id=? LIMIT 1').bind(owner,id).first();}
export async function sessionContext(env:Env,ctx:Pick<ExecutionContext,'waitUntil'>,owner:string,store:SessionStore,infer:ConstructorParameters<typeof ConversationContext>[6],observe?:ConstructorParameters<typeof ConversationContext>[7]) {
 const row=store.get(),history=storyMessages(store.messages()),state=store.state(history);
 const [books,prompts,capability,telegram]=await Promise.all([ownedBooks(env,owner,JSON.parse(row.book_ids_json)),readPrompts(env),capabilities(env,ctx),telegramSession(env,owner,row.id)]);
 const context=new ConversationContext(history,JSON.parse(row.character_json),books.filter(b=>b.enabled).map(b=>parseBook(JSON.parse(b.book_json),b.name)),settings(JSON.parse(row.settings_json)),capability.contextTokens,{protocol:prompts.texts.tools,summaryTask:prompts.texts.summaryTask,inputRatio:capability.inputRatio,state:stateContext(state),telegram},infer,observe);
 await context.restore(row.summary_json);return context;
}
