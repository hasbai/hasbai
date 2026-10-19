import {it,expect,vi,beforeEach,afterEach} from 'vitest';
import {DatabaseSync} from 'node:sqlite';
import {readFileSync,readdirSync} from 'node:fs';
import {TavernSession,sessionName} from './session-object';
import {SessionStore,SESSION_SCHEMA} from './session-store';
import {ConversationContext} from './context';
import {DEFAULT_SETTINGS} from '../shared/types';
vi.mock('cloudflare:workers',()=>({DurableObject:class{constructor(public ctx:DurableObjectState,public env:Env){}}}));
let db:DatabaseSync,env:Env,sqlDbs:Map<string,DatabaseSync>,objects:Map<string,TavernSession>,work:Promise<unknown>[],alarms:Map<string,number>;
let intercept:((sql:string)=>Promise<void>|void)|undefined;
let deleteStorage:((name:string)=>Promise<void>)|undefined;
let readIntercept:((sql:string)=>Promise<void>|void)|undefined;
function statement(query:string,values:unknown[]=[]):D1PreparedStatement{return {bind:(...v:unknown[])=>statement(query,v),first:async()=>{await readIntercept?.(query);return db.prepare(query).get(...values as never[])??null;},all:async()=>({results:db.prepare(query).all(...values as never[])}),run:async()=>{await intercept?.(query);return {meta:{changes:Number(db.prepare(query).run(...values as never[]).changes)}};}} as D1PreparedStatement;}
function storage(name:string){let sql=sqlDbs.get(name);if(!sql){sql=new DatabaseSync(':memory:');sqlDbs.set(name,sql);}const sqlite=sql;return {sql:{exec:(query:string,...values:unknown[])=>{if(query.includes(';')){sqlite.exec(query);return {toArray:()=>[]};}return {toArray:()=>sqlite.prepare(query).all(...values as never[])};}},transactionSync:<T>(fn:()=>T)=>{sqlite.exec('BEGIN');try{const result=fn();sqlite.exec('COMMIT');return result;}catch(error){sqlite.exec('ROLLBACK');throw error;}},setAlarm:async(time:number)=>{alarms.set(name,time);},deleteAll:async()=>{await deleteStorage?.(name);for(const row of sqlite.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'").all())sqlite.exec('DROP TABLE "'+row.name+'"');alarms.delete(name);}} as unknown as DurableObjectStorage;}
function target(owner='owner',id='s'){const name=sessionName(owner,id);let object=objects.get(name);if(!object){object=new TavernSession({storage:storage(name),waitUntil:(p:Promise<unknown>)=>work.push(p)} as unknown as DurableObjectState,env);objects.set(name,object);}return object;}
async function invoke(method:Parameters<TavernSession['invoke']>[2],data:Record<string,unknown>={},owner='owner',id='s'){return JSON.parse(await target(owner,id).invoke(owner,id,method,data));}
function seed(id='s',owner='owner'){db.prepare('INSERT INTO sessions(id,owner,title,character_json,character_name,settings_json,created_at,updated_at,summary_json) VALUES(?,?,?,?,?,?,?,?,?)').run(id,owner,'旅店',JSON.stringify({name:'岚',first_mes:'你好'}),'岚',JSON.stringify(DEFAULT_SETTINGS),1,2,'historical-checkpoint');db.prepare("INSERT INTO messages(id,session_id,role,content,status,ordinal,created_at,finish_reason,candidates_json) VALUES(?,?,'assistant','旧正文','completed',0,3,'stop',?)").run('m-'+id,id,'["问问往事。"]');}
beforeEach(()=>{db=new DatabaseSync(':memory:');for(const name of readdirSync(new URL('../migrations/',import.meta.url)).filter(n=>n.endsWith('.sql')).sort())db.exec(readFileSync(new URL('../migrations/'+name,import.meta.url),'utf8'));sqlDbs=new Map();objects=new Map();work=[];alarms=new Map();intercept=undefined;deleteStorage=undefined;env={PROMPTS:{get:async()=>null},DB:{prepare:statement,batch:async(stmts:D1PreparedStatement[])=>{db.exec('BEGIN');try{const result=[];for(const stmt of stmts)result.push(await stmt.run());db.exec('COMMIT');return result;}catch(error){db.exec('ROLLBACK');throw error;}}},SESSIONS:{getByName:(name:string)=>{const [owner,id]=JSON.parse(name);return target(owner,id);}}} as unknown as Env;});
afterEach(async()=>{await Promise.allSettled(work);db.close();for(const sqlite of sqlDbs.values())sqlite.close();});
it('imports once, fences every legacy write, retains source IDs and all version metadata',async()=>{
 seed();const old=db.prepare('SELECT * FROM messages').all();const first=await invoke('read');expect(first.ok).toBe(true);expect(first.value.messages[0]).toMatchObject({id:'m-s',content:'旧正文',finishReason:'stop',candidates:['问问往事。']});
 expect(db.prepare('UPDATE sessions SET generation_id=? WHERE id=? AND (generation_id IS NULL OR generation_until<=?)').run('legacy','s',Date.now()).changes).toBe(0);
 expect(db.prepare("INSERT INTO messages(id,session_id,role,content,status,ordinal,created_at) SELECT 'late','s','assistant','late','pending',1,4 WHERE EXISTS(SELECT 1 FROM sessions WHERE id='s' AND generation_id='legacy')").run().changes).toBe(0);
 expect(db.prepare('SELECT * FROM messages').all()).toEqual(old);await invoke('read');expect(sqlDbs.get(sessionName('owner','s'))!.prepare('SELECT count(*) n FROM messages').get()?.n).toBe(1);expect(sqlDbs.get(sessionName('owner','s'))!.prepare('SELECT summary_json FROM sessions').get()?.summary_json).toBe('historical-checkpoint');
});
it('rejects an active old generation and retries a frozen but unfinished import',async()=>{
 seed();db.prepare('UPDATE sessions SET generation_id=?,generation_until=?').run('active',Date.now()+180000);expect((await invoke('read')).status).toBe(409);
 db.prepare('UPDATE sessions SET generation_until=0').run();let failed=false;intercept=sql=>{if(sql.startsWith('UPDATE messages')&&!failed){failed=true;throw new Error('temporary failure');}};
 await expect(invoke('read')).rejects.toThrow('temporary');intercept=undefined;expect(db.prepare('SELECT storage_backend FROM sessions').get()?.storage_backend).toBe('do');expect((await invoke('read')).value.messages[0].id).toBe('m-s');
});
it('recovers interrupted occupancy on a new object instance and retains completed and partial versions',async()=>{
 seed();await invoke('read');const name=sessionName('owner','s'),store=new SessionStore(storage(name),'s');store.claim('pending',Date.now());store.start('pending',undefined,{id:'pending',role:'assistant',content:'部分正文',status:'pending',ordinal:1,requestId:'r',createdAt:4});objects.delete(name);
 const result=await invoke('read');expect(result.value.messages.at(-1)).toMatchObject({id:'pending',content:'部分正文',status:'aborted',finishReason:'interrupted'});expect(result.value.session.generationId).toBeNull();
});
it('recovers a cold interrupted object when the first request deletes it',async()=>{
 seed();await invoke('read');const name=sessionName('owner','s'),store=new SessionStore(storage(name),'s');store.claim('pending',Date.now());store.start('pending',undefined,{id:'pending',role:'assistant',content:'部分正文',status:'pending',ordinal:1,requestId:'r',createdAt:4});objects.delete(name);
 expect((await invoke('remove')).ok).toBe(true);expect(sqlDbs.get(name)!.prepare("SELECT count(*) n FROM sqlite_master WHERE type='table'").get()?.n).toBe(0);expect(alarms.has(name)).toBe(false);
});
it('retries a failed initial recovery before caching the imported store',async()=>{
 seed();await invoke('read');const name=sessionName('owner','s'),store=new SessionStore(storage(name),'s');store.claim('pending',Date.now());store.start('pending',undefined,{id:'pending',role:'assistant',content:'部分正文',status:'pending',ordinal:1,requestId:'r',createdAt:4});objects.delete(name);
 const recover=vi.spyOn(SessionStore.prototype,'recover').mockImplementationOnce(()=>{throw Error('storage unavailable');});
 try{await expect(invoke('read')).rejects.toThrow('storage unavailable');const result=await invoke('read');expect(result.value.session.generationId).toBeNull();expect(result.value.messages.at(-1)).toMatchObject({status:'aborted',finishReason:'interrupted',content:'部分正文'});}finally{recover.mockRestore();}
});
it('does not let an old recovery marker clear an unrelated generation',async()=>{
 seed();await invoke('read');const store=new SessionStore(storage(sessionName('owner','s')),'s');store.claim('new',Date.now());store.start('new',undefined,{id:'new',role:'assistant',content:'活跃',status:'pending',ordinal:1,requestId:'new-r',createdAt:4});Object.assign(target(),{recoveryId:'old'});
 const result=await invoke('read');expect(result.value.session.generationId).toBe('new');expect(result.value.messages.at(-1).status).toBe('pending');expect((await invoke('remove')).status).toBe(409);
});
it('isolates both owners and sessions in independent SQLite storage',async()=>{
 seed();seed('other');expect((await invoke('read',{},'stranger')).status).toBe(404);await invoke('read');await invoke('read',{},'owner','other');await invoke('update',{title:'改变'});
 expect((await invoke('read',{},'owner','other')).value.session.title).toBe('旅店');expect(sqlDbs.get(sessionName('owner','other'))!.prepare('SELECT id FROM messages').all()).toEqual([{id:'m-other'}]);
});
function characterCard(owner='owner',id='card'){
 const card={spec:'chara_card_v2',spec_version:'2.0',data:{name:'Saki（祥子）',description:'认真回应群友，把想法说完整。',mes_example:'<START>\n{{user}}: 今天好累。\n{{char}}: 先坐一会儿吧。愿意的话，我陪你聊聊。'}};
 db.prepare('INSERT INTO characters(id,owner,name,description,creator,tags_json,card_json,format,original_key,original_filename,content_hash,created_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)').run(id,owner,card.data.name,'摘要','','[]',JSON.stringify(card),'V2','cards/'+id,'saki.json',id,1);
 return card;
}
it('explicitly refreshes an owned character snapshot without changing history, settings or state across restart',async()=>{
 seed();const card=characterCard(),before=(await invoke('read')).value;
 const refreshed=await invoke('update',{characterId:'card'});
 expect(refreshed.value).toMatchObject({title:before.session.title,character:card,characterName:card.data.name,settings:before.session.settings});
 expect(db.prepare('SELECT character_json,character_name FROM sessions').get()).toEqual({character_json:JSON.stringify(card),character_name:card.data.name});
 objects.delete(sessionName('owner','s'));const after=(await invoke('read')).value;
 expect(after.messages).toEqual(before.messages);expect(after.session.state).toEqual(before.session.state);expect(after.session.character).toEqual(card);
 await invoke('update',{title:'新标题'});expect((await invoke('read')).value.session.character).toEqual(card);
});
it('rejects foreign, missing and busy character refreshes without changing the snapshot',async()=>{
 seed();characterCard('other','foreign');characterCard();const before=(await invoke('read')).value.session.character;
 for(const characterId of ['foreign','missing',''])expect((await invoke('update',{characterId})).status).toBe(404);
 expect((await invoke('update',{characterId:'card'},'other')).status).toBe(404);
 Object.assign(target(),{active:{requestId:'r',id:'a',abort:new AbortController()}});
 expect((await invoke('update',{characterId:'card'})).status).toBe(409);
 expect((await invoke('read')).value.session.character).toEqual(before);
});
it('retries character directory synchronization from the durable snapshot after restart',async()=>{
 seed();const card=characterCard();await invoke('read');intercept=sql=>{if(sql.startsWith('UPDATE sessions SET title'))throw Error('D1 unavailable');};
 expect((await invoke('update',{characterId:'card'})).ok).toBe(true);expect(db.prepare('SELECT character_name FROM sessions').get()?.character_name).toBe('岚');
 objects.delete(sessionName('owner','s'));intercept=undefined;await target().alarm();
 expect(db.prepare('SELECT character_json,character_name FROM sessions').get()).toEqual({character_json:JSON.stringify(card),character_name:card.data.name});
});
it('deallocates all private tables and alarm, and never recreates a deleted object on stale calls',async()=>{
 seed();seed('other');await invoke('read',{},'owner','other');await invoke('remove');const name=sessionName('owner','s'),sqlite=sqlDbs.get(name)!;
 expect(sqlite.prepare("SELECT count(*) n FROM sqlite_master WHERE type='table'").get()?.n).toBe(0);expect(alarms.has(name)).toBe(false);
 expect((await invoke('read')).status).toBe(404);await expect(target().cancel('owner','s','old-uuid')).rejects.toMatchObject({status:404});await target().alarm();
 objects.delete(name);expect((await invoke('read')).status).toBe(404);expect((await invoke('remove')).ok).toBe(true);await target().alarm();
 expect(sqlite.prepare("SELECT count(*) n FROM sqlite_master WHERE type='table'").get()?.n).toBe(0);expect(alarms.has(name)).toBe(false);
 expect(db.prepare("SELECT deleted_at,book_ids_json FROM sessions WHERE id='s'").get()).toMatchObject({book_ids_json:'[]'});expect(db.prepare("SELECT deleted_at FROM sessions WHERE id='s'").get()?.deleted_at).toBeTruthy();expect(db.prepare("SELECT id FROM messages WHERE session_id='s'").get()?.id).toBe('m-s');
 expect((await invoke('read',{},'owner','other')).value.messages[0].id).toBe('m-other');
});
it('keeps cleanup intent and alarm when D1 fails, and resumes deletion after restart',async()=>{
 seed();intercept=sql=>{if(sql.startsWith('UPDATE sessions SET deleted_at'))throw Error('D1 unavailable');};await expect(invoke('remove')).rejects.toThrow('D1 unavailable');
 const name=sessionName('owner','s'),sqlite=sqlDbs.get(name)!;expect(sqlite.prepare('SELECT deleted FROM session_meta').get()?.deleted).toBe(1);expect(alarms.has(name)).toBe(true);expect(db.prepare('SELECT deleted_at FROM sessions').get()?.deleted_at).toBeNull();
 intercept=undefined;objects.delete(name);await target().alarm();expect(db.prepare('SELECT deleted_at FROM sessions').get()?.deleted_at).toBeTruthy();expect(sqlite.prepare("SELECT count(*) n FROM sqlite_master WHERE type='table'").get()?.n).toBe(0);expect(alarms.has(name)).toBe(false);
});
it('retries physical deletion after D1 commits without allowing the old source to revive',async()=>{
 seed();deleteStorage=async()=>{throw Error('storage unavailable');};await expect(invoke('remove')).rejects.toThrow('storage unavailable');
 const name=sessionName('owner','s'),sqlite=sqlDbs.get(name)!;expect(db.prepare('SELECT deleted_at FROM sessions').get()?.deleted_at).toBeTruthy();expect(alarms.has(name)).toBe(true);expect((await invoke('read')).status).toBe(404);
 objects.delete(name);expect((await invoke('read')).status).toBe(404);deleteStorage=undefined;await target().alarm();expect(sqlite.prepare("SELECT count(*) n FROM sqlite_master WHERE type='table'").get()?.n).toBe(0);expect(alarms.has(name)).toBe(false);
});
it('prevents concurrent stale mutations and alarm from creating storage after cleanup',async()=>{
 seed();await invoke('read');let release!:()=>void,entered!:()=>void;const started=new Promise<void>(r=>entered=r);deleteStorage=async()=>{entered();await new Promise<void>(r=>release=r);};
 const removal=invoke('remove');await started;expect((await invoke('update',{title:'late'})).status).toBe(404);expect((await invoke('remove')).status).toBe(409);await target().alarm();release();expect((await removal).ok).toBe(true);
 const name=sessionName('owner','s');await target().alarm();expect(alarms.has(name)).toBe(false);expect(sqlDbs.get(name)!.prepare("SELECT count(*) n FROM sqlite_master WHERE type='table'").get()?.n).toBe(0);
});
it.each(['body','capacity'])('rejects a prepared generation released after deletion: %s',async stage=>{
 seed();await invoke('read');let release!:()=>void,entered!:()=>void;const paused=new Promise<void>(r=>release=r),started=new Promise<void>(r=>entered=r),infer=vi.fn();Object.assign(env,{PROMPTS:{get:async()=>null},AI:{run:infer}});
 const data=JSON.stringify({requestId:crypto.randomUUID(),content:'准备中'});
 const input=stage==='body'?new ReadableStream<Uint8Array>({async pull(controller){entered();await paused;controller.enqueue(new TextEncoder().encode(data));controller.close();}}):data;
 if(stage==='capacity')readIntercept=async sql=>{if(sql.includes('FROM model_capabilities')){entered();await paused;}};
 try{const pending=target().fetch(new Request('https://session/generate',{method:'POST',headers:{'X-Tavern-Owner':'owner','X-Tavern-Session':'s','Content-Type':'application/json'},body:input,duplex:'half'} as RequestInit));await started;expect((await invoke('remove')).ok).toBe(true);release();expect((await pending).status).toBe(404);
 const name=sessionName('owner','s');expect(infer).not.toHaveBeenCalled();expect(alarms.has(name)).toBe(false);expect(sqlDbs.get(name)!.prepare("SELECT count(*) n FROM sqlite_master WHERE type='table'").get()?.n).toBe(0);
 }finally{release();readIntercept=undefined;}
});
it('refuses deletion during active generation even after its SQLite occupancy is released',async()=>{
 seed();await invoke('read');Object.assign(target(),{active:{requestId:'r',id:'a',abort:new AbortController()}});
 expect((await invoke('remove')).status).toBe(409);expect(db.prepare('SELECT deleted_at FROM sessions').get()?.deleted_at).toBeNull();expect(sqlDbs.get(sessionName('owner','s'))!.prepare('SELECT deleted FROM session_meta').get()?.deleted).toBe(0);
});

it('retries failed directory synchronization from its durable revision after restart',async()=>{
 seed();await invoke('read');intercept=sql=>{if(sql.startsWith('UPDATE sessions SET title'))throw new Error('D1 unavailable');};expect((await invoke('update',{title:'新标题'})).value.title).toBe('新标题');expect(db.prepare('SELECT title FROM sessions').get()?.title).toBe('旅店');
 objects.delete(sessionName('owner','s'));intercept=undefined;await target().alarm();expect(db.prepare('SELECT title FROM sessions').get()?.title).toBe('新标题');
});
it('reserves worldbook references through a failed directory sync, then releases them on detach/delete',async()=>{
 seed();db.prepare('INSERT INTO worldbooks VALUES(?,?,?,?,?,?)').run('b','owner','书','{"entries":[]}',1,1);await invoke('read');intercept=sql=>{if(sql.startsWith('UPDATE sessions SET title'))throw new Error('offline');};await invoke('update',{bookIds:['b']});
 expect(db.prepare("DELETE FROM worldbooks WHERE id='b' AND NOT EXISTS(SELECT 1 FROM sessions,json_each(book_ids_json) WHERE value='b')").run().changes).toBe(0);
 intercept=undefined;await target().alarm();await invoke('update',{bookIds:[]});expect(db.prepare("DELETE FROM worldbooks WHERE id='b' AND NOT EXISTS(SELECT 1 FROM sessions,json_each(book_ids_json) WHERE value='b')").run().changes).toBe(1);
});
it('ignores legacy transport cancellation before a generation is accepted',async()=>{
 seed();await target().cancel('owner','s','early');const store=new SessionStore(storage(sessionName('owner','s')),'s');expect(store.cancelled('early')).toBe(false);expect(store.get().generation_id).toBeNull();
});

it('lets the user stop an old in-flight generation before migration without removing its fence',async()=>{
 seed();db.prepare('UPDATE sessions SET generation_id=?,generation_until=?').run('old-active',Date.now()+180000);db.prepare("INSERT INTO messages(id,session_id,role,content,status,ordinal,created_at) VALUES('old-active','s','assistant','partial','pending',1,4)").run();expect((await invoke('stop',{generationId:'wrong'})).status).toBe(409);expect((await invoke('stop',{generationId:'old-active'})).ok).toBe(true);expect(db.prepare("SELECT status,finish_reason FROM messages WHERE id='old-active'").get()).toEqual({status:'aborted',finish_reason:'stopped'});expect(db.prepare('SELECT storage_backend,generation_id FROM sessions').get()).toEqual({storage_backend:'d1',generation_id:'old-active'});
});
it('upgrades existing SQLite storage and edits in place while retaining prior state',async()=>{
 seed();await invoke('read');const sqlite=sqlDbs.get(sessionName('owner','s'))!;sqlite.exec('DROP TABLE turn_snapshots; DROP TABLE model_projections');objects.delete(sessionName('owner','s'));await invoke('read');expect(sqlite.prepare('SELECT id FROM messages').get()?.id).toBe('m-s');expect(sqlite.prepare('SELECT count(*) n FROM turn_snapshots').get()?.n).toBe(0);
 const store=new SessionStore(storage(sessionName('owner','s')),'s'),before={scene:null,facts:{},relationships:{},inventory:{},goals:{}};store.claim('a',Date.now());store.start('a',undefined,{id:'a',role:'assistant',content:'抵达北港',status:'pending',ordinal:1,requestId:'r',createdAt:5});store.beginState('a',before);store.finish('a','抵达北港','completed','stop',[],{...before,scene:'北港'});
 sqlite.prepare("INSERT INTO messages VALUES('u','s','user','新问题','completed',2,NULL,6,NULL,NULL)").run();
 expect((await invoke('changeMessage',{action:'edit',messageId:'u',content:'改问'})).ok).toBe(true);const recovered=await invoke('read');expect(db.prepare('SELECT count(*) n FROM sessions').get()?.n).toBe(1);expect(recovered.value.session.state.scene).toBe('北港');expect(recovered.value.messages.at(-1).content).toBe('改问');
});
it('keeps prior goal snapshots and removes future goals after an in-place edit',async()=>{
 seed();await invoke('read');const store=new SessionStore(storage(sessionName('owner','s')),'s');
 const paused={task:'核对货单',actor:'character' as const,status:'paused' as const,progress:'已登记',pauseReason:'用户休息',completionEvidence:null};
 const before={scene:null,facts:{},relationships:{},inventory:{},goals:{warehouse:paused}};
 store.claim('a',Date.now());store.start('a',undefined,{id:'a',role:'assistant',content:'暂不核对。',status:'pending',ordinal:1,requestId:'r',createdAt:5},before);store.finish('a','暂不核对。','completed','stop',[],before);
 const sql=sqlDbs.get(sessionName('owner','s'))!;sql.prepare("INSERT INTO messages VALUES('u','s','user','现在恢复','completed',2,NULL,6,NULL,NULL)").run();
 const completed={...before,goals:{warehouse:{...paused,status:'completed' as const,pauseReason:null,completionEvidence:'核对完成。'}}};
 store.claim('b',Date.now());store.start('b',undefined,{id:'b',role:'assistant',content:'核对完成。',status:'pending',ordinal:3,requestId:'r2',createdAt:7},before);store.finish('b','核对完成。','completed','stop',[],completed);
 expect((await invoke('changeMessage',{action:'edit',messageId:'u',content:'继续休息'})).ok).toBe(true);const saved=await invoke('read');
 expect(saved.value.session.state.goals).toEqual(before.goals);expect(saved.value.messages.at(-1)).toMatchObject({role:'user',content:'继续休息'});expect(saved.value.messages.some((m:{content:string})=>m.content==='核对完成。')).toBe(false);
 objects.delete(sessionName('owner','s'));expect((await invoke('read')).value.session.state.goals).toEqual(before.goals);
});

it.each(['before','capacity','initialization'])('stops an explicit request before stream headers: %s',async stage=>{
 seed();await invoke('read');const requestId=crypto.randomUUID(),infer=vi.fn();Object.assign(env,{PROMPTS:{get:async()=>null},AI:{run:infer}});
 db.prepare('INSERT INTO model_capabilities VALUES(?,?,?)').run('rp',JSON.stringify({contextTokens:16384,source:'llama.cpp:n_ctx',checkedAt:Date.now(),inputRatio:1.2}),Date.now()+300000);
 let release!:()=>void,entered!:()=>void;const paused=new Promise<void>(r=>release=r),started=new Promise<void>(r=>entered=r);
 const restore=vi.spyOn(ConversationContext.prototype,'restore');
 if(stage==='capacity')readIntercept=async sql=>{if(sql.includes('FROM model_capabilities')){entered();await paused;}};
 if(stage==='initialization')restore.mockImplementationOnce(async()=>{entered();await paused;});
 try{
  if(stage==='before')expect((await invoke('stop',{requestId})).ok).toBe(true);
  const pending=target().fetch(new Request('https://session/generate',{method:'POST',headers:{'X-Tavern-Owner':'owner','X-Tavern-Session':'s','Content-Type':'application/json'},body:JSON.stringify({requestId,content:'准备中'})}));
  if(stage!=='before'){await started;expect((await invoke('stop',{requestId})).ok).toBe(true);release();}
  expect((await pending).status).toBe(409);expect(infer).not.toHaveBeenCalled();
  const result=await invoke('read');expect(result.value.session.generationId).toBeNull();expect(result.value.messages).toHaveLength(1);
  expect((await invoke('stop',{requestId})).ok).toBe(true);
 }finally{release();restore.mockRestore();readIntercept=undefined;}
});
it('validates explicit request stops and leaves a different active request running',async()=>{
 seed();await invoke('read');expect((await invoke('stop',{requestId:'invalid'})).status).toBe(400);
 const store=new SessionStore(storage(sessionName('owner','s')),'s'),requestId=crypto.randomUUID(),abort=new AbortController();
 store.claim('new',Date.now());store.start('new',undefined,{id:'new',role:'assistant',content:'进行中',status:'pending',ordinal:1,requestId,createdAt:4});Object.assign(target(),{active:{requestId,id:'new',abort}});
 expect((await invoke('stop',{requestId:crypto.randomUUID()})).ok).toBe(true);expect(abort.signal.aborted).toBe(false);expect(store.pending('new')).toBe(true);
 expect((await invoke('stop',{requestId})).ok).toBe(true);expect(abort.signal.aborted).toBe(true);expect(store.findMessage('new')).toMatchObject({status:'aborted',finish_reason:'stopped'});
});

it('honors a command request cancelled while context preparation is still pending',async()=>{
 seed();await invoke('read');let entered!:()=>void,release!:()=>void;const started=new Promise<void>(r=>entered=r),paused=new Promise<void>(r=>release=r),requestId=crypto.randomUUID();
 readIntercept=async sql=>{if(sql.includes('FROM model_capabilities')){entered();await paused;}};
 const command=invoke('command',{requestId,content:'/compress'});await started;expect((await invoke('stop',{requestId})).ok).toBe(true);release();expect((await command).status).toBe(409);readIntercept=undefined;
 const saved=await invoke('read');expect(saved.value.session.generationId).toBeNull();expect(saved.value.activities).toEqual([]);
});
