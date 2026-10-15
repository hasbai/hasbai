// Isolated real workerd/SQLite acceptance. This harness is never bundled into the production Worker.
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {readFileSync,readdirSync,mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
const require=createRequire(import.meta.url),runtimeRequire=createRequire(require.resolve('wrangler'));
const {Miniflare,convertV4MiniflareOptions}=runtimeRequire('miniflare'),{build}=runtimeRequire('esbuild');
const root=resolve(import.meta.dirname,'..'),persist=mkdtempSync(join(tmpdir(),'tavern-session-'));
const source=`
import {TavernSession} from './worker/session-object';
export class TestSession extends TavernSession {
 async inspectStorage(){const tables=this.ctx.storage.sql.exec("SELECT name FROM sqlite_master WHERE type='table'").toArray().map(r=>r.name).filter(n=>!n.startsWith('_cf')&&!n.startsWith('sqlite_'));return {tables,drafts:tables.includes('generation_drafts')?this.ctx.storage.sql.exec('SELECT content FROM generation_drafts').toArray():[],alarm:await this.ctx.storage.getAlarm(),bytes:this.ctx.storage.sql.databaseSize};}
 async checkRecovery(owner,id,mode){
  await this.invoke(owner,id,'read',{});
  const requestId=crypto.randomUUID(),generate=()=>this.fetch(new Request('https://session/generate',{method:'POST',headers:{'X-Tavern-Owner':owner,'X-Tavern-Session':id,'Content-Type':'application/json'},body:JSON.stringify({requestId,content:'问候'})}));
  this.ctx.storage.sql.exec(mode==='snapshot'?"CREATE TRIGGER fail_write BEFORE INSERT ON turn_snapshots BEGIN SELECT RAISE(ABORT,'snapshot unavailable'); END;":mode==='persistent'?"CREATE TRIGGER fail_write BEFORE UPDATE ON messages BEGIN SELECT RAISE(ABORT,'storage unavailable'); END;":"CREATE TRIGGER fail_write BEFORE UPDATE OF candidates_json ON messages WHEN NEW.status='completed' BEGIN SELECT RAISE(ABORT,'final unavailable'); END;");
  if(mode==='snapshot'){let rejected=false;try{await generate();}catch{rejected=true;}if(!rejected)throw Error('snapshot failure missing');if(this.ctx.storage.sql.exec('SELECT * FROM messages WHERE request_id=?',requestId).toArray().length)throw Error('initial messages not rolled back');}
  else{const wire=await(await generate()).text();if(wire.includes('"type":"done"'))throw Error('failed persistence reported done');}
  // Let the task finish in this object, then recover without evicting it or rerunning the model.
  for(let n=0;n<100;n++){if(!this.active)break;await new Promise(r=>setTimeout(r,10));}
  if(this.active)throw Error('failed task retained active');
  this.ctx.storage.sql.exec('DROP TRIGGER fail_write');
  let result=JSON.parse(await this.invoke(owner,id,'read',{}));if(result.value.session.generationId!==null)throw Error('failed task retained lock');
  if(mode==='snapshot'){const wire=await(await generate()).text();if(!wire.includes('"status":"completed"'))throw Error('same UUID failed retry');}
  else{const saved=result.value.messages.at(-1);if(saved.content!=='你好。'||saved.status!=='aborted'||saved.finishReason!=='interrupted')throw Error('failed task not interrupted');if((await(await generate()).json()).replayed!==true)throw Error('failed task not replayed');}
  let removed;for(let n=0;n<100;n++){removed=JSON.parse(await this.invoke(owner,id,'remove',{}));if(removed.ok||removed.status!==409)break;await new Promise(r=>setTimeout(r,10));}if(!removed.ok)throw Error('failed task retained deletion');return {mode,recovered:true,storage:await this.inspectStorage()};
 }
 async checkBackpressure(owner,id,phase){
  const response=await this.fetch(new Request('https://session/generate',{method:'POST',headers:{'X-Tavern-Owner':owner,'X-Tavern-Session':id,'Content-Type':'application/json'},body:JSON.stringify({requestId:crypto.randomUUID(),content:'问候'})})),reader=response.body.getReader();
  const decoder=new TextDecoder();
  if(phase!=='start'){const frame=decoder.decode((await reader.read()).value);if(!frame.includes('"type":"start"'))throw Error('start missing');}
  if(phase==='candidates_pending'||phase==='completed'){const frame=decoder.decode((await reader.read()).value);if(!frame.includes('"type":"delta"'))throw Error('delta missing');}
  if(phase==='completed'){const frame=decoder.decode((await reader.read()).value);if(!frame.includes('"type":"candidates_pending"'))throw Error('candidate event missing');}
  await new Promise(r=>setTimeout(r,10));
  if(phase!=='completed'){const generationId=this.ctx.storage.sql.exec('SELECT generation_id FROM sessions WHERE id=?',id).toArray()[0].generation_id;await this.invoke(owner,id,'stop',{generationId});}
  for(let n=0;n<100;n++){if(this.ctx.storage.sql.exec('SELECT generation_id FROM sessions WHERE id=?',id).toArray()[0].generation_id===null)break;await new Promise(r=>setTimeout(r,10));}
  if(this.ctx.storage.sql.exec('SELECT generation_id FROM sessions WHERE id=?',id).toArray()[0].generation_id!==null)throw Error('reader retained generation');
  // Deletion must be possible before draining the generation stream.
  const removed=JSON.parse(await this.invoke(owner,id,'remove',{}));if(!removed.ok)throw Error('active generation retained deletion');
  let wire='';for(;;){const next=await reader.read();if(next.done)break;wire+=decoder.decode(next.value);}return {wire,storage:await this.inspectStorage()};
 }
 constructor(ctx,env){super(ctx,{...env,AIG_RP_RUN_TOKEN:'fixture-only'});globalThis.fetch=async(url,options)=>{if(!String(url).includes('/compat/chat/completions'))throw Error('fixture unexpected fetch');const request={provider:'compat',endpoint:'chat/completions',query:JSON.parse(options.body)};if(request.query.model!=='dynamic/rp'||request.provider!=='compat'||request.endpoint!=='chat/completions')throw Error('gateway binding contract missing');
 if(request.query.messages.some(m=>m.content.includes('本消息是每轮应用写作提醒')))throw new Error('body reminder leaked');
 if(!request.query.response_format&&request.query.messages.filter(m=>m.content.startsWith('当前已确认状态')).length>1)throw new Error('historical state accumulated');
 if(!request.query.response_format&&request.query.messages.at(-1).content==='污染验收继续'){if(request.query.messages.some(m=>m.role==='tool'||m.tool_calls))throw new Error('historical tool protocol accumulated');const states=request.query.messages.filter(m=>m.content.startsWith('当前已确认状态'));if(states.length!==1||!states[0].content.includes('北港'))throw new Error('current state missing');}
 const director=!!request.query.response_format;const synopsis=request.query.messages.at(-1).content.startsWith('本次任务是压缩');const input=request.query.messages.at(-1).content;if(synopsis&&(request.query.messages.some(m=>m.role==='system')||request.query.messages.at(-1).role!=='user'))throw new Error('summary must end with one user task without system');
 if(request.query.messages.some(m=>!m.content.isWellFormed()))throw new Error('split Unicode in model projection');
 if(!director&&!synopsis&&!request.query.messages.at(-1).content.startsWith('本次任务是压缩')&&request.query.messages.some(m=>m.role==='user'&&m.content.includes('同次长正文工具'))){
  const results=request.query.messages.filter(m=>m.role==='tool');if(!results.length)return new Response('data: '+JSON.stringify({choices:[{delta:{content:'😀'.repeat(2201),tool_calls:[{index:0,id:'prose-call',type:'function',function:{name:'update_state',arguments:'{"patch":{"scene":"港口"}}'}}]},finish_reason:'tool_calls'}]})+'\\n\\ndata: [DONE]\\n\\n',{headers:{'Content-Type':'text/event-stream'}});
  throw new Error('must not retry oversized tool prose');
 }
 if(!director&&!synopsis&&request.query.messages.some(m=>m.role==='user'&&m.content.includes('检索两个片段'))){
  const results=request.query.messages.filter(m=>m.role==='tool');
  if(results.length<4){const query=results.length?'银怀表':'北门钥匙',name=results.length<2?'search_memory':'read_memory',args=results.length<2?{query}:{id:JSON.parse(results[0].content)[0].id,offset:(results.length-2)*1200};return new Response('data: '+JSON.stringify({choices:[{delta:{tool_calls:[{index:0,id:'recall-'+results.length,type:'function',function:{name,arguments:JSON.stringify(args)}}]},finish_reason:'tool_calls'}]})+'\\n\\ndata: [DONE]\\n\\n',{headers:{'Content-Type':'text/event-stream'}});}
  const hits=results.slice(0,2).map(m=>JSON.parse(m.content)[0]);const pages=results.slice(2).map(m=>JSON.parse(m.content));if(pages[0].nextOffset!==1200||pages[1].nextOffset!==null||!pages.map(p=>p.text).join('').includes('银怀表藏在南塔。'))throw Error('full original pages missing');if(hits[0].source.messageId!==hits[1].source.messageId||!hits[0].text.includes('北门钥匙在南塔')||!hits[0].text.isWellFormed()||hits[0].text.includes('银怀表')||!hits[1].text.includes('银怀表藏在南塔'))throw new Error('memory fragment provenance missing');
 }
 if(!director&&input.includes('工具抵达北港')&&!request.query.messages.some(m=>m.role==='tool'))return new Response([{tool_calls:[{index:1,id:'state-call',type:'function',function:{name:'update_state',arguments:''}}]},{tool_calls:[{index:1,id:null,type:null,function:null}]},{tool_calls:[{index:1,id:null,type:'function',function:{name:null,arguments:'{"patch":{"scene":"北港"}}'}}]}].map((delta,i)=>'data: '+JSON.stringify({choices:[{delta,finish_reason:i===2?'tool_calls':null}]})+'\\n\\n').join('')+'data: [DONE]\\n\\n',{headers:{'Content-Type':'text/event-stream'}});
 if(director){if(!request.query.tools||request.query.tool_choice!=='none'||request.query.messages.at(-1).role!=='user'||request.query.messages.slice(1).some(m=>m.role==='system'))throw new Error('Director prefix missing');if(input.includes('本轮正文任务（应用指令）'))throw new Error('Director reminder leaked');}
 if(director&&request.query.messages.some(m=>m.role==='user'&&m.content==='候选时重启'))return new Response(new ReadableStream(),{headers:{'Content-Type':'text/event-stream'}});
 if(!director&&input==='正文时重启')return new Response(new ReadableStream({start(c){c.enqueue(new TextEncoder().encode('data: '+JSON.stringify({choices:[{delta:{content:'重启前半句。'}}]})+'\\n\\n'));}}),{headers:{'Content-Type':'text/event-stream'}});
 if(!director&&input.includes('等待'))return new Response(new ReadableStream(),{headers:{'Content-Type':'text/event-stream'}});
 return new Response('data: '+JSON.stringify({choices:[{delta:{tool_calls:null,content:director?JSON.stringify({choices:['我坐下。','我问问。','我看窗外。']}):synopsis?'旧事':'你好。'},finish_reason:'stop'}]})+'\\n\\ndata: [DONE]\\n\\n',{headers:{'Content-Type':'text/event-stream'}});
 };}
}
export default {async fetch(request,env){const d=await request.json();const stub=env.SESSIONS.getByName(JSON.stringify([d.owner,d.id]));
 if(d.method==='recovery')return Response.json(await stub.checkRecovery(d.owner,d.id,d.data.mode));
 if(d.method==='backpressure')return Response.json(await stub.checkBackpressure(d.owner,d.id,d.data.phase));
 if(d.method==='inspect')return Response.json(await stub.inspectStorage());
 if(d.method==='generate')return stub.fetch(new Request('https://session/generate',{method:'POST',headers:{'X-Tavern-Owner':d.owner,'X-Tavern-Session':d.id,'X-Tavern-Username':'test','Content-Type':'application/json'},body:JSON.stringify(d.data)}));
 return new Response(await stub.invoke(d.owner,d.id,d.method,d.data??{}),{headers:{'Content-Type':'application/json'}});
}};`;
const bundle=await build({stdin:{contents:source,resolveDir:root,sourcefile:'session-test.ts',loader:'ts'},bundle:true,write:false,format:'esm',platform:'browser',target:'es2022',external:['cloudflare:workers']});
const options={modules:true,script:bundle.outputFiles[0].text,compatibilityDate:'2026-09-18',compatibilityFlags:['nodejs_compat','enable_request_signal'],durableObjects:{SESSIONS:{className:'TestSession',useSQLite:true}},resourcePersistencePath:persist,kvNamespaces:{PROMPTS:'test-prompts'},d1Databases:{DB:'test'},bindings:{AIG_GATEWAY_ID:'default'}};
let runtime=new Miniflare(convertV4MiniflareOptions(options));
async function call(id,method,data,owner='owner'){return runtime.dispatchFetch('https://test',{method:'POST',body:JSON.stringify({id,owner,method,data})});}
try{
 let db=await runtime.getD1Database('DB');for(const name of readdirSync(join(root,'migrations')).filter(n=>n.endsWith('.sql')).sort())await db.exec(readFileSync(join(root,'migrations',name),'utf8').replace(/--[^\n]*/g,'').replace(/\n/g,' '));
 const settings={userName:'旅人',persona:'',systemPrompt:'保持角色',modelId:'rp',thinkingEnabled:false,temperature:.9,topP:1,topK:0,frequencyPenalty:0,presencePenalty:0};
 for(const id of ['a','b','memory','tool-prose','pressure-start','pressure-delta','pressure-candidates_pending','pressure-completed','recovery-final','recovery-persistent','recovery-snapshot','restart-draft','restart-review'])await db.prepare('INSERT INTO sessions(id,owner,title,character_json,character_name,settings_json,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?)').bind(id,'owner','旅店','{"name":"岚"}','岚',JSON.stringify(settings),1,1).run();
 await db.prepare("INSERT INTO messages(id,session_id,role,content,status,ordinal,created_at,finish_reason) VALUES('long-story','memory','assistant',?,'completed',0,1,'stop')").bind('北门早已关闭。'+'İ'.repeat(800)+'😀'.repeat(61)+'a北门钥匙在南塔。'+'风'.repeat(1000)+'银怀表藏在南塔。').run();
 await db.prepare("INSERT INTO messages(id,session_id,role,content,status,ordinal,created_at,finish_reason,candidates_json) VALUES('legacy','a','assistant','旧正文','completed',0,1,'stop','[\"问问。\"]')").run();
 await db.prepare('INSERT INTO model_capabilities VALUES(?,?,?)').bind('rp',JSON.stringify({contextTokens:32768,source:'llama.cpp:n_ctx',inputRatio:1.2}),Date.now()+300000).run();
 let a=await(await call('a','read')).json();assert.equal(a.value.messages[0].id,'legacy');assert.deepEqual(a.value.messages[0].candidates,['问问。']);
 assert.equal((await db.prepare('SELECT generation_id FROM sessions WHERE id=?').bind('a').first()).generation_id,'do:a');
 assert.equal((await(await call('a','read',undefined,'stranger')).json()).status,404);
 const requestId=crypto.randomUUID();const streamed=await(await call('a','generate',{requestId,content:'问候'})).text();assert.match(streamed,/"type":"done"/);assert.doesNotMatch(streamed,/\[TAVERN_NEXT\]/);
 a=await(await call('a','read')).json();assert.equal(a.value.messages.at(-1).content,'你好。');assert.equal(a.value.messages.at(-1).candidates.length,3);assert.equal((await(await call('b','read')).json()).value.messages.length,0);
 assert.equal((await(await call('a','generate',{requestId})).json()).replayed,true);
 const memoryRequest=crypto.randomUUID(),memoryStream=await(await call('memory','generate',{requestId:memoryRequest,content:'检索两个片段'})).text();assert.doesNotMatch(memoryStream,/"type":"error"/);let recalled=await(await call('memory','read')).json();assert.equal(recalled.value.messages.at(-1).status,'completed');assert.equal(recalled.value.messages.at(-1).candidates.length,3);assert.equal((await(await call('memory','generate',{requestId:memoryRequest})).json()).replayed,true);
 const memoryExport=await(await call('memory','export')).json();const steps=JSON.parse(memoryExport.value.snapshots.at(-1).steps_json);assert.equal(steps.length,4);assert.equal(steps[2].call.function.name,'read_memory');assert.equal(steps[3].call.function.name,'read_memory');assert.equal(JSON.parse(steps[0].result)[0].source.messageId,'long-story');assert.equal(JSON.parse(steps[1].result)[0].source.messageId,'long-story');assert.match(JSON.parse(steps[1].result)[0].text,/银怀表藏在南塔/);
 await db.prepare('UPDATE model_capabilities SET value_json=? WHERE id=?').bind(JSON.stringify({contextTokens:2048,source:'llama.cpp:n_ctx',inputRatio:1.2}),'rp').run();const proseRequest=crypto.randomUUID(),proseWire=await(await call('tool-prose','generate',{requestId:proseRequest,content:'同次长正文工具'})).text();assert.match(proseWire,/"type":"error"/);const proseSaved=await(await call('tool-prose','read')).json();assert.equal(proseSaved.value.messages.at(-1).content,'😀'.repeat(2201));assert.equal(proseSaved.value.messages.at(-1).status,"error");assert.equal(proseSaved.value.messages.at(-1).candidates.length,0);assert.equal(proseSaved.value.session.state.scene,null);assert.equal((await(await call('tool-prose','generate',{requestId:proseRequest})).json()).replayed,true);await db.prepare('UPDATE model_capabilities SET value_json=? WHERE id=?').bind(JSON.stringify({contextTokens:32768,source:'llama.cpp:n_ctx',inputRatio:1.2}),'rp').run();
 for(const mode of ['final','persistent','snapshot']){const result=await(await call('recovery-'+mode,'recovery',{mode})).json();assert.equal(result.recovered,true);assert.deepEqual(result.storage.tables,[]);assert.equal(result.storage.alarm,null);}
 for(const phase of ['start','delta','candidates_pending','completed']){const result=await(await call('pressure-'+phase,'backpressure',{phase})).json();assert.match(result.wire,/"type":"done"/);assert.match(result.wire,phase==='completed'?/"status":"completed"/:/"finishReason":"stopped"/);assert.deepEqual(result.storage.tables,[]);assert.equal(result.storage.alarm,null);}
 const fork=await(await call('a','fork',{messageId:a.value.messages.at(-1).id,content:'新分支'})).json();assert.equal((await(await call(fork.value.id,'read')).json()).value.messages.at(-1).content,'新分支');
 await(await call('a','generate',{requestId:crypto.randomUUID(),content:'工具抵达北港'})).text();a=await(await call('a','read')).json();assert.equal(a.value.session.state.scene,'北港');
 const continued=await(await call('a','generate',{requestId:crypto.randomUUID(),content:'污染验收继续'})).text();assert.doesNotMatch(continued,/"type":"error"/);
 const preTool=a.value.messages.findLast(m=>m.role==='user');const priorBranch=await(await call('a','fork',{messageId:preTool.id,content:'不同方向'})).json();assert.equal((await(await call(priorBranch.value.id,'read')).json()).value.session.state.scene,null);
 const stateBranch=await(await call('a','fork',{messageId:a.value.messages.at(-1).id,content:'编辑这一轮'})).json();assert.equal((await(await call(stateBranch.value.id,'read')).json()).value.session.state.scene,null);
 const pending=await call('b','generate',{requestId:crypto.randomUUID(),content:'等待'}),reader=pending.body.getReader();await reader.read();const b=await(await call('b','read')).json();await call('b','stop',{generationId:b.value.session.generationId});while(!(await reader.read()).done){};
 await call('a','update',{title:'已保存'});await runtime.dispose();runtime=new Miniflare(convertV4MiniflareOptions(options));a=await(await call('a','read')).json();assert.equal(a.value.session.title,'已保存');assert.equal(a.value.messages.at(-1).content,'你好。');assert.equal(a.value.session.state.scene,'北港');
 recalled=await(await call('memory','read')).json();assert.equal(recalled.value.messages.at(-1).status,'completed');assert.equal((await(await call('memory','generate',{requestId:memoryRequest})).json()).replayed,true);assert.equal((await(await call('memory','remove')).json()).ok,true);
 const proseRestored=await(await call('tool-prose','read')).json();assert.equal(proseRestored.value.messages.at(-1).content,'😀'.repeat(2201));assert.equal(proseRestored.value.session.state.scene,null);assert.equal((await(await call('tool-prose','remove')).json()).ok,true);
 for(const [id,content,expected]of [['restart-draft','正文时重启','重启前半句。'],['restart-review','候选时重启','你好。']]){
  const pending=await call(id,'generate',{requestId:crypto.randomUUID(),content}),reader=pending.body.getReader();await reader.read();
  // This fixture never sends stop: body must arrive while the upstream request is still open.
  if(id==='restart-draft')assert.match(new TextDecoder().decode((await reader.read()).value),/"type":"delta".*重启前半句。/);
  let checkpoint;for(let n=0;n<100;n++){checkpoint=await(await call(id,'inspect')).json();if(checkpoint.drafts.length)break;await new Promise(r=>setTimeout(r,10));}assert.equal(checkpoint.drafts[0]?.content,expected);
  assert.equal((await(await call(id,'read')).json()).value.messages.at(-1).content,id==='restart-draft'?'':expected);await runtime.dispose();runtime=new Miniflare(convertV4MiniflareOptions(options));
  const recovered=await(await call(id,'read')).json();assert.equal(recovered.value.messages.at(-1).content,expected);assert.equal(recovered.value.messages.at(-1).status,'aborted');assert.equal(recovered.value.messages.at(-1).finishReason,'interrupted');assert.equal(recovered.value.session.state.scene,null);assert.deepEqual((await(await call(id,'inspect')).json()).drafts,[]);assert.equal((await(await call(id,'remove')).json()).ok,true);
 }
 const interrupted=await call('b','generate',{requestId:crypto.randomUUID(),content:'等待'});await interrupted.body.getReader().read();await runtime.dispose();runtime=new Miniflare(convertV4MiniflareOptions(options));const recovered=await(await call('b','read')).json();assert.equal(recovered.value.session.generationId,null);assert.equal(recovered.value.messages.at(-1).status,'aborted');
 assert.equal((await(await call('a','remove')).json()).ok,true);let empty=await(await call('a','inspect')).json();assert.deepEqual(empty.tables,[]);assert.equal(empty.alarm,null);assert.equal(typeof empty.bytes,'number');
 await runtime.dispose();runtime=new Miniflare(convertV4MiniflareOptions(options));assert.equal((await(await call('a','read')).json()).status,404);assert.equal((await(await call('a','remove')).json()).ok,true);empty=await(await call('a','inspect')).json();assert.deepEqual(empty.tables,[]);assert.equal(empty.alarm,null);assert.equal(typeof empty.bytes,'number');
 assert.equal((await(await call('a','generate',{requestId:crypto.randomUUID(),content:'旧会话不能复活'})).json()).message,'会话不存在');empty=await(await call('a','inspect')).json();assert.deepEqual(empty.tables,[]);assert.equal(empty.alarm,null);assert.equal((await(await call('b','read')).json()).ok,true);
 db=await runtime.getD1Database('DB');assert.equal((await db.prepare("SELECT count(*) n FROM messages WHERE id='legacy'").first()).n,1);
 console.log('workerd SQLite: import, fence, isolation, streaming, distinct memory fragments and full Unicode original pages, long Unicode prose with tool_calls, persisted steps, replay, snapshot/final/persistent storage failure recovery without eviction, fork, stop with start/delta/candidate/terminal backpressure, restart, deleteAll with no business tables/alarm and stale-request rejection passed (empty SQLite page bytes: '+empty.bytes+')');
}finally{await runtime.dispose();rmSync(persist,{recursive:true,force:true});}
