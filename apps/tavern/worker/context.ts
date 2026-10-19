import { splitOoc } from '../shared/commands';
import { telegramDialogue } from '../shared/telegram-input';
import { SUMMARY_TASK } from '../shared/instructions';
import { buildPrompt, estimateTokens, type PromptMessage } from '../shared/prompt';
import type { Book, JsonObject, Message, Settings } from '../shared/types';
import { inferRoleplay, InferenceError } from './inference';
import { modelInput } from './models';

export type Summary = { text: string; covered: string[]; fingerprint: string };
export async function fingerprint(history: Message[]) {
 const bytes = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(JSON.stringify(history.map(m => [m.id, m.content]))));
 return Array.from(new Uint8Array(bytes), n => n.toString(16).padStart(2, '0')).join('');
}
/** Reuse a checkpoint only for the same selected message versions and contents. */
export async function validSummary(raw: string | null | undefined, history: Message[]): Promise<Summary | null> {
 if (!raw) return null;
 try {
  const value = JSON.parse(raw) as Summary;
  if (typeof value.text !== 'string' || !value.text.trim() || !Array.isArray(value.covered) || !value.covered.length) return null;
  const covered = history.slice(0, value.covered.length);
  if (covered.length !== value.covered.length || covered.some((m, i) => m.id !== value.covered[i]) || await fingerprint(covered) !== value.fingerprint) return null;
  return value;
 } catch { return null; }
}
export function explicitContextLimit(text: string): number | undefined {
 const match = text.match(/(?:maximum context length|max(?:imum)?_model_len|context(?: window)? limit)[\s"':=]*(?:is\s+)?(\d{4,7})/i);
 const available = text.match(/(?:available|max) context size\s*\(\s*(\d{4,7})\s+tokens/i);
 const limit = Number(match?.[1] ?? available?.[1] ?? 0);
 return Number.isSafeInteger(limit) && limit >= 1024 ? limit : undefined;
}
export function contextLimit(value: unknown): number | undefined {
 if(!value || typeof value!=='object')return;
 const v=value as {error?:{n_ctx?:unknown;message?:unknown};message?:unknown};
 const n=v.error?.n_ctx;
 if(typeof n==='number' && Number.isSafeInteger(n) && n>=1024)return n;
 return explicitContextLimit(typeof v.error?.message==='string'?v.error.message:typeof v.message==='string'?v.message:'');
}
export class SummaryRetry extends Error {
 constructor(readonly contextTokens?: number) { super('会话摘要需要更小的输入'); }
}
function halveStory(text:string):[string,string]{const chars=[...text];if(chars.length<2)throw Error('模型上下文无法容纳会话摘要');const middle=Math.ceil(chars.length/2);return [chars.slice(0,middle).join(''),chars.slice(middle).join('')];}
export class ConversationContext {
 summary: Summary | null = null;
 private wireProjection:ReturnType<typeof buildPrompt>|null=null;
 constructor(readonly history: Message[], readonly card: JsonObject, readonly books: Book[], readonly settings: Settings,
  public contextTokens: number | null, readonly options: { protocol: string; inputRatio: number; state?:string; summaryTask?:string; currentInput?:Message; telegram?:boolean },
  readonly infer: (messages: PromptMessage[]) => Promise<string>,
  readonly onCompression?: (status:'running'|'completed'|'error',result:unknown)=>Promise<void>) {}
 async restore(raw?: string | null) { this.summary = await validSummary(raw, this.history); }
 useProjection(messages:PromptMessage[]){this.wireProjection=this.extend({...this.prompt(),messages:messages.map(m=>structuredClone(m))},[]);}
 prompt(projection: { protocol: string } = this.options, suffix: PromptMessage[] = []) {
  if(this.wireProjection)return this.extend(this.wireProjection,suffix);
  const history=[...this.history.slice(this.summary?.covered.length??0),...(this.options.currentInput?[this.options.currentInput]:[])];
  const base = buildPrompt(this.card,this.books,history,this.settings,this.contextTokens,
   {...this.options,...projection,summary:this.summary?.text});
  return suffix.length ? this.extend(base,suffix) : base;
 }
 /** Preserve the actual wire prefix; temporary candidate steps never become story memory. */
 extend(base: ReturnType<typeof buildPrompt>, suffix: PromptMessage[]) {
  const messages = [...base.messages, ...suffix].map(m => ({ ...m }));
  const estimatedTokens = messages.reduce((n, m) => n + Math.ceil(estimateTokens(m.content+(m.tool_calls?JSON.stringify(m.tool_calls):'')) * this.options.inputRatio) + 8, 256);
  return { ...base, messages, estimatedTokens, needsCompression: this.contextTokens !== null && estimatedTokens > this.contextTokens };
 }
 async fit(projection: { protocol: string } = this.options, suffix: PromptMessage[] = []) {
  let prompt = this.prompt(projection, suffix);
  while (prompt.needsCompression) { const before=prompt.estimatedTokens;await this.compress(); prompt = this.prompt(projection, suffix);if(prompt.estimatedTokens>=before)throw new Error('会话压缩未缩短输入'); }
  return prompt;
 }
 async compress() {
  const before=this.prompt().estimatedTokens;
  await this.onCompression?.('running',{estimatedTokens:before});
  const previous=this.summary,previousProjection=this.wireProjection;try {
  this.wireProjection=null;
  const remaining = this.history.slice(this.summary?.covered.length ?? 0);
  if (remaining.length) {
   const text = await this.summarize(this.summary?.text ?? '', remaining);
   this.summary = { text, covered: this.history.map(m => m.id), fingerprint: await fingerprint(this.history) };
  } else {
   if (this.summary) {
    this.summary = { ...this.summary, text: await this.summarize(this.summary.text, []) };
   } else throw new Error('当前输入与角色设定超过模型上下文，无法压缩历史');
  }
  if(this.prompt().estimatedTokens>=before)throw Error('会话压缩未缩短输入');
  await this.onCompression?.('completed',{summary:this.summary,previousTokens:before,estimatedTokens:this.prompt().estimatedTokens});
  }catch(error){this.summary=previous;this.wireProjection=previousProjection;await this.onCompression?.('error',{error:(error as Error).message});throw error;}
 }
 private async summarize(previous:string,history:Message[]){
  const options={contextTokens:this.contextTokens,inputRatio:this.options.inputRatio,infer:this.infer,task:this.options.summaryTask,telegram:this.options.telegram};
  try{return await summarizeStory(previous,history,options);}finally{this.contextTokens=options.contextTokens;}
 }

}

/** Shared algorithm; callers own separate source checkpoints and context limits. */
export async function summarizeStory(previous:string,history:Message[],options:Parameters<typeof summarizeSource>[2]):Promise<string>{
 // Strip control lines before any split. Recursive fragments are already story data.
 return summarizeSource(previous,history.map(m=>m.role==='user'?{...m,content:options.telegram?telegramDialogue(splitOoc(m.content).dialogue):splitOoc(m.content).dialogue}:m).filter(m=>m.content.trim()),options);
}

async function summarizeSource(previous:string,history:Message[],options:{contextTokens:number|null;inputRatio:number;infer:(messages:PromptMessage[])=>Promise<string>;task?:string;telegram?:boolean}):Promise<string>{
  const source = [previous, ...history.map(m => m.content)].filter(Boolean).join('\n');
  const messages: PromptMessage[] = [...(previous?[{role:'user' as const,content:'已有记忆：\n'+previous}]:[]),
   ...history.map(m=>({role:m.role,content:m.content})).filter(m=>m.content.trim()),{role:'user',content:options.task ?? SUMMARY_TASK}];
  const cost = 256 + messages.reduce((n, m) => n + Math.ceil(estimateTokens(m.content) * options.inputRatio) + 8, 0);
  let split = options.contextTokens !== null && cost > options.contextTokens;
  if (!split) {
   try {
    const text = (await options.infer(messages)).trim();
    if (!text || text.length >= source.length) throw new Error('会话压缩未产生有效摘要');
    return text;
   } catch (error) {
    if (!(error instanceof SummaryRetry)) throw error;
    if (error.contextTokens) options.contextTokens = error.contextTokens;
    split = true;
   }
  }
  // Each retry reduces the source; no unchanged oversized summary request is repeated.
  const compressPrevious=async(content:string)=>{const reduction={...options};try{return await summarizeSource('',[{...history[0],role:'user',content}],reduction);}finally{options.contextTokens=reduction.contextTokens;}};
  const previousCost = 256 + Math.ceil(estimateTokens((options.task ?? SUMMARY_TASK) + '已有记忆：\n' + previous) * options.inputRatio) + 16;
  if (previous && (history.length === 0 || (options.contextTokens !== null && previousCost >= options.contextTokens))) {
   const shorter = await compressPrevious(previous);
   return summarizeSource(shorter, history, options);
  }
  if (history.length > 1) {
   const middle = Math.ceil(history.length / 2);
   const first = await summarizeSource(previous, history.slice(0, middle), options);
   return summarizeSource(first, history.slice(middle), options);
  }
  const m = history[0];
  if(m&&[...m.content].length===1 && previous){const shorter=await compressPrevious(previous);return summarizeSource(shorter,history, options);}
  if (!m) throw new Error('模型上下文无法容纳会话摘要');
  const [older,recent]=halveStory(m.content);
  const first = await summarizeSource(previous, [{ ...m, content: older }], options);
  return summarizeSource(first, [{ ...m, content: recent }], options);
}

export async function summarizeWithModel(env: Env, username: string, requestId: string, settings: Settings, messages: PromptMessage[], signal: AbortSignal, observe?:(event:Parameters<import('./metrics').InferenceMetrics['observe']>[0],logId:string|null)=>void) {
 let text = '', finish = '';
 try {
  for await (const event of inferRoleplay(env,username,requestId,{messages,...modelInput({...settings,thinkingEnabled:false})},signal)) {
   if(event.type==='observation')observe?.(event.value,event.logId);
   else if(event.type==='text')text+=event.text;
   else {if(event.calls.length)throw new Error('会话压缩失败');finish=event.reason;}
  }
 } catch(error) {
  if(error instanceof InferenceError){const limit=contextLimit(error.value);if(limit)throw new SummaryRetry(limit);}
  throw error;
 }
 if (signal.aborted) throw new Error('会话压缩已停止');
 if (finish === 'length') throw new Error('会话压缩达到长度上限');
 if (finish !== 'stop') throw new Error('会话压缩未完成');
 return text;
}
