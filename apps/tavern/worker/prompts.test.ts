import {expect,it,vi} from 'vitest';
import {DEFAULT_PROMPTS,PROMPT_KEY} from '../shared/prompts';
import { BODY_BOUNDARY, DIRECTOR_BOUNDARY, SUMMARY_BOUNDARY } from '../shared/instructions';
import {readPrompts,savePrompts} from './prompts';

function namespace(raw:string|null=null){return {PROMPTS:{get:vi.fn(async()=>raw),put:vi.fn(async(_key:string,value:string)=>{raw=value;})}} as unknown as Pick<Env,'PROMPTS'>;}
it('uses defaults only for a missing key without writing on reads',async()=>{
 const env=namespace();expect(await readPrompts(env)).toEqual({revision:'defaults-v3',texts:DEFAULT_PROMPTS});expect(env.PROMPTS.put).not.toHaveBeenCalled();
});
it('saves all text with a new revision and returns the written snapshot',async()=>{
 const env=namespace(),texts={...DEFAULT_PROMPTS,tools:'新工具指导'};const saved=await savePrompts(env,texts);
 expect(saved.texts).toEqual(texts);expect(saved.revision).not.toBe('defaults-v3');expect(env.PROMPTS.put).toHaveBeenCalledWith(PROMPT_KEY,JSON.stringify(saved));expect(await readPrompts(env)).toEqual(saved);
});
it('does not disguise storage failures or corrupt data as defaults',async()=>{
 const env=namespace();vi.mocked(env.PROMPTS.get).mockRejectedValue(Error('KV unavailable'));await expect(readPrompts(env)).rejects.toThrow('KV unavailable');
 for(const raw of ['{broken','{}',JSON.stringify({revision:'r',texts:{tools:'partial'}})])await expect(readPrompts(namespace(raw))).rejects.toMatchObject({status:503});
 vi.mocked(env.PROMPTS.put).mockRejectedValue(Error('put failed'));await expect(savePrompts(env,DEFAULT_PROMPTS)).rejects.toThrow('put failed');
});
it('rejects missing, extra and empty prompt fields without imposing a text cutoff',async()=>{
 const env=namespace();for(const texts of [{...DEFAULT_PROMPTS,tools:''},{...DEFAULT_PROMPTS,extra:'x'},{tools:'x'},null])await expect(savePrompts(env,texts)).rejects.toMatchObject({status:400});
 expect(env.PROMPTS.put).not.toHaveBeenCalled();expect((await savePrompts(env,{...DEFAULT_PROMPTS,tools:'长'.repeat(30000)})).texts.tools).toHaveLength(30000);
});

it('upgrades v2 writing and fixed rules into editable fields without writing storage',async()=>{
 const legacy={revision:'custom-v2',texts:{systemTemplate:'原系统模板',agent:'原正文规则',director:'原候选规则',summaryTask:'原压缩任务',character:'原角色创作'}};
 const env=namespace();Object.assign(env.PROMPTS,{get:vi.fn(async(key:string)=>key==='dialogue-v2'?JSON.stringify(legacy):null)});
 const result=await readPrompts(env);
 expect(result.texts).toEqual({...DEFAULT_PROMPTS,systemTemplate:['原系统模板','原正文规则',BODY_BOUNDARY].join('\n\n'),director:['原候选规则',DIRECTOR_BOUNDARY].join('\n\n'),summaryTask:['原压缩任务',SUMMARY_BOUNDARY].join('\n\n'),character:'原角色创作'});
 expect(result.texts).not.toHaveProperty('agent');expect(env.PROMPTS.put).not.toHaveBeenCalled();
 const saved=await savePrompts(env,result.texts);expect(env.PROMPTS.put).toHaveBeenCalledWith(PROMPT_KEY,JSON.stringify(saved));
});
it('prefers v3 and rejects corrupt v3 without silently restoring v2',async()=>{
 const env=namespace(JSON.stringify({revision:'v3',texts:{...DEFAULT_PROMPTS,director:'完全自定义'}}));
 expect((await readPrompts(env)).texts.director).toBe('完全自定义');expect(env.PROMPTS.get).toHaveBeenCalledTimes(1);
 Object.assign(env.PROMPTS,{get:vi.fn(async(key:string)=>key===PROMPT_KEY?'{}':JSON.stringify({revision:'old',texts:DEFAULT_PROMPTS}))});
 await expect(readPrompts(env)).rejects.toMatchObject({status:503});expect(env.PROMPTS.get).not.toHaveBeenCalledWith('dialogue-v2');
});
