import type { Message } from '../shared/types';
import type { PromptMessage } from '../shared/prompt';

export type Goal = {task:string;actor:'character'|'player';status:'active'|'paused'|'completed';progress:string;pauseReason:string|null;completionEvidence:string|null};
export type StoryState = { scene: string | null; facts: Record<string,string>; relationships: Record<string,string>; inventory: Record<string,string>; goals:Record<string,Goal> };
export const emptyState = ():StoryState => ({scene:null,facts:{},relationships:{},inventory:{},goals:{}});
export function normalizeState(state:Omit<StoryState,'goals'> & {goals?:Record<string,Goal>}):StoryState{return {...state,goals:state.goals??{}};}
export { AGENT_RULE, AGENT_TOOLS } from '../shared/instructions';
export function stableJson(value:unknown):string {
 if(Array.isArray(value))return '['+value.map(stableJson).join(',')+']';
 if(value&&typeof value==='object')return '{'+Object.entries(value).sort(([a],[b])=>a.localeCompare(b)).map(([k,v])=>JSON.stringify(k)+':'+stableJson(v)).join(',')+'}';
 return JSON.stringify(value);
}
/** No confirmed facts means no state payload to add to the model context. */
export function stateContext(state:StoryState):string|undefined{const current=normalizeState(state);return current.scene!==null||Object.keys(current.facts).length||Object.keys(current.relationships).length||Object.keys(current.inventory).length||Object.keys(current.goals).length?stableJson(current):undefined;}
export async function contentHash(value:unknown){const bytes=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(stableJson(value)));return [...new Uint8Array(bytes)].map(n=>n.toString(16).padStart(2,'0')).join('');}
export type ModelProjection={key:string;messages:PromptMessage[]};
function object(v:unknown):v is Record<string,unknown>{return !!v&&typeof v==='object'&&!Array.isArray(v);}
export function patchState(state:StoryState,value:unknown):StoryState {
 if(!object(value)||Object.keys(value).some(k=>!['scene','facts','relationships','inventory','goals'].includes(k)))throw Error('状态字段无效');
 const next=structuredClone(normalizeState(state));
 for(const [k,v] of Object.entries(value)){
  if(k==='scene'){if(v!==null&&(typeof v!=='string'||[...v].length>1000))throw Error('scene需为不超过1000字的文本或null');next.scene=v as string|null;continue;}
  if(!object(v)||Object.keys(v).length>64)throw Error('状态项需为字典');
  if(k==='goals'){
   for(const [key,goal] of Object.entries(v)){
    if(!key.trim()||[...key].length>80||['__proto__','constructor','prototype'].includes(key))throw Error('目标名称无效');
    if(goal===null){delete next.goals[key];continue;}
    if(!object(goal)||Object.keys(goal).sort().join(',')!=='actor,completionEvidence,pauseReason,progress,status,task'||!['character','player'].includes(String(goal.actor))||!['active','paused','completed'].includes(String(goal.status)))throw Error('目标字段无效');
    for(const field of ['task','progress','pauseReason','completionEvidence']){const text=goal[field];if(text!==null&&(typeof text!=='string'||[...text].length>1000))throw Error('目标文本无效');}
    if(typeof goal.task!=='string'||!goal.task.trim()||typeof goal.progress!=='string')throw Error('目标文本无效');
    if(goal.status==='paused'?(typeof goal.pauseReason!=='string'||!goal.pauseReason.trim()):goal.pauseReason!==null)throw Error('目标暂停原因无效');
    if(goal.status==='completed'?(typeof goal.completionEvidence!=='string'||!goal.completionEvidence.trim()):goal.completionEvidence!==null)throw Error('目标完成证据无效');
    next.goals[key]=goal as Goal;
   }
   if(Object.keys(next.goals).length>16)throw Error('目标过多');continue;
  }
  const target=next[k as 'facts'|'relationships'|'inventory'];
  for(const [key,text] of Object.entries(v)){
   if(!key.trim()||[...key].length>80||['__proto__','constructor','prototype'].includes(key)||text!==null&&(typeof text!=='string'||[...text].length>1000))throw Error('状态项名称或文本无效');
   if(text===null)delete target[key];else target[key]=text as string;
  }
  if(Object.keys(target).length>64)throw Error('状态项过多');
 }
 if(new TextEncoder().encode(stableJson(next)).length>16384)throw Error('状态内容过长');
 return next;
}
/** Latest successful story versions; failed regenerations remain visible but never replace committed facts. */
export function storyMessages(messages:Message[]):Message[]{const chosen=new Map<number,Message>();for(const m of messages)if(m.status==='completed')chosen.set(m.ordinal,m);return [...chosen.values()].sort((a,b)=>a.ordinal-b.ordinal);}
export type MemoryHit={id:string;text:string;source:{messageId?:string;ordinal?:number;role?:Message['role'];bookId?:string;revision?:string;entryId?:string}};
export type MemoryPage=MemoryHit & {offset:number;total:number;nextOffset:number|null};
export function memoryPage(hit:MemoryHit,text:string,offset:number):MemoryPage{
 const chars=[...text];if(!Number.isSafeInteger(offset)||offset<0||offset>=chars.length)throw Error('原文位置无效');
 const end=Math.min(offset+1200,chars.length);return {...hit,text:chars.slice(offset,end).join(''),offset,total:chars.length,nextOffset:end<chars.length?end:null};
}
const memoryIdentity=(hit:MemoryHit)=>stableJson({id:hit.id,source:hit.source});
// One source can yield different excerpts across queries; only repeated excerpts lack new evidence.
const memoryEvidence=(hit:MemoryHit)=>stableJson({id:hit.id,source:hit.source,text:hit.text});
/** Keep both sources without comparing lexical scores with vector similarity. */
export function mergeMemory(history:MemoryHit[],lore:MemoryHit[]):MemoryHit[]{
 const unique=(hits:MemoryHit[])=>[...new Map(hits.map(hit=>[memoryIdentity(hit),hit])).values()];
 const story=unique(history),books=unique(lore);
 if(!books.length)return story.slice(0,3);
 // History recall is already relevance-filtered and chronological. Keep its latest corrections.
 const chosen=story.slice(-2),seen=new Set(chosen.map(memoryIdentity));
 for(const hit of [...books,...story]){const key=memoryIdentity(hit);if(!seen.has(key)){chosen.push(hit);seen.add(key);}if(chosen.length===3)break;}
 return chosen;
}
export function searchMemory(history:Message[],query:string):MemoryHit[]{
 if(!query.trim()||[...query].length>160)throw Error('query需为1–160字');
 const normalized=query.toLowerCase(),parts=normalized.match(/[a-z0-9]+|[\p{Script=Han}]+/gu)??[];
 const terms=[...new Set(parts.flatMap(p=>{const chars=[...p];return /\p{Script=Han}/u.test(p)&&chars.length>2?[p,...chars.slice(1).map((_,i)=>chars.slice(i,i+2).join(''))]:[p];}))];
 const selected=storyMessages(history);
 const scored=selected.map(m=>{const text=m.content.toLowerCase();const score=terms.reduce((n,t)=>n+(text.includes(t)?t.length:0),0);return {m,score};}).filter(x=>x.score>0).sort((a,b)=>b.score-a.score||b.m.ordinal-a.m.ordinal).slice(0,3).sort((a,b)=>a.m.ordinal-b.m.ordinal);
 return scored.map(({m})=>{
  const lower=m.content.toLowerCase(),chars=[...m.content];
  const matches=terms.map(term=>({at:lower.indexOf(term),length:[...term].length})).filter(match=>match.at>=0).sort((a,b)=>b.length-a.length||a.at-b.at);
  // Lowercase can expand characters (e.g. İ); map its UTF-16 offset back to original code points.
  let offset=0,index=0;while(index<chars.length&&offset+chars[index].toLowerCase().length<=matches[0].at){offset+=chars[index].toLowerCase().length;index++;}
  const start=Math.max(0,index-100);
  return {id:m.id,text:chars.slice(start,start+600).join(''),source:{messageId:m.id,ordinal:m.ordinal,role:m.role}};
 });
}
export type ToolCall={id:string;type:'function';function:{name:string;arguments:string}};
export class ToolCallStream {
 private calls=new Map<number,ToolCall>();
 push(value:unknown){
  if(value===undefined||value===null)return;if(!Array.isArray(value)||value.length>8)throw Error('工具协议无效');
  for(const d of value){if(!object(d)||!Number.isSafeInteger(d.index)||Number(d.index)<0||Number(d.index)>7)throw Error('工具索引无效');
   const i=Number(d.index),call=this.calls.get(i)??{id:'',type:'function' as const,function:{name:'',arguments:''}};
   if(d.id!==undefined&&d.id!==null){if(typeof d.id!=='string'||d.id.length>200)throw Error('工具ID无效');call.id=d.id;}
   if(d.type!==undefined&&d.type!==null&&d.type!=='function')throw Error('工具类型无效');
   if(d.function!==undefined&&d.function!==null){if(!object(d.function))throw Error('工具内容无效');for(const key of ['name','arguments'] as const){const text=d.function[key];if(text!==undefined&&text!==null){if(typeof text!=='string')throw Error('工具字段无效');call.function[key]+=text;}}}
   if(call.function.arguments.length>16384||call.function.name.length>80)throw Error('工具参数过长');this.calls.set(i,call);
  }
 }
 finish(){const calls=[...this.calls.values()];if(calls.some(c=>!c.id||!c.function.name)||new Set(calls.map(c=>c.id)).size!==calls.length)throw Error('工具调用不完整');return calls;}
 get size(){return this.calls.size;}
}
export type ToolStep={call:ToolCall;result:string};
export class AgentTurn {
 state:StoryState;steps:ToolStep[]=[];private seen=new Set<string>();private evidence=new Set<string>();private emptySearch=false;
 private recalled=new Map<string,MemoryHit>();private offsets=new Map<string,Set<number>>();private output='';private actors:Map<string,Goal['actor']>;
 constructor(readonly before:StoryState,readonly history:Message[],readonly currentInput?:Message,readonly readBook?:(hit:MemoryHit,offset:number)=>MemoryPage){this.state=structuredClone(normalizeState(before));this.actors=new Map(Object.entries(this.state.goals).map(([id,g])=>[id,g.actor]));}
 observeOutput(text:string){this.output=text;}
 private page(args:Record<string,unknown>):MemoryPage{
  if(Object.keys(args).some(k=>!['id','offset'].includes(k))||typeof args.id!=='string'||!this.recalled.has(args.id))throw Error('原文来源无效');
  const offset=args.offset??0;if(typeof offset!=='number'||!Number.isSafeInteger(offset)||!this.offsets.get(args.id)?.has(offset))throw Error('原文位置无效');
  const hit=this.recalled.get(args.id)!;
  if(hit.source.messageId){const source=storyMessages(this.history).find(m=>m.id===hit.source.messageId);if(!source)throw Error('原文来源已失效');return memoryPage(hit,source.content,offset);}
  if(!this.readBook)throw Error('原文来源已失效');return this.readBook(hit,offset);
 }
 private statePatch(state:StoryState,patch:unknown,actors=this.actors):StoryState{
  const next=patchState(state,patch);
  for(const [id,goal] of Object.entries(next.goals)){
   if(actors.has(id)&&actors.get(id)!==goal.actor)throw Error('目标执行主体不能改变');actors.set(id,goal.actor);
   if(goal.status!=='completed'||stableJson(goal)===stableJson(state.goals[id]??null))continue;
   const sources=[...storyMessages(this.history),...(this.currentInput?[this.currentInput]:[])];
   const quoted=goal.completionEvidence!;
   const sentences=(text:string)=>(text.match(/[^。！？!?\n“”"「」『』]+[。！？!?]?/gu)??[]).map(s=>s.trim()).filter(Boolean);
   if(!sources.some(m=>(goal.actor==='character'||m.role==='user')&&sentences(m.content).includes(quoted))&&!(goal.actor==='character'&&sentences(this.output).includes(quoted)))throw Error('目标完成证据需引用完整原句');
  }
  return next;
 }
 /** Check the entire batch without consuming calls or touching external retrieval. */
 validate(calls:ToolCall[]):void{
  const seen=new Set(this.seen),actors=new Map(this.actors);let state=this.state;
  for(const call of calls){
   const args=JSON.parse(call.function.arguments);if(!object(args))throw Error('工具参数无效');
   const key=call.function.name+':'+stableJson(args);if(seen.has(key))throw Error('工具调用没有进展');seen.add(key);
   if(call.function.name==='search_memory'){if(Object.keys(args).length!==1||typeof args.query!=='string')throw Error('记忆检索参数无效');searchMemory([],args.query);}
   else if(call.function.name==='read_memory'){this.page(args);}
   else if(call.function.name==='update_state'){if(Object.keys(args).length!==1||!('patch'in args))throw Error('状态更新参数无效');state=this.statePatch(state,args.patch,actors);}
   else throw Error('工具不存在');
  }
 }
 execute(calls:ToolCall[],lore:Map<string,MemoryHit[]>=new Map()):PromptMessage[]{
  this.validate(calls);
  const results:PromptMessage[]=[];let progress=false;
  for(const call of calls){
   const args=JSON.parse(call.function.arguments);if(!object(args))throw Error('工具参数无效');
   const key=call.function.name+':'+stableJson(args);if(this.seen.has(key))throw Error('工具调用没有进展');this.seen.add(key);
   let value:unknown;
   if(call.function.name==='search_memory'){if(Object.keys(args).length!==1||typeof args.query!=='string')throw Error('记忆检索参数无效');const recalled=lore.get(args.query)??[],history=[...new Map([...recalled.filter(h=>h.source.messageId),...searchMemory(this.history,args.query)].map(h=>[memoryIdentity(h),h])).values()].sort((a,b)=>(a.source.ordinal??0)-(b.source.ordinal??0)).slice(-3),hits=mergeMemory(history,recalled.filter(h=>!h.source.messageId));value=hits;const added=hits.filter(hit=>!this.evidence.has(memoryEvidence(hit)));for(const hit of hits){this.evidence.add(memoryEvidence(hit));this.recalled.set(hit.id,hit);if(!this.offsets.has(hit.id))this.offsets.set(hit.id,new Set([0]));}progress ||= added.length>0||!this.emptySearch&&!hits.length;this.emptySearch ||= !hits.length;}
   else if(call.function.name==='read_memory'){const page=this.page(args);value=page;if(page.nextOffset!==null)this.offsets.get(page.id)!.add(page.nextOffset);progress=true;}
   else if(call.function.name==='update_state'){if(Object.keys(args).length!==1||!('patch'in args))throw Error('状态更新参数无效');const next=this.statePatch(this.state,args.patch);progress ||= stableJson(next)!==stableJson(this.state);this.state=next;value={ok:true};}
   else throw Error('工具不存在');
   const result=stableJson(value);this.steps.push({call,result});results.push({role:'tool',tool_call_id:call.id,content:result});
  }
  if(!progress)throw Error('工具调用没有进展');return results;
 }
}
