import { expect, it, vi } from 'vitest';
import { ConversationContext, SummaryRetry, validSummary, summarizeWithModel, summarizeStory } from './context';
import { DEFAULT_SETTINGS, type Message } from '../shared/types';
import type {PromptMessage} from '../shared/prompt';
const card={name:'岚',description:'旅店主人'};
const message=(id:string,role:Message['role'],content:string):Message=>({id,role,content,status:'completed',ordinal:0,requestId:null,createdAt:0});
vi.mock('./gateway',async(original)=>({...await original<typeof import('./gateway')>(),runRoleplay:async(env:Env,username:string,requestId:string,input:Record<string,unknown>,signal:AbortSignal)=>env.AI.gateway('default').run({provider:'compat',endpoint:'chat/completions',headers:{},query:input},{gateway:{id:'default',skipCache:true,collectLog:true,eventId:requestId,retries:{maxAttempts:1},metadata:{app:'tavern',task:'roleplay',username}},signal})}));
const options={protocol:'',inputRatio:1.2};
it('projects Telegram history and current input for body and summary while preserving original checkpoint sources',async()=>{
 const raw=JSON.stringify({speaker:{id:12,name:'@alice'},text:'今天的事情。'.repeat(20)}),history=[message('old','user',raw)];
 const infer=vi.fn(async(_messages:PromptMessage[])=>'她谈起今天的事。');
 const context=new ConversationContext(history,card,[],DEFAULT_SETTINGS,32768,{...options,telegram:true,currentInput:message('now','user',JSON.stringify({speaker:{id:13,name:'@bob'},text:'后来呢？'}))},infer);
 expect(context.prompt().messages.slice(1).map(m=>m.content)).toEqual(['@alice: '+'今天的事情。'.repeat(20),'@bob: 后来呢？']);
 const browser=new ConversationContext(history,card,[],DEFAULT_SETTINGS,32768,options,infer);expect(browser.prompt().messages[1].content).toBe(raw);
 await context.compress();expect(infer.mock.calls[0][0][0].content).toBe('@alice: '+'今天的事情。'.repeat(20));
 expect(history[0].content).toBe(raw);expect(await validSummary(JSON.stringify(context.summary),history)).toEqual(context.summary);
});
it('compresses all past turns at once while preserving only the current input',async()=>{
 const history=Array.from({length:9},(_,i)=>message(String(i),i%2?'user':'assistant',('第'+i+'段剧情。').repeat(100)));
 history.push(message('current','user','现在怎么办？'));
 const infer=vi.fn(async(_messages:PromptMessage[])=>'旅人在港城旅店停留。');
 const context=new ConversationContext(history.slice(0,-1),card,[],DEFAULT_SETTINGS,32768,{...options,currentInput:history.at(-1)},infer);
 await context.compress();
 expect(infer).toHaveBeenCalledTimes(1);
 expect(context.summary?.covered).toEqual(history.slice(0,-1).map(m=>m.id));
 expect(context.prompt().messages.slice(1).map(m=>m.content)).toEqual(['现在怎么办？']);
 expect(infer.mock.calls[0]?.[0].slice(0,-1).map(m=>m.content)).toEqual(history.slice(0,-1).map(m=>m.content));
});
it('manually compresses the latest exchange too and merges an existing checkpoint',async()=>{
 const history=[message('g','assistant','旧开场。'.repeat(100)),message('u','user','我走进旅店。'.repeat(100)),message('a','assistant','她招呼我坐下。'.repeat(100))];
 const infer=vi.fn(async(_messages:PromptMessage[])=>'旅人进店坐下。');
 const context=new ConversationContext(history,card,[],DEFAULT_SETTINGS,32768,options,infer);
 await context.compress();
 expect(context.summary?.covered).toEqual(['g','u','a']);
 expect(context.prompt().budget.includedMessages).toBe(0);
 const later=[...history,message('u2','user','我询问灯塔。'.repeat(100)),message('a2','assistant','灯塔今夜亮起。'.repeat(100))];
 const next=new ConversationContext(later,card,[],DEFAULT_SETTINGS,32768,options,infer);
 await next.restore(JSON.stringify(context.summary));await next.compress();
 expect(infer.mock.calls[1][0][0].content).toContain('旅人进店坐下。');
 expect(infer.mock.calls[1][0].slice(1,-1).map(m=>m.content)).toEqual(later.slice(3).map(m=>m.content));
 expect(next.summary?.covered).toEqual(later.map(m=>m.id));expect(next.prompt().budget.includedMessages).toBe(0);
});
it('can manually compress a single greeting without requiring another turn',async()=>{
 const context=new ConversationContext([message('g','assistant','开场剧情。'.repeat(100))],card,[],DEFAULT_SETTINGS,null,options,async()=>'开场。');
 await context.compress();expect(context.summary?.covered).toEqual(['g']);expect(context.prompt().budget.includedMessages).toBe(0);
});
it('requires every summary to be nonempty and shorter than its source',async()=>{
 const history=[message('short','assistant','雨')];
 await expect(summarizeStory('',history,{contextTokens:null,inputRatio:1.2,infer:async()=> '岚与旅人在雨夜相遇。'})).rejects.toThrow('有效摘要');
 await expect(summarizeStory('',history,{contextTokens:null,inputRatio:1.2,infer:async()=>''})).rejects.toThrow('有效摘要');
});
it('does not reissue a summary when its output finishes with length',async()=>{
 const run=vi.fn(async()=>new Response('data: {"choices":[{"delta":{"content":"半个摘要"},"finish_reason":"length"}]}\n\ndata: [DONE]\n\n',{headers:{'Content-Type':'text/event-stream'}})),env={AI:{gateway:()=>({run})},AIG_GATEWAY_ID:'default'} as unknown as Env;
 await expect(summarizeStory('',[message('a','assistant','源剧情'.repeat(100))],{contextTokens:null,inputRatio:1.2,infer:messages=>summarizeWithModel(env,'用户','request',DEFAULT_SETTINGS,messages,new AbortController().signal)})).rejects.toThrow('长度上限');expect(run).toHaveBeenCalledTimes(1);
});
it('keeps Unicode whole when recursively splitting summary sources',async()=>{
 const recursive=vi.fn(async(messages:PromptMessage[])=>{expect(messages.map(m=>m.content).join('')).not.toMatch(/[\uD800-\uDFFF]/u);if(messages.slice(0,-1).some(m=>m.content.includes('😀😀😀')))throw new SummaryRetry();return '港';});
 expect(await summarizeStory('',[message('a','assistant','😀'.repeat(5))],{contextTokens:null,inputRatio:1.2,infer:recursive})).toBe('港');expect(recursive.mock.calls.length).toBeGreaterThan(1);
});
it('stops splitting a single supplementary character instead of repeating the same oversized source',async()=>{
 const infer=vi.fn(async()=>{throw new SummaryRetry();});await expect(summarizeStory('',[message('a','assistant','😀')],{contextTokens:null,inputRatio:1.2,infer})).rejects.toThrow('无法容纳');expect(infer).toHaveBeenCalledTimes(1);
});
it('does not summarize below discovered capacity or when unknown, and checkpoints overflow without editing source',async()=>{
 const history=[message('u','user','中'.repeat(1800)),message('a','assistant','未承诺出发。'.repeat(400)),message('new','user','现在呢？')],before=JSON.stringify(history);
 const infer=vi.fn(async()=>'此前未承诺出发。');const c=new ConversationContext(structuredClone(history.slice(0,-1)),card,[],DEFAULT_SETTINGS,null,{...options,currentInput:history.at(-1)},infer);
 await c.fit();expect(infer).not.toHaveBeenCalled();c.contextTokens=65536;await c.fit();expect(infer).not.toHaveBeenCalled();c.contextTokens=4096;await c.fit();expect(infer).toHaveBeenCalled();expect(c.prompt().needsCompression).toBe(false);expect(c.prompt().messages.at(-1)?.content).toBe('现在呢？');expect(JSON.stringify(history)).toBe(before);
 expect(await validSummary(JSON.stringify(c.summary),history)).toEqual(c.summary);
 expect(await validSummary(JSON.stringify(c.summary),[{...history[0],id:'different'},...history.slice(1)])).toBeNull();expect(await validSummary(JSON.stringify(c.summary),[{...history[0],content:'更正'},...history.slice(1)])).toBeNull();
 const next=new ConversationContext([...history,message('later','assistant','新回复')],card,[],DEFAULT_SETTINGS,4096,options,infer);await next.restore(JSON.stringify(c.summary));infer.mockClear();await next.fit();expect(infer).not.toHaveBeenCalled();
});
it('splits summary sources only on explicit context feedback, without unchanged retry',async()=>{
 const infer=vi.fn(async(messages:{content:string}[])=>{const chars=messages.slice(0,-1).reduce((n,m)=>n+m.content.length,0);if(chars>600)throw new SummaryRetry(1024);return '事实';});
 const c=new ConversationContext([message('u','user','中'.repeat(2400)),message('a','assistant','否定'.repeat(1000)),message('n','user','后来')],card,[],DEFAULT_SETTINGS,4096,options,infer);
 await c.fit();expect(c.prompt().needsCompression).toBe(false);expect(c.contextTokens).toBe(1024);expect(infer).toHaveBeenCalled();
 expect(infer.mock.calls.filter(([m])=>m.slice(0,-1).reduce((n,x)=>n+x.content.length,0)>600).length).toBeGreaterThan(0);
});
it('keeps a previous checkpoint intact when summarization fails',async()=>{
 const c=new ConversationContext([message('u','user','中'.repeat(2000)),message('a','assistant','答'.repeat(2000)),message('n','user','后来')],card,[],DEFAULT_SETTINGS,4096,options,async()=>{throw new Error('failed');});const original=JSON.stringify(c.history);await expect(c.fit()).rejects.toThrow('failed');expect(c.summary).toBeNull();expect(JSON.stringify(c.history)).toBe(original);
});
it('propagates capacity errors and ends truncated summaries and cancels on stop',async()=>{
 const run=vi.fn();const env={AI:{gateway:()=>({run})},AIG_GATEWAY_ID:'default'} as unknown as Env;const signal=new AbortController(),source:PromptMessage[]=[{role:'user',content:'已经发生的旧事。'}];
 run.mockResolvedValueOnce(Response.json({error:{message:'maximum context length is 2048 tokens'}},{status:400}));await expect(summarizeWithModel(env,'用户名','request',DEFAULT_SETTINGS,source,signal.signal)).rejects.toMatchObject({contextTokens:2048});
 run.mockResolvedValueOnce(new Response('data: {"choices":[{"delta":{"content":"摘要"},"finish_reason":"length"}]}\n\ndata: [DONE]\n\n',{headers:{'Content-Type':'text/event-stream'}}));await expect(summarizeWithModel(env,'用户名','request',DEFAULT_SETTINGS,source,signal.signal)).rejects.toThrow('会话压缩达到长度上限');expect(run).toHaveBeenCalledTimes(2);
 const cancel=vi.fn();run.mockResolvedValueOnce(new Response(new ReadableStream({cancel}),{headers:{'Content-Type':'text/event-stream'}}));const pending=summarizeWithModel(env,'用户名','request',DEFAULT_SETTINGS,source,signal.signal);await vi.waitFor(()=>expect(run).toHaveBeenCalledTimes(3));signal.abort();await expect(pending).rejects.toThrow();expect(cancel).toHaveBeenCalled();
});
it('shrinks existing memory when a single-character addition still cannot complete a summary',async()=>{
 const infer=vi.fn(async(messages:{content:string}[])=>{const previous=messages.find(m=>m.content.startsWith('已有记忆：'))?.content??'';if(previous.length>60)throw new SummaryRetry();return '事实';});
 const c=new ConversationContext([message('u','user','长历史'.repeat(600)),message('a','assistant','旧回复'.repeat(600)),message('n','user','后来')],card,[],DEFAULT_SETTINGS,1024,options,infer);
 // A valid existing source checkpoint near the summary model's actual completion boundary.
 const seedContext=new ConversationContext([message('s','user','源'.repeat(1000)),message('n','user','新')],card,[],DEFAULT_SETTINGS,1024,options,async()=>'记忆'.repeat(100));await seedContext.compress();
 c.summary={...seedContext.summary!,covered:[],text:'记忆'.repeat(100)};await c.compress();expect(c.summary?.text).toBe('事实');expect(infer).toHaveBeenCalled();
});

it('preserves assistant source roles before the final user compression task',async()=>{
 const infer=vi.fn(async(_messages:{role:string;content:string}[])=> '尚未出港。');const c=new ConversationContext([message('g','assistant','旧角色正文'.repeat(900))],card,[],DEFAULT_SETTINGS,16384,{...options,currentInput:message('u','user','后来呢')},infer);await c.compress();
 const messages=infer.mock.calls[0]?.[0] as {role:string;content:string}[]|undefined;expect(messages?.map(m=>m.role)).toEqual(['assistant','user']);expect(messages?.[0]?.content).toBe('旧角色正文'.repeat(900));expect(messages?.at(-1)?.content).toMatch(/^本次任务是压缩/);
});

it('estimates temporary candidate suffixes while excluding them from summary facts',async()=>{
 const sources:string[]=[];const c=new ConversationContext([message('old','user','旧问题'.repeat(1200)),message('reply','assistant','旧事实'.repeat(1200)),message('current','user','现在')],card,[],DEFAULT_SETTINGS,16384,{protocol:'',inputRatio:1.2},async messages=>{sources.push(JSON.stringify(messages));return '旧事';});
 const first=await c.fit();const before=JSON.stringify(first.messages);const suffix=[{role:'user' as const,content:'给候选'},{role:'assistant' as const,content:'将来我乘船离开。'},{role:'user' as const,content:'接着给候选'}];const frozen=c.extend(first,[{role:'assistant',content:'正文已经完成。'},...suffix]);expect(JSON.stringify(first.messages)).toBe(before);expect(frozen.messages.slice(0,first.messages.length)).toEqual(first.messages);c.contextTokens=4096;const fitted=await c.fit({protocol:''},suffix);expect(fitted.needsCompression).toBe(false);expect(fitted.messages.slice(-3)).toEqual(suffix);expect(sources.length).toBeGreaterThan(0);expect(sources.join('')).not.toContain('将来我乘船离开');expect(c.history.at(-1)?.content).toBe('现在');
});

it('uses the turn snapshot for summary rules and its user task including split retries',async()=>{
 const infer=vi.fn(async(messages:PromptMessage[])=>{expect(messages.some(m=>m.role==='system')).toBe(false);expect(messages.at(-1)?.content).toBe('保存的压缩任务');if(messages.slice(0,-1).reduce((n,m)=>n+m.content.length,0)>700)throw new SummaryRetry(1024);return '确认旧事';});
 const c=new ConversationContext([message('u','user','中'.repeat(1800)),message('a','assistant','事实'.repeat(900)),message('n','user','后来')],card,[],DEFAULT_SETTINGS,2048,{protocol:'保存的正文规则',inputRatio:1.2,summaryTask:'保存的压缩任务'},infer);
 await c.fit();expect(infer).toHaveBeenCalled();expect(c.prompt().messages[0].content).toContain('保存的正文规则');
});

it('strips long OOC once before recursive summary splitting can lose its command marker',async()=>{
 const infer=vi.fn(async(messages:PromptMessage[])=>{const source=messages.slice(0,-1).map(m=>m.content).join('');expect(source).not.toContain('系统专用指令');expect(source).not.toContain('/ooc');if(source.length>300)throw new SummaryRetry();return '旅人坐下。';});
 const raw='/ooc '+('系统专用指令'.repeat(200))+'\n'+('旅人坐在桌边喝茶。'.repeat(150));
 expect(await summarizeStory('',[message('ooc','user',raw)],{contextTokens:null,inputRatio:1.2,infer})).toBe('旅人坐下。');expect(infer.mock.calls.length).toBeGreaterThan(1);
});
