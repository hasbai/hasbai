import {expect,it} from 'vitest';
import {AgentTurn,emptyState,patchState,type Goal,type ToolCall} from './agent';
import type {Message} from '../shared/types';
const message=(id:string,ordinal:number,content:string,role:Message['role']='assistant',status:Message['status']='completed'):Message=>({id,ordinal,content,role,status,createdAt:ordinal,requestId:null});
const call=(name:string,args:unknown):ToolCall=>({id:crypto.randomUUID(),type:'function',function:{name,arguments:JSON.stringify(args)}});
const goal=(status:Goal['status']='active'):Goal=>({task:'核对仓库',actor:'character',status,progress:'已接受委托',pauseReason:status==='paused'?'用户要求先休息':null,completionEvidence:status==='completed'?'账目已经核对完成。':null});

it('reads the entire recalled successful version in Unicode pages, rejecting unissued, stale and failed sources',()=>{
 const text='钥匙在木盒。'+'😀风'.repeat(1400),turn=new AgentTurn(emptyState(),[message('old',0,'钥匙已丢失'),message('current',0,text),message('failed',1,'钥匙在屋顶','assistant','error')]);
 for(const id of ['current','old','failed','other-session'])expect(()=>turn.validate([call('read_memory',{id})])).toThrow('来源');
 turn.execute([call('search_memory',{query:'钥匙'})]);
 const pages=[];let offset:number|null=0;
 while(offset!==null){const page=JSON.parse(turn.execute([call('read_memory',{id:'current',offset})])[0].content);expect(page.text).not.toMatch(/[\uD800-\uDFFF]/u);pages.push(page.text);offset=page.nextOffset;}
 expect(pages.join('')).toBe(text);expect(()=>turn.execute([call('read_memory',{id:'current',offset:0})])).toThrow('没有进展');
 for(const args of [{id:'old'},{id:'failed'},{id:'current',offset:1},{id:'current',offset:-1},{id:'current',offset:1.5},{id:'current',owner:'other'}])expect(()=>turn.validate([call('read_memory',args)])).toThrow();
});
it('rejects an invalid later tool before staging a goal or reading a page',()=>{
 const turn=new AgentTurn(emptyState(),[message('source',0,'钥匙在柜子里')]);turn.execute([call('search_memory',{query:'钥匙'})]);
 const before=structuredClone(turn.steps);
 expect(()=>turn.execute([call('update_state',{patch:{goals:{warehouse:goal()}}}),call('read_memory',{id:'source'}),call('read_memory',{id:'outside'})])).toThrow();
 expect(turn.state.goals).toEqual({});expect(turn.steps).toEqual(before);
 expect(JSON.parse(turn.execute([call('read_memory',{id:'source'})])[0].content).text).toBe('钥匙在柜子里');
});
it('validates goal shape, pause and completion evidence while preserving omitted goals',()=>{
 const active=patchState(emptyState(),{goals:{warehouse:goal()}});
 expect(patchState(active,{scene:'北港'}).goals).toEqual(active.goals);
 expect(patchState(active,{goals:{warehouse:goal('paused')}}).goals.warehouse.pauseReason).toBeTruthy();
 expect(patchState(active,{goals:{warehouse:null}}).goals).toEqual({});
 for(const bad of [{...goal(),task:null},{...goal(),progress:null},{...goal('paused'),pauseReason:null},{...goal('completed'),completionEvidence:''},{...goal(),extra:'x'},{...goal(),actor:'automatic'},{...goal(),completionEvidence:'预测完成'}])expect(()=>patchState(active,{goals:{warehouse:bad}})).toThrow();
});
it('requires literal completion evidence and prevents assistant prose from confirming player decisions',()=>{
 const user=message('user',1,'我已签收货物。','user'),turn=new AgentTurn(emptyState(),[],user);
 expect(()=>turn.execute([call('update_state',{patch:{goals:{warehouse:goal('completed')}}})])).toThrow('证据');
 turn.observeOutput('账目已经核对完成。');turn.execute([call('update_state',{patch:{goals:{warehouse:goal('completed')}}})]);
 const player={...goal('completed'),actor:'player',completionEvidence:'账目已经核对完成。'};
 expect(()=>turn.execute([call('update_state',{patch:{goals:{player}}})])).toThrow('证据');
 turn.execute([call('update_state',{patch:{goals:{player:{...player,completionEvidence:'我已签收货物。'}}}})]);
 expect(turn.state.goals.player.actor).toBe('player');expect(turn.before.goals).toEqual({});
 expect(()=>turn.execute([call('update_state',{patch:{goals:{player:{...goal('completed'),completionEvidence:'账目已经核对完成。'}}}})])).toThrow('主体');
 const denied=new AgentTurn(emptyState(),[],message('no',1,'我还没有签收。','user'));
 expect(()=>denied.execute([call('update_state',{patch:{goals:{player:{...goal('completed'),actor:'player',completionEvidence:'签收'}}}})])).toThrow('完整原句');
});
it.each(['岚逐一核对面前货单与账册上的木箱数量：“核对完毕：货单写两箱，账册也写两箱，两者一致。本次仅核对这两张纸。”','岚说：「核对完毕：货单写两箱，账册也写两箱，两者一致。」','岚说："核对完毕：货单写两箱，账册也写两箱，两者一致。"'])('accepts a complete sentence inside quoted dialogue: %s',text=>{
 const turn=new AgentTurn(emptyState(),[]);turn.observeOutput(text);turn.execute([call('update_state',{patch:{goals:{warehouse:{...goal('completed'),completionEvidence:'核对完毕：货单写两箱，账册也写两箱，两者一致。'}}}})]);expect(turn.state.goals.warehouse.status).toBe('completed');
});
