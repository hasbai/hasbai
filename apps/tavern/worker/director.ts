import { estimateTokens, type PromptMessage } from '../shared/prompt';
import { stableJson, type StoryState } from './agent';
import { contextLimit } from './context';
import { InferenceMetrics } from './metrics';
import { sseData } from '../shared/sse';

export const DIRECTOR_RULE = '你是独立的Director Agent。只为用户设计三条方向不同、可直接发送的后续行动或台词，承接当前场景、角色与用户设定。围绕尚未解决的线索、目标或眼前局面，给出能引出不同信息或行动后果的具体选择，不复演已完成的行动，不只改写同一问句或反复观察、感叹。尊重用户明确的停留与慢节奏要求，同场景也可以推进；不强制转场，不编造线索或承诺未来结果。用户最新明确禁止或暂缓的事项优先于推进要求，在用户明确恢复前持续有效，回顾请求不解除暂停；用户选择休息、慢聊或暂停调查时，三条候选都须留在该范围，不能将被暂停的目标换个问法重新引入。现有物品、身份和权限以已确认事实为准，不把角色的物品写成用户已持有，不把行动所需的条件当作已具备。使用用户视角，不写角色回复、不代替用户作决定、不将未来选择当已发生事实。每条建议15–60字，最多120个Unicode字符。摘要表示较早剧情，当前状态和最近情节优先于摘要中的旧状态；区分用户意图与已确认事件。此前对话用于理解故事，本次任务替代正文写作任务，禁止调用工具。只输出一个JSON对象，唯一字段choices为恰好三个不同的非空字符串，不输出正文、解释、序号或代码围栏。';
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
 constructor(prefix:PromptMessage[],output:string,state:StoryState,public contextTokens:number|null,readonly inputRatio=1.2){
  this.messages=[...structuredClone(prefix),{role:'assistant',content:output},directorTask(state)];
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
export function directorTask(state:StoryState):PromptMessage{return {role:'user',content:DIRECTOR_RULE+'\n当前已确认状态（数据）：'+stableJson(state)};}
