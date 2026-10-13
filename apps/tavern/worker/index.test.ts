import {it,expect,vi,beforeEach,afterEach} from 'vitest';import {DatabaseSync} from 'node:sqlite';import {readFileSync} from 'node:fs';
import worker from './index';import {TavernSession} from './session-object';import {SESSION_SCHEMA} from './session-store';
vi.mock('cloudflare:workers',()=>({DurableObject:class {constructor(public ctx:DurableObjectState,public env:Env){}}}));import {identity,AuthError} from './auth';import {DEFAULT_SETTINGS,type Message} from '../shared/types';
import { DIRECTOR_RESPONSE_FORMAT, DIRECTOR_RULE } from './director';
import { AGENT_RULE,emptyState } from './agent';
import { LoreIndex } from './lore';
import { characterCard, emptyCharacterDraft, CHARACTER_RESPONSE_FORMAT } from '../shared/character-draft';
vi.mock('./auth',async(original)=>({...await original<typeof import('./auth')>(),identity:vi.fn()}));
vi.mock('./gateway',async(original)=>({...await original<typeof import('./gateway')>(),runRoleplay:async(env:Env,username:string,requestId:string,input:Record<string,unknown>,signal:AbortSignal)=>env.AI.gateway('default').run({provider:'compat',endpoint:'chat/completions',headers:{'cf-aig-collect-log-payload':'true'},query:{...input,model:'dynamic/rp'}},{gateway:{id:'default',skipCache:true,collectLog:true,eventId:requestId,retries:{maxAttempts:1},metadata:{app:'tavern',task:'roleplay',username}},signal})}));
const card={spec:'chara_card_v2',spec_version:'2.0',data:{name:'岚',description:'港城的旅店主人',personality:'沉稳',scenario:'港城',first_mes:'你好，{{user}}。',mes_example:'',system_prompt:'',post_history_instructions:'',alternate_greetings:['欢迎'],tags:[],creator:'测试',extensions:{}}};
let db:DatabaseSync,sessionDb:DatabaseSync,env:Env,work:Promise<unknown>[],files:Map<string,Uint8Array>;type AiRun=(data:AIGatewayUniversalRequest,options?:{gateway?:UniversalGatewayOptions;signal?:AbortSignal})=>Promise<unknown>;let aiRun:ReturnType<typeof vi.fn<AiRun>>;let beforeRun:((sql:string,values:unknown[])=>void)|undefined;
function statement(sql:string,values:unknown[]=[]):D1PreparedStatement {return {bind:(...v:unknown[])=>statement(sql,v),first:async()=>db.prepare(sql).get(...values as never[])??null,all:async()=>({results:db.prepare(sql).all(...values as never[])}),run:async()=>{beforeRun?.(sql,values);const r=db.prepare(sql).run(...values as never[]);return {meta:{changes:Number(r.changes),last_row_id:Number(r.lastInsertRowid)}};}} as D1PreparedStatement;}
const ctx={waitUntil:(promise:Promise<unknown>)=>{work.push(promise);}};
async function call(path:string,method='GET',data?:unknown){return worker.fetch(new Request('https://tavern.test'+path,{method,headers:data?{'Content-Type':'application/json'}:{},body:data===undefined?undefined:JSON.stringify(data)}),env,ctx);}
beforeEach(()=>{
 beforeRun=undefined;db=new DatabaseSync(':memory:');for(const name of ['0001_schema.sql','0002_source_catalog.sql','0003_generation_outcomes.sql','0004_source_quality.sql','0005_candidates_capabilities.sql','0006_session_summary.sql','0007_session_objects.sql','0008_branch_state_seed.sql'])db.exec(readFileSync(new URL('../migrations/'+name,import.meta.url),'utf8'));sessionDb=new DatabaseSync(':memory:');sessionDb.exec(SESSION_SCHEMA);files=new Map();work=[];
 aiRun=vi.fn<AiRun>(async request=>{const last=(request.query as {messages:{content:string}[]}).messages.at(-1)!.content;const candidate=!!(request.query as {response_format?:unknown}).response_format;const synopsis=(request.query as {messages:{content:string}[]}).messages[0].content.startsWith('总结已发生剧情');return new ReadableStream({start(c){c.enqueue(new TextEncoder().encode('data: '+JSON.stringify({choices:[{delta:{reasoning_content:'private'}}]})+'\n\ndata: '+JSON.stringify({choices:[{delta:{content:candidate?JSON.stringify({choices:['去港口。','问问来路。','坐下喝茶。']}):synopsis?'旧事。':'欢迎来到港城。'}}]})+'\n\ndata: {"choices":[{"delta":{},"finish_reason":"stop"}]}\n\ndata: [DONE]\n\n'));c.close();}});});
 env=Object.assign({} as Env,{PROMPTS:{get:vi.fn(async()=>null),put:vi.fn(async()=>{})},DB:{prepare:statement,batch:async(stmts:D1PreparedStatement[])=>{const result=[];db.exec('BEGIN');try{for(const s of stmts)result.push(await s.run());db.exec('COMMIT');return result;}catch(e){db.exec('ROLLBACK');throw e;}}},FILES:{put:async(key:string,bytes:Uint8Array)=>files.set(key,bytes),get:async(key:string)=>files.has(key)?{body:new Response(Uint8Array.from(files.get(key)!)).body}:null,delete:async(keys:string|string[])=>{for(const key of Array.isArray(keys)?keys:[keys])files.delete(key);}},AI:{gateway:(id:string)=>({run:async(data:AIGatewayUniversalRequest,options?:{gateway?:UniversalGatewayOptions;signal?:AbortSignal})=>{expect(id).toBe('default');expect(data.provider).toBe('compat');expect(data.endpoint).toBe('chat/completions');expect((data.query as {model:string}).model).toBe('dynamic/rp');const result=await aiRun(data,options);return result instanceof ReadableStream?new Response(result,{headers:{'Content-Type':'text/event-stream','cf-aig-log-id':'test-log'}}):result;}})},AUTH0_DOMAIN:'auth.hasbai.xyz',AUTH0_AUDIENCE:'https://financial.hasbai.xyz/api',AIG_GATEWAY_ID:'default',CONTEXT_TOKENS:'16000',VERSION:{id:'test'},ASSETS:{fetch:async()=>new Response('assets')}});
 const objects=new Map<string,TavernSession>();
 const storage={sql:{exec:(sql:string,...values:unknown[])=>{beforeRun?.(sql,values);const stmt=sessionDb.prepare(sql);const rows=stmt.all(...values as never[]);return {toArray:()=>rows};}},transactionSync:<T>(fn:()=>T)=>{sessionDb.exec('BEGIN');try{const result=fn();sessionDb.exec('COMMIT');return result;}catch(e){sessionDb.exec('ROLLBACK');throw e;}},setAlarm:async()=>{},deleteAll:async()=>{for(const row of sessionDb.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'").all())sessionDb.exec('DROP TABLE "'+row.name+'"');}};
 Object.assign(env,{SESSIONS:{getByName:(name:string)=>{let target=objects.get(name);if(!target){target=new TavernSession({storage,waitUntil:ctx.waitUntil} as unknown as DurableObjectState,env);objects.set(name,target);}return target;}}});
 db.prepare('INSERT INTO model_capabilities(id,value_json,expires_at) VALUES(?,?,?)').run('rp',JSON.stringify({contextTokens:16384,source:'llama.cpp:n_ctx',checkedAt:Date.now(),inputRatio:1.2}),Date.now()+300000);
 vi.mocked(identity).mockResolvedValue({sub:'auth0|owner',email:'owner',username:'月石',admin:true});
});
afterEach(async()=>{await Promise.allSettled(work);db.close();sessionDb.close();vi.clearAllMocks();});
async function seed(){const c=await(await call('/api/characters','POST',card)).json() as {id:string};const s=await(await call('/api/sessions','POST',{characterId:c.id})).json() as {id:string};return {c,s};}
it('installs/imports without duplicate private rows and preserves raw exports',async()=>{const a=await(await call('/api/characters','POST',card)).json() as {id:string};const b=await(await call('/api/characters','POST',card)).json() as {id:string};expect(a.id).toBe(b.id);expect(await(await call('/api/characters/'+a.id+'/export')).json()).toEqual(card);vi.mocked(identity).mockResolvedValue({sub:'auth0|other',email:'other',username:'其他用户',admin:true});expect((await call('/api/characters/'+a.id)).status).toBe(404);});
it('denies missing JWT and cross-origin writes',async()=>{vi.mocked(identity).mockRejectedValue(new AuthError(401,'请先登录'));expect((await call('/api/settings')).status).toBe(401);vi.mocked(identity).mockResolvedValue({sub:'owner',email:'owner',username:'月石',admin:true});const r=await worker.fetch(new Request('https://tavern.test/api/settings',{method:'PUT',headers:{Origin:'https://evil.test'}}),env,ctx);expect(r.status).toBe(403);});
it('snapshots role definitions and creates selected alternate greeting',async()=>{const {c,s}=await seed();await call('/api/characters/'+c.id,'DELETE');const history=await(await call('/api/sessions/'+s.id)).json() as {session:{character:unknown};messages:{content:string}[]};expect(history.session.character).toEqual(card);expect(history.messages[0].content).toBe('你好，旅人。');});
it('persists streamed output, fixed dynamic route, no reasoning leak and idempotent replay',async()=>{const {s}=await seed(),requestId=crypto.randomUUID();const r=await call('/api/sessions/'+s.id+'/generate','POST',{requestId,content:'你好',model:'override'});expect(r.headers.get('Content-Type')).toContain('event-stream');const text=await r.text();await Promise.all(work);expect(text).toContain('欢迎来到港城。');expect(text).not.toContain('private');expect(aiRun).toHaveBeenCalledWith(expect.objectContaining({provider:'compat',endpoint:'chat/completions',query:expect.objectContaining({model:'dynamic/rp',stream:true}),headers:expect.objectContaining({'cf-aig-collect-log-payload':'true'})}),expect.objectContaining({gateway:{id:'default',skipCache:true,collectLog:true,eventId:requestId,retries:{maxAttempts:1},metadata:{app:'tavern',task:'roleplay',username:'月石'}}}));const duplicate=await call('/api/sessions/'+s.id+'/generate','POST',{requestId,content:'你好'});expect((await duplicate.json() as {replayed:boolean}).replayed).toBe(true);expect(aiRun).toHaveBeenCalledTimes(2);expect(sessionDb.prepare('SELECT generation_id FROM sessions WHERE id=?').get(s.id)?.generation_id).toBeNull();});
it('records provider cache and first body observations for body and candidate stages without changing stream events',async()=>{
 const {s}=await seed();const info=vi.spyOn(console,'info').mockImplementation(()=>{});
 aiRun.mockResolvedValueOnce(new Response('data: '+JSON.stringify({choices:[{delta:{content:'故事。\n[TAVERN_NEXT]\n去港口。\n问问来路。\n坐下喝茶。'},finish_reason:'stop'}],usage:{prompt_tokens:1000,completion_tokens:3,prompt_tokens_details:{cached_tokens:800}},timings:{cache_n:800,prompt_n:200,prompt_ms:100,predicted_ms:50}})+'\n\ndata: [DONE]\n\n',{headers:{'Content-Type':'text/event-stream'}}));
 try{const response=await call('/api/sessions/'+s.id+'/generate','POST',{requestId:crypto.randomUUID(),content:'你好'});await response.text();await Promise.all(work);
  expect(aiRun).toHaveBeenCalledTimes(2);expect(aiRun.mock.calls[0][0].query).toHaveProperty('cache_prompt',true);
  expect(info).toHaveBeenCalledWith('tavern-generation-outcome',expect.objectContaining({bodyRequests:1,candidateRequests:1,bodyMetrics:expect.objectContaining({promptTokens:1000,outputTokens:3,cachedTokens:800,prefillTokens:200,prefillMs:100,decodeMs:50}),firstBodyMs:expect.any(Number),modelFirstBodyMs:expect.any(Number),promptBudget:expect.objectContaining({detectedContextTokens:16384,includedMessages:2})}));
 }finally{info.mockRestore();}
});
it('keeps inline candidate protocol out of deltas and stored story before an independent candidate model call',async()=>{
 const {s}=await seed();const wire='灯？[TAVERN_NEXT]\n我问问往事。\n我坐下喝茶。\n我看向窗外。';
 aiRun.mockImplementation(async request=>new Response(((request.query as {response_format?:unknown}).response_format?JSON.stringify({choices:['我问问往事。','我坐下喝茶。','我看向窗外。']}):wire).split('').map(content=>'data: '+JSON.stringify({choices:[{delta:{content}}]})+'\n\n').join('')+'data: {"choices":[{"delta":{},"finish_reason":"stop"}]}\n\ndata: [DONE]\n\n',{headers:{'Content-Type':'text/event-stream'}}));
 const requestId=crypto.randomUUID(),r=await call('/api/sessions/'+s.id+'/generate','POST',{requestId,content:'继续'});const text=await r.text();await Promise.all(work);
 const frames=text.split('\n').filter(line=>line.startsWith('data: ')).map(line=>JSON.parse(line.slice(6)));expect(frames.filter(e=>e.type==='delta').map(e=>e.text).join('')).toBe('灯？');
 expect(frames.find(e=>e.type==='done').message).toMatchObject({content:'灯？',status:'completed',candidates:['我问问往事。','我坐下喝茶。','我看向窗外。']});
 expect(sessionDb.prepare("SELECT content,candidates_json FROM messages WHERE role='assistant' AND request_id=?").get(requestId)).toEqual({content:'灯？',candidates_json:JSON.stringify(['我问问往事。','我坐下喝茶。','我看向窗外。'])});expect(aiRun).toHaveBeenCalledTimes(2);
});
it('recovers a failed final transaction without a restart or repeating model inference',async()=>{
 const {s}=await seed(),requestId=crypto.randomUUID();let failed=false;
 beforeRun=sql=>{if(!failed&&sql.startsWith('UPDATE messages SET content=?,candidates_json=')){failed=true;throw Error('temporary final storage failure');}};
 const response=await call('/api/sessions/'+s.id+'/generate','POST',{requestId,content:'出发'});await response.text();await Promise.all(work);expect(failed).toBe(true);beforeRun=undefined;
 const read=await(await call('/api/sessions/'+s.id)).json() as {session:{generationId:string|null};messages:Message[]};
 expect(read.session.generationId).toBeNull();expect(read.messages.at(-1)).toMatchObject({status:'aborted',finishReason:'interrupted',content:'欢迎来到港城。'});
 expect((await(await call('/api/sessions/'+s.id+'/generate','POST',{requestId})).json() as {replayed:boolean}).replayed).toBe(true);expect(aiRun).toHaveBeenCalledTimes(2);
 expect((await call('/api/sessions/'+s.id,'DELETE')).status).toBe(200);
});
it.each(['read','delete','generate'])('recovers after storage is unavailable through settlement via %s',async action=>{
 const {s}=await seed(),requestId=crypto.randomUUID();let unavailable=false;
 beforeRun=sql=>{if(sql.startsWith('UPDATE messages SET content=?,candidates_json='))unavailable=true;if(unavailable&&sql.startsWith('UPDATE messages'))throw Error('storage unavailable');};
 const response=await call('/api/sessions/'+s.id+'/generate','POST',{requestId,content:'出发'});await response.text();await Promise.all(work);expect(unavailable).toBe(true);beforeRun=undefined;
 expect(sessionDb.prepare('SELECT generation_id FROM sessions WHERE id=?').get(s.id)?.generation_id).toBeTruthy();
 if(action==='delete'){expect((await call('/api/sessions/'+s.id,'DELETE')).status).toBe(200);return;}
 if(action==='generate'){await(await call('/api/sessions/'+s.id+'/generate','POST',{requestId:crypto.randomUUID(),content:'下一轮'})).text();await Promise.all(work);}
 const read=await(await call('/api/sessions/'+s.id)).json() as {session:{generationId:string|null};messages:Message[]};expect(read.session.generationId).toBeNull();
 expect(read.messages.find(m=>m.requestId===requestId&&m.role==='assistant')).toMatchObject({content:'欢迎来到港城。',status:'aborted',finishReason:'interrupted'});expect(sessionDb.prepare('SELECT after_json FROM turn_snapshots WHERE message_id=(SELECT id FROM messages WHERE request_id=? AND role=?)').get(requestId,'assistant')?.after_json).toBeNull();
});
it('rolls back message creation with a failed initial state snapshot and permits the same UUID retry',async()=>{
 const {s}=await seed(),requestId=crypto.randomUUID();beforeRun=sql=>{if(sql.startsWith('INSERT INTO turn_snapshots'))throw Error('snapshot failure');};
 expect((await call('/api/sessions/'+s.id+'/generate','POST',{requestId,content:'出发'})).status).toBe(500);await Promise.all(work);beforeRun=undefined;
 expect(sessionDb.prepare('SELECT count(*) n FROM messages WHERE request_id=?').get(requestId)?.n).toBe(0);expect(sessionDb.prepare('SELECT generation_id FROM sessions WHERE id=?').get(s.id)?.generation_id).toBeNull();expect(aiRun).not.toHaveBeenCalled();
 const wire=await(await call('/api/sessions/'+s.id+'/generate','POST',{requestId,content:'出发'})).text();await Promise.all(work);expect(wire).toContain('"status":"completed"');expect(sessionDb.prepare('SELECT count(*) n FROM messages WHERE request_id=?').get(requestId)?.n).toBe(2);
});
it('retains a persisted stop reason when the final transaction fails',async()=>{
 const {s}=await seed();aiRun.mockResolvedValueOnce(completion('正文。')).mockImplementationOnce(async()=>new ReadableStream());
 const response=await call('/api/sessions/'+s.id+'/generate','POST',{requestId:crypto.randomUUID(),content:'出发'}),drain=response.text();await vi.waitFor(()=>expect(aiRun).toHaveBeenCalledTimes(2));const id=sessionDb.prepare('SELECT generation_id FROM sessions WHERE id=?').get(s.id)?.generation_id as string;
 let failed=false;beforeRun=sql=>{if(!failed&&sql.startsWith('UPDATE messages SET content=?,candidates_json=')){failed=true;throw Error('final unavailable');}};
 expect((await call('/api/sessions/'+s.id+'/stop','POST',{generationId:id})).status).toBe(200);await drain;await Promise.all(work);expect(failed).toBe(true);beforeRun=undefined;
 const read=await(await call('/api/sessions/'+s.id)).json() as {session:{generationId:string|null};messages:Message[]};expect(read.session.generationId).toBeNull();expect(read.messages.at(-1)).toMatchObject({content:'正文。',status:'aborted',finishReason:'stopped'});
});
it('keeps user messages on model failure and never auto-retries',async()=>{const {s}=await seed();aiRun.mockRejectedValue(new Error('secret upstream error'));const r=await call('/api/sessions/'+s.id+'/generate','POST',{requestId:crypto.randomUUID(),content:'留下这句'});const text=await r.text();await Promise.all(work);expect(text).toContain('生成失败，请重试');expect(text).not.toContain('secret');expect(sessionDb.prepare("SELECT content FROM messages WHERE role='user'").get()?.content).toBe('留下这句');expect(sessionDb.prepare("SELECT status FROM messages WHERE role='assistant' AND request_id IS NOT NULL").get()?.status).toBe('error');});
it('aborts a stopped generation and refuses stale stop or concurrent send',async()=>{const {s}=await seed();let controller:ReadableStreamDefaultController<Uint8Array>;aiRun.mockResolvedValue(new ReadableStream({start(c){controller=c;}}));
 const response=await call('/api/sessions/'+s.id+'/generate','POST',{requestId:crypto.randomUUID(),content:'出发'});const reader=response.body!.getReader();await reader.read();const generationId=sessionDb.prepare('SELECT generation_id FROM sessions WHERE id=?').get(s.id)?.generation_id;
 expect((await call('/api/sessions/'+s.id+'/generate','POST',{requestId:crypto.randomUUID(),content:'重复'})).status).toBe(409);
 expect((await call('/api/sessions/'+s.id+'/stop','POST',{generationId:'wrong'})).status).toBe(409);
 expect((await call('/api/sessions/'+s.id+'/stop','POST',{generationId})).status).toBe(200);
 while(!(await reader.read()).done){}await Promise.all(work);expect(sessionDb.prepare("SELECT status FROM messages WHERE id=?").get(generationId as string)?.status).toBe('aborted');
});
it('forks edited history without changing original messages',async()=>{const {s}=await seed();const data=await(await call('/api/sessions/'+s.id)).json() as {messages:{id:string}[]};const fork=await(await call('/api/sessions/'+s.id+'/fork','POST',{messageId:data.messages[0].id,content:'新的开场'})).json() as {id:string};expect(sessionDb.prepare('SELECT content FROM messages WHERE session_id=?').get(s.id)?.content).toBe('你好，旅人。');expect(sessionDb.prepare('SELECT content FROM messages WHERE session_id=?').get(fork.id)?.content).toBe('新的开场');});
it('validates worldbook ownership, settings and malformed imported files',async()=>{const {s}=await seed();expect((await call('/api/sessions/'+s.id,'PATCH',{bookIds:['missing']})).status).toBe(400);expect((await call('/api/settings','PUT',{...DEFAULT_SETTINGS,temperature:999999})).status).toBe(400);expect((await call('/api/worldbooks','POST',{raw:{name:'bad'}})).status).toBe(400);expect((await call('/api/characters','POST',{fake:true})).status).toBe(400);});
it('searches actual synchronized catalog rows and installs from server definitions',async()=>{const revision='a'.repeat(40);db.prepare('INSERT INTO source_catalog VALUES(?,?,?,?,?,?,?,?,?)').run('theatrelm',revision,'0','岚','旅店主人','G-reen','[]','https://huggingface.co/source',JSON.stringify(card));db.prepare('INSERT INTO source_releases VALUES(?,?,?,?)').run('theatrelm',revision,1,Date.now());const r=await(await call('/api/discover?source=theatrelm&q=岚')).json() as {results:{id:string}[]};expect(r.results[0].id).toBe(revision+':0');const installed=await(await call('/api/install','POST',{source:'theatrelm',id:r.results[0].id,card:{name:'fake'}})).json() as {name:string};expect(installed.name).toBe('岚');expect((await call('/api/install','POST',{source:'theatrelm',id:'../escape'})).status).toBe(400);});

it('refuses deletion of a book bound to sessions and allows explicit detachment',async()=>{const {s}=await seed();const b=await(await call('/api/worldbooks','POST',{raw:{name:'港',entries:[]}})).json() as {id:string};await call('/api/sessions/'+s.id,'PATCH',{bookIds:[b.id]});expect((await call('/api/worldbooks/'+b.id,'DELETE')).status).toBe(409);await call('/api/sessions/'+s.id,'PATCH',{bookIds:[]});expect((await call('/api/worldbooks/'+b.id,'DELETE')).status).toBe(200);});

it('reads history only after claiming generation when a previous turn finishes concurrently',async()=>{
 const {s}=await seed();beforeRun=(sql)=>{if(!sql.startsWith('UPDATE sessions SET generation_id=?'))return;beforeRun=undefined;
  sessionDb.prepare("INSERT INTO messages(id,session_id,role,content,status,ordinal,created_at) VALUES(?,?,'user','previous turn','completed',1,?)").run(crypto.randomUUID(),s.id,Date.now());
  sessionDb.prepare("INSERT INTO messages(id,session_id,role,content,status,ordinal,created_at) VALUES(?,?,'assistant','previous answer','completed',2,?)").run(crypto.randomUUID(),s.id,Date.now());
 };
 const response=await call('/api/sessions/'+s.id+'/generate','POST',{requestId:crypto.randomUUID(),content:'next turn'});await response.text();await Promise.all(work);
 const args=aiRun.mock.calls[0][0].query as {messages:{content:string}[]};expect(args.messages.some(m=>m.content==='previous answer')).toBe(true);expect(sessionDb.prepare("SELECT ordinal FROM messages WHERE content='next turn'").get()?.ordinal).toBe(3);
});
it('atomically refuses a book deletion when binding races with it',async()=>{
 const {s}=await seed();const b=await(await call('/api/worldbooks','POST',{raw:{name:'race',entries:[]}})).json() as {id:string};
 beforeRun=sql=>{if(!sql.startsWith('DELETE FROM worldbooks'))return;beforeRun=undefined;db.prepare('UPDATE sessions SET book_ids_json=? WHERE id=?').run(JSON.stringify([b.id]),s.id);};
 expect((await call('/api/worldbooks/'+b.id,'DELETE')).status).toBe(409);expect(db.prepare('SELECT id FROM worldbooks WHERE id=?').get(b.id)).toBeTruthy();
});
it('atomically refuses binding a book deleted after its ownership check',async()=>{
 const {s}=await seed();const b=await(await call('/api/worldbooks','POST',{raw:{name:'race',entries:[]}})).json() as {id:string};
 beforeRun=sql=>{if(!sql.startsWith('UPDATE sessions SET book_ids_json'))return;beforeRun=undefined;db.prepare('DELETE FROM worldbooks WHERE id=?').run(b.id);};
 expect((await call('/api/sessions/'+s.id,'PATCH',{bookIds:[b.id]})).status).toBe(409);expect(sessionDb.prepare('SELECT book_ids_json FROM sessions WHERE id=?').get(s.id)?.book_ids_json).toBe('[]');
});

it('rejects a fork if its book disappears after the DO snapshot',async()=>{
 const {s}=await seed();const b=await(await call('/api/worldbooks','POST',{raw:{name:'race',entries:[]}})).json() as {id:string};await call('/api/sessions/'+s.id,'PATCH',{bookIds:[b.id]});const m=sessionDb.prepare('SELECT id FROM messages WHERE session_id=?').get(s.id)!;
 beforeRun=sql=>{if(!sql.startsWith('INSERT INTO sessions'))return;beforeRun=undefined;sessionDb.prepare('UPDATE sessions SET book_ids_json=? WHERE id=?').run('[]',s.id);db.prepare('DELETE FROM worldbooks WHERE id=?').run(b.id);};
 const r=await call('/api/sessions/'+s.id+'/fork','POST',{messageId:m.id,content:'fork'});expect(r.status).toBe(409);
});
it('returns conflict when generation claims a session before deletion',async()=>{
 const {s}=await seed();beforeRun=sql=>{if(!sql.startsWith('SELECT * FROM sessions'))return;beforeRun=undefined;sessionDb.prepare('UPDATE sessions SET generation_id=?,generation_until=? WHERE id=?').run(crypto.randomUUID(),Date.now()+60000,s.id);};
 expect((await call('/api/sessions/'+s.id,'DELETE')).status).toBe(409);expect(sessionDb.prepare('SELECT id FROM sessions WHERE id=?').get(s.id)).toBeTruthy();
});

it('cancels idle upstream when the response reader disconnects and releases the lock',async()=>{
 const {s}=await seed(),cancel=vi.fn();aiRun.mockImplementation(async()=>new ReadableStream({cancel}));
 const response=await call('/api/sessions/'+s.id+'/generate','POST',{requestId:crypto.randomUUID(),content:'idle'});const reader=response.body!.getReader();await reader.read();await vi.waitFor(()=>expect(aiRun).toHaveBeenCalled());await reader.cancel();await Promise.all(work);
 expect(cancel).toHaveBeenCalled();expect(sessionDb.prepare('SELECT generation_id FROM sessions WHERE id=?').get(s.id)?.generation_id).toBeNull();expect(sessionDb.prepare("SELECT status FROM messages WHERE request_id IS NOT NULL AND role='assistant'").get()?.status).toBe('aborted');
});
it.each(['start','delta','candidates_pending'])('settles stop during %s backpressure without waiting for the response reader',async phase=>{
 const {s}=await seed(),requestId=crypto.randomUUID(),writes=vi.spyOn(WritableStreamDefaultWriter.prototype,'write');
 const target=(env.SESSIONS as unknown as {getByName(name:string):TavernSession}).getByName(JSON.stringify(['auth0|owner',s.id]));
 const response=await target.fetch(new Request('https://session/generate',{method:'POST',headers:{'X-Tavern-Owner':'auth0|owner','X-Tavern-Session':s.id,'X-Tavern-Username':encodeURIComponent('月石'),'Content-Type':'application/json'},body:JSON.stringify({requestId,content:'你好'})})),reader=response.body!.getReader();
 try{
  if(phase!=='start')await reader.read();
  if(phase==='candidates_pending')await reader.read();
  await vi.waitFor(()=>expect(writes.mock.calls.some(([chunk])=>new TextDecoder().decode(chunk as Uint8Array).includes('\"type\":\"'+phase+'\"'))).toBe(true));
  const id=sessionDb.prepare('SELECT generation_id FROM sessions WHERE id=?').get(s.id)?.generation_id as string;
  expect((await call('/api/sessions/'+s.id+'/stop','POST',{generationId:id})).status).toBe(200);
  await vi.waitFor(()=>expect(sessionDb.prepare('SELECT generation_id FROM sessions WHERE id=?').get(s.id)?.generation_id).toBeNull(),{timeout:200});
  await Promise.all(work);let wire='';for(;;){const next=await reader.read();if(next.done)break;wire+=new TextDecoder().decode(next.value);}
  expect(wire).toContain('"type":"done"');expect(wire).toContain('"status":"aborted"');expect(wire).toContain('"finishReason":"stopped"');expect(sessionDb.prepare('SELECT content FROM messages WHERE id=?').get(id)?.content).toBe(phase==='start'?'':'欢迎来到港城。');expect(sessionDb.prepare('SELECT after_json FROM turn_snapshots WHERE message_id=?').get(id)?.after_json).toBeNull();
  expect((await(await call('/api/sessions/'+s.id+'/generate','POST',{requestId})).json() as {replayed:boolean}).replayed).toBe(true);
  expect((await call('/api/sessions/'+s.id,'DELETE')).status).toBe(200);
 }finally{await reader.cancel();await Promise.allSettled(work);writes.mockRestore();}
});
it.each(['completed','disconnected'])('settles %s transport without a terminal reader',async outcome=>{
 const {s}=await seed(),requestId=crypto.randomUUID(),abort=new AbortController(),writes=vi.spyOn(WritableStreamDefaultWriter.prototype,'write');
 const target=(env.SESSIONS as unknown as {getByName(name:string):TavernSession}).getByName(JSON.stringify(['auth0|owner',s.id]));
 const response=await target.fetch(new Request('https://session/generate',{method:'POST',signal:abort.signal,headers:{'X-Tavern-Owner':'auth0|owner','X-Tavern-Session':s.id,'Content-Type':'application/json'},body:JSON.stringify({requestId,content:'你好'})})),reader=response.body!.getReader();
 try{
  await reader.read();
  if(outcome==='completed'){await reader.read();await reader.read();}else{await vi.waitFor(()=>expect(writes.mock.calls.some(([chunk])=>new TextDecoder().decode(chunk as Uint8Array).includes('"type":"delta"'))).toBe(true));abort.abort();}
  await vi.waitFor(()=>expect(sessionDb.prepare('SELECT generation_id FROM sessions WHERE id=?').get(s.id)?.generation_id).toBeNull(),{timeout:200});await Promise.all(work);
  let wire='';for(;;){const next=await reader.read();if(next.done)break;wire+=new TextDecoder().decode(next.value);}
  const saved=sessionDb.prepare("SELECT status,finish_reason,content FROM messages WHERE request_id=? AND role='assistant'").get(requestId);
  expect(saved).toMatchObject({status:outcome==='completed'?'completed':'aborted',finish_reason:outcome==='completed'?'stop':'disconnected',content:'欢迎来到港城。'});
  if(outcome==='completed')expect(wire).toContain('"type":"done"');else expect(wire).not.toContain('"type":"done"');
  expect((await call('/api/sessions/'+s.id,'DELETE')).status).toBe(200);
 }finally{await reader.cancel();await Promise.allSettled(work);writes.mockRestore();}
});
it('stops an idle upstream without waiting for another model chunk',async()=>{
 const {s}=await seed(),cancel=vi.fn();aiRun.mockImplementation(async()=>new ReadableStream({cancel}));
 const response=await call('/api/sessions/'+s.id+'/generate','POST',{requestId:crypto.randomUUID(),content:'idle'});const reader=response.body!.getReader();await reader.read();await vi.waitFor(()=>expect(aiRun).toHaveBeenCalled());const generationId=sessionDb.prepare('SELECT generation_id FROM sessions WHERE id=?').get(s.id)?.generation_id;
 expect((await call('/api/sessions/'+s.id+'/stop','POST',{generationId})).status).toBe(200);while(!(await reader.read()).done){}await Promise.all(work);expect(cancel).toHaveBeenCalled();expect(sessionDb.prepare('SELECT generation_id FROM sessions WHERE id=?').get(s.id)?.generation_id).toBeNull();
});

it('rejects non-stream model output and releases the generation lock without retrying',async()=>{
 const {s}=await seed();aiRun.mockResolvedValue({response:'unexpected non-stream'});const r=await call('/api/sessions/'+s.id+'/generate','POST',{requestId:crypto.randomUUID(),content:'stream required'});const text=await r.text();await Promise.all(work);expect(text).toContain('模型返回了不支持的结束类型');expect(aiRun).toHaveBeenCalledTimes(1);expect(sessionDb.prepare('SELECT generation_id FROM sessions WHERE id=?').get(s.id)?.generation_id).toBeNull();expect(sessionDb.prepare("SELECT status FROM messages WHERE request_id IS NOT NULL AND role='assistant'").get()?.status).toBe('error');
});

it.each([['content_filter','content_filter'],['tool_calls','unsupported'],['unknown','unsupported'],[null,'interrupted']])('persists incomplete finish %s with visible reason %s',async(finish,reason)=>{
 const {s}=await seed();aiRun.mockResolvedValue(new ReadableStream({start(c){c.enqueue(new TextEncoder().encode('data: '+JSON.stringify({choices:[{delta:{content:'半句'},finish_reason:finish}]})+'\n\ndata: [DONE]\n\n'));c.close();}}));
 const response=await call('/api/sessions/'+s.id+'/generate','POST',{requestId:crypto.randomUUID(),content:'你是谁'});const stream=await response.text();await Promise.all(work);expect(stream).toContain('"type":"error"');
 const saved=await(await call('/api/sessions/'+s.id)).json() as {messages:{status:string;content:string;finishReason:string}[]};expect(saved.messages.at(-1)).toMatchObject({content:'半句',status:'error',finishReason:reason});expect(aiRun).toHaveBeenCalledTimes(1);
});
it('continues saved partial text as a new version without duplicating the user turn',async()=>{
 const {s}=await seed();aiRun.mockResolvedValueOnce(new ReadableStream({start(c){c.enqueue(new TextEncoder().encode('data: {"choices":[{"delta":{"content":"她抬起头，"},"finish_reason":"content_filter"}]}\n\ndata: [DONE]\n\n'));c.close();}}));
 await(await call('/api/sessions/'+s.id+'/generate','POST',{requestId:crypto.randomUUID(),content:'问候'})).text();await Promise.all(work);
 await(await call('/api/sessions/'+s.id+'/generate','POST',{requestId:crypto.randomUUID(),continue:true})).text();await Promise.all(work);
 const saved=await(await call('/api/sessions/'+s.id)).json() as {messages:{content:string;status:string;finishReason:string}[]};expect(saved.messages.at(-1)).toMatchObject({content:'她抬起头，欢迎来到港城。',status:'completed',finishReason:'stop'});expect(sessionDb.prepare("SELECT count(*) AS n FROM messages WHERE role='user'").get()?.n).toBe(1);expect(sessionDb.prepare("SELECT count(*) AS n FROM messages WHERE role='assistant' AND ordinal=2").get()?.n).toBe(2);
 const args=aiRun.mock.calls[1][0].query as {messages:{content:string}[]};expect(args.messages.some(m=>m.content==='她抬起头，')).toBe(true);
});
it('exposes failed regeneration even when a previous completed version exists',async()=>{
 const {s}=await seed();await(await call('/api/sessions/'+s.id+'/generate','POST',{requestId:crypto.randomUUID(),content:'你好'})).text();await Promise.all(work);aiRun.mockRejectedValue(new Error('private'));
 await(await call('/api/sessions/'+s.id+'/generate','POST',{requestId:crypto.randomUUID(),regenerate:true})).text();await Promise.all(work);
 const saved=await(await call('/api/sessions/'+s.id)).json() as {messages:{status:string;finishReason:string}[]};expect(saved.messages.at(-1)).toMatchObject({status:'error',finishReason:'upstream'});
});
it('renews a slow generation beyond the old deadline until the user stops',async()=>{
 vi.useFakeTimers();try{const {s}=await seed();aiRun.mockImplementation(async()=>new ReadableStream());const r=await call('/api/sessions/'+s.id+'/generate','POST',{requestId:crypto.randomUUID(),content:'slow'});const reader=r.body!.getReader();await reader.read();const tail=(async()=>{while(!(await reader.read()).done){}})();await vi.advanceTimersByTimeAsync(240000);const state=sessionDb.prepare('SELECT generation_id,generation_until FROM sessions WHERE id=?').get(s.id)!;expect(state.generation_until).toBeGreaterThan(Date.now());expect(sessionDb.prepare("SELECT status FROM messages WHERE id=?").get(state.generation_id as string)?.status).toBe('pending');await call('/api/sessions/'+s.id+'/stop','POST',{generationId:state.generation_id});await vi.advanceTimersByTimeAsync(1000);await tail;await Promise.all(work);expect(sessionDb.prepare("SELECT status,finish_reason FROM messages WHERE request_id IS NOT NULL AND role='assistant'").get()).toMatchObject({status:'aborted',finish_reason:'stopped'});}finally{vi.useRealTimers();}
});
it('filters malformed public names and rejects their direct installation',async()=>{
 const revision='b'.repeat(40);db.prepare('INSERT INTO source_catalog VALUES(?,?,?,?,?,?,?,?,?)').run('theatrelm',revision,'2921','x'.repeat(459),'bad','G-reen','[]','https://huggingface.co/source',JSON.stringify(card));db.prepare('INSERT INTO source_releases VALUES(?,?,?,?)').run('theatrelm',revision,1,Date.now());const r=await(await call('/api/discover?source=theatrelm')).json() as {results:unknown[];total:number};expect(r.results).toEqual([]);expect(r.total).toBe(0);expect((await call('/api/install','POST',{source:'theatrelm',id:revision+':2921'})).status).toBe(422);
});
it('passes supported ranking and tag filters to Chub and validates pagination',async()=>{
 const fetcher=vi.fn(async(_url:RequestInfo|URL)=>Response.json({data:{count:30,nodes:[{fullPath:'author/role',name:'Role',tagline:'Story',topics:['Fantasy'],starCount:42,createdAt:'2026-10-01T00:00:00Z'}]}}));vi.stubGlobal('fetch',fetcher);try{
 for(const [sort,upstream]of[['popular','star_count'],['newest','created_at'],['updated','last_activity_at'],['trending','trending']]){const r=await(await call('/api/discover?source=chub&sort='+sort+'&tags=Fantasy,OC&page=2')).json() as {hasMore:boolean;total:number;results:{popularity:number}[]};expect(r.hasMore).toBe(true);expect(r.total).toBe(30);expect(r.results[0].popularity).toBe(42);const u=new URL(String(fetcher.mock.calls.at(-1)![0]));expect(u.searchParams.get('sort')).toBe(upstream);expect(u.searchParams.get('topics')).toBe('Fantasy,OC');expect(u.searchParams.get('page')).toBe('2');}
 expect((await call('/api/discover?sort=invalid')).status).toBe(400);expect((await call('/api/discover?source=theatrelm&sort=newest')).status).toBe(400);
 }finally{vi.unstubAllGlobals();}
});

it('uses the authenticated account name for every generation mode, ignoring client attribution and persona',async()=>{
 const {s}=await seed();
 for(const regenerate of [false,true]){
  const requestId=crypto.randomUUID();
  const response=await call('/api/sessions/'+s.id+'/generate','POST',{requestId,content:'你好',regenerate,username:'伪造',metadata:{app:'fake',task:'fake',username:'fake'}});
  expect(response.status).toBe(200);await response.text();await Promise.all(work);
  expect(aiRun.mock.calls.at(-1)?.[1]).toEqual(expect.objectContaining({gateway:expect.objectContaining({collectLog:true,eventId:requestId,retries:{maxAttempts:1},metadata:{app:'tavern',task:'roleplay',username:'月石'}})}));
 }
});
it('refuses generation before acquiring a lock when the authenticated name cannot be resolved',async()=>{
 const {s}=await seed();vi.mocked(identity).mockResolvedValue({sub:'auth0|owner',email:'owner',username:undefined,admin:true});
 const response=await call('/api/sessions/'+s.id+'/generate','POST',{requestId:crypto.randomUUID(),content:'你好',username:'伪造'});
 expect(response.status).toBe(401);expect(aiRun).not.toHaveBeenCalled();expect(sessionDb.prepare('SELECT generation_id FROM sessions WHERE id=?').get(s.id)?.generation_id).toBeNull();
});

it.each([{status:502,reason:'upstream'},{status:200,reason:'unsupported'}])('classifies raw Gateway $status failures and preserves their log ID without exposing bodies',async({status,reason})=>{
 const {s}=await seed(),requestId=crypto.randomUUID(),info=vi.spyOn(console,'info');
 let cancelled=false;const stream=new ReadableStream({start(c){c.enqueue(new TextEncoder().encode('private provider failure'));},cancel(){cancelled=true;}});
 aiRun.mockResolvedValue(new Response(stream,{status,headers:{'Content-Type':'application/json','cf-aig-log-id':'failed-gateway-log'}}));
 const response=await call('/api/sessions/'+s.id+'/generate','POST',{requestId,content:'你好'});
 const text=await response.text();await Promise.all(work);expect(text).not.toContain('private provider failure');expect(aiRun).toHaveBeenCalledTimes(1);expect(cancelled).toBe(true);
 expect(sessionDb.prepare('SELECT generation_id FROM sessions WHERE id=?').get(s.id)?.generation_id).toBeNull();
 expect(sessionDb.prepare("SELECT finish_reason FROM messages WHERE request_id=? AND role='assistant'").get(requestId)?.finish_reason).toBe(reason);
 expect(info).toHaveBeenCalledWith('tavern-generation-outcome',expect.objectContaining({gatewayLogId:'failed-gateway-log',requestId,finishReason:reason}));info.mockRestore();
});

it('normalizes legacy session/settings JSON and rejects unknown logical model before inference',async()=>{
 const {s}=await seed();const old={userName:'旧名',persona:'旧设定',systemPrompt:'旧提示',temperature:0.3,maxTokens:2048};
 sessionDb.prepare('UPDATE sessions SET settings_json=? WHERE id=?').run(JSON.stringify(old),s.id);
 const session=await(await call('/api/sessions/'+s.id)).json() as {session:{settings:typeof DEFAULT_SETTINGS}};expect(session.session.settings).toEqual({...DEFAULT_SETTINGS,userName:old.userName,persona:old.persona,systemPrompt:old.systemPrompt,temperature:old.temperature});
 expect((await call('/api/settings','PUT',{...DEFAULT_SETTINGS,modelId:'dynamic/saki'})).status).toBe(400);
 await(await call('/api/sessions/'+s.id+'/generate','POST',{requestId:crypto.randomUUID(),content:'出发'})).text();await Promise.all(work);
 expect(aiRun.mock.calls[0][0].query).toMatchObject({temperature:0.3,top_p:1,chat_template_kwargs:{enable_thinking:false},frequency_penalty:0,presence_penalty:0});expect(aiRun.mock.calls[0][0].query).not.toHaveProperty('top_k');expect(aiRun.mock.calls[0][0].query).not.toHaveProperty('max_tokens');
});
it('preserves session effort and the Director template with a best-effort auxiliary budget',async()=>{
 const {s}=await seed(),path='/api/sessions/'+s.id;
 const saved={...DEFAULT_SETTINGS,thinkingEnabled:true,reasoningEffort:'high'};
 expect((await call(path,'PATCH',{settings:saved})).status).toBe(200);
 const read=await(await call(path)).json() as {session:{settings:typeof DEFAULT_SETTINGS}};
 expect(read.session.settings).toMatchObject({thinkingEnabled:true,reasoningEffort:'high'});
 await(await call(path+'/generate','POST',{requestId:crypto.randomUUID(),content:'你好'})).text();await Promise.all(work);
 expect(aiRun.mock.calls[0][0].query).toMatchObject({chat_template_kwargs:{enable_thinking:true},reasoning_effort:'high'});
 expect(aiRun.mock.calls[1][0].query).toMatchObject({chat_template_kwargs:{enable_thinking:true},reasoning_effort:'high',thinking_budget_tokens:0});expect(aiRun.mock.calls[0][0].query).not.toHaveProperty('thinking_budget_tokens');
 expect((await call(path,'PATCH',{settings:{...saved,thinkingEnabled:false}})).status).toBe(200);
 const disabled=await(await call(path)).json() as {session:{settings:typeof DEFAULT_SETTINGS}};
 expect(disabled.session.settings).toMatchObject({thinkingEnabled:false,reasoningEffort:'high'});
 expect((await call(path,'PATCH',{settings:{...disabled.session.settings,thinkingEnabled:true}})).status).toBe(200);
 expect((await call(path,'PATCH',{settings:{...saved,reasoningEffort:'invalid'}})).status).toBe(400);
 const restored=await(await call(path)).json() as {session:{settings:typeof DEFAULT_SETTINGS}};
 expect(restored.session.settings).toMatchObject({thinkingEnabled:true,reasoningEffort:'high'});
});
it('generates, persists and replays candidates in two stages without including candidate tail in the next turn',async()=>{
 const {s}=await seed(),requestId=crypto.randomUUID();
 const marker='\n[TAVERN_NEXT]\n';
 aiRun.mockImplementationOnce(async()=>new ReadableStream({start(c){for(const content of ['正文。',marker.slice(0,7),marker.slice(7),'往港口走。\n问问来路。\n往港口走。\n坐下喝茶。\n第四条'])c.enqueue(new TextEncoder().encode('data: '+JSON.stringify({choices:[{delta:{content}}]})+'\n\n'));c.enqueue(new TextEncoder().encode('data: {"choices":[{"delta":{},"finish_reason":"stop"}]}\n\ndata: [DONE]\n\n'));c.close();}}));
 aiRun.mockResolvedValueOnce(candidateCompletion(['往港口走。','问问来路。','坐下喝茶。']));
 const stream=await(await call('/api/sessions/'+s.id+'/generate','POST',{requestId,content:'你好'})).text();await Promise.all(work);expect(stream).toContain('candidates_pending');expect(stream).not.toContain('[TAVERN_NEXT]');
 const saved=await(await call('/api/sessions/'+s.id)).json() as {messages:Message[]};expect(saved.messages.at(-1)).toMatchObject({content:'正文。',status:'completed',candidates:['往港口走。','问问来路。','坐下喝茶。']});
 const replay=await(await call('/api/sessions/'+s.id+'/generate','POST',{requestId})).json() as {message:Message};expect(replay.message.candidates).toEqual(saved.messages.at(-1)?.candidates);expect(aiRun).toHaveBeenCalledTimes(2);expect(JSON.stringify(aiRun.mock.calls[0][0].query)).not.toContain(requestId);
 await(await call('/api/sessions/'+s.id+'/generate','POST',{requestId:crypto.randomUUID(),content:'往港口走。'})).text();await Promise.all(work);
 const prompt=aiRun.mock.calls[2][0].query as {messages:{content:string}[]};expect(prompt.messages.map(m=>m.content).join('')).not.toContain('问问来路。');
 const fork=await(await call('/api/sessions/'+s.id+'/fork','POST',{messageId:saved.messages.at(-1)!.id,content:'新正文'})).json() as {id:string};expect(sessionDb.prepare('SELECT candidates_json FROM messages WHERE session_id=?').all(fork.id).every(m=>!m.candidates_json)).toBe(true);
});
it.each(['normal','regenerate','continue'])('reminds the %s request once without changing saved user text',async mode=>{
 const {s}=await seed();
 await(await call('/api/sessions/'+s.id+'/generate','POST',{requestId:crypto.randomUUID(),content:'原输入'})).text();await Promise.all(work);
 if(mode==='continue')sessionDb.prepare("UPDATE messages SET status='aborted',finish_reason='stopped' WHERE session_id=? AND request_id IS NOT NULL AND role='assistant'").run(s.id);
 await(await call('/api/sessions/'+s.id+'/generate','POST',{requestId:crypto.randomUUID(),...(mode==='normal'?{content:'下一轮'}:mode==='regenerate'?{regenerate:true}:{continue:true})})).text();await Promise.all(work);
 const query=aiRun.mock.calls.at(-1)![0].query as {messages:{role:string;content:string}[];response_format:unknown};
 expect(query.messages.at(-1)?.role).toBe('user');
 expect(query).toHaveProperty('response_format',DIRECTOR_RESPONSE_FORMAT);
 expect(JSON.stringify(query)).not.toContain('本次只完成角色正文');
 const body=aiRun.mock.calls.map(c=>c[0].query).filter(q=>!(q as {response_format?:unknown}).response_format).at(-1) as {messages:{content:string}[]};expect(body.messages.at(-1)?.content).toBe(mode==='normal'?'下一轮':mode==='regenerate'?'原输入':'继续上一条回复，从中断处接着写，不要重复已有内容。');
 expect(aiRun).toHaveBeenCalledTimes(4);
 expect(sessionDb.prepare("SELECT content FROM messages WHERE session_id=? AND role='user' ORDER BY ordinal").all(s.id).map(m=>m.content)).toEqual(mode==='normal'?['原输入','下一轮']:['原输入']);
});
it.each(['stop'])('keeps clean prose with invalid candidates on %s',async finish=>{
 const {s}=await seed(),requestId=crypto.randomUUID();aiRun.mockResolvedValueOnce(new ReadableStream({start(c){c.enqueue(new TextEncoder().encode('data: '+JSON.stringify({choices:[{delta:{content:'正文。\n[TAVERN_NEXT]\n{"candidates":'},finish_reason:finish}]})+'\n\ndata: [DONE]\n\n'));c.close();}}));
 aiRun.mockRejectedValueOnce(new Error('repair upstream'));await(await call('/api/sessions/'+s.id+'/generate','POST',{requestId,content:'你好'})).text();await Promise.all(work);const saved=sessionDb.prepare('SELECT * FROM messages WHERE request_id=? AND role=?').get(requestId,'assistant');expect(saved).toMatchObject({content:'正文。',candidates_json:null,status:'completed'});expect(aiRun).toHaveBeenCalledTimes(2);
});

function completion(content:string,finish='stop') {return new ReadableStream<Uint8Array>({start(c){c.enqueue(new TextEncoder().encode('data: '+JSON.stringify({choices:[{delta:{content},finish_reason:finish}]})+'\n\ndata: [DONE]\n\n'));c.close();}});}
function candidateCompletion(choices:string[]){return completion(JSON.stringify({choices}));}
function tool(name:string,args:unknown,id='call-1'){return new Response('data: '+JSON.stringify({choices:[{delta:{tool_calls:[{index:0,id,type:'function',function:{name,arguments:JSON.stringify(args)}}]},finish_reason:'tool_calls'}]})+'\n\ndata: [DONE]\n\n',{headers:{'Content-Type':'text/event-stream'}});}
it('keeps a short opening in the reused Director prefix without calling synopsis',async()=>{
 const {s}=await seed();sessionDb.prepare("UPDATE messages SET content='雨' WHERE session_id=?").run(s.id);
 await(await call('/api/sessions/'+s.id+'/generate','POST',{requestId:crypto.randomUUID(),content:'我走进旅店'})).text();await Promise.all(work);
 const wire=await(await call('/api/sessions/'+s.id+'/generate','POST',{requestId:crypto.randomUUID(),content:'我坐下喝茶'})).text();await Promise.all(work);
 const done=wire.split('\n').filter(l=>l.startsWith('data: ')).map(l=>JSON.parse(l.slice(6))).find(e=>e.type==='done');expect(done.message.candidates).toHaveLength(3);
 expect(sessionDb.prepare('SELECT * FROM director_synopsis').all()).toHaveLength(0);expect(aiRun).toHaveBeenCalledTimes(4);
 const candidate=aiRun.mock.calls.at(-1)![0].query as {messages:{content:string}[];response_format:unknown};expect(candidate.response_format).toEqual(DIRECTOR_RESPONSE_FORMAT);expect(candidate.messages.some(m=>m.content==='雨')).toBe(true);
});
it.each([{query:'钥匙',owner:'other'},{query:''},{query:'字'.repeat(161)}])('rejects invalid memory arguments before lore indexing: %j',async args=>{
 const recall=vi.spyOn(LoreIndex.prototype,'search').mockResolvedValue([]);
 try{const {s}=await seed();aiRun.mockResolvedValueOnce(tool('search_memory',args));const wire=await(await call('/api/sessions/'+s.id+'/generate','POST',{requestId:crypto.randomUUID(),content:'回忆钥匙'})).text();await Promise.all(work);expect(wire).toContain('"type":"error"');expect(recall).not.toHaveBeenCalled();expect(aiRun).toHaveBeenCalledTimes(1);}finally{recall.mockRestore();}
});
it('rejects an identical repeated memory call before doing the second external search',async()=>{
 const recall=vi.spyOn(LoreIndex.prototype,'search').mockResolvedValue([]);
 try{const {s}=await seed();aiRun.mockResolvedValueOnce(tool('search_memory',{query:'你好'})).mockResolvedValueOnce(tool('search_memory',{query:'你好'},'again'));const wire=await(await call('/api/sessions/'+s.id+'/generate','POST',{requestId:crypto.randomUUID(),content:'回忆开场'})).text();await Promise.all(work);expect(wire).toContain('"type":"error"');expect(recall).toHaveBeenCalledTimes(1);expect(aiRun).toHaveBeenCalledTimes(2);}finally{recall.mockRestore();}
});
it.each(['invalid','duplicate'])('preflights the full tool batch before any lore search: %s',async kind=>{
 const recall=vi.spyOn(LoreIndex.prototype,'search').mockResolvedValue([]);
 try{const {s}=await seed();const first={index:0,id:'first',type:'function',function:{name:'search_memory',arguments:'{"query":"钥匙"}'}},second={...first,index:1,id:'second',function:{name:kind==='invalid'?'fetch':'search_memory',arguments:kind==='invalid'?'{}':first.function.arguments}};
 aiRun.mockResolvedValueOnce(new Response('data: '+JSON.stringify({choices:[{delta:{tool_calls:[first,second]},finish_reason:'tool_calls'}]})+'\n\ndata: [DONE]\n\n',{headers:{'Content-Type':'text/event-stream'}}));
 const wire=await(await call('/api/sessions/'+s.id+'/generate','POST',{requestId:crypto.randomUUID(),content:'回忆钥匙'})).text();await Promise.all(work);expect(wire).toContain('"type":"error"');expect(recall).not.toHaveBeenCalled();expect(aiRun).toHaveBeenCalledTimes(1);}finally{recall.mockRestore();}
});
it('passes mixed history and worldbook sources into the native model continuation',async()=>{
 const evidence={id:'lore-key',text:'铜钥匙打开北门。',source:{bookId:'gates',revision:'v1',entryId:'keys'}},recall=vi.spyOn(LoreIndex.prototype,'search').mockResolvedValue([evidence]);
 try{const {s}=await seed();for(const [i,text] of ['钥匙在岚手中。','门上有钥匙孔。','更正：钥匙已交给旅人。'].entries())sessionDb.prepare("INSERT INTO messages(id,session_id,role,content,status,ordinal,created_at) VALUES(?,?,'assistant',?,'completed',?,?)").run('history-'+i,s.id,text,i+1,Date.now()+i);
 aiRun.mockResolvedValueOnce(tool('search_memory',{query:'钥匙'})).mockResolvedValueOnce(completion('旅人走向北门。'));
 const wire=await(await call('/api/sessions/'+s.id+'/generate','POST',{requestId:crypto.randomUUID(),content:'回忆钥匙'})).text();await Promise.all(work);expect(wire).toContain('"status":"completed"');
 const query=aiRun.mock.calls[1][0].query as {messages:{role:string;content:string}[]},hits=JSON.parse(query.messages.find(m=>m.role==='tool')!.content);
 expect(hits).toHaveLength(3);expect(hits).toContainEqual(evidence);expect(hits.some((h:{id:string})=>h.id==='history-2')).toBe(true);expect(recall).toHaveBeenCalledTimes(1);
 }finally{recall.mockRestore();}
});
it('continues native retrieval for distinct fragments of one long message, persists both steps and replays without inference',async()=>{
 const {s}=await seed();sessionDb.prepare('UPDATE messages SET content=? WHERE session_id=?').run('铜钥匙在北门。'+'风'.repeat(1000)+'银怀表藏在南塔。',s.id);
 aiRun.mockResolvedValueOnce(tool('search_memory',{query:'铜钥匙'},'keys')).mockResolvedValueOnce(tool('search_memory',{query:'银怀表'},'watch')).mockResolvedValueOnce(completion('钥匙在北门，怀表在南塔。'));
 const requestId=crypto.randomUUID(),wire=await(await call('/api/sessions/'+s.id+'/generate','POST',{requestId,content:'核对旧事'})).text();await Promise.all(work);
 expect(wire).not.toContain('"type":"error"');expect(wire).not.toContain('tool_calls');expect(aiRun).toHaveBeenCalledTimes(4);
 const query=aiRun.mock.calls[2][0].query as {messages:{role:string;tool_call_id?:string;content:string}[]},results=query.messages.filter(m=>m.role==='tool');
 expect(results.map(m=>m.tool_call_id)).toEqual(['keys','watch']);const hits=results.map(m=>JSON.parse(m.content)[0]);
 expect(hits[0].source).toEqual(hits[1].source);expect(hits[0].text).not.toContain('银怀表');expect(hits[1].text).toContain('银怀表藏在南塔');
 const restored=await(await call('/api/sessions/'+s.id)).json() as {messages:Message[];session:{generationId:string|null}};
 expect(restored.messages.at(-1)).toMatchObject({content:'钥匙在北门，怀表在南塔。',status:'completed',finishReason:'stop',candidates:expect.any(Array)});expect(restored.messages.at(-1)?.candidates).toHaveLength(3);expect(restored.session.generationId).toBeNull();
 const steps=JSON.parse(sessionDb.prepare('SELECT steps_json FROM turn_snapshots').get()!.steps_json as string);expect(steps.map((step:{call:{id:string}})=>step.call.id)).toEqual(['keys','watch']);
 expect((await(await call('/api/sessions/'+s.id+'/generate','POST',{requestId})).json() as {replayed:boolean}).replayed).toBe(true);expect(aiRun).toHaveBeenCalledTimes(4);
});
it('sends an intact exact-query excerpt after earlier partial matches and expanding Unicode to the model and export',async()=>{
 const {s}=await seed(),original='北门早已关闭。'+'İ'.repeat(800)+'😀'.repeat(61)+'a北门钥匙放在南塔木柜。';sessionDb.prepare('UPDATE messages SET content=? WHERE session_id=?').run(original,s.id);
 aiRun.mockResolvedValueOnce(tool('search_memory',{query:'北门钥匙'},'keys')).mockResolvedValueOnce(completion('北门钥匙放在南塔木柜。'));
 const requestId=crypto.randomUUID(),wire=await(await call('/api/sessions/'+s.id+'/generate','POST',{requestId,content:'核对旧事'})).text();await Promise.all(work);expect(wire).not.toContain('"type":"error"');
 const query=aiRun.mock.calls[1][0].query as {messages:{role:string;content:string}[]},hit=JSON.parse(query.messages.find(m=>m.role==='tool')!.content)[0];
 expect(hit.text).toContain('北门钥匙放在南塔木柜');expect(hit.text).not.toMatch(/[\uD800-\uDFFF]/u);expect(original.includes(hit.text)).toBe(true);
 const exported=await(await call('/api/sessions/'+s.id+'/export')).text();const lines=exported.trim().split('\n').map(line=>JSON.parse(line)),snapshot=lines.at(-1).extra.tavern_agent;
 expect(JSON.parse(JSON.parse(snapshot.steps_json)[0].result)[0]).toEqual(hit);expect(lines[1].mes).toBe(original);
 expect((await(await call('/api/sessions/'+s.id+'/generate','POST',{requestId})).json() as {replayed:boolean}).replayed).toBe(true);expect(aiRun).toHaveBeenCalledTimes(3);
});
it('stops different native queries that return the same excerpt instead of allowing a retrieval loop',async()=>{
 const {s}=await seed();sessionDb.prepare('UPDATE messages SET content=? WHERE session_id=?').run('铜钥匙在北门。',s.id);
 aiRun.mockResolvedValueOnce(tool('search_memory',{query:'铜钥匙'},'keys')).mockResolvedValueOnce(tool('search_memory',{query:'铜钥匙 北门'},'again'));
 const wire=await(await call('/api/sessions/'+s.id+'/generate','POST',{requestId:crypto.randomUUID(),content:'核对旧事'})).text();await Promise.all(work);
 expect(wire).toContain('"type":"error"');expect(aiRun).toHaveBeenCalledTimes(2);expect(sessionDb.prepare('SELECT after_json FROM turn_snapshots').get()?.after_json).toBeNull();expect(sessionDb.prepare('SELECT generation_id FROM sessions WHERE id=?').get(s.id)?.generation_id).toBeNull();
});
it('runs two native tool steps, commits the snapshot atomically and reuses Director tool transcript and sees staged state',async()=>{
 const {s}=await seed();aiRun.mockResolvedValueOnce(tool('search_memory',{query:'你好'})).mockResolvedValueOnce(tool('update_state',{patch:{scene:'北港',facts:{钥匙:'旅人持有'}}},'call-2')).mockResolvedValueOnce(completion('北港灯亮了。'));
 const requestId=crypto.randomUUID(),wire=await(await call('/api/sessions/'+s.id+'/generate','POST',{requestId,content:'我们已经到达北港，钥匙在我手里。'})).text();await Promise.all(work);expect(wire).not.toContain('tool_calls');expect(aiRun).toHaveBeenCalledTimes(4);
 const candidate=aiRun.mock.calls[3][0].query as {messages:{role:string;content:string}[];tools:unknown;tool_choice:string};const body=aiRun.mock.calls[2][0].query as typeof candidate;expect(candidate.tools).toEqual(body.tools);expect(candidate.tool_choice).toBe('none');expect(candidate).toHaveProperty('response_format',DIRECTOR_RESPONSE_FORMAT);expect(candidate.messages.slice(0,body.messages.length)).toEqual(body.messages);expect(candidate.messages.at(-2)).toEqual({role:'assistant',content:'北港灯亮了。'});expect(candidate.messages.at(-1)?.role).toBe('user');expect(candidate.messages.slice(1).some(m=>m.role==='system')).toBe(false);expect(candidate.messages.at(-1)?.content).toContain('北港');expect(candidate.messages.at(-1)?.content).toContain('旅人持有');
 const restored=await(await call('/api/sessions/'+s.id)).json() as {session:{state:{scene:string;facts:unknown}}};expect(restored.session.state).toMatchObject({scene:'北港',facts:{钥匙:'旅人持有'}});const snapshot=sessionDb.prepare('SELECT * FROM turn_snapshots').get();expect(JSON.parse(snapshot!.before_json as string).scene).toBeNull();expect(JSON.parse(snapshot!.steps_json as string)).toHaveLength(2);
 expect((await(await call('/api/sessions/'+s.id+'/generate','POST',{requestId})).json() as {replayed:boolean}).replayed).toBe(true);expect(aiRun).toHaveBeenCalledTimes(4);
});
it('keeps committed state after failed regeneration and restarts successful regeneration from the original before state',async()=>{
 const {s}=await seed();aiRun.mockResolvedValueOnce(tool('update_state',{patch:{scene:'北港'}})).mockResolvedValueOnce(completion('到达北港。'));await(await call('/api/sessions/'+s.id+'/generate','POST',{requestId:crypto.randomUUID(),content:'到达北港。'})).text();await Promise.all(work);
 aiRun.mockResolvedValueOnce(tool('update_state',{patch:{scene:'未来灯塔'}})).mockRejectedValueOnce(Error('offline'));await(await call('/api/sessions/'+s.id+'/generate','POST',{requestId:crypto.randomUUID(),regenerate:true})).text();await Promise.all(work);
 const failed=await(await call('/api/sessions/'+s.id)).json() as {session:{state:{scene:string}};messages:Message[]};expect(failed.session.state.scene).toBe('北港');expect(failed.messages.at(-1)?.status).toBe('error');
 aiRun.mockResolvedValueOnce(tool('update_state',{patch:{scene:'新港'}})).mockResolvedValueOnce(completion('到了新港。'));const at=aiRun.mock.calls.length;await(await call('/api/sessions/'+s.id+'/generate','POST',{requestId:crypto.randomUUID(),regenerate:true})).text();await Promise.all(work);
 const query=aiRun.mock.calls[at][0].query as {messages:{content:string}[]};expect(query.messages.some(m=>m.content.startsWith('当前已确认状态'))).toBe(false);expect((await(await call('/api/sessions/'+s.id)).json() as {session:{state:{scene:string}}}).session.state.scene).toBe('新港');
 const projection=JSON.parse(sessionDb.prepare('SELECT value_json FROM model_projections').get()!.value_json as string).messages;
 const nextAt=aiRun.mock.calls.length;await(await call('/api/sessions/'+s.id+'/generate','POST',{requestId:crypto.randomUUID(),content:'然后呢'})).text();await Promise.all(work);
 const next=aiRun.mock.calls[nextAt][0].query as {messages:{role:string;content:string}[]};expect(next.messages.slice(0,projection.length)).toEqual(projection);expect(next.messages.filter(m=>m.content.startsWith('当前已确认状态'))).toHaveLength(1);expect(JSON.stringify(next)).not.toContain('未来灯塔');expect(next.messages.filter(m=>m.role==='assistant').some(m=>m.content==='到达北港。')).toBe(false);
});
it('rolls back staged state for duplicate tools; candidate failure still preserves completed state',async()=>{
 const {s}=await seed();aiRun.mockResolvedValueOnce(tool('update_state',{patch:{scene:'北港'}})).mockResolvedValueOnce(tool('update_state',{patch:{scene:'北港'}},'again'));
 await(await call('/api/sessions/'+s.id+'/generate','POST',{requestId:crypto.randomUUID(),content:'到达北港'})).text();await Promise.all(work);expect(sessionDb.prepare('SELECT after_json FROM turn_snapshots').get()?.after_json).toBeNull();
 aiRun.mockResolvedValueOnce(tool('update_state',{patch:{scene:'北港'}})).mockResolvedValueOnce(completion('已到北港。')).mockRejectedValueOnce(Error('candidate unavailable'));
 await(await call('/api/sessions/'+s.id+'/generate','POST',{requestId:crypto.randomUUID(),content:'确认抵达北港'})).text();await Promise.all(work);expect((await(await call('/api/sessions/'+s.id)).json() as {session:{state:{scene:string}}}).session.state.scene).toBe('北港');
});
it('preserves ordered tool results through body length and candidate context rebuilds',async()=>{
 const {s}=await seed();let bodies=0,candidates=0;aiRun.mockImplementation(async request=>{const q=request.query as {messages:{role:string;content:string}[]};
  if((request.query as {response_format?:unknown}).response_format){expect(q.messages.at(-1)?.role).toBe('user');expect(q.messages.slice(1).some(m=>m.role==='system')).toBe(false);if(++candidates===1)return Response.json({error:{message:'maximum context length is 4096 tokens'}},{status:400});expect(q.messages.at(-2)).toEqual({role:'assistant',content:'第一段。第二段。'});return candidateCompletion(['我问问。','我坐下。','我看窗外。']);}
  if(q.messages[0].content.startsWith('总结已发生剧情'))return completion('旧事。');if(q.messages[0].content.startsWith('压缩会话记忆'))return completion('此前问候。');
  if(++bodies===1)return tool('update_state',{patch:{scene:'旅店'}});if(bodies===2)return completion('第一段。','length');const result=q.messages.findIndex(m=>m.role==='tool'),first=q.messages.findIndex(m=>m.content==='第一段。');expect(result).toBeLessThan(first);return completion('第二段。');
 });
 await(await call('/api/sessions/'+s.id+'/generate','POST',{requestId:crypto.randomUUID(),content:'继续当前场景'})).text();await Promise.all(work);expect((await(await call('/api/sessions/'+s.id)).json() as {messages:Message[]}).messages.at(-1)?.content).toBe('第一段。第二段。');
});
it('appends to a successful actual model projection and invalidates it for changed worldbook activation',async()=>{
 const {s}=await seed();await(await call('/api/sessions/'+s.id+'/generate','POST',{requestId:crypto.randomUUID(),content:'第一次问候'})).text();await Promise.all(work);const original=(aiRun.mock.calls[0][0].query as {messages:unknown[]}).messages;
 await(await call('/api/sessions/'+s.id+'/generate','POST',{requestId:crypto.randomUUID(),content:'第二次问候'})).text();await Promise.all(work);const next=(aiRun.mock.calls[2][0].query as {messages:unknown[]}).messages;expect(next.slice(0,original.length)).toEqual(original);expect(sessionDb.prepare('SELECT count(*) n FROM model_projections').get()?.n).toBe(1);
});
it('discards a stale rule projection once and then resumes append-only prefix reuse without changing saved content',async()=>{
 const {s}=await seed();const originalSettings=sessionDb.prepare('SELECT settings_json,character_json FROM sessions WHERE id=?').get(s.id);
 await(await call('/api/sessions/'+s.id+'/generate','POST',{requestId:crypto.randomUUID(),content:'保留原文'})).text();await Promise.all(work);
 const row=sessionDb.prepare('SELECT message_id,value_json FROM model_projections').get()!;
 const projection=JSON.parse(row.value_json as string);projection.messages[0].content=projection.messages[0].content.replace(AGENT_RULE,'旧版正文规则');
 sessionDb.prepare('UPDATE model_projections SET value_json=? WHERE message_id=?').run(JSON.stringify(projection),row.message_id);
 await(await call('/api/sessions/'+s.id+'/generate','POST',{requestId:crypto.randomUUID(),content:'行动要有结果'})).text();await Promise.all(work);
 const fresh=(aiRun.mock.calls[2][0].query as {messages:{role:string;content:string}[]}).messages;expect(fresh[0].content).toContain(AGENT_RULE);expect(JSON.stringify(fresh)).not.toContain('旧版正文规则');
 const renewed=JSON.parse(sessionDb.prepare('SELECT value_json FROM model_projections').get()!.value_json as string);
 await(await call('/api/sessions/'+s.id+'/generate','POST',{requestId:crypto.randomUUID(),content:'仍留在这里慢聊'})).text();await Promise.all(work);
 const next=(aiRun.mock.calls[4][0].query as {messages:unknown[]}).messages;expect(next.slice(0,renewed.messages.length)).toEqual(renewed.messages);expect(aiRun).toHaveBeenCalledTimes(6);
 expect(sessionDb.prepare('SELECT settings_json,character_json FROM sessions WHERE id=?').get(s.id)).toEqual(originalSettings);
 expect(sessionDb.prepare("SELECT content FROM messages WHERE role='user' ORDER BY ordinal").all().map(m=>m.content)).toEqual(['保留原文','行动要有结果','仍留在这里慢聊']);
});
it('compresses only the model projection of long tool-assisted prose while retaining full persisted body',async()=>{
 const {s}=await seed();db.prepare('UPDATE model_capabilities SET value_json=?').run(JSON.stringify({contextTokens:2048,inputRatio:1.2,source:'llama.cpp:n_ctx'}));let bodies=0;
 aiRun.mockImplementation(async request=>{const q=request.query as {messages:{content:string}[]};if(q.messages[0].content.startsWith('总结已发生剧情'))return completion('旧事。');if(q.messages[0].content.startsWith('压缩会话记忆'))return completion('已经到达港口。');if((request.query as {response_format?:unknown}).response_format)return candidateCompletion(['我问问。','我坐下。','我看窗外。']);if(++bodies===1)return tool('update_state',{patch:{scene:'港口'}});if(bodies===2)return completion('正文'.repeat(2200),'length');expect(q.messages.some(m=>m.content.includes('已发生正文摘要'))).toBe(true);return completion('结尾。');});
 await(await call('/api/sessions/'+s.id+'/generate','POST',{requestId:crypto.randomUUID(),content:'抵达港口'})).text();await Promise.all(work);expect(sessionDb.prepare('SELECT content,status FROM messages WHERE session_id=? ORDER BY created_at DESC LIMIT 1').get(s.id)).toMatchObject({content:'正文'.repeat(2200)+'结尾。',status:'completed'});
});
it.each(['plain','crlf','trailing-newline'])('compresses %s prose emitted alongside a tool call while preserving the call, result and full saved reply',async format=>{
 const {s}=await seed();db.prepare('UPDATE model_capabilities SET value_json=?').run(JSON.stringify({contextTokens:2048,inputRatio:1.2,source:'llama.cpp:n_ctx'}));let bodies=0;
 const prose='已发生场景：'.repeat(300)+(format==='crlf'?'\r\n':'')+'已发生场景：'.repeat(300)+(format==='trailing-newline'?'\n':''),nativeCall={id:'state-with-prose',type:'function',function:{name:'update_state',arguments:JSON.stringify({patch:{scene:'港口'}})}};
 aiRun.mockImplementation(async request=>{const q=request.query as {messages:{role:string;content:string;tool_calls?:unknown[];tool_call_id?:string}[]};
  if(q.messages[0].content.startsWith('总结已发生剧情'))return completion('抵达港口。');if(q.messages[0].content.startsWith('压缩会话记忆'))return completion('已经到达港口。');if((request.query as {response_format?:unknown}).response_format)return candidateCompletion(['我问问。','我坐下。','我看窗外。']);
  if(++bodies===1)return new Response('data: '+JSON.stringify({choices:[{delta:{content:prose,tool_calls:[{index:0,...nativeCall}]},finish_reason:'tool_calls'}]})+'\n\ndata: [DONE]\n\n',{headers:{'Content-Type':'text/event-stream'}});
  const at=q.messages.findIndex(m=>m.tool_calls?.length);expect(q.messages[at].tool_calls).toEqual([nativeCall]);expect(q.messages[at].content).toContain('已发生正文摘要');expect(q.messages[at+1]).toMatchObject({role:'tool',tool_call_id:nativeCall.id,content:'{"ok":true}'});return completion('结尾。');
 });
 const requestId=crypto.randomUUID(),wire=await(await call('/api/sessions/'+s.id+'/generate','POST',{requestId,content:'抵达港口'})).text();await Promise.all(work);expect(wire).not.toContain('"type":"error"');
 expect(sessionDb.prepare('SELECT content,status FROM messages WHERE request_id=? AND role=?').get(requestId,'assistant')).toMatchObject({content:prose.replace(/\r\n?/g,'\n')+'结尾。',status:'completed'});expect(JSON.parse(sessionDb.prepare('SELECT after_json FROM turn_snapshots').get()!.after_json as string).scene).toBe('港口');
});
it.each(['tool','length','stream'])('never summarizes legacy candidate actions in a %s body/tool projection',async mode=>{
 const {s}=await seed();db.prepare('UPDATE model_capabilities SET value_json=?').run(JSON.stringify({contextTokens:2048,inputRatio:1.2,source:'llama.cpp:n_ctx'}));let bodies=0;const sources:string[]=[];
 const raw='已抵达。\n[TAVERN_NEXT]\n'+'未来行动未发生'.repeat(700);
 aiRun.mockImplementation(async request=>{const q=request.query as {messages:{content:string}[]};
  if(q.messages[0].content.startsWith('压缩会话记忆')){sources.push(JSON.stringify(q.messages));return completion('旧');}
  if(++bodies===1)return tool('update_state',{patch:{scene:'旅店'}});
  if(mode==='tool')return new Response('data: '+JSON.stringify({choices:[{delta:{content:raw,tool_calls:[{index:0,id:'next',type:'function',function:{name:'update_state',arguments:JSON.stringify({patch:{scene:'港口'}})}}]},finish_reason:'tool_calls'}]})+'\n\ndata: [DONE]\n\n',{headers:{'Content-Type':'text/event-stream'}});
  if(mode==='length')return completion(raw,'length');
  return new Response('data: '+JSON.stringify({choices:[{delta:{content:raw}}]})+'\n\ndata: '+JSON.stringify({error:{message:'maximum context length is 2048 tokens'}})+'\n\n',{headers:{'Content-Type':'text/event-stream'}});
 });
 const wire=await(await call('/api/sessions/'+s.id+'/generate','POST',{requestId:crypto.randomUUID(),content:'抵达港口'})).text();await Promise.all(work);
 expect(wire).toContain('"type":"error"');expect(sources.length).toBeGreaterThan(0);expect(sources.join('')).not.toContain('未来行动未发生');expect(sessionDb.prepare('SELECT after_json FROM turn_snapshots').get()?.after_json).toBeNull();
 const saved=sessionDb.prepare('SELECT content FROM messages WHERE session_id=? ORDER BY created_at DESC LIMIT 1').get(s.id);expect(saved?.content).toBe('已抵达。');
});
it('retains a stopped prefix once when continuation calls a tool then finishes through length',async()=>{
 const {s}=await seed();sessionDb.prepare("INSERT INTO messages(id,session_id,role,content,status,ordinal,created_at,finish_reason) VALUES('stopped',?,'assistant','独有事实：铜钥匙在掌柜口袋。','aborted',1,?,'stopped')").run(s.id,Date.now());
 aiRun.mockResolvedValueOnce(tool('update_state',{patch:{scene:'旅店'}})).mockResolvedValueOnce(completion('她取出钥匙。','length')).mockResolvedValueOnce(completion('灯亮了。'));
 await(await call('/api/sessions/'+s.id+'/generate','POST',{requestId:crypto.randomUUID(),continue:true})).text();await Promise.all(work);for(const [request]of aiRun.mock.calls){const q=request.query as {messages:{content:string}[]};expect(q.messages.map(m=>m.content).join('\n').split('独有事实：铜钥匙在掌柜口袋。')).toHaveLength(2);}
});
it('retains cumulative prose before the first tool when length precedes tool and another length',async()=>{
 const {s}=await seed();aiRun.mockResolvedValueOnce(completion('先前正文事实。','length')).mockResolvedValueOnce(tool('update_state',{patch:{scene:'港口'}})).mockResolvedValueOnce(completion('随后正文。','length')).mockResolvedValueOnce(completion('结尾。'));
 await(await call('/api/sessions/'+s.id+'/generate','POST',{requestId:crypto.randomUUID(),content:'开始'})).text();await Promise.all(work);const q=aiRun.mock.calls[3][0].query as {messages:{content:string}[]};expect(q.messages.map(m=>m.content).join('\n').split('先前正文事实。')).toHaveLength(2);expect(sessionDb.prepare('SELECT content,status FROM messages ORDER BY created_at DESC LIMIT 1').get()).toMatchObject({content:'先前正文事实。随后正文。结尾。',status:'completed'});
});
it('rejects invalid tool parameters without committing state and preserves a stopped version before-state for continuation',async()=>{
 const {s}=await seed();aiRun.mockResolvedValueOnce(tool('update_state',{patch:{scene:'旅店'}})).mockResolvedValueOnce(tool('update_state',{patch:{scene:{sql:'unsafe'}}},'bad'));
 await(await call('/api/sessions/'+s.id+'/generate','POST',{requestId:crypto.randomUUID(),content:'记录当前位置'})).text();await Promise.all(work);expect(sessionDb.prepare('SELECT after_json FROM turn_snapshots').get()?.after_json).toBeNull();
 let controller!:ReadableStreamDefaultController<Uint8Array>;aiRun.mockResolvedValueOnce(tool('update_state',{patch:{scene:'未完成灯塔'}})).mockResolvedValueOnce(new ReadableStream({start(c){controller=c;}}));
 const response=await call('/api/sessions/'+s.id+'/generate','POST',{requestId:crypto.randomUUID(),content:'去灯塔'}),drain=response.text();await vi.waitFor(()=>expect(aiRun).toHaveBeenCalledTimes(4));controller.enqueue(new TextEncoder().encode('data: {"choices":[{"delta":{"content":"半句正文"}}]}\n\n'));await vi.waitFor(()=>expect(sessionDb.prepare('SELECT content FROM generation_drafts').get()?.content).toBe('半句正文'));
 const generationId=sessionDb.prepare('SELECT generation_id FROM sessions WHERE id=?').get(s.id)?.generation_id;await call('/api/sessions/'+s.id+'/stop','POST',{generationId});await drain;await Promise.all(work);expect(sessionDb.prepare('SELECT after_json FROM turn_snapshots WHERE message_id=?').get(generationId as string)?.after_json).toBeNull();
 const at=aiRun.mock.calls.length;await(await call('/api/sessions/'+s.id+'/generate','POST',{requestId:crypto.randomUUID(),continue:true})).text();await Promise.all(work);const q=aiRun.mock.calls[at][0].query as {messages:{content:string}[]};expect(q.messages.some(m=>m.content.startsWith('当前已确认状态'))).toBe(false);
 const projection=JSON.parse(sessionDb.prepare('SELECT value_json FROM model_projections').get()!.value_json as string).messages;
 expect(JSON.stringify(projection)).not.toContain('继续上一条回复');expect(JSON.stringify(projection)).not.toContain('未完成灯塔');
 const nextAt=aiRun.mock.calls.length;await(await call('/api/sessions/'+s.id+'/generate','POST',{requestId:crypto.randomUUID(),content:'现在呢'})).text();await Promise.all(work);
 const next=aiRun.mock.calls[nextAt][0].query as {messages:unknown[]};expect(next.messages.slice(0,projection.length)).toEqual(projection);expect(JSON.stringify(next)).not.toContain('继续上一条回复');
});
it('automatically continues through more than three length finishes with one parser and UUID',async()=>{
 const {s}=await seed(),requestId=crypto.randomUUID();
 for(const content of ['她说：','你好。','\n[TAV','ERN_NEXT]\n去港口','。\n坐下喝茶。'])aiRun.mockResolvedValueOnce(completion(content,'length'));
 aiRun.mockResolvedValueOnce(completion('\n问问来路。'));aiRun.mockResolvedValueOnce(candidateCompletion(['去港口。','坐下喝茶。','问问来路。']));
 const text=await(await call('/api/sessions/'+s.id+'/generate','POST',{requestId,content:'你好'})).text();await Promise.all(work);
 const saved=sessionDb.prepare('SELECT * FROM messages WHERE request_id=? AND role=?').get(requestId,'assistant');expect(saved).toMatchObject({content:'她说：你好。',status:'completed',finish_reason:'stop'});expect(JSON.parse(saved!.candidates_json as string)).toEqual(['去港口。','坐下喝茶。','问问来路。']);expect(text).not.toContain('[TAVERN_NEXT]');expect(aiRun).toHaveBeenCalledTimes(7);expect(sessionDb.prepare('SELECT count(*) n FROM messages WHERE request_id=? AND role=?').get(requestId,'assistant')?.n).toBe(1);
 for(const [,opts]of aiRun.mock.calls){expect(opts?.gateway).not.toHaveProperty('requestTimeoutMs');}for(const [request]of aiRun.mock.calls)expect(request.query).not.toHaveProperty('max_tokens');
});
it.each(['http','stream'])('keeps generated prefix and continuation across a %s context error, with persistent valid summary',async mode=>{
 const {s}=await seed();sessionDb.prepare("INSERT INTO messages(id,session_id,role,content,status,ordinal,created_at) VALUES(?,?,'user',?,'completed',1,?)").run(crypto.randomUUID(),s.id,'旧问题'.repeat(800),Date.now());sessionDb.prepare("INSERT INTO messages(id,session_id,role,content,status,ordinal,created_at) VALUES(?,?,'assistant',?,'completed',2,?)").run(crypto.randomUUID(),s.id,'旧回答'.repeat(800),Date.now()+1);
 let bodyCalls=0;aiRun.mockImplementation(async request=>{const q=request.query as {messages:{content:string}[]};if(q.messages[0].content.startsWith('总结已发生剧情'))return completion('旧事。');if(q.messages[0].content.startsWith('压缩会话记忆'))return completion('旧事');bodyCalls++;
 if(bodyCalls===1&&mode==='http')return completion('她抬起头，','length');
 if((bodyCalls===1&&mode==='stream')||(bodyCalls===2&&mode==='http'))return mode==='http'?Response.json({error:{message:'maximum context length is 4096 tokens'}},{status:400}):new ReadableStream({start(c){c.enqueue(new TextEncoder().encode('data: {"choices":[{"delta":{"content":"她抬起头，"}}]}\n\ndata: {"error":{"message":"maximum context length is 4096 tokens"}}\n\n'));c.close();}});
 expect(q.messages.at(-1)?.content).toContain('接着最后一条');expect(q.messages.some(m=>m.content==='她抬起头，')).toBe(true);return completion('把热茶递给你。');});
 await(await call('/api/sessions/'+s.id+'/generate','POST',{requestId:crypto.randomUUID(),content:'现在呢'})).text();await Promise.all(work);
 expect(sessionDb.prepare('SELECT content,status FROM messages WHERE session_id=? ORDER BY created_at DESC LIMIT 1').get(s.id)).toMatchObject({content:'她抬起头，把热茶递给你。',status:'completed'});expect(sessionDb.prepare('SELECT summary_json FROM sessions WHERE id=?').get(s.id)?.summary_json).toBeTruthy();expect(sessionDb.prepare('SELECT count(*) n FROM messages WHERE session_id=?').get(s.id)?.n).toBe(5);
});
it('rolls back the user and assistant together if the atomic insert fails',async()=>{
 const {s}=await seed();let inserts=0;beforeRun=sql=>{if(sql.startsWith('INSERT INTO messages')&&++inserts===2){beforeRun=undefined;throw new Error('disk fault');}};
 const r=await call('/api/sessions/'+s.id+'/generate','POST',{requestId:crypto.randomUUID(),content:'旧请求'});expect(r.status).toBe(500);expect(aiRun).not.toHaveBeenCalled();expect(sessionDb.prepare('SELECT count(*) n FROM messages WHERE session_id=?').get(s.id)?.n).toBe(1);expect(sessionDb.prepare('SELECT generation_id FROM sessions WHERE id=?').get(s.id)?.generation_id).toBeNull();
});
it('stops during summarization without changing the checkpoint or deleting source history',async()=>{
 const {s}=await seed();db.prepare('UPDATE model_capabilities SET value_json=?').run(JSON.stringify({contextTokens:2048,inputRatio:1.2,source:'llama.cpp:n_ctx'}));sessionDb.prepare("INSERT INTO messages(id,session_id,role,content,status,ordinal,created_at) VALUES(?,?,'user',?,'completed',1,?)").run(crypto.randomUUID(),s.id,'旧问题'.repeat(800),Date.now());sessionDb.prepare("INSERT INTO messages(id,session_id,role,content,status,ordinal,created_at) VALUES(?,?,'assistant',?,'completed',2,?)").run(crypto.randomUUID(),s.id,'旧回答'.repeat(800),Date.now()+1);
 const cancel=vi.fn();aiRun.mockImplementation(async request=>(request.query as {messages:{content:string}[]}).messages[0].content.startsWith('压缩会话记忆')?new ReadableStream({cancel}):completion('旧事'));
 const r=await call('/api/sessions/'+s.id+'/generate','POST',{requestId:crypto.randomUUID(),content:'现在呢'}),reader=r.body!.getReader();await reader.read();await vi.waitFor(()=>expect(aiRun).toHaveBeenCalled());const id=sessionDb.prepare('SELECT generation_id FROM sessions WHERE id=?').get(s.id)?.generation_id;
 await call('/api/sessions/'+s.id+'/stop','POST',{generationId:id});while(!(await reader.read()).done){}await Promise.all(work);expect(cancel).toHaveBeenCalled();expect(sessionDb.prepare('SELECT summary_json FROM sessions WHERE id=?').get(s.id)?.summary_json).toBeNull();expect(sessionDb.prepare('SELECT count(*) n FROM messages WHERE session_id=?').get(s.id)?.n).toBe(5);
});
it('allows output beyond the removed application character cap',async()=>{
 const {s}=await seed();aiRun.mockResolvedValueOnce(completion('字'.repeat(100001)));await(await call('/api/sessions/'+s.id+'/generate','POST',{requestId:crypto.randomUUID(),content:'继续'})).text();await Promise.all(work);expect(sessionDb.prepare('SELECT length(content) n,status FROM messages WHERE session_id=? ORDER BY created_at DESC LIMIT 1').get(s.id)).toMatchObject({n:100001,status:'completed'});
});
it('delivers one done event when an in-flight heartbeat returns after final persistence',async()=>{
 vi.useFakeTimers();try{
 const {s}=await seed();let controller:ReadableStreamDefaultController<Uint8Array>;aiRun.mockImplementationOnce(async()=>new ReadableStream({start(c){controller=c;}}));
 const response=await call('/api/sessions/'+s.id+'/generate','POST',{requestId:crypto.randomUUID(),content:'出发'}),reader=response.body!.getReader();await reader.read();const tail=(async()=>{let value='';for(;;){const next=await reader.read();if(next.done)return value;value+=new TextDecoder().decode(next.value);}})();
 await vi.advanceTimersByTimeAsync(1000);controller!.enqueue(new TextEncoder().encode('data: {"choices":[{"delta":{"content":"出发了。\\n[TAVERN_NEXT]\\n去港口。\\n问问来路。\\n坐下喝茶。"},"finish_reason":"stop"}]}\n\ndata: [DONE]\n\n'));controller!.close();
 await vi.waitFor(()=>expect(sessionDb.prepare('SELECT generation_id FROM sessions WHERE id=?').get(s.id)?.generation_id).toBeNull());await Promise.resolve();expect((await tail).split('"type":"done"')).toHaveLength(2);await Promise.all(work);
 }finally{vi.useRealTimers();}
});
it('refuses checkpoint write when stop wins just after the summary returns',async()=>{
 const {s}=await seed();db.prepare('UPDATE model_capabilities SET value_json=?').run(JSON.stringify({contextTokens:2048,inputRatio:1.2,source:'llama.cpp:n_ctx'}));sessionDb.prepare("INSERT INTO messages(id,session_id,role,content,status,ordinal,created_at) VALUES(?,?,'user',?,'completed',1,?)").run(crypto.randomUUID(),s.id,'旧事'.repeat(800),Date.now());sessionDb.prepare("INSERT INTO messages(id,session_id,role,content,status,ordinal,created_at) VALUES(?,?,'assistant',?,'completed',2,?)").run(crypto.randomUUID(),s.id,'回复'.repeat(800),Date.now()+1);
 aiRun.mockImplementation(async()=>completion('旧事'));beforeRun=sql=>{if(!sql.startsWith('UPDATE sessions SET summary_json'))return;beforeRun=undefined;sessionDb.prepare("UPDATE messages SET status='aborted',finish_reason='stopped' WHERE session_id=? AND status='pending'").run(s.id);};
 const text=await(await call('/api/sessions/'+s.id+'/generate','POST',{requestId:crypto.randomUUID(),content:'后来'})).text();await Promise.all(work);expect(text).toContain('"type":"done"');expect(sessionDb.prepare('SELECT summary_json FROM sessions WHERE id=?').get(s.id)?.summary_json).toBeNull();expect(sessionDb.prepare('SELECT status,finish_reason FROM messages WHERE session_id=? ORDER BY created_at DESC LIMIT 1').get(s.id)).toMatchObject({status:'aborted',finish_reason:'stopped'});
});
it('compresses a large streamed prefix on context error without comparing against the old shorter request',async()=>{
 const {s}=await seed();let bodies=0;aiRun.mockImplementation(async request=>{
 if((request.query as {messages:{content:string}[]}).messages[0].content.startsWith('压缩会话记忆'))return completion('事实');
 if(++bodies===1)return new ReadableStream({start(c){c.enqueue(new TextEncoder().encode('data: '+JSON.stringify({choices:[{delta:{content:'字'.repeat(8000)}}]})+'\n\ndata: {"error":{"message":"request (10000 tokens) exceeds the available context size (4096 tokens), try increasing it","n_ctx":4096}}\n\n'));c.close();}});
 return completion('结束。');});await(await call('/api/sessions/'+s.id+'/generate','POST',{requestId:crypto.randomUUID(),content:'开始'})).text();await Promise.all(work);expect(sessionDb.prepare('SELECT content,status FROM messages WHERE session_id=? ORDER BY created_at DESC LIMIT 1').get(s.id)).toMatchObject({content:'字'.repeat(8000)+'结束。',status:'completed'});
});
it('does not call the model if cancellation wins during capability preparation',async()=>{
 const {s}=await seed();const original=env.DB.prepare.bind(env.DB);let entered!:()=>void,release!:()=>void;const enteredPromise=new Promise<void>(r=>entered=r),blocked=new Promise<void>(r=>release=r);
 env.DB.prepare=(sql:string)=>{const stmt=original(sql);if(sql.includes('SELECT value_json,expires_at')){const first=stmt.first.bind(stmt);stmt.first=(async(...args:Parameters<typeof first>)=>{entered();await blocked;return first(...args);}) as typeof stmt.first;}return stmt;};
 const controller=new AbortController(),requestId=crypto.randomUUID();const response=worker.fetch(new Request('https://tavern.test/api/sessions/'+s.id+'/generate',{method:'POST',body:JSON.stringify({requestId,content:'出发'}),signal:controller.signal}),env,ctx);await enteredPromise;controller.abort();release();expect((await response).status).toBe(409);await Promise.all(work);expect(aiRun).not.toHaveBeenCalled();expect(sessionDb.prepare('SELECT generation_id FROM sessions WHERE id=?').get(s.id)?.generation_id).toBeNull();
});
it('sends done and permits another generation while the directory is stalled',async()=>{
 const {s}=await seed();const original=env.DB.prepare.bind(env.DB);let release!:()=>void;const blocked=new Promise<void>(r=>release=r);env.DB.prepare=(sql:string)=>{const stmt=original(sql);if(sql.startsWith('UPDATE sessions SET title')){const run=stmt.run.bind(stmt);stmt.run=(async(...args:Parameters<typeof run>)=>{await blocked;return run(...args);}) as typeof stmt.run;const bind=stmt.bind.bind(stmt);stmt.bind=(...values:unknown[])=>{const bound=bind(...values),boundRun=bound.run.bind(bound);bound.run=async()=>{await blocked;return boundRun();};return bound;};}return stmt;};
 try{const first=await(await call('/api/sessions/'+s.id+'/generate','POST',{requestId:crypto.randomUUID(),content:'你好'})).text();expect(first).toContain('"type":"done"');const second=await(await call('/api/sessions/'+s.id+'/generate','POST',{requestId:crypto.randomUUID(),content:'继续'})).text();expect(second).toContain('"type":"done"');expect(aiRun).toHaveBeenCalledTimes(4);}finally{release();await Promise.all(work);}
});

it.each([0,1,2,3])('independently generates candidates despite %i accidental inline candidates without changing prose and replays persisted results',async count=>{
 const {s}=await seed(),requestId=crypto.randomUUID(),all=['我去港口。','我坐下喝茶。','我问问来路。'];
 aiRun.mockResolvedValueOnce(completion('正文。'+(count?'\n[TAVERN_NEXT]\n'+all.slice(0,count).join('\n'):'')));
 aiRun.mockResolvedValueOnce(candidateCompletion(all));
 const wire=await(await call('/api/sessions/'+s.id+'/generate','POST',{requestId,content:'下一步'})).text();await Promise.all(work);
 const events=wire.split('\n').filter(l=>l.startsWith('data: ')).map(l=>JSON.parse(l.slice(6)));
 expect(events.filter(e=>e.type==='delta').map(e=>e.text).join('')).toBe('正文。');expect(events.at(-1).message).toMatchObject({content:'正文。',candidates:all,status:'completed',finishReason:'stop'});
 const replay=await(await call('/api/sessions/'+s.id+'/generate','POST',{requestId})).json() as {message:Message};expect(replay.message.candidates).toEqual(all);expect(aiRun).toHaveBeenCalledTimes(2);
 expect(aiRun.mock.calls[1][0].query).toHaveProperty('response_format',DIRECTOR_RESPONSE_FORMAT);
});
it.each([JSON.stringify({choices:['一条','两条']}),JSON.stringify({choices:['重复','重复','第三条']}),'我去港口。\n我坐下喝茶。\n我问问来路。'])('rejects invalid Director output atomically and keeps completed prose: %s',async content=>{
 const {s}=await seed();aiRun.mockResolvedValueOnce(completion('正文。')).mockResolvedValueOnce(completion(content));
 const wire=await(await call('/api/sessions/'+s.id+'/generate','POST',{requestId:crypto.randomUUID(),content:'你好'})).text();await Promise.all(work);expect(aiRun).toHaveBeenCalledTimes(2);expect(JSON.parse(wire.trim().split('data: ').at(-1)!).message).toMatchObject({content:'正文。',status:'completed',finishReason:'stop',candidates:[]});
});
it('discards a truncated Director JSON without appending it to story or retrying partial JSON',async()=>{
 const {s}=await seed();aiRun.mockResolvedValueOnce(completion('正文。')).mockResolvedValueOnce(completion('{"choices":["我去港口。","我坐','length'));
 const wire=await(await call('/api/sessions/'+s.id+'/generate','POST',{requestId:crypto.randomUUID(),content:'你好'})).text();await Promise.all(work);expect(JSON.parse(wire.trim().split('data: ').at(-1)!).message).toMatchObject({content:'正文。',status:'completed',candidates:[]});expect(aiRun).toHaveBeenCalledTimes(2);
});
it('immediately cancels candidate recovery and retains the generated body',async()=>{
 const {s}=await seed();const cancelled=vi.fn();aiRun.mockResolvedValueOnce(completion('正文。'));aiRun.mockResolvedValueOnce(new ReadableStream({cancel:cancelled}));
 const reader=(await call('/api/sessions/'+s.id+'/generate','POST',{requestId:crypto.randomUUID(),content:'你好'})).body!.getReader();await reader.read();let wire='';const drain=(async()=>{for(;;){const next=await reader.read();if(next.done)return;wire+=new TextDecoder().decode(next.value);}})();await vi.waitFor(()=>expect(aiRun).toHaveBeenCalledTimes(2));const id=sessionDb.prepare('SELECT generation_id FROM sessions WHERE id=?').get(s.id)?.generation_id;await call('/api/sessions/'+s.id+'/stop','POST',{generationId:id});await drain;await Promise.all(work);expect(cancelled).toHaveBeenCalled();expect(sessionDb.prepare('SELECT content,status,finish_reason FROM messages WHERE id=?').get(id as string)).toMatchObject({content:'正文。',status:'aborted',finish_reason:'stopped'});expect(wire).not.toContain('我去港口');
});
it.each(['http','stream'])('rebuilds disposable Director context only after %s overflow',async mode=>{
 const {s}=await seed();sessionDb.prepare('UPDATE messages SET content=? WHERE session_id=?').run('旧事。'.repeat(2000),s.id);let directors=0;aiRun.mockImplementation(async request=>{
  const q=request.query as {messages:{role:string;content:string}[];response_format?:unknown};
  if(q.messages[0].content.startsWith('压缩会话记忆'))return completion('旧事。');
  if(!q.response_format)return completion('已完成正文。');
  expect(q.messages.at(-1)?.content).toContain(DIRECTOR_RULE);
  if(++directors===1)return mode==='http'?Response.json({error:{n_ctx:4096}},{status:400}):new ReadableStream({start(c){c.enqueue(new TextEncoder().encode('data: {"error":{"n_ctx":4096}}\n\n'));c.close();}});
  expect(JSON.stringify(q.messages)).toContain('旧事。');return candidateCompletion(['我去港口。','我坐下喝茶。','我问问来路。']);
 });
 const wire=await(await call('/api/sessions/'+s.id+'/generate','POST',{requestId:crypto.randomUUID(),content:'接下来呢'})).text();await Promise.all(work);expect(JSON.parse(wire.trim().split('data: ').at(-1)!).message).toMatchObject({content:'已完成正文。',status:'completed',candidates:['我去港口。','我坐下喝茶。','我问问来路。']});expect(directors).toBe(2);expect(sessionDb.prepare('SELECT summary_json FROM sessions WHERE id=?').get(s.id)?.summary_json).toBeNull();
});
it('reuses body worldbook activation, raw user text and wire prefix for Director',async()=>{
 const {s}=await seed();const book=await(await call('/api/worldbooks','POST',{raw:{name:'火山',entries:[{keys:['火山'],content:'火山之约必须保密。',enabled:true}]}})).json() as {id:string};await call('/api/sessions/'+s.id,'PATCH',{bookIds:[book.id]});
 aiRun.mockResolvedValueOnce(completion('她望向火山。')).mockResolvedValueOnce(candidateCompletion(['我坐下。','我问问。','我看窗外。']));
 await(await call('/api/sessions/'+s.id+'/generate','POST',{requestId:crypto.randomUUID(),content:'说说远处的山'})).text();await Promise.all(work);
 const body=aiRun.mock.calls[0][0].query as {messages:{role:string;content:string}[];tools:unknown},candidate=aiRun.mock.calls[1][0].query as typeof body;
 expect(candidate.messages.slice(0,body.messages.length)).toEqual(body.messages);expect(candidate.tools).toEqual(body.tools);expect(candidate.messages.at(-2)).toEqual({role:'assistant',content:'她望向火山。'});expect(body.messages.at(-1)?.content).toBe('说说远处的山');
 await(await call('/api/sessions/'+s.id+'/generate','POST',{requestId:crypto.randomUUID(),content:'然后呢'})).text();await Promise.all(work);const next=aiRun.mock.calls[2][0].query as typeof body;expect(next.messages[0].content).toContain('火山之约必须保密');expect(JSON.stringify(next)).not.toContain(DIRECTOR_RULE);
});
it('appends only the last request output to Director after repeated length continuations',async()=>{
 const {s}=await seed();aiRun.mockResolvedValueOnce(completion('她说：','length')).mockResolvedValueOnce(completion('你好。','length')).mockResolvedValueOnce(completion('坐下吧。')).mockResolvedValueOnce(candidateCompletion(['我坐下。','我问问。','我看窗外。']));
 const wire=await(await call('/api/sessions/'+s.id+'/generate','POST',{requestId:crypto.randomUUID(),content:'你好'})).text();await Promise.all(work);const body=aiRun.mock.calls[2][0].query as {messages:{role:string;content:string}[]},candidate=aiRun.mock.calls[3][0].query as typeof body;expect(candidate.messages.slice(0,body.messages.length)).toEqual(body.messages);expect(candidate.messages.at(-2)).toEqual({role:'assistant',content:'坐下吧。'});expect(JSON.parse(wire.trim().split('data: ').at(-1)!).message.content).toBe('她说：你好。坐下吧。');expect(aiRun).toHaveBeenCalledTimes(4);
});
it('keeps long ordinary conversation at two calls per turn and excludes candidate tasks from projections',async()=>{
 const {s}=await seed();for(let ordinal=1;ordinal<=6;ordinal++)sessionDb.prepare('INSERT INTO messages(id,session_id,role,content,status,ordinal,created_at) VALUES(?,?,?,?,?,?,?)').run('past-'+ordinal,s.id,ordinal%2?'user':'assistant','已发生的重要剧情'+ordinal+'，包含约定和未决线索。','completed',ordinal,Date.now()+ordinal);
 let previous:{role:string;content:string}[]|undefined,system:string|undefined;
 for(const content of ['现在继续','新的情节','再次继续']){
  const at=aiRun.mock.calls.length;await(await call('/api/sessions/'+s.id+'/generate','POST',{requestId:crypto.randomUUID(),content})).text();await Promise.all(work);expect(aiRun.mock.calls.length-at).toBe(2);
  const body=aiRun.mock.calls[at][0].query as {messages:{role:string;content:string}[];tools:unknown;cache_prompt:boolean},candidate=aiRun.mock.calls[at+1][0].query as typeof body;expect(candidate.messages.slice(0,body.messages.length)).toEqual(body.messages);expect(candidate.tools).toEqual(body.tools);expect(body.cache_prompt).toBe(true);expect(candidate.cache_prompt).toBe(true);expect(JSON.stringify(body)).toContain('已发生的重要剧情1');expect(JSON.stringify(body)).not.toContain(DIRECTOR_RULE);
  system??=body.messages[0].content;expect(body.messages[0].content).toBe(system);if(previous)expect(body.messages.slice(0,previous.length)).toEqual(previous);
  previous=JSON.parse(sessionDb.prepare('SELECT value_json FROM model_projections').get()!.value_json as string).messages;
 }
 expect(sessionDb.prepare('SELECT * FROM director_synopsis').all()).toHaveLength(0);expect(sessionDb.prepare('SELECT summary_json FROM sessions WHERE id=?').get(s.id)?.summary_json).toBeNull();
 const projection=sessionDb.prepare('SELECT value_json FROM model_projections ORDER BY rowid DESC').get()!.value_json as string;expect(projection).not.toContain('director_choices');expect(projection).not.toContain(DIRECTOR_RULE);
});

it('lets ordinary authenticated users manage their own cards and sessions while retaining owner isolation', async () => {
 vi.mocked(identity).mockResolvedValue({sub:'auth0|ordinary',email:'ordinary',username:'普通用户',admin:false});
 const created = await call('/api/characters','POST',card);
 expect(created.status).toBe(201);
 const character = await created.json() as {id:string};
 const started = await call('/api/sessions','POST',{characterId:character.id});
 expect(started.status).toBe(201);
 const session = await started.json() as {id:string};
 expect((await call('/api/sessions/'+session.id)).status).toBe(200);
 const requestId = crypto.randomUUID();
 const generated = await call('/api/sessions/'+session.id+'/generate','POST',{requestId,content:'你好'});
 expect(generated.headers.get('Content-Type')).toContain('text/event-stream');
 expect(await generated.text()).toContain('欢迎来到港城。');
 await Promise.all(work);
 expect(aiRun).toHaveBeenCalledWith(expect.anything(),expect.objectContaining({gateway:expect.objectContaining({metadata:{app:'tavern',task:'roleplay',username:'普通用户'}})}));

 vi.mocked(identity).mockResolvedValue({sub:'auth0|other-ordinary',email:'other',username:'另一用户',admin:false});
 expect((await call('/api/characters/'+character.id)).status).toBe(404);
 expect((await call('/api/sessions/'+session.id)).status).toBe(404);
 vi.mocked(identity).mockResolvedValue({sub:'auth0|ordinary',email:'ordinary',username:'普通用户',admin:false});
 expect((await call('/api/sessions/'+session.id,'DELETE')).status).toBe(200);
 expect((await call('/api/characters/'+character.id,'DELETE')).status).toBe(200);
});

it('streams null tool deltas through completion, independent Director, persistence and UUID replay',async()=>{
 const c=await(await call('/api/characters','POST',{name:'Null delta',first_mes:'你好'})).json() as {id:string},s=await(await call('/api/sessions','POST',{characterId:c.id})).json() as {id:string},requestId=crypto.randomUUID();
 aiRun.mockImplementation(async request=>{const candidate=!!(request.query as {response_format?:unknown}).response_format;return new Response('data: '+JSON.stringify({choices:[{delta:{content:candidate?JSON.stringify({choices:['去港口。','问问来路。','坐下喝茶。']}):'正文。',tool_calls:null,reasoning_content:null},finish_reason:null}]})+'\n\ndata: '+JSON.stringify({choices:[{delta:{content:'',tool_calls:null},finish_reason:'stop'}]})+'\n\ndata: [DONE]\n\n',{headers:{'Content-Type':'text/event-stream'}});});
 const wire=await(await call('/api/sessions/'+s.id+'/generate','POST',{requestId,content:'你好'})).text();await Promise.all(work);const frames=wire.split('\n\n').filter(x=>x.startsWith('data: ')).map(x=>JSON.parse(x.slice(6))),done=frames.find(e=>e.type==='done').message;expect(frames.some(e=>e.type==='error')).toBe(false);expect(frames.filter(e=>e.type==='delta').map(e=>e.text).join('')).toBe('正文。');expect(done).toMatchObject({status:'completed',finishReason:'stop',content:'正文。',candidates:['去港口。','问问来路。','坐下喝茶。']});expect(aiRun).toHaveBeenCalledTimes(2);expect((await(await call('/api/sessions/'+s.id)).json() as {messages:Message[]}).messages.at(-1)).toEqual(done);expect(await(await call('/api/sessions/'+s.id+'/generate','POST',{requestId})).json()).toMatchObject({replayed:true,message:done});expect(aiRun).toHaveBeenCalledTimes(2);
});

it('rejects a tool_calls terminal with only null deltas and no actual calls',async()=>{
 const c=await(await call('/api/characters','POST',{name:'empty tool',first_mes:'你好'})).json() as {id:string},s=await(await call('/api/sessions','POST',{characterId:c.id})).json() as {id:string};aiRun.mockResolvedValueOnce(new Response('data: '+JSON.stringify({choices:[{delta:{content:'',tool_calls:null},finish_reason:'tool_calls'}]})+'\n\ndata: [DONE]\n\n',{headers:{'Content-Type':'text/event-stream'}}));const wire=await(await call('/api/sessions/'+s.id+'/generate','POST',{requestId:crypto.randomUUID(),content:'你好'})).text();await Promise.all(work);expect(JSON.parse(wire.trim().split('data: ').at(-1)!).message).toMatchObject({status:'error',finishReason:'unsupported',candidates:[]});expect(aiRun).toHaveBeenCalledTimes(1);
});

it('executes nullable streamed tool fragments, persists state and reuses tool protocol in Director without executing it',async()=>{
 const {s}=await seed(),requestId=crypto.randomUUID(),chunks=[{content:'到了。',tool_calls:null},{content:null,tool_calls:[{index:1,id:'nullable-call',type:'function',function:{name:'update_state',arguments:''}}]},{content:null,tool_calls:[{index:1,id:null,type:null,function:null}]},{content:null,tool_calls:[{index:1,id:null,type:'function',function:{name:null,arguments:'{"patch":{"scene":"北港"}}'}}]}];aiRun.mockResolvedValueOnce(new Response(chunks.map((delta,i)=>'data: '+JSON.stringify({choices:[{delta,finish_reason:i===chunks.length-1?'tool_calls':null}]})+'\n\n').join('')+'data: [DONE]\n\n',{headers:{'Content-Type':'text/event-stream'}})).mockResolvedValueOnce(completion('门开了。'));
 const wire=await(await call('/api/sessions/'+s.id+'/generate','POST',{requestId,content:'到北港'})).text();await Promise.all(work);expect(wire).not.toContain('"type":"error"');const saved=await(await call('/api/sessions/'+s.id)).json() as {session:{state:{scene:string};generationId:string|null};messages:Message[]};expect(saved.messages.at(-1)).toMatchObject({content:'到了。门开了。',status:'completed',finishReason:'stop'});expect(saved.messages.at(-1)?.candidates).toHaveLength(3);expect(saved.session.state.scene).toBe('北港');expect(saved.session.generationId).toBeNull();expect(aiRun).toHaveBeenCalledTimes(3);const body=aiRun.mock.calls[1][0].query as {messages:{role:string;tool_calls?:unknown;tool_call_id?:string;content:string}[]},callAt=body.messages.findIndex(m=>!!m.tool_calls);expect(body.messages[callAt].tool_calls).toEqual([{id:'nullable-call',type:'function',function:{name:'update_state',arguments:'{"patch":{"scene":"北港"}}'}}]);expect(body.messages[callAt+1]).toMatchObject({role:'tool',tool_call_id:'nullable-call',content:'{"ok":true}'});expect((aiRun.mock.calls[2][0].query as typeof body).messages.slice(0,body.messages.length)).toEqual(body.messages);const snapshot=sessionDb.prepare('SELECT * FROM turn_snapshots').get();expect(JSON.parse(snapshot!.steps_json as string)).toHaveLength(1);expect(JSON.parse(snapshot!.after_json as string).scene).toBe('北港');expect(await(await call('/api/sessions/'+s.id+'/generate','POST',{requestId})).json()).toMatchObject({replayed:true,message:saved.messages.at(-1)});expect(aiRun).toHaveBeenCalledTimes(3);
});

it('authenticates character generation before the id route and never persists a generated draft',async()=>{
 const draft={...emptyCharacterDraft(),name:'岚',description:'港城旅店主人'},generated=characterCard({...draft,personality:'沉稳',scenario:'港城',first_mes:'你好',mes_example:'<START>\n{{char}}: 你好'});
 aiRun.mockResolvedValueOnce(new Response('data: '+JSON.stringify({choices:[{delta:{content:JSON.stringify(generated)},finish_reason:'stop'}]})+'\n\ndata: [DONE]\n\n',{headers:{'Content-Type':'text/event-stream'}}));
 const response=await call('/api/characters/generate','POST',{brief:'',draft});expect(response.status).toBe(200);expect(await response.json()).toEqual({card:generated});expect(aiRun).toHaveBeenCalledOnce();expect(aiRun.mock.calls[0][0].query).toMatchObject({model:'dynamic/rp',response_format:CHARACTER_RESPONSE_FORMAT});expect(db.prepare('SELECT count(*) n FROM characters').get()?.n).toBe(0);expect(files.size).toBe(0);
 vi.mocked(identity).mockRejectedValue(new AuthError(401,'请先登录'));expect((await call('/api/characters/generate','POST',{brief:'',draft})).status).toBe(401);expect(aiRun).toHaveBeenCalledOnce();
});

function terminal(wire:string):Message{return JSON.parse(wire.trim().split('data: ').at(-1)!).message;}
it('delivers successive body deltas while upstream completion is still withheld',async()=>{
 const {s}=await seed(),requestId=crypto.randomUUID();let controller!:ReadableStreamDefaultController<Uint8Array>;
 aiRun.mockResolvedValueOnce(new ReadableStream({start(c){controller=c;}}));
 const response=await call('/api/sessions/'+s.id+'/generate','POST',{requestId,content:'开门'}),reader=response.body!.getReader(),decoder=new TextDecoder();let wire=decoder.decode((await reader.read()).value);
 const chunk=(content:string,finish_reason:string|null=null)=>new TextEncoder().encode('data: '+JSON.stringify({choices:[{delta:{content},finish_reason}]})+'\n\n');
 for(const text of ['岚推开门。','她指向柜台。']){
  controller.enqueue(chunk(text));const delta=decoder.decode((await reader.read()).value);wire+=delta;
  expect(JSON.parse(delta.slice(6))).toEqual({type:'delta',text});expect(aiRun).toHaveBeenCalledOnce();expect(sessionDb.prepare('SELECT after_json FROM turn_snapshots').get()?.after_json).toBeNull();
 }
 controller.enqueue(chunk('','stop'));controller.close();for(;;){const part=await reader.read();if(part.done)break;wire+=decoder.decode(part.value);}await Promise.all(work);
 const done=terminal(wire);expect(done).toMatchObject({status:'completed',content:'岚推开门。她指向柜台。'});
 expect((await(await call('/api/sessions/'+s.id)).json() as {messages:Message[]}).messages.at(-1)).toEqual(done);
 expect(await(await call('/api/sessions/'+s.id+'/generate','POST',{requestId})).json()).toMatchObject({replayed:true,message:done});
});
it.each([['<th','ink>秘密'],['< / THI','NKING >秘密'],['<th','i'],['<think data="','<span'],['<think 内容','<']])('holds split reasoning tags and replaces a rejected first version: %s',async(first,last)=>{
 const {s}=await seed();let controller!:ReadableStreamDefaultController<Uint8Array>;
 aiRun.mockResolvedValueOnce(new ReadableStream({start(c){controller=c;}})).mockResolvedValueOnce(completion('岚打开柜台。'));
 const response=await call('/api/sessions/'+s.id+'/generate','POST',{requestId:crypto.randomUUID(),content:'开门'}),reader=response.body!.getReader(),decoder=new TextDecoder();let wire=decoder.decode((await reader.read()).value);
 const chunk=(content:string,finish_reason:string|null=null)=>new TextEncoder().encode('data: '+JSON.stringify({choices:[{delta:{content},finish_reason}]})+'\n\n');
 controller.enqueue(chunk('正文。'+first));const early=decoder.decode((await reader.read()).value);wire+=early;expect(JSON.parse(early.slice(6))).toEqual({type:'delta',text:'正文。'});
 controller.enqueue(chunk(last,'stop'));controller.close();for(;;){const part=await reader.read();if(part.done)break;wire+=decoder.decode(part.value);}await Promise.all(work);
 expect(wire).not.toContain(first);expect(wire).not.toContain('秘密');expect(terminal(wire)).toMatchObject({status:'completed',content:'岚打开柜台。'});expect(aiRun).toHaveBeenCalledTimes(3);
 const events=wire.split('\n\n').filter(x=>x.startsWith('data: ')).map(x=>JSON.parse(x.slice(6)));expect(events.filter(e=>e.type==='delta').map(e=>e.text).join('')).toBe('正文。');
});
it('keeps a streamed rejected first version discarded when stopped during its private revision',async()=>{
 const {s}=await seed(),paragraph='岚在灯下逐项核对那张货单上的库位编号、交付签名与入库时间，随后对照记录册圈出遗漏。'.repeat(3);let controller!:ReadableStreamDefaultController<Uint8Array>;
 aiRun.mockResolvedValueOnce(completion(paragraph+'\n\n'+paragraph)).mockResolvedValueOnce(new ReadableStream({start(c){controller=c;}}));
 const requestId=crypto.randomUUID(),response=await call('/api/sessions/'+s.id+'/generate','POST',{requestId,content:'核对'}),drain=response.text();await vi.waitFor(()=>expect(aiRun).toHaveBeenCalledTimes(2));
 controller.enqueue(new TextEncoder().encode('data: {"choices":[{"delta":{"content":"岚补好交接登记。"}}]}\n\n'));await vi.waitFor(()=>expect(sessionDb.prepare('SELECT content FROM generation_drafts').get()?.content).toBe('岚补好交接登记。'));
 const generationId=sessionDb.prepare('SELECT generation_id FROM sessions WHERE id=?').get(s.id)?.generation_id;await call('/api/sessions/'+s.id+'/stop','POST',{generationId});const wire=await drain;await Promise.all(work);
 expect(wire).toContain(paragraph);const done=terminal(wire);expect(done).toMatchObject({status:'aborted',finishReason:'stopped',content:'岚补好交接登记。'});expect(done.content).not.toContain(paragraph);expect(sessionDb.prepare('SELECT after_json FROM turn_snapshots').get()?.after_json).toBeNull();
 expect(await(await call('/api/sessions/'+s.id+'/generate','POST',{requestId})).json()).toMatchObject({replayed:true,message:done});
});
it('replaces streamed repetition and keeps only accepted story in the next turn',async()=>{
 const {s}=await seed(),paragraph='岚在灯下将那张货单和记录册并排摆好，逐项检查库位编号、交付签名与入库时间。'.repeat(4);
 aiRun.mockResolvedValueOnce(tool('update_state',{patch:{scene:'错位场景',facts:{bad:'拒稿事实'}}})).mockResolvedValueOnce(completion(paragraph+'\n\n'+paragraph)).mockResolvedValueOnce(completion('岚查明交付签名漏填，货物还在原库位。')).mockResolvedValueOnce(candidateCompletion(['我问签名。','我留在这里。','我请岚补登记。']));
 const wire=await(await call('/api/sessions/'+s.id+'/generate','POST',{requestId:crypto.randomUUID(),content:'请岚核对'})).text();await Promise.all(work);expect(terminal(wire)).toMatchObject({status:'completed',content:'岚查明交付签名漏填，货物还在原库位。'});expect(wire).toContain(paragraph);expect(terminal(wire).content).not.toContain(paragraph);expect(aiRun).toHaveBeenCalledTimes(4);expect(JSON.parse(sessionDb.prepare('SELECT after_json FROM turn_snapshots').get()!.after_json as string)).toEqual(emptyState());expect(JSON.parse(sessionDb.prepare('SELECT steps_json FROM turn_snapshots').get()!.steps_json as string)).toEqual([]);
 const projection=JSON.parse(sessionDb.prepare('SELECT value_json FROM model_projections').get()!.value_json as string);expect(JSON.stringify(projection)).not.toContain('拒稿事实');expect(JSON.stringify(projection)).not.toContain(DIRECTOR_RULE);expect(sessionDb.prepare('SELECT * FROM generation_drafts').all()).toHaveLength(0);
 await(await call('/api/sessions/'+s.id+'/generate','POST',{requestId:crypto.randomUUID(),content:'然后呢？'})).text();await Promise.all(work);const next=aiRun.mock.calls[4][0].query as {messages:unknown[]};expect(next.messages.slice(0,projection.messages.length)).toEqual(projection.messages);expect(JSON.stringify(next)).not.toContain('重新生成本次正文');expect(JSON.stringify(next)).not.toContain('错位场景');
});
it('fails after one invalid revision without publishing either draft or state',async()=>{
 const {s}=await seed();aiRun.mockResolvedValueOnce(completion('第一稿。</think>')).mockResolvedValueOnce(completion('第二稿。<thinking>'));
 const wire=await(await call('/api/sessions/'+s.id+'/generate','POST',{requestId:crypto.randomUUID(),content:'继续'})).text();await Promise.all(work);expect(terminal(wire)).toMatchObject({status:'error',finishReason:'review_failed',content:'',candidates:[]});expect(wire).not.toContain('"type":"delta"');expect(aiRun).toHaveBeenCalledTimes(2);expect(sessionDb.prepare('SELECT after_json FROM turn_snapshots').get()?.after_json).toBeNull();expect(sessionDb.prepare('SELECT * FROM generation_drafts').all()).toHaveLength(0);
});
it('streams generating prose and restores a stopped valid partial without state',async()=>{
 const {s}=await seed(),requestId=crypto.randomUUID();let controller!:ReadableStreamDefaultController<Uint8Array>;aiRun.mockResolvedValueOnce(new ReadableStream({start(c){controller=c;}}));
 const response=await call('/api/sessions/'+s.id+'/generate','POST',{requestId,content:'继续'}),drain=response.text();await vi.waitFor(()=>expect(aiRun).toHaveBeenCalledOnce());controller.enqueue(new TextEncoder().encode('data: {"choices":[{"delta":{"content":"岚核对了半页记录。"}}]}\n\n'));await vi.waitFor(()=>expect(sessionDb.prepare('SELECT content FROM generation_drafts').get()?.content).toBe('岚核对了半页记录。'));
 const read=await(await call('/api/sessions/'+s.id)).json() as {messages:Message[];session:{generationId:string}};expect(read.messages.at(-1)).toMatchObject({status:'pending',content:''});expect((await(await call('/api/sessions/'+s.id+'/generate','POST',{requestId})).json() as {message:Message}).message.content).toBe('');await call('/api/sessions/'+s.id+'/stop','POST',{generationId:read.session.generationId});const wire=await drain;await Promise.all(work);expect(terminal(wire)).toMatchObject({status:'aborted',finishReason:'stopped',content:'岚核对了半页记录。'});expect(wire).toContain('"type":"delta"');expect(sessionDb.prepare('SELECT after_json FROM turn_snapshots').get()?.after_json).toBeNull();
});
it('preserves tool and length wire prefixes across buffered newlines',async()=>{
 const {s}=await seed(),native={id:'newline-state',type:'function',function:{name:'update_state',arguments:'{"patch":{"scene":"值班室"}}'}};
 aiRun.mockResolvedValueOnce(new Response('data: '+JSON.stringify({choices:[{delta:{content:'岚核对记录。\n',tool_calls:[{index:0,...native}]},finish_reason:'tool_calls'}]})+'\n\ndata: [DONE]\n\n',{headers:{'Content-Type':'text/event-stream'}})).mockResolvedValueOnce(completion('发现签名漏填。','length')).mockResolvedValueOnce(completion('货物未发出。')).mockResolvedValueOnce(candidateCompletion(['我问签名。','我留在这里。','我请岚补登记。']));
 const wire=await(await call('/api/sessions/'+s.id+'/generate','POST',{requestId:crypto.randomUUID(),content:'核对原因'})).text();await Promise.all(work);expect(terminal(wire).content).toBe('岚核对记录。\n发现签名漏填。货物未发出。');const projection=JSON.parse(sessionDb.prepare('SELECT value_json FROM model_projections').get()!.value_json as string);expect(JSON.stringify(projection)).not.toContain('newline-state');expect(JSON.stringify(projection)).not.toContain(DIRECTOR_RULE);
 await(await call('/api/sessions/'+s.id+'/generate','POST',{requestId:crypto.randomUUID(),content:'然后呢？'})).text();await Promise.all(work);const next=aiRun.mock.calls[4][0].query as {messages:unknown[]};expect(next.messages.slice(0,projection.messages.length)).toEqual(projection.messages);
});
it('never restores a known invalid draft when cancellation wins at its rejection',async()=>{
 const {s}=await seed(),controller=new AbortController();aiRun.mockResolvedValueOnce(completion('正文。</think>'));beforeRun=sql=>{if(aiRun.mock.calls.length>=1&&sql.startsWith('INSERT INTO generation_drafts'))controller.abort();};
 const response=await worker.fetch(new Request('https://tavern.test/api/sessions/'+s.id+'/generate',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({requestId:crypto.randomUUID(),content:'继续'}),signal:controller.signal}),env,ctx);await response.text();await Promise.all(work);beforeRun=undefined;const saved=await(await call('/api/sessions/'+s.id)).json() as {messages:Message[]};expect(saved.messages.at(-1)).toMatchObject({status:'aborted',content:'',finishReason:'disconnected'});expect(sessionDb.prepare('SELECT * FROM generation_drafts').all()).toHaveLength(0);expect(sessionDb.prepare('SELECT after_json FROM turn_snapshots').get()?.after_json).toBeNull();
});
it('repairs cross-turn replay once, keeps the source history and appends the accepted next-turn prefix',async()=>{
 const {s}=await seed(),a='岚将货单和记录册并排放在台灯下，逐项核对库位编号、交付签名与入库时间。她翻到交付登记的下一页，对照两处经手人的字迹，又把未填写的栏目用笔圈出，确认记录上的批次与桌面货单一致。',b='这批货尚未获得复核签名，也没有装车放行的记录。岚把这两项核对结果记在表格里，合上账簿并收好印章；接下来要核查的就是复核人员为何未完成签字，而不需要再重复对照同一份货单。',body=a+'\n\n'+b;
 aiRun.mockResolvedValueOnce(completion(body)).mockResolvedValueOnce(candidateCompletion(['我等结果。','我问签字人。','我想先喝茶。']));await(await call('/api/sessions/'+s.id+'/generate','POST',{requestId:crypto.randomUUID(),content:'请岚查清原因'})).text();await Promise.all(work);
 aiRun.mockResolvedValueOnce(completion(body)).mockResolvedValueOnce(completion('岚联系复核人员，查明签字遗漏源于值班交接未完成，随即按原批次补好登记。')).mockResolvedValueOnce(candidateCompletion(['我问后续。','我看登记。','我想先喝茶。']));const wire=await(await call('/api/sessions/'+s.id+'/generate','POST',{requestId:crypto.randomUUID(),content:'继续。'})).text();await Promise.all(work);expect(terminal(wire)).toMatchObject({status:'completed',content:'岚联系复核人员，查明签字遗漏源于值班交接未完成，随即按原批次补好登记。'});expect(wire).toContain(a);expect(terminal(wire)?.content??'').not.toContain(a);expect(aiRun).toHaveBeenCalledTimes(5);
 const repaired=aiRun.mock.calls[3][0].query as {messages:{content:string}[]};expect(repaired.messages.filter(m=>m.content===body)).toHaveLength(1);const projection=JSON.parse(sessionDb.prepare('SELECT value_json FROM model_projections').get()!.value_json as string);
 await(await call('/api/sessions/'+s.id+'/generate','POST',{requestId:crypto.randomUUID(),content:'下一步呢？'})).text();await Promise.all(work);const next=aiRun.mock.calls[5][0].query as {messages:unknown[]};expect(next.messages.slice(0,projection.messages.length)).toEqual(projection.messages);
});
it('settles and recovers when the last private checkpoint fails',async()=>{
 const {s}=await seed();let checkpoints=0;beforeRun=sql=>{if(sql.startsWith('INSERT INTO generation_drafts')&&++checkpoints===3)throw Error('final checkpoint unavailable');};
 const wire=await(await call('/api/sessions/'+s.id+'/generate','POST',{requestId:crypto.randomUUID(),content:'你好'})).text();await Promise.all(work);beforeRun=undefined;expect(wire).not.toContain('"type":"done"');const read=await(await call('/api/sessions/'+s.id)).json() as {messages:Message[];session:{generationId:string|null}};expect(read.session.generationId).toBeNull();expect(read.messages.at(-1)).toMatchObject({content:'欢迎来到港城。',status:'aborted',finishReason:'interrupted'});expect(sessionDb.prepare('SELECT after_json FROM turn_snapshots').get()?.after_json).toBeNull();
});
it('settles and closes transmission when invalid draft discard fails during final cleanup',async()=>{
 const {s}=await seed();let failures=0;aiRun.mockResolvedValueOnce(completion('正文。</think>')).mockResolvedValueOnce(completion('修订。</think>'));beforeRun=sql=>{if(aiRun.mock.calls.length>=2&&sql.startsWith('INSERT INTO generation_drafts')){failures++;if(failures<=2)throw Error('discard unavailable');}};
 const wire=await(await call('/api/sessions/'+s.id+'/generate','POST',{requestId:crypto.randomUUID(),content:'继续'})).text();await Promise.all(work);beforeRun=undefined;expect(failures).toBeGreaterThanOrEqual(1);expect(wire).not.toContain('"type":"done"');expect(wire).not.toContain('正文。');const read=await(await call('/api/sessions/'+s.id)).json() as {messages:Message[];session:{generationId:string|null}};expect(read.session.generationId).toBeNull();expect(read.messages.at(-1)?.status).toBe('aborted');expect((await call('/api/sessions/'+s.id,'DELETE')).status).toBe(200);
});

it.each(['stop',null])('does not discard an unfinished repeated paragraph prefix that later differs: %s',async finish=>{
 const {s}=await seed(),a='岚逐项检查货单上的库位、交付签名、入库时间和经手记录，并把已经确认的两处遗漏圈出。'.repeat(3);let controller!:ReadableStreamDefaultController<Uint8Array>;
 aiRun.mockResolvedValueOnce(new ReadableStream({start(c){controller=c;}}));const draining=(await call('/api/sessions/'+s.id+'/generate','POST',{requestId:crypto.randomUUID(),content:'继续核对'})).text();await vi.waitFor(()=>expect(aiRun).toHaveBeenCalledOnce());
 const chunk=(content:string,finish_reason:string|null=null)=>new TextEncoder().encode('data: '+JSON.stringify({choices:[{delta:{content},finish_reason}]})+'\n\n');controller.enqueue(chunk(a+'\n\n'+a));await vi.waitFor(()=>expect(sessionDb.prepare('SELECT content FROM generation_drafts').get()?.content).toBe(a+'\n\n'+a));
 controller.enqueue(chunk('但这次她查明交接表的空项只是待补签，货物实际尚未装车。',finish));controller.close();const wire=await draining;await Promise.all(work);expect(terminal(wire)).toMatchObject({content:a+'\n\n'+a+'但这次她查明交接表的空项只是待补签，货物实际尚未装车。',status:finish==='stop'?'completed':'error'});expect(aiRun).toHaveBeenCalledTimes(finish==='stop'?2:1);
});
it('regenerates a rejected legacy continuation from its before-state without its invalid prefix or tools',async()=>{
 const {s}=await seed();await(await call('/api/sessions/'+s.id+'/generate','POST',{requestId:crypto.randomUUID(),content:'请岚核对原因'})).text();await Promise.all(work);sessionDb.prepare("UPDATE messages SET content='旧残稿。<think>秘密',status='aborted',finish_reason='stopped' WHERE role='assistant' AND ordinal=2").run();aiRun.mockClear();
 aiRun.mockResolvedValueOnce(tool('update_state',{patch:{scene:'拒稿场景'}})).mockResolvedValueOnce(completion('补写。')).mockResolvedValueOnce(completion('岚查明漏签导致货物未发出，随后补好交接登记。')).mockResolvedValueOnce(candidateCompletion(['我问交接。','我留在这里。','我喝茶。']));
 const wire=await(await call('/api/sessions/'+s.id+'/generate','POST',{requestId:crypto.randomUUID(),continue:true})).text();await Promise.all(work);expect(terminal(wire)).toMatchObject({status:'completed',content:'岚查明漏签导致货物未发出，随后补好交接登记。'});expect(wire).not.toContain('旧残稿');const retry=aiRun.mock.calls[2][0].query as {messages:{content:string}[]};expect(JSON.stringify(retry)).not.toContain('旧残稿');expect(JSON.stringify(retry)).not.toContain('拒稿场景');expect(retry.messages.some(m=>m.content==='请岚核对原因')).toBe(true);expect(retry.messages.some(m=>m.content==='继续上一条回复，从中断处接着写，不要重复已有内容。')).toBe(false);expect(JSON.parse(sessionDb.prepare('SELECT after_json FROM turn_snapshots ORDER BY rowid DESC LIMIT 1').get()!.after_json as string)).toEqual(emptyState());expect(sessionDb.prepare("SELECT count(*) n FROM messages WHERE role='user'").get()?.n).toBe(1);
});

it('compresses a plain length continuation projection without tools and saves the whole completed body',async()=>{
 const {s}=await seed();db.prepare('UPDATE model_capabilities SET value_json=?').run(JSON.stringify({contextTokens:2048,inputRatio:1.2,source:'llama.cpp:n_ctx'}));let bodies=0,summaries=0;const prose='记录已核对，货物仍在暂存区。'.repeat(400);
 aiRun.mockImplementation(async request=>{const q=request.query as {messages:{content:string;role:string}[];response_format?:unknown};if(q.messages[0].content.startsWith('压缩会话记忆')){summaries++;return completion('货物仍在暂存区。');}if(q.response_format)return candidateCompletion(['我问交接。','我留在这里。','我喝茶。']);if(++bodies===1)return completion(prose,'length');expect(q.messages.some(m=>m.content.includes('已发生正文摘要'))).toBe(true);expect(q.messages.some(m=>m.role==='tool')).toBe(false);return completion('岚补好登记，交付恢复。');});
 const wire=await(await call('/api/sessions/'+s.id+'/generate','POST',{requestId:crypto.randomUUID(),content:'核查并处理'})).text();await Promise.all(work);expect(terminal(wire)).toMatchObject({content:prose+'岚补好登记，交付恢复。',status:'completed',finishReason:'stop'});expect(bodies).toBe(2);expect(summaries).toBeGreaterThan(0);expect(sessionDb.prepare('SELECT after_json FROM turn_snapshots').get()?.after_json).not.toBeNull();
});

it('does not restore a streamed repeated draft when discard fails and idle recovery retries',async()=>{
 const {s}=await seed(),a='岚逐项核对货单和记录，检查经手签名、库位编号与入库时间，圈出仍需补全的交接栏。'.repeat(3);let controller!:ReadableStreamDefaultController<Uint8Array>;
 aiRun.mockResolvedValueOnce(new ReadableStream({start(c){controller=c;}}));const draining=(await call('/api/sessions/'+s.id+'/generate','POST',{requestId:crypto.randomUUID(),content:'继续'})).text();await vi.waitFor(()=>expect(aiRun).toHaveBeenCalledOnce());controller.enqueue(new TextEncoder().encode('data: '+JSON.stringify({choices:[{delta:{content:a+'\n\n'+a}}]})+'\n\n'));await vi.waitFor(()=>expect(sessionDb.prepare('SELECT content FROM generation_drafts').get()?.content).toBe(a+'\n\n'+a));
 let failures=0;beforeRun=sql=>{if(sql.startsWith('DELETE FROM generation_drafts')&&++failures<=2)throw Error('discard unavailable');};const id=sessionDb.prepare('SELECT generation_id FROM sessions WHERE id=?').get(s.id)?.generation_id;await call('/api/sessions/'+s.id+'/stop','POST',{generationId:id});const wire=await draining;await Promise.all(work);beforeRun=undefined;expect(wire).toContain(a);expect(terminal(wire)?.content??'').not.toContain(a);const read=await(await call('/api/sessions/'+s.id)).json() as {messages:Message[];session:{generationId:string|null}};expect(read.messages.at(-1)).toMatchObject({content:'',status:'aborted',finishReason:'stopped'});expect(read.session.generationId).toBeNull();expect(sessionDb.prepare('SELECT * FROM generation_drafts').all()).toHaveLength(0);
});

it('keeps a durably rejected cross-turn replay empty when final cleanup fails',async()=>{
 const {s}=await seed(),a='岚将货单和记录册并排放在台灯下，逐项核对库位编号、交付签名与入库时间。她翻到交付登记的下一页，对照两处经手人的字迹，又把未填写的栏目用笔圈出，确认记录上的批次与桌面货单一致。',b='这批货尚未获得复核签名，也没有装车放行的记录。岚把这两项核对结果记在表格里，合上账簿并收好印章；接下来要核查的就是复核人员为何未完成签字，而不需要再重复对照同一份货单。',body=a+'\n\n'+b;
 aiRun.mockResolvedValueOnce(completion(body)).mockResolvedValueOnce(candidateCompletion(['我问签字。','我等结果。','我喝茶。']));await(await call('/api/sessions/'+s.id+'/generate','POST',{requestId:crypto.randomUUID(),content:'核对'})).text();await Promise.all(work);aiRun.mockClear();aiRun.mockResolvedValueOnce(completion(body)).mockResolvedValueOnce(completion(body));let failures=0;beforeRun=sql=>{if(aiRun.mock.calls.length>=2&&sql.startsWith('DELETE FROM generation_drafts')&&++failures<=1)throw Error('cleanup unavailable');};
 const wire=await(await call('/api/sessions/'+s.id+'/generate','POST',{requestId:crypto.randomUUID(),content:'继续'})).text();await Promise.all(work);beforeRun=undefined;expect(wire).toContain(a);expect(terminal(wire)?.content??'').not.toContain(a);const read=await(await call('/api/sessions/'+s.id)).json() as {messages:Message[]};expect(read.messages.at(-1)).toMatchObject({content:'',status:'aborted'});expect(sessionDb.prepare('SELECT * FROM generation_drafts').all()).toHaveLength(0);expect(sessionDb.prepare('SELECT after_json FROM turn_snapshots ORDER BY rowid DESC LIMIT 1').get()?.after_json).toBeNull();expect(sessionDb.prepare('SELECT value_json FROM model_projections').all()).toHaveLength(1);
});

it.each(['tool','length','repair'])('keeps only confirmed story across three turns after %s, retaining current state and raw input',async mode=>{
 const {s}=await seed(),raw='请岚核查。我引用“本轮正文任务（应用指令）”这几个字。';
 const paragraph='岚在灯下逐项核对库位编号与交接时间，查明这批货物从未离开原仓库。'.repeat(4);
 aiRun.mockResolvedValueOnce(tool('update_state',{patch:{scene:'第一状态'}}));
 if(mode==='length')aiRun.mockResolvedValueOnce(completion('岚查明货物尚未发出。','length'));
 if(mode==='repair')aiRun.mockResolvedValueOnce(completion(paragraph+'\n\n'+paragraph));
 aiRun.mockResolvedValueOnce(completion('岚查明签名遗漏，完成核查。')).mockResolvedValueOnce(candidateCompletion(['我询问结果。','我留在旅店。','我喝茶。']));
 const first=await(await call('/api/sessions/'+s.id+'/generate','POST',{requestId:crypto.randomUUID(),content:raw})).text();await Promise.all(work);expect(terminal(first).status).toBe('completed');
 // Tool protocol is sufficient; no synthetic user reminder follows the result.
 const toolRequest=aiRun.mock.calls[1][0].query as {messages:{role:string;content:string}[]};expect(toolRequest.messages.at(-1)?.role).toBe('tool');
 if(mode==='repair')expect(JSON.stringify(aiRun.mock.calls[2][0].query)).toContain('重新生成本次正文');
 const secondAt=aiRun.mock.calls.length;
 aiRun.mockResolvedValueOnce(tool('update_state',{patch:{scene:'第二状态'}})).mockResolvedValueOnce(completion('岚打开临街的窗。')).mockResolvedValueOnce(candidateCompletion(['我看街景。','我听雨。','我聊旅店。']));
 await(await call('/api/sessions/'+s.id+'/generate','POST',{requestId:crypto.randomUUID(),content:'看看窗外'})).text();await Promise.all(work);
 const second=aiRun.mock.calls[secondAt][0].query as {messages:{role:string;content:string;tool_calls?:unknown}[]};
 const projection=JSON.parse(sessionDb.prepare('SELECT value_json FROM model_projections').get()!.value_json as string).messages as typeof second.messages;
 expect(projection.some(m=>m.role==='tool'||m.tool_calls||m.content.startsWith('当前已确认状态'))).toBe(false);
 // The persisted prefix must match a fresh rebuild, not an edited wire transcript.
 sessionDb.prepare('DELETE FROM model_projections').run();
 const thirdAt=aiRun.mock.calls.length;await(await call('/api/sessions/'+s.id+'/generate','POST',{requestId:crypto.randomUUID(),content:'聊聊旅店'})).text();await Promise.all(work);
 const third=aiRun.mock.calls[thirdAt][0].query as typeof second;expect(third.messages.slice(0,projection.length)).toEqual(projection);
 for(const [q,scene] of [[second,mode==='repair'?null:'第一状态'],[third,'第二状态']] as const){
  const states=q.messages.filter(m=>m.content.startsWith('当前已确认状态'));expect(states).toHaveLength(scene?1:0);if(scene){expect(states[0].content).toContain(scene);expect(states[0].content).not.toContain('应用指令');}
  expect(q.messages.some(m=>m.role==='tool'||m.tool_calls)).toBe(false);expect(q.messages.find(m=>m.content===raw)).toEqual({role:'user',content:raw});
  expect(JSON.stringify(q)).not.toContain('重新生成本次正文');expect(JSON.stringify(q)).not.toContain('接着最后一条未完成的正文续写');expect(JSON.stringify(q)).not.toContain(DIRECTOR_RULE);
 }
 expect(JSON.stringify(third)).not.toContain('第一状态');expect(JSON.stringify(third)).toContain('岚查明签名遗漏，完成核查。');
});

it('reuses a validated checkpoint with full accepted story and excludes discarded request controls',async()=>{
 const {s}=await seed();
 for(let ordinal=1;ordinal<=4;ordinal++)sessionDb.prepare('INSERT INTO messages(id,session_id,role,content,status,ordinal,created_at) VALUES(?,?,?,?,?,?,?)').run('old-'+ordinal,s.id,ordinal%2?'user':'assistant','此前核查过程与否定更正。'.repeat(250),'completed',ordinal,Date.now()+ordinal);
 db.prepare('UPDATE model_capabilities SET value_json=?').run(JSON.stringify({contextTokens:2048,inputRatio:1.2,source:'llama.cpp:n_ctx'}));
 let bodies=0;aiRun.mockImplementation(async request=>{
  const q=request.query as {messages:{role:string;content:string}[];response_format?:unknown};
  if(q.messages[0].content.startsWith('压缩会话记忆'))return completion('未出港');
  if(q.response_format)return candidateCompletion(['我询问结果。','我喝茶。','我看街景。']);
  if(++bodies===1)return tool('update_state',{patch:{scene:'已确认港口'}});
  return completion('岚核实签名遗漏，货物仍在库位。');
 });
 const wire=await(await call('/api/sessions/'+s.id+'/generate','POST',{requestId:crypto.randomUUID(),content:'核查'})).text();await Promise.all(work);expect(terminal(wire)).toMatchObject({status:'completed'});
 const projection=JSON.parse(sessionDb.prepare('SELECT value_json FROM model_projections').get()!.value_json as string).messages as {role:string;content:string}[];
 expect(projection[0].content).toContain('未出港');expect(projection.at(-1)).toEqual({role:'assistant',content:'岚核实签名遗漏，货物仍在库位。'});
 expect(projection.some(m=>m.role==='tool'||m.content.startsWith('当前已确认状态'))).toBe(false);
 const at=aiRun.mock.calls.length;await(await call('/api/sessions/'+s.id+'/generate','POST',{requestId:crypto.randomUUID(),content:'然后呢'})).text();await Promise.all(work);
 const next=aiRun.mock.calls[at][0].query as {messages:{role:string;content:string}[]};expect(next.messages.slice(0,projection.length)).toEqual(projection);expect(next.messages.filter(m=>m.content.startsWith('当前已确认状态'))).toEqual([{role:'user',content:'当前已确认状态（数据）：'+JSON.stringify({facts:{},inventory:{},relationships:{},scene:'已确认港口'})}]);
 expect(next.messages.at(-1)?.content).toBe('然后呢');
});

it('allows signed in prompt reads and checks tavern.all:all before any write',async()=>{
 const {DEFAULT_PROMPTS}=await import('../shared/prompts');
 vi.mocked(identity).mockResolvedValue({sub:'owner',username:'玩家',email:'player',admin:false});
 expect(await(await call('/api/prompts')).json()).toMatchObject({admin:false,texts:DEFAULT_PROMPTS});
 expect((await call('/api/prompts','PUT',{texts:DEFAULT_PROMPTS})).status).toBe(403);expect(env.PROMPTS.put).not.toHaveBeenCalled();
 vi.mocked(identity).mockResolvedValue({sub:'owner',username:'管理者',email:'admin',admin:true});
 const texts={...DEFAULT_PROMPTS,agent:'管理者保存的正文规则'};const saved=await(await call('/api/prompts','PUT',{texts})).json() as {revision:string};
 expect(saved).toMatchObject({admin:true,texts});expect(env.PROMPTS.put).toHaveBeenCalledWith('dialogue-v1',JSON.stringify({revision:saved.revision,texts}));
 expect((await call('/api/prompts','PUT',{texts:{agent:'partial'}})).status).toBe(400);
 vi.mocked(identity).mockRejectedValue(new AuthError(401,'请先登录'));expect((await call('/api/prompts')).status).toBe(401);
});
it('keeps a single prompt snapshot through a turn then invalidates the old projection after editing',async()=>{
 const {DEFAULT_PROMPTS}=await import('../shared/prompts');
 let document={revision:'one',texts:{...DEFAULT_PROMPTS,agent:'第一版正文协议',director:'第一版候选协议'}};
 Object.assign(env.PROMPTS,{get:vi.fn(async()=>JSON.stringify(document))});
 const original=aiRun.getMockImplementation()!;
 aiRun.mockImplementation(async(data,options)=>{const result=await original(data,options);document={revision:'two',texts:{...DEFAULT_PROMPTS,agent:'第二版正文协议',director:'第二版候选协议'}};return result;});
 const {s}=await seed();const path='/api/sessions/'+s.id+'/generate';
 await(await call(path,'POST',{requestId:crypto.randomUUID(),content:'第一轮'})).text();await Promise.all(work);
 expect(env.PROMPTS.get).toHaveBeenCalledTimes(1);
 const first=aiRun.mock.calls.map(([data])=>(data.query as {messages:{content:string}[]}).messages);
 expect(first[0][0].content).toContain('第一版正文协议');expect(first[1].at(-1)!.content).toContain('第一版候选协议');expect(JSON.stringify(first)).not.toContain('第二版');
 await(await call(path,'POST',{requestId:crypto.randomUUID(),content:'第二轮'})).text();await Promise.all(work);
 const next=(aiRun.mock.calls[2][0].query as {messages:{content:string}[]}).messages;
 expect(next[0].content).toContain('第二版正文协议');expect(JSON.stringify(next)).not.toContain('第一版');expect(env.PROMPTS.get).toHaveBeenCalledTimes(2);
});
