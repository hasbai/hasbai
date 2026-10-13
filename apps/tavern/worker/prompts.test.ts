import {expect,it,vi} from 'vitest';
import {DEFAULT_PROMPTS,PROMPT_KEY} from '../shared/prompts';
import {readPrompts,savePrompts} from './prompts';

function namespace(raw:string|null=null){return {PROMPTS:{get:vi.fn(async()=>raw),put:vi.fn(async(_key:string,value:string)=>{raw=value;})}} as unknown as Pick<Env,'PROMPTS'>;}
it('uses defaults only for a missing key without writing on reads',async()=>{
 const env=namespace();expect(await readPrompts(env)).toEqual({revision:'defaults-v2',texts:DEFAULT_PROMPTS});expect(env.PROMPTS.put).not.toHaveBeenCalled();
});
it('saves all text with a new revision and returns the written snapshot',async()=>{
 const env=namespace(),texts={...DEFAULT_PROMPTS,agent:'新正文协议'};const saved=await savePrompts(env,texts);
 expect(saved.texts).toEqual(texts);expect(saved.revision).not.toBe('defaults-v2');expect(env.PROMPTS.put).toHaveBeenCalledWith(PROMPT_KEY,JSON.stringify(saved));expect(await readPrompts(env)).toEqual(saved);
});
it('does not disguise storage failures or corrupt data as defaults',async()=>{
 const env=namespace();vi.mocked(env.PROMPTS.get).mockRejectedValue(Error('KV unavailable'));await expect(readPrompts(env)).rejects.toThrow('KV unavailable');
 for(const raw of ['{broken','{}',JSON.stringify({revision:'r',texts:{agent:'partial'}})])await expect(readPrompts(namespace(raw))).rejects.toMatchObject({status:503});
 vi.mocked(env.PROMPTS.put).mockRejectedValue(Error('put failed'));await expect(savePrompts(env,DEFAULT_PROMPTS)).rejects.toThrow('put failed');
});
it('rejects missing, extra and empty prompt fields without imposing a text cutoff',async()=>{
 const env=namespace();for(const texts of [{...DEFAULT_PROMPTS,agent:''},{...DEFAULT_PROMPTS,extra:'x'},{agent:'x'},null])await expect(savePrompts(env,texts)).rejects.toMatchObject({status:400});
 expect(env.PROMPTS.put).not.toHaveBeenCalled();expect((await savePrompts(env,{...DEFAULT_PROMPTS,agent:'长'.repeat(30000)})).texts.agent).toHaveLength(30000);
});
