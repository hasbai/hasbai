import { expect, it } from 'vitest';
import { buildPrompt } from './prompt';
import { DEFAULT_SETTINGS, type Message } from './types';
const card={name:'岚',description:'港城旅店主人',personality:'沉稳'};
const base:Message={id:'0',role:'user',content:'',status:'completed',ordinal:0,requestId:null,createdAt:0};
it.each([null,16384,32768,65536])('retains all originals and requests compression only above discovered %s',window=>{
 const history:Message[]=Array.from({length:60},(_,i)=>({...base,id:String(i),role:i%2?'assistant':'user',content:String(i)+'中'.repeat(600),ordinal:i}));
 const original=JSON.stringify(history),prompt=buildPrompt(card,[],history,DEFAULT_SETTINGS,window,{inputRatio:1.2});
 expect(prompt.messages.slice(1).map(m=>m.content)).toEqual(history.map(m=>m.content));expect(JSON.stringify(history)).toBe(original);
 expect(prompt.needsCompression).toBe(window!==null&&prompt.estimatedTokens>window);expect(prompt.budget.detectedContextTokens).toBe(window);
 expect(prompt.estimatedTokens).toBeGreaterThan(32768);
});
it('keeps the stable prefix when history grows and uses one system with a checkpoint',()=>{
 const history=[{...base,content:'最早的问题'},{...base,id:'a',role:'assistant' as const,content:'最早的回答'}];
 const first=buildPrompt(card,[],history,DEFAULT_SETTINGS,65536,{summary:'已约定下雨后出发。'});
 const next=buildPrompt(card,[],[...history,{...base,id:'b',content:'下一问'}],DEFAULT_SETTINGS,65536,{summary:'已约定下雨后出发。'});
 expect(next.messages.slice(0,-1)).toEqual(first.messages);expect(first.messages.filter(m=>m.role==='system')).toHaveLength(1);expect(first.messages[0].content).toContain('已约定下雨后出发。');
});
