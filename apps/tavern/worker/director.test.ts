import { it, expect, vi } from 'vitest';
import { DirectorAgent, directorChoices, DirectorContextError, DIRECTOR_RESPONSE_FORMAT, DIRECTOR_RULE, directorTask } from './director';
import { emptyState } from './agent';
import type {PromptMessage} from '../shared/prompt';
const prefix:PromptMessage[]=[{role:'system',content:'角色设定与剧情摘要'},{role:'user',content:'我的输入'}];
const agent=()=>new DirectorAgent(prefix,'最新正文',emptyState(),null);
const reply=async function*(chunks:string[],reason='stop',extra:Record<string,unknown>={}):AsyncGenerator<import('./inference').InferenceEvent>{
 if(extra.tool_calls||extra.refusal)throw Error('无效响应');
 for(const text of chunks)yield {type:'text',text};
 yield {type:'finish',reason,calls:[]};
};
it('preserves wire messages and tool transcript, then appends a Qwen-compatible Director task',()=>{
 const state=emptyState();state.scene='北港';const source:PromptMessage[]=[...structuredClone(prefix),{role:'assistant',content:'工具前正文',tool_calls:[{id:'state',type:'function',function:{name:'update_state',arguments:'{}'}}]},{role:'tool',tool_call_id:'state',content:'已更新'}];
 const before=structuredClone(source),director=new DirectorAgent(source,'当前正文',state,null);source[0].content='后来修改';state.scene='未来';
 const messages=director.prompt().messages;expect(messages.slice(0,before.length)).toEqual(before);expect(messages.at(-2)).toEqual({role:'assistant',content:'当前正文'});expect(messages.at(-1)?.role).toBe('user');expect(messages.filter(m=>m.role==='system')).toEqual([before[0]]);expect(messages.at(-1)?.content).toContain(DIRECTOR_RULE);expect(messages.at(-1)?.content).toContain('北港');
 messages[0].content='外部修改';expect(director.prompt().messages[0].content).toBe(before[0].content);
});
it('keeps complete long story when capacity is unknown without a synopsis request',()=>{
 const director=new DirectorAgent([{role:'system',content:'设定'},{role:'user',content:'😀'.repeat(7000)+'结尾'}],'最新正文',emptyState(),null);expect(director.prompt().messages[1].content).toBe('😀'.repeat(7000)+'结尾');expect(director.prompt().condensed).toBe(false);
});
it.each(['{"choices":["一","二"]}','{"choices":["一","二","三","四"]}','{"choices":["一"," 一 ","三"]}','{"choices":["","二","三"]}','{"choices":[1,"二","三"]}','{"choices":["一","二","三"],"extra":true}','```json\n{"choices":["一","二","三"]}\n```','一\n二\n三',JSON.stringify({choices:['😀'.repeat(121),'二','三']}),JSON.stringify({choices:['一\n段','二','三']})])('rejects invalid structured response: %s',text=>expect(()=>directorChoices(text)).toThrow());
it('accepts exactly three distinct bounded Unicode strings and trims whitespace',()=>{
 expect(directorChoices(JSON.stringify({choices:[' 一 ','😀'.repeat(120),'三']}))).toEqual(['一','😀'.repeat(120),'三']);expect(DIRECTOR_RESPONSE_FORMAT.json_schema.schema.properties.choices).toMatchObject({minItems:3,maxItems:3});
});
it('parses arbitrarily split JSON only after reliable stop',async()=>{
 const director=agent(),text=JSON.stringify({choices:['去港口。','坐下喝茶。','问问来路。']});expect(await director.run(async()=>reply([...text]),new AbortController().signal,async()=>{})).toEqual(['去港口。','坐下喝茶。','问问来路。']);expect(director.outcome).toBe('completed');
});
it.each(['length','tool_calls','content_filter',''])('discards all choices on %s',async reason=>{
 const infer=vi.fn(async()=>reply([JSON.stringify({choices:['一','二','三']})],reason));expect(await agent().run(infer,new AbortController().signal,async()=>{})).toEqual([]);expect(infer).toHaveBeenCalledTimes(1);
});
it('rebuilds only after explicit capacity feedback and requires smaller input',async()=>{
 const director=new DirectorAgent([{role:'system',content:'设定'},{role:'user',content:'过去的重要情节'.repeat(1000)}],'当前正文',emptyState(),null);let calls=0;
 const infer=vi.fn(async()=>{if(++calls===1)throw new DirectorContextError(4096);return reply(['{"choices":["一","二","三"]}']);}),rebuild=vi.fn(async()=>[{role:'system' as const,content:'设定'},{role:'user' as const,content:'旧事摘要'},directorTask(emptyState())]);
 expect(await director.run(infer,new AbortController().signal,async()=>{},rebuild)).toHaveLength(3);expect(rebuild).toHaveBeenCalledOnce();expect(director.rebuilds).toBe(1);expect(prefix[0].content).toBe('角色设定与剧情摘要');
});
it('does not silently truncate a core context when it cannot fit',async()=>{
 const director=new DirectorAgent([{role:'system',content:'设定'.repeat(3000)}],'情节',emptyState(),1024),infer=vi.fn();expect(await director.run(infer,new AbortController().signal,async()=>{})).toEqual([]);expect(infer).not.toHaveBeenCalled();expect(director.prompt().messages[0].content).toHaveLength(6000);
});
it('does not execute or accept tool calls or refusal alongside valid JSON',async()=>{
 for(const extra of [{tool_calls:[{index:0}]},{refusal:'refused'}])expect(await agent().run(async()=>reply(['{"choices":["一","二","三"]}'],'stop',extra),new AbortController().signal,async()=>{})).toEqual([]);
});
it('does not repeatedly retry compression that makes no progress',async()=>{
 const director=new DirectorAgent(prefix,'正文',emptyState(),1),rebuild=vi.fn(async()=>director.prompt().messages),infer=vi.fn();expect(await director.run(infer,new AbortController().signal,async()=>{},rebuild)).toEqual([]);expect(rebuild).toHaveBeenCalledOnce();expect(infer).not.toHaveBeenCalled();
});
