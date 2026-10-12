import { it, expect } from 'vitest';
import { CandidateStream, candidateDelimiter, candidateInstruction,  validateCandidates } from './candidates';
import { normalizeSettings } from './settings';
import { DEFAULT_SETTINGS, LEGACY_SYSTEM_PROMPT, PREVIOUS_SYSTEM_PROMPT } from './types';
import { buildPrompt, estimateTokens } from './prompt';
import { parseBook } from './cards';
const card={name:'岚',description:'港城旅店主人',personality:'沉稳'};

it('adds generation defaults to historical snapshots and preserves identity and ignores legacy output limits',()=>{
 const old={userName:'旧用户',persona:'北方人',systemPrompt:'继续故事',temperature:0.4,maxTokens:1024};
 expect(normalizeSettings(old)).toEqual({...DEFAULT_SETTINGS,userName:old.userName,persona:old.persona,systemPrompt:old.systemPrompt,temperature:old.temperature});
 expect(normalizeSettings(old).thinkingEnabled).toBe(false);
 expect(normalizeSettings(old).reasoningEffort).toBe('low');
});
it.each([{thinkingEnabled:'false'},{reasoningEffort:'xhigh'},{reasoningEffort:null},{reasoningEffort:undefined},{modelId:'dynamic/saki'},{topP:0},{topP:1.1},{topK:1.5},{frequencyPenalty:3},{presencePenalty:NaN},{temperature:undefined}])('rejects explicit invalid settings %j', invalid=>{
 expect(()=>normalizeSettings({...DEFAULT_SETTINGS,...invalid})).toThrow();
});
it('holds delimiter across every possible chunk boundary and never emits the protocol',()=>{
 const marker=candidateDelimiter(); const wire='正文结束。'+marker+' 去看看窗外。 \n问她叫什么？\n去看看窗外。\n坐下喝茶。\n第五条';
 for(let split=0;split<=wire.length;split++) {const parser=new CandidateStream(marker);const body=parser.push(wire.slice(0,split))+parser.push(wire.slice(split));const result=parser.finish();expect(body+result.body).toBe('正文结束。');expect(result.candidates).toEqual(['去看看窗外。','问她叫什么？','坐下喝茶。']);}
 const parser=new CandidateStream(marker);let body='';for(const c of wire)body+=parser.push(c);expect(body+parser.finish().body).toBe('正文结束。');
});
it('keeps story with no tail, rejects oversized or malformed tails and partial markers',()=>{
 for(const tail of ['{"candidates":',JSON.stringify({candidates:['中'.repeat(1000)]}),'\u0000无效','[]']){const p=new CandidateStream(candidateDelimiter());expect(p.push('正文'+candidateDelimiter()+tail)).toBe('正文');expect(p.finish().candidates).toEqual([]);}
 const p=new CandidateStream(candidateDelimiter());expect(p.push('正文。\n')).toBe('正文。');expect(p.finish().body).toBe('\n');
 for(let n=2;n<candidateDelimiter().length;n++){const p=new CandidateStream(candidateDelimiter());expect(p.push('正文'+candidateDelimiter().slice(0,n))).toBe('正文');expect(p.finish()).toEqual({body:'',candidates:[]});}
});
it('validates Unicode length, rejects controls, deduplicates and caps candidates',()=>{
 expect(validateCandidates([null,3,' ','😀'.repeat(121),'\u0000坏数据','😀'.repeat(120),'可以走走。','可以走走。','可以问问。','第四条'])).toEqual(['😀'.repeat(120),'可以走走。','可以问问。']);
});
it.each(['\n','\r\n'])('isolates an inline reserved marker at every stream boundary (%j)', newline=>{
 const wire='灯？[TAVERN_NEXT]'+newline+'我问问港口的往事。'+newline+'我坐下喝茶。'+newline+'我望向窗外。';
 for(let split=0;split<=wire.length;split++) {const p=new CandidateStream();const body=p.push(wire.slice(0,split))+p.push(wire.slice(split));const end=p.finish();expect(body+end.body).toBe('灯？');expect(end.candidates).toEqual(['我问问港口的往事。','我坐下喝茶。','我望向窗外。']);}
});
it('withholds interrupted inline protocol and leaves custom marker semantics intact',()=>{
 const marker='[TAVERN_NEXT]\n';
 for(let n=2;n<marker.length;n++){const p=new CandidateStream();const body=p.push('正文'+marker.slice(0,n));expect(body+p.finish().body).toBe('正文');}
 const custom=new CandidateStream('\nCUSTOM\n');expect(custom.push('正文CUSTOM\n尾部')).toBe('正文CUSTOM\n尾部');expect(custom.inTail).toBe(false);
});
it.each([16384,32768])('preserves recent history and existing worldbook selection at %i', window=>{
 const book=parseBook({name:'书',token_budget:window,entries:[{constant:true,content:'世'.repeat(window),enabled:true}]});
 const latest={id:'latest',role:'user' as const,content:'这轮不要丢',status:'completed' as const,ordinal:1,requestId:null,createdAt:0,candidates:['不进入prompt']};
 const previous=[{...latest,id:'earlier-user',content:'上一轮的问题',ordinal:0},{...latest,id:'earlier-reply',role:'assistant' as const,content:'上一轮的回答',ordinal:1}];
 const prompt=buildPrompt(card,[book],[...previous,latest],DEFAULT_SETTINGS,window,'',{protocol:'候选协议',inputRatio:1.2});
 expect(prompt.messages.some(m=>m.content==='这轮不要丢')).toBe(true);expect(prompt.messages.some(m=>m.content==='上一轮的问题')).toBe(true);expect(prompt.messages.some(m=>m.content==='上一轮的回答')).toBe(true);expect(prompt.needsCompression).toBe(prompt.estimatedTokens>window);expect(prompt.messages.map(m=>m.content).join('')).not.toContain('不进入prompt');
});
it('keeps the greeting, all complete turns and activated worldbook when capacity is unknown',()=>{
 const m={id:'a',role:'user' as const,content:'当前输入',status:'completed' as const,ordinal:1,requestId:null,createdAt:0};
 const history=[{...m,role:'assistant' as const,content:'角色最初的问候'},{...m,content:'更早的问题'},{...m,role:'assistant' as const,content:'更早的回复'},{...m,content:'上一轮问题'},{...m,role:'assistant' as const,content:'上一轮回答'},m];
 const book=parseBook({name:'书',entries:[{constant:true,content:'早期世界设定',enabled:true}]});
 const prompt=buildPrompt({...card,post_history_instructions:'后续规则'},[book],history,DEFAULT_SETTINGS,null,'',{protocol:'候选协议'});
 expect(prompt.messages.filter(m=>m.role==='system')).toHaveLength(1);expect(prompt.messages[0].content).toContain('后续规则');expect(prompt.messages[0].content).toContain('候选协议');expect(prompt.messages.slice(1).map(m=>m.content)).toEqual(history.map(m=>m.content));expect(prompt.messages[0].content).toContain('早期世界设定');
});

it('accepts CRLF, blank lines and simple list prefixes at every split',()=>{
 const wire='故事。\r\n[TAVERN_NEXT]\r\n\r\n1. 我走向港口。\r\n- 我问问来路。\r\n我坐下喝茶。\r';
 for(let i=0;i<=wire.length;i++){const parser=new CandidateStream();const body=parser.push(wire.slice(0,i))+parser.push(wire.slice(i));const result=parser.finish();expect(body+result.body).toBe('故事。');expect(result.candidates).toEqual(['我走向港口。','我问问来路。','我坐下喝茶。']);}
});
it('keeps configured prompt with card instructions and updates only the exact old default',()=>{
 expect(normalizeSettings({...DEFAULT_SETTINGS,systemPrompt:LEGACY_SYSTEM_PROMPT}).systemPrompt).toBe(DEFAULT_SETTINGS.systemPrompt);
 expect(normalizeSettings({...DEFAULT_SETTINGS,systemPrompt:PREVIOUS_SYSTEM_PROMPT}).systemPrompt).toBe(DEFAULT_SETTINGS.systemPrompt);
 const configured='每次详细写出对白与动作。';const prompt=buildPrompt({...card,system_prompt:'沿用角色口吻。'},[],[],{...DEFAULT_SETTINGS,systemPrompt:configured},null);
 expect(prompt.messages[0].content).toContain(configured);expect(prompt.messages[0].content).toContain('沿用角色口吻。');
 const expanded=buildPrompt({...card,system_prompt:'{{original}}\n角色口吻'},[],[],{...DEFAULT_SETTINGS,systemPrompt:configured},null);
 expect(expanded.messages[0].content.split(configured)).toHaveLength(2);
 expect(normalizeSettings({...DEFAULT_SETTINGS,systemPrompt:configured}).systemPrompt).toBe(configured);
 expect(candidateInstruction()).not.toMatch(/[a-f0-9]{8}-[a-f0-9-]{27,}/);expect(candidateInstruction()).toContain('[TAVERN_NEXT]');
});
it('preserves raw user inputs and puts application rules only in system messages',()=>{
 const m={id:'a',role:'user' as const,content:'我的原始输入',status:'completed' as const,ordinal:0,requestId:null,createdAt:0};
 const prompt=buildPrompt(card,[],[m],DEFAULT_SETTINGS,null,'',{protocol:'正文任务'});
 expect(prompt.messages.at(-1)).toEqual({role:'user',content:m.content});
 expect(prompt.messages[0].content).toContain('正文任务');
 const continued=buildPrompt(card,[],[m],DEFAULT_SETTINGS,null,'从中断处继续');
 expect(continued.messages.at(-1)?.content).toBe('从中断处继续');expect(m.content).toBe('我的原始输入');
});
