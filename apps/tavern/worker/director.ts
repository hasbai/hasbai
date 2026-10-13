import { estimateTokens, type PromptMessage } from '../shared/prompt';
import { stateContext, type StoryState } from './agent';
import { contextLimit } from './context';
import { InferenceMetrics } from './metrics';
import { sseData } from '../shared/sse';

import { DIRECTOR_RULE, STATE_PREFIX } from '../shared/instructions';
export { DIRECTOR_RULE } from '../shared/instructions';
export const DIRECTOR_RESPONSE_FORMAT = {
 type: 'json_schema',
 json_schema: { name: 'director_choices', strict: true, schema: {
  type: 'object', properties: { choices: { type: 'array', minItems: 3, maxItems: 3, items: { type: 'string', minLength: 1, maxLength: 120 } } }, required: ['choices'], additionalProperties: false,
 } },
};
export function directorChoices(text:string):string[] {
 const v:unknown=JSON.parse(text);
 if(!v||typeof v!=='object'||Array.isArray(v)||Object.keys(v).length!==1||!('choices' in v)||!Array.isArray(v.choices)||v.choices.length!==3)throw Error('Director JSON无效');
 const choices=v.choices.map((item:unknown)=>{
  if(typeof item!=='string'||[...item].length>120||!item.trim()||/[\u0000-\u001f\u007f]/u.test(item))throw Error('Director候选无效');return item.trim();
 });
 if(new Set(choices).size!==3)throw Error('Director候选重复');return choices;
}
export class DirectorContextError extends Error { constructor(readonly limit:number){super('Director上下文超限');} }
/** Append the task after the exact body wire prefix; candidate steps remain disposable. */
export class DirectorAgent {
 private messages:PromptMessage[];
 requests=0;rebuilds=0;model='';gatewayLogId:string|null=null;metrics=new InferenceMetrics();
 firstAt:number|null=null;outcome='not-started';
 constructor(prefix:PromptMessage[],output:string,state:StoryState,public contextTokens:number|null,readonly inputRatio=1.2,rule=DIRECTOR_RULE){
  this.messages=[...structuredClone(prefix),{role:'assistant',content:output},directorTask(state,rule)];
 }
 prompt(){
  return {messages:structuredClone(this.messages),estimatedTokens:this.messages.reduce((n,m)=>n+Math.ceil(estimateTokens(m.content+(m.tool_calls?JSON.stringify(m.tool_calls):''))*this.inputRatio)+8,256),includedMessages:this.messages.length-1,condensed:this.rebuilds>0};
 }
 private async compact(rebuild:((limit:number)=>Promise<PromptMessage[]>)|undefined){
  if(!rebuild||this.contextTokens===null)return false;
  const before=this.prompt().estimatedTokens;
  this.messages=structuredClone(await rebuild(this.contextTokens));this.rebuilds++;
  return this.prompt().estimatedTokens<before;
 }
 async run(infer:(messages:PromptMessage[])=>Promise<Response>,signal:AbortSignal,owns:()=>Promise<void>,rebuild?:((limit:number)=>Promise<PromptMessage[]>)):Promise<string[]>{
  this.outcome='generating';
  try{for(;;){
   while(this.contextTokens!==null&&this.prompt().estimatedTokens>this.contextTokens){if(!await this.compact(rebuild))throw Error('Director核心上下文过长');}
   await owns();this.requests++;this.metrics=new InferenceMetrics();
   let response:Response;
   try{response=await infer(this.prompt().messages);}catch(error){if(error instanceof DirectorContextError){this.contextTokens=error.limit;if(!await this.compact(rebuild))throw error;continue;}throw error;}
   this.gatewayLogId=response.headers.get('cf-aig-log-id');
   if(!response.ok||!response.body||!response.headers.get('Content-Type')?.includes('text/event-stream')){await response.body?.cancel();throw Error('Director非流式响应');}
   let text='',reason:string|undefined,limit:number|undefined;
   for await(const raw of sseData(response.body,signal)){
    if(raw==='[DONE]')break;const event=JSON.parse(raw);this.metrics.observe(event);if(typeof event.model==='string')this.model=event.model;
    if(event.error){limit=contextLimit(event);if(limit)break;throw Error('Director上游错误');}
    const choice=event.choices?.[0];
    if(choice?.delta?.tool_calls?.length||choice?.delta?.refusal)throw Error('Director响应无效');
    if(choice?.finish_reason){if(reason&&reason!==choice.finish_reason)throw Error('Director终态冲突');reason=choice.finish_reason;}
    if(typeof choice?.delta?.content==='string'){text+=choice.delta.content;if(choice.delta.content.trim())this.firstAt??=Date.now();}
    // Three 120-character strings fit comfortably; malformed streams are never unbounded.
    if(new TextEncoder().encode(text).length>8192)throw Error('Director输出过长');
   }
   await owns();
   if(limit){this.contextTokens=limit;if(!await this.compact(rebuild))throw Error('Director上下文未缩短');continue;}
   if(reason!=='stop'){this.outcome='incomplete';return [];}
   const choices=directorChoices(text);this.outcome='completed';return choices;
  }}catch(error){this.outcome=signal.aborted?'cancelled':'error';if(signal.aborted)throw error;return [];}
 }
}

// llama.cpp's Qwen template accepts system messages only at the beginning.
// Keep the body prefix intact and append this disposable task as a user turn.
export function directorTask(state:StoryState,rule=DIRECTOR_RULE):PromptMessage{return {role:'user',content:rule+(stateContext(state)?'\n'+STATE_PREFIX+stateContext(state):'')};}
