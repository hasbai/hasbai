import {it,expect} from 'vitest';
import {AgentTurn,emptyState,mergeMemory,patchState,searchMemory,stableJson,storyMessages,ToolCallStream} from './agent';
import type {Message} from '../shared/types';
const m=(id:string,ordinal:number,content:string,status:Message['status']='completed'):Message=>({id,ordinal,content,status,role:'assistant',requestId:null,createdAt:ordinal});
it('validates bounded state patches, preserves omissions and supports deletion without prototype writes',()=>{
 const state=patchState(emptyState(),{scene:'北港',facts:{钥匙:'岚持有'},inventory:{金币:'三枚'}});
 expect(patchState(state,{facts:{钥匙:null}})).toEqual({...state,facts:{}});expect(state.facts.钥匙).toBe('岚持有');
 for(const value of [{future:{}},{scene:1},{facts:{a:[]}},JSON.parse('{"facts":{"__proto__":"x"}}'),{scene:'字'.repeat(1001)}])expect(()=>patchState(state,value)).toThrow();
 expect(stableJson({z:1,a:{b:2,a:3}})).toBe('{"a":{"a":3,"b":2},"z":1}');
});
it('searches Chinese partial terms with version anchors, corrections and no invented hits',()=>{
 const history=[m('old',0,'钥匙在岚手中。'),m('stale',1,'我们去了灯塔。'),m('new',1,'更正：没有去灯塔，钥匙已经交给旅人。'),m('failed',2,'钥匙送给船长。','error')];
 expect(storyMessages(history).map(x=>x.id)).toEqual(['old','new']);
 const hits=searchMemory(history,'钥匙 灯塔');expect(hits.map(x=>x.id)).toEqual(['old','new']);expect(hits[1].text).toContain('更正：没有');expect(hits[1].source.messageId).toBe('new');expect(searchMemory(history,'南极企鹅')).toEqual([]);
 expect(searchMemory([m('c',0,'北境港城正在下雨')],'港城天气')[0].id).toBe('c');
});
it('assembles chunked tool calls, rejects malformed indices and incomplete identity',()=>{
 const stream=new ToolCallStream();stream.push([{index:0,id:'c',type:'function',function:{name:'update_',arguments:'{"patch":'}}]);stream.push([{index:0,function:{name:'state',arguments:'{"scene":"港口"}}'}}]);expect(stream.finish()[0].function).toEqual({name:'update_state',arguments:'{"patch":{"scene":"港口"}}'});
 expect(()=>new ToolCallStream().push([{index:9}])).toThrow();const partial=new ToolCallStream();partial.push([{index:0,function:{name:'update_state'}}]);expect(()=>partial.finish()).toThrow();
});
it('anchors excerpts at the longest matching term instead of an earlier partial match',()=>{
 const content='北门早已关闭。'+'风'.repeat(1000)+'北门钥匙如今放在南塔木柜。';
 const hits=searchMemory([m('story',0,content)],'北门钥匙');
 expect(hits).toHaveLength(1);expect(hits[0].text).toContain('北门钥匙如今放在南塔木柜');expect([...hits[0].text].length).toBeLessThanOrEqual(600);
});
it('maps expanding lowercase offsets back to original Unicode characters without empty or split excerpts',()=>{
 for(const prefix of ['İ'.repeat(800),'😀'.repeat(61)+'a']){
  const content=prefix+'南塔钥匙藏在木柜。',hit=searchMemory([m('unicode',0,content)],'南塔钥匙')[0];
  expect(hit.text).toContain('南塔钥匙藏在木柜');expect(hit.text).not.toMatch(/[\uD800-\uDFFF]/u);expect(content.includes(hit.text)).toBe(true);expect([...hit.text].length).toBeLessThanOrEqual(600);
 }
 const prefix='😀'.repeat(251)+'a',hit=searchMemory([m('emoji',0,prefix+'南塔钥匙藏在木柜。')],'南塔钥匙')[0];
 expect([...hit.text].slice(0,100).join('')).toBe([...prefix].slice(-100).join(''));
});
it('matches supplementary Han bigrams without matching a shared surrogate half',()=>{
 expect(searchMemory([m('related',0,'𠀀𠀁藏在北门')],'𠀀𠀁𠀂')[0]?.id).toBe('related');
 expect(searchMemory([m('partial',0,'𠀀藏在北门')],'𠀀𠀁𠀂')).toEqual([]);
 expect(searchMemory([m('partial',0,'𠀀藏在北门')],'𠀀𠀁')).toEqual([]);
 expect(searchMemory([m('unrelated',0,'𠀃藏在北门')],'𠀀𠀁𠀂')).toEqual([]);
});
it('keeps a full 160-character query inside the bounded excerpt',()=>{
 const query='北门钥匙'.repeat(40),content='北门。'+'风'.repeat(1000)+query+'在南塔。';
 expect(searchMemory([m('long-query',0,content)],query)[0].text).toContain(query+'在南塔');
});
it('stages native state and memory results without changing the before snapshot or accepting repeated calls',()=>{
 const before=emptyState(),turn=new AgentTurn(before,[m('old',0,'铜钥匙还在岚手中')]);
 const update={id:'u',type:'function' as const,function:{name:'update_state',arguments:'{"patch":{"scene":"旅店"}}'}};
 expect(turn.execute([update])[0]).toMatchObject({role:'tool',tool_call_id:'u',content:'{"ok":true}'});expect(before.scene).toBeNull();expect(turn.state.scene).toBe('旅店');
 const result=turn.execute([{id:'s',type:'function',function:{name:'search_memory',arguments:'{"query":"钥匙"}'}}]);expect(result[0].content).toContain('"messageId":"old"');expect(()=>turn.execute([update])).toThrow('没有进展');
 expect(()=>new AgentTurn(emptyState(),[]).execute([{...update,function:{name:'update_state',arguments:'{"patch":{}}'}}])).toThrow('没有进展');
 expect(()=>turn.execute([{...update,function:{name:'fetch',arguments:'{"url":"https://example.com"}'}}])).toThrow('工具不存在');
});
it('allows one empty search result but stops consecutive different queries without new evidence',()=>{
 const turn=new AgentTurn(emptyState(),[]);const call=(query:string)=>({id:query,type:'function' as const,function:{name:'search_memory',arguments:JSON.stringify({query})}});
 expect(turn.execute([call('灯塔')])[0].content).toBe('[]');expect(()=>turn.execute([call('北港')])).toThrow('没有进展');
});
it('keeps worldbook evidence when history fills the recall limit, including the latest correction',()=>{
 const history=[m('old',0,'钥匙在岚手中。'),m('middle',1,'门上的钥匙孔是铜制的。'),m('corrected',2,'更正：钥匙已交给旅人。')];
 const lore={id:'book-hit',text:'铜钥匙只能打开北门，南门需要银钥匙。',source:{bookId:'gates',revision:'v1',entryId:'keys'}};
 const turn=new AgentTurn(emptyState(),history);
 const results=turn.execute([{id:'search',type:'function',function:{name:'search_memory',arguments:'{"query":"钥匙"}'}}],new Map([['钥匙',[lore]]]));
 const hits=JSON.parse(results[0].content);
 expect(hits).toHaveLength(3);expect(hits).toContainEqual(lore);expect(hits.some((hit:{id:string})=>hit.id==='corrected')).toBe(true);
});
it('fills recall from either available source and deduplicates by source, not a shared id',()=>{
 const history=searchMemory([m('same',0,'铜钥匙'),m('next',1,'银钥匙')],'钥匙');
 const lore={id:'same',text:'铜钥匙打开北门。',source:{bookId:'gates',revision:'v1',entryId:'keys'}};
 expect(mergeMemory(history,[])).toEqual(history);expect(mergeMemory([], [lore,lore])).toEqual([lore]);
 expect(mergeMemory(history,[lore,lore])).toEqual([...history,lore]);
 const second={...lore,id:'second',source:{...lore.source,entryId:'second'}};
 expect(mergeMemory(history.slice(0,1),[lore,second])).toEqual([history[0],lore,second]);
});
it('counts a new source or book revision as evidence while stopping repeated evidence',()=>{
 const turn=new AgentTurn(emptyState(),[m('same',0,'铜钥匙')]);
 const call=(query:string)=>({id:query,type:'function' as const,function:{name:'search_memory',arguments:JSON.stringify({query})}});
 turn.execute([call('铜钥匙')]);
 const lore={id:'same',text:'钥匙打开北门。',source:{bookId:'gates',revision:'v1',entryId:'keys'}};
 expect(turn.execute([call('钥匙')],new Map([['钥匙',[lore]]]))[0].content).toContain('"bookId":"gates"');
 expect(turn.execute([call('银钥匙')],new Map([['银钥匙',[{...lore,source:{...lore.source,revision:'v2'}}]]]))[0].content).toContain('"revision":"v2"');
 expect(()=>turn.execute([call('北门')],new Map([['北门',[{...lore,source:{...lore.source,revision:'v2'}}]]]))).toThrow('没有进展');
});
it('accepts a new fragment from the same successful version but stops queries returning already seen text',()=>{
 const history=[m('obsolete',0,'银怀表藏在北塔。'),m('current',0,'铜钥匙在北门。'+'风'.repeat(1000)+'银怀表藏在南塔。'),m('failed',0,'银怀表已丢失。','error')];
 const turn=new AgentTurn(emptyState(),history),call=(query:string)=>({id:query,type:'function' as const,function:{name:'search_memory',arguments:JSON.stringify({query})}});
 const first=JSON.parse(turn.execute([call('铜钥匙')])[0].content),second=JSON.parse(turn.execute([call('银怀表')])[0].content);
 expect(first[0].source.messageId).toBe('current');expect(first[0].text).not.toContain('银怀表');
 expect(second[0].source).toEqual(first[0].source);expect(second[0].text).toContain('银怀表藏在南塔');
 expect(()=>turn.validate([call('银怀表')])).toThrow('没有进展');
 expect(()=>turn.execute([call('银怀表 南塔')])).toThrow('没有进展');
});
it('preflights a whole batch without consuming calls or partially staging state',()=>{
 const turn=new AgentTurn(emptyState(),[]),update={id:'update',type:'function' as const,function:{name:'update_state',arguments:'{"patch":{"scene":"港口"}}'}},search={id:'search',type:'function' as const,function:{name:'search_memory',arguments:'{"query":"钥匙"}'}};
 expect(()=>turn.validate([search,{...search,id:'duplicate'}])).toThrow('没有进展');
 expect(()=>turn.execute([update,{...search,function:{name:'search_memory',arguments:'{"query":"钥匙","owner":"other"}'}}])).toThrow();
 expect(turn.state).toEqual(emptyState());expect(turn.steps).toEqual([]);
 turn.validate([update,search]);turn.validate([update,search]);expect(turn.execute([update,search]).map(r=>r.tool_call_id)).toEqual(['update','search']);
 expect(turn.state.scene).toBe('港口');expect(()=>turn.validate([search])).toThrow('没有进展');
});

it('ignores null tool deltas between real fragments without accepting malformed calls',()=>{
 const stream=new ToolCallStream();stream.push(null);expect(stream.size).toBe(0);stream.push([{index:0,id:'c',type:'function',function:{name:'update_',arguments:'{"patch":'}}]);stream.push(null);stream.push([{index:0,function:{name:'state',arguments:'{"scene":"港口"}}'}}]);stream.push(null);expect(stream.finish()).toEqual([{id:'c',type:'function',function:{name:'update_state',arguments:'{"patch":{"scene":"港口"}}'}}]);
 for(const bad of [false,0,'',{},[null],[{index:null}],[{index:0,function:false}],[{index:0,function:{arguments:1}}]])expect(()=>new ToolCallStream().push(bad)).toThrow();
});

it('assembles nullable optional tool fields without losing earlier identity or argument fragments',()=>{
 const stream=new ToolCallStream();stream.push([{index:1,id:'c',type:'function',function:{name:'update_state',arguments:''}}]);stream.push([{index:1,id:null,type:null,function:null}]);stream.push([{index:1,id:null,type:'function',function:{name:null,arguments:'{"patch":'}}]);stream.push([{index:1,id:null,type:null,function:{name:null,arguments:null}}]);stream.push([{index:1,function:{name:null,arguments:'{"scene":"北港"}}'}}]);expect(stream.finish()).toEqual([{id:'c',type:'function',function:{name:'update_state',arguments:'{"patch":{"scene":"北港"}}'}}]);
 for(const bad of [[{index:null}],[{index:0,id:1}],[{index:0,type:0}],[{index:0,function:false}],[{index:0,function:{name:false}}],[{index:0,function:{arguments:1}}]])expect(()=>new ToolCallStream().push(bad)).toThrow();
 const incomplete=new ToolCallStream();incomplete.push([{index:0,id:null,type:null,function:{name:null,arguments:null}}]);expect(()=>incomplete.finish()).toThrow('不完整');
});

it('retains an initially empty index until later fields complete it and preserves null in JSON arguments',()=>{
 const stream=new ToolCallStream();stream.push([{index:1,id:null,type:null,function:{name:null,arguments:null}}]);expect(stream.size).toBe(1);expect(()=>stream.finish()).toThrow();stream.push([{index:1,id:'later',type:'function',function:{name:'update_state',arguments:'{"patch":{"facts":{"钥匙":null}}}'}}]);stream.push([{index:1,id:null,type:null,function:{name:null,arguments:null}}]);expect(stream.finish()).toEqual([{id:'later',type:'function',function:{name:'update_state',arguments:'{"patch":{"facts":{"钥匙":null}}}'}}]);
});

it('retains earlier tool id and ignores empty continuation type strings',()=>{
 const stream=new ToolCallStream();
 stream.push([{index:0,id:'call-1',type:'function',function:{name:'update_state',arguments:'{"patch":'}}]);
 stream.push([{index:0,id:'',type:'',function:{name:'',arguments:'{"scene":"北港"}}'}}]);
 expect(stream.finish()).toEqual([{id:'call-1',type:'function',function:{name:'update_state',arguments:'{"patch":{"scene":"北港"}}'}}]);
});
