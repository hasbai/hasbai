import { splitOoc } from '../shared/commands';
import type {Book,Message} from '../shared/types';
import {contentHash,memoryPage,searchMemory,storyMessages,type MemoryHit,type MemoryPage} from './agent';
import {roleplayGatewayOptions} from './gateway';

export type LoreSource={id:string;book:Book};
export type LoreChunk={id:string;bookId:string;revision:string;entryId:string;text:string;vector?:number[];message?:Pick<Message,'id'|'ordinal'|'role'>};
export const LORE_SCHEMA='CREATE TABLE IF NOT EXISTS lore_chunks(id TEXT PRIMARY KEY,book_id TEXT NOT NULL,revision TEXT NOT NULL,entry_id TEXT NOT NULL,text TEXT NOT NULL,vector_json TEXT); CREATE INDEX IF NOT EXISTS lore_source ON lore_chunks(book_id,revision);';
export async function loreChunks(sources:LoreSource[]):Promise<LoreChunk[]>{
 const result:LoreChunk[]=[];
 for(const source of sources){const revision=await contentHash(source.book.raw);
  for(const entry of source.book.entries){if(!entry.enabled||entry.regex||!entry.content||/^\s*@@/m.test(entry.content))continue;const chars=[...entry.content];
   for(let at=0;at<chars.length;at+=1000)result.push({id:source.id+':'+revision+':'+entry.id+':'+at,bookId:source.id,revision,entryId:entry.id,text:chars.slice(at,at+1200).join('')});
  }
 }
 return result;
}
export async function historyChunks(history:Message[]):Promise<LoreChunk[]>{
 const result:LoreChunk[]=[];
 for(const raw of storyMessages(history)){
  const message=raw.role==='user'?{...raw,content:splitOoc(raw.content).dialogue}:raw;
  const revision=await contentHash([message.id,message.content]),chars=[...message.content];
  for(let at=0;at<chars.length;at+=1000)result.push({id:'history:'+message.id+':'+revision+':'+at,bookId:'@history',revision,entryId:message.id,text:chars.slice(at,at+1200).join(''),message:{id:message.id,ordinal:message.ordinal,role:message.role}});
 }
 return result;
}
export function cosine(a:number[],b:number[]){if(a.length!==b.length||!a.length)return 0;let dot=0,aa=0,bb=0;for(let i=0;i<a.length;i++){dot+=a[i]*b[i];aa+=a[i]*a[i];bb+=b[i]*b[i];}return aa&&bb?dot/Math.sqrt(aa*bb):0;}
export async function embeddings(env:Env,text:string[],username:string,requestId:string,signal:AbortSignal):Promise<number[][]>{
 const opts=roleplayGatewayOptions(env,username,requestId);
 if(signal.aborted)throw Error('检索已停止');
 const timeout=new AbortController(),timer=setTimeout(()=>timeout.abort(),10000),cancel=AbortSignal.any([signal,timeout.signal]);
 let onAbort!:()=>void;
 const response=await Promise.race([env.AI.run('@cf/baai/bge-m3',{text},{...opts,signal:cancel}),new Promise<never>((_,reject)=>{onAbort=()=>reject(Error('向量检索已停止'));cancel.addEventListener('abort',onAbort,{once:true});if(cancel.aborted)onAbort();})]).finally(()=>{clearTimeout(timer);cancel.removeEventListener('abort',onAbort);});
 if(signal.aborted)throw Error('检索已停止');
 const raw=response as {data?:number[][];result?:{data?:number[][]}};const vectors=raw.data??raw.result?.data;
 if(!Array.isArray(vectors)||vectors.length!==text.length||vectors.some(v=>!Array.isArray(v)||v.length!==1024||v.some(n=>typeof n!=='number'||!Number.isFinite(n))))throw Error('向量响应无效');return vectors;
}
/** Index belongs to the private session DO; allowed source revisions are fixed for this round. */
export class LoreIndex{
 private revisions=new Map<string,string>();
 constructor(readonly sql:SqlStorage,readonly sources:LoreSource[],readonly embed:(texts:string[],signal:AbortSignal)=>Promise<number[][]>,readonly signal:AbortSignal=new AbortController().signal,readonly history:Message[]=[]){}
 read(hit:MemoryHit,offset:number):MemoryPage{
  this.signal.throwIfAborted();
  const {bookId,revision,entryId}=hit.source,source=this.sources.find(s=>s.id===bookId);
  const entry=source?.book.entries.find(e=>e.id===entryId);
  if(!source||!entry||!entry.enabled||entry.regex||!entry.content||/^\s*@@/m.test(entry.content)||this.revisions.get(source.id)!==revision)throw Error('原文来源已失效');
  return memoryPage(hit,entry.content,offset);
 }
 async search(query:string):Promise<MemoryHit[]>{
  // Validate before indexing/inference, and provide a deterministic keyword path on embedding failure.
  searchMemory([],query);this.signal.throwIfAborted();const chunks=[...await loreChunks(this.sources),...await historyChunks(this.history)];
  for(const chunk of chunks)this.revisions.set(chunk.bookId,chunk.revision);
  const allowed=new Set(chunks.map(c=>c.id));
  this.sql.exec(LORE_SCHEMA);
  for(const row of this.sql.exec<{id:string}>('SELECT id FROM lore_chunks').toArray())if(!allowed.has(row.id))this.sql.exec('DELETE FROM lore_chunks WHERE id=?',row.id).toArray();
  if(!chunks.length)return [];
  for(const chunk of chunks){const existing=this.sql.exec<{vector_json:string|null}>('SELECT vector_json FROM lore_chunks WHERE id=?',chunk.id).toArray()[0];if(existing?.vector_json)chunk.vector=JSON.parse(existing.vector_json);else this.sql.exec('INSERT OR IGNORE INTO lore_chunks(id,book_id,revision,entry_id,text) VALUES(?,?,?,?,?)',chunk.id,chunk.bookId,chunk.revision,chunk.entryId,chunk.text).toArray();}
  let vector:number[]|undefined;
  const keyword=searchMemory(chunks.map((c,i)=>({id:c.id,role:'assistant',content:c.text,status:'completed',ordinal:i,requestId:null,createdAt:i})),query);const lexical=new Set(keyword.map(h=>h.id));
  const deadline=AbortSignal.any([this.signal,AbortSignal.timeout(10000)]);
  try{const batch=chunks.filter(c=>!c.vector).sort((a,b)=>Number(lexical.has(b.id))-Number(lexical.has(a.id))).slice(0,8);if(batch.length){const vectors=await this.embed(batch.map(c=>c.text),deadline);batch.forEach((c,i)=>{c.vector=vectors[i];this.sql.exec('UPDATE lore_chunks SET vector_json=? WHERE id=?',JSON.stringify(vectors[i]),c.id).toArray();});}if(deadline.aborted)throw Error('检索已停止');vector=(await this.embed([query],deadline))[0];}catch{if(this.signal.aborted)throw Error('检索已停止');console.info({event:'lore_keyword_fallback',sources:this.sources.length,chunks:chunks.length});}
  const ranked=chunks.map(c=>({c,score:(lexical.has(c.id)?1:0)+(vector&&c.vector?Math.max(0,cosine(vector,c.vector)):0)})).filter(x=>lexical.has(x.c.id)||x.score>=.55).sort((a,b)=>b.score-a.score||a.c.id.localeCompare(b.c.id));
  const messages=new Map<string,typeof ranked[number]>();
  for(const item of ranked)if(item.c.message&&!messages.has(item.c.message.id))messages.set(item.c.message.id,item);
  const selected=[...messages.values()].slice(0,3).concat(ranked.filter(x=>!x.c.message).slice(0,3));
  return selected.map(({c})=>c.message?{id:c.message.id,text:[...c.text].slice(0,600).join(''),source:{messageId:c.message.id,ordinal:c.message.ordinal,role:c.message.role}}:{id:c.id,text:c.text,source:{bookId:c.bookId,revision:c.revision,entryId:c.entryId}});
 }
}
