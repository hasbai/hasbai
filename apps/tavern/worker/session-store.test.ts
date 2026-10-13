import {it,expect} from 'vitest';
import {DatabaseSync} from 'node:sqlite';
import {SessionStore,SESSION_SCHEMA} from './session-store';
import {emptyState} from './agent';
function fixture(){
 const db=new DatabaseSync(':memory:');db.exec(SESSION_SCHEMA);let fail=false;
 const storage={sql:{exec:(sql:string,...values:unknown[])=>{if(fail&&sql.startsWith('UPDATE messages SET content=?,candidates_json='))throw Error('final unavailable');return {toArray:()=>db.prepare(sql).all(...values as never[])};}},transactionSync:<T>(fn:()=>T)=>{db.exec('BEGIN');try{const result=fn();db.exec('COMMIT');return result;}catch(e){db.exec('ROLLBACK');throw e;}}};
 db.prepare('INSERT INTO sessions(id,owner,title,character_json,character_name,settings_json,book_ids_json,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?)').run('s','owner','t','{}','岚','{}','[]',1,1);db.prepare('INSERT INTO session_meta(id) VALUES(?)').run('s');
 const store=new SessionStore(storage as unknown as DurableObjectStorage,'s'),before={...emptyState(),scene:'值班室'};
 expect(store.claim('draft',Date.now())).toBe(true);store.start('draft',undefined,{id:'draft',role:'assistant',content:'',status:'pending',ordinal:1,requestId:'request',createdAt:2},before);
 return {db,store,before,fail:()=>fail=true,repair:()=>fail=false};
}
it.each(['generating','reviewing'])('recovers private %s draft after restart without exposing it while pending or committing state',()=>{
 const f=fixture();try{f.store.saveDraft('draft','未审稿');expect(f.store.messages().at(-1)?.content).toBe('');expect(f.store.findRequest('request')?.content).toBe('');
 const restarted=new SessionStore(f.store.storage,'s');restarted.recover();expect(restarted.messages().at(-1)).toMatchObject({content:'未审稿',status:'aborted',finishReason:'interrupted',candidates:[]});expect(restarted.snapshot('draft')?.after_json).toBeNull();expect(restarted.state()).toEqual(emptyState());expect(f.db.prepare('SELECT * FROM generation_drafts').all()).toEqual([]);
 }finally{f.db.close();}
});
it('recovers a stopped private draft after a failed final transaction and preserves the stop reason',()=>{
 const f=fixture();try{f.store.saveDraft('draft','完整未审稿');f.store.stop('draft');f.fail();expect(()=>f.store.finish('draft','完整未审稿','aborted','stopped',[],f.before)).toThrow();expect(f.db.prepare('SELECT content FROM generation_drafts').get()?.content).toBe('完整未审稿');f.repair();f.store.recover('draft');expect(f.store.messages().at(-1)).toMatchObject({content:'完整未审稿',status:'aborted',finishReason:'stopped'});expect(f.store.snapshot('draft')?.after_json).toBeNull();
 }finally{f.db.close();}
});
it('atomically publishes reviewed state and deletes its private checkpoint',()=>{
 const f=fixture();try{f.store.saveDraft('draft','正文');f.store.finish('draft','正文','completed','stop',[],f.before);expect(f.store.state()).toEqual(f.before);expect(f.store.messages().at(-1)).toMatchObject({content:'正文',status:'completed'});expect(f.db.prepare('SELECT * FROM generation_drafts').all()).toEqual([]);f.store.recover();expect(f.store.messages().at(-1)?.status).toBe('completed');
 }finally{f.db.close();}
});

it.each(['正文。<think>秘密',('货单已逐项核对，仍有一处交接签名需要补全。'.repeat(5))+'\n\n'+('货单已逐项核对，仍有一处交接签名需要补全。'.repeat(5))])('preserves the actual partial checkpoint after restart: %s',content=>{
 const f=fixture();try{f.store.saveDraft('draft',content);new SessionStore(f.store.storage,'s').recover();expect(f.store.messages().at(-1)).toMatchObject({content,status:'aborted',finishReason:'interrupted'});expect(f.store.snapshot('draft')?.after_json).toBeNull();expect(f.db.prepare('SELECT * FROM generation_drafts').all()).toEqual([]);}finally{f.db.close();}
});
