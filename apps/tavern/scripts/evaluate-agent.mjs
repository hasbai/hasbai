// Opt-in real-model evaluation in disposable workerd/SQLite. No production user data.
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {readFileSync,readdirSync,mkdtempSync,mkdirSync,rmSync,writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {scenario} from './agent-evaluation-cases.mjs';

const root=resolve(import.meta.dirname,'..'),require=createRequire(import.meta.url),runtimeRequire=createRequire(require.resolve('wrangler'));
const {Miniflare,convertV4MiniflareOptions,Log,LogLevel}=runtimeRequire('miniflare'),{build}=runtimeRequire('esbuild');
const args=process.argv.slice(2),option=name=>{const at=args.indexOf(name);return at<0?undefined:args[at+1];};
if(!args.includes('--live')||!process.env.AIG_RP_RUN_TOKEN)throw Error('Use --live with AIG_RP_RUN_TOKEN in the environment.');
const out=resolve(option('--out-dir')??join(root,'.local-visual','agent-evaluation',new Date().toISOString().replaceAll(':','-')));
mkdirSync(out,{recursive:true});
const persist=mkdtempSync(join(tmpdir(),'tavern-agent-evaluation-')),snapshot=option('--ref');let appRoot=root;
const useEmbeddings=args.includes('--embeddings'),accountId=option('--account-id')??process.env.CLOUDFLARE_ACCOUNT_ID;
let embeddingToken=process.env.CLOUDFLARE_API_TOKEN;
if(useEmbeddings){
 if(!accountId)throw Error('--embeddings requires --account-id or CLOUDFLARE_ACCOUNT_ID');
 if(!embeddingToken){const raw=execFileSync('pnpm',['exec','wrangler','auth','token','--json'],{cwd:root,encoding:'utf8',stdio:['ignore','pipe','pipe']});embeddingToken=JSON.parse(raw.slice(raw.indexOf('{'))).token;}
 if(!embeddingToken)throw Error('Workers AI authentication unavailable');
}
if(snapshot){const archive=join(persist,'source.tar');execFileSync('git',['archive',snapshot,'apps/tavern','--output='+archive],{cwd:resolve(root,'../..')});execFileSync('tar',['-xf',archive,'-C',persist]);appRoot=join(persist,'apps/tavern');}
const source=`console.info=()=>{};import {TavernSession} from './worker/session-object';import {LoreIndex,embeddings} from './worker/lore';
export class EvaluationSession extends TavernSession {
 constructor(ctx,env){super(ctx,{...env,AI:{run:async(model,input,options)=>{const r=await fetch('https://evaluation-embedding',{method:'POST',body:JSON.stringify({model,input,metadata:options.gateway.metadata,eventId:options.gateway.eventId}),signal:options.signal});if(!r.ok)throw Error('evaluation embedding unavailable');return (await r.json()).result;}}});}
 async probe(id,query){await this.invoke('evaluation',id,'read',{});const index=new LoreIndex(this.ctx.storage.sql,[],(texts,signal)=>embeddings(this.env,texts,'agent-evaluation','semantic-probe',signal),new AbortController().signal,this.store.messages());return index.search(query);}
}
export default {async fetch(request,env){const d=await request.json(),stub=env.SESSIONS.getByName(JSON.stringify(['evaluation',d.id]));
if(d.method==='generate')return stub.fetch(new Request('https://session/generate',{method:'POST',headers:{'X-Tavern-Owner':'evaluation','X-Tavern-Session':d.id,'X-Tavern-Username':'agent-evaluation','Content-Type':'application/json'},body:JSON.stringify(d.data)}));
if(d.method==='probe')return Response.json(await stub.probe(d.id,d.data.query));
return new Response(await stub.invoke('evaluation',d.id,d.method,d.data??{}),{headers:{'Content-Type':'application/json'}});}};`;
const bundled=await build({stdin:{contents:source,resolveDir:appRoot,sourcefile:'evaluation.ts',loader:'ts'},bundle:true,write:false,format:'esm',platform:'browser',target:'es2022',external:['cloudflare:workers'],nodePaths:[join(root,'node_modules')]});
const requests=[],rounds=[],embeddingRequests=[],resources=new Set(['main','cache-other']);let active={id:'setup',session:'main'},runtime;
const metadata={scenario:scenario.name,fixture:scenario,bundleSHA256:createHash('sha256').update(bundled.outputFiles[0].text).digest('hex'),ref:snapshot??execFileSync('git',['rev-parse','HEAD'],{cwd:root,encoding:'utf8'}).trim(),workingTree:!snapshot,startedAt:new Date().toISOString(),settings:scenario.settings};
const save=()=>{writeFileSync(join(out,'results.json'),JSON.stringify({metadata,rounds,requests,embeddingRequests},null,2)+'\n');};
runtime=new Miniflare(convertV4MiniflareOptions({modules:true,script:bundled.outputFiles[0].text,compatibilityDate:'2026-10-03',compatibilityFlags:['nodejs_compat','enable_request_signal'],durableObjects:{SESSIONS:{className:'EvaluationSession',useSQLite:true}},resourcePersistencePath:join(persist,'storage'),kvNamespaces:{PROMPTS:'evaluation-prompts'},d1Databases:{DB:'evaluation'},bindings:{AIG_GATEWAY_ID:'default',AIG_RP_RUN_TOKEN:process.env.AIG_RP_RUN_TOKEN},log:new Log(LogLevel.ERROR),outboundService:async request=>{
 if(new URL(request.url).hostname==='evaluation-embedding'){
  const data=await request.json();if(data.model!=='@cf/baai/bge-m3')throw Error('Unexpected embedding model');
  if(!useEmbeddings)return new Response(null,{status:503});
  const started=Date.now(),response=await fetch('https://api.cloudflare.com/client/v4/accounts/'+accountId+'/ai/run/@cf/baai/bge-m3',{method:'POST',headers:{Authorization:'Bearer '+embeddingToken,'Content-Type':'application/json'},body:JSON.stringify(data.input),signal:request.signal});
  const value=await response.json();embeddingRequests.push({round:active.id,items:data.input.text.length,status:response.status,dimensions:value.result?.data?.map(v=>v.length)??[],elapsedMs:Date.now()-started});save();return Response.json({result:value.result},{status:response.status});
 }
 if(!request.url.includes('/compat/chat/completions'))throw Error('Unexpected evaluation endpoint');
 const input=await request.json(),start=Date.now(),record={round:active.id,session:active.session,sequence:requests.length+1,phase:input.response_format?'director':input.tools?'body':'summary',input,toolDeltas:[],firstTextMs:null,elapsedMs:null,promptTokens:null,cachedTokens:null,prefillTokens:null,prefillMs:null,decodeMs:null,finishReason:null,model:null};
 record.phaseIndex=requests.filter(r=>r.round===record.round&&r.session===record.session&&r.phase===record.phase).length+1;requests.push(record);
 const response=await fetch(request.url,{method:'POST',headers:request.headers,body:JSON.stringify(input),signal:AbortSignal.any([request.signal,AbortSignal.timeout(180000)]),redirect:'manual'});
 record.httpStatus=response.status;record.logId=response.headers.get('cf-aig-log-id');let wire='',decoder=new TextDecoder();
 return new Response(response.body?.pipeThrough(new TransformStream({transform(chunk,controller){
  wire+=decoder.decode(chunk,{stream:true});const lines=wire.split('\n');wire=lines.pop();
  for(const line of lines){if(!line.startsWith('data: ')||line.slice(6)==='[DONE]')continue;let e;try{e=JSON.parse(line.slice(6));}catch{continue;}
   if(e.choices?.[0]?.delta?.content&&record.firstTextMs===null)record.firstTextMs=Date.now()-start;
   if(e.choices?.[0]?.delta?.tool_calls)record.toolDeltas.push(e.choices[0].delta.tool_calls);
   record.model=e.model??record.model;record.finishReason=e.choices?.[0]?.finish_reason??record.finishReason;
   record.promptTokens=e.usage?.prompt_tokens??record.promptTokens;record.cachedTokens=e.usage?.prompt_tokens_details?.cached_tokens??e.timings?.cache_n??record.cachedTokens;
   record.prefillTokens=e.timings?.prompt_n??record.prefillTokens;record.prefillMs=e.timings?.prompt_ms??record.prefillMs;record.decodeMs=e.timings?.predicted_ms??record.decodeMs;
  }record.elapsedMs=Date.now()-start;controller.enqueue(chunk);
 },flush(){record.elapsedMs=Date.now()-start;save();}})),{status:response.status,headers:response.headers});
}}));
const call=(id,method,data)=>runtime.dispatchFetch('https://evaluation',{method:'POST',body:JSON.stringify({id,method,data})});
async function generate(id,test,extra={}){
 active={id:test.id,session:id};const requestId=crypto.randomUUID(),started=Date.now(),before=requests.length;let wire='',error;
 try{wire=await(await call(id,'generate',{requestId,content:test.input,...extra})).text();}catch(e){error=e.message;}
 const frames=wire.split('\n').filter(l=>l.startsWith('data: ')).map(l=>JSON.parse(l.slice(6))),message=frames.find(e=>e.type==='done')?.message;
 const saved=await(await call(id,'read')).json(),exported=await(await call(id,'export')).json(),snapshot=exported.value.snapshots.find(s=>s.message_id===message?.id);
 const count=requests.length,replay=await(await call(id,'generate',{requestId})).json();
 const round={id:test.id,session:id,input:test.input,checks:test.checks??[],elapsedMs:Date.now()-started,message,state:saved.value.session.state,steps:snapshot?JSON.parse(snapshot.steps_json):[],requestCount:count-before,persisted:!!message&&saved.value.messages.at(-1)?.content===message.content,replayed:replay.replayed===true&&requests.length===count,error:error??null};
 rounds.push(round);save();console.log(JSON.stringify({round:round.id,session:id,status:message?.status??'transport-error',requests:round.requestCount,candidates:message?.candidates?.length??0,persisted:round.persisted,replayed:round.replayed}));return round;
}
try{
 const db=await runtime.getD1Database('DB');for(const name of readdirSync(join(appRoot,'migrations')).filter(n=>n.endsWith('.sql')).sort())await db.exec(readFileSync(join(appRoot,'migrations',name),'utf8').replace(/--[^\n]*/g,'').replace(/\n/g,' '));
 for(const id of resources){await db.prepare('INSERT INTO sessions(id,owner,title,character_json,character_name,settings_json,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?)').bind(id,'evaluation','合成评测',JSON.stringify(scenario.card),scenario.card.name,JSON.stringify(scenario.settings),1,1).run();await db.prepare("INSERT INTO messages(id,session_id,role,content,status,ordinal,created_at,finish_reason) VALUES(?,?,'assistant',?,'completed',0,1,'stop')").bind(id+'-greeting',id,scenario.card.first_mes).run();}
 await db.prepare('INSERT INTO model_capabilities VALUES(?,?,?)').bind('rp',JSON.stringify({contextTokens:32768,source:'evaluation-fixed-context',inputRatio:1.2}),Date.now()+3600000).run();
 // A nonempty KV snapshot verifies capabilities are not accidentally default-only.
 const kv=await runtime.getKVNamespace('PROMPTS');
 const promptBundle=await build({entryPoints:[join(appRoot,'shared/prompts.ts')],bundle:true,write:false,format:'esm',platform:'node'});
 const {DEFAULT_PROMPTS:prompts}=await import('data:text/javascript;base64,'+Buffer.from(promptBundle.outputFiles[0].text).toString('base64'));
 await kv.put('dialogue-v2',JSON.stringify({revision:'evaluation-custom-kv',texts:{...prompts,agent:prompts.agent+'保留这份自定义协议。'}}));
 let editMessageId;
 for(const test of scenario.turns){
  const round=await generate('main',test);
  if(test.id===scenario.edit.after)editMessageId=(await(await call('main','read')).json()).value.messages.findLast(m=>m.role==='user').id;
  if(test.id==='continue-1'){await generate('cache-other',{id:'cache-switch',input:'我们先喝一口茶，简短打个招呼。'});}
 }
 active={id:'semantic-probe',session:'main'};const embeddingCount=embeddingRequests.length,hits=await(await call('main','probe',{query:scenario.semanticProbe.query})).json();metadata.semanticProbe={query:scenario.semanticProbe.query,hits,actualEmbeddingRequests:embeddingRequests.length-embeddingCount,foundCorrection:hits.some(h=>h.text.includes('南柜'))};save();
 const edited=await(await call('main','changeMessage',{action:'edit',messageId:editMessageId,content:scenario.edit.input})).json();assert(edited.ok);metadata.editedInitialState=(await(await call('main','read')).json()).value.session.state;
 await generate('main',{id:'edit-isolation',input:'只回顾此时已经确认的数量、钥匙位置和签收状态，不继续核对。',checks:scenario.edit.checks});
 await generate('main',{id:'regenerate',input:'',checks:['重生成从before开始，不重新执行玩家签收']},{regenerate:true});
 active={id:'stop',session:'main'};const pending=await call('main','generate',{requestId:crypto.randomUUID(),content:'简短说说今天的工作。'}),drain=pending.text();
 for(let n=0;n<1000&&!requests.some(r=>r.round==='stop');n++)await new Promise(r=>setTimeout(r,10));
 const state=await(await call('main','read')).json();await call('main','stop',{generationId:state.value.session.generationId});await drain;
 const stopped=await(await call('main','read')).json();metadata.stop={upstreamStarted:requests.some(r=>r.round==='stop'),stopped:stopped.value.messages.at(-1).finishReason==='stopped',lockCleared:stopped.value.session.generationId===null};
 metadata.semanticReview='pending: review each round against its checks; HTTP success is not semantic success';
 metadata.cache={bodyFirst:requests.filter(r=>r.phase==='body'&&r.phaseIndex===1).map(({round,session,cachedTokens,promptTokens,firstTextMs})=>({round,session,cachedTokens,promptTokens,firstTextMs})),director:requests.filter(r=>r.phase==='director').map(({round,cachedTokens,promptTokens})=>({round,cachedTokens,promptTokens}))};
 metadata.prefixChecks=requests.filter(r=>r.phase==='director').map(r=>{const body=requests.slice(0,requests.indexOf(r)).findLast(b=>b.round===r.round&&b.session===r.session&&b.phase==='body');return {round:r.round,exactMessages:!!body&&JSON.stringify(r.input.messages.slice(0,body.input.messages.length))===JSON.stringify(body.input.messages),exactTools:!!body&&JSON.stringify(r.input.tools)===JSON.stringify(body.input.tools)};});
 metadata.completedAt=new Date().toISOString();save();
}finally{
 const cleanup=[];for(const id of resources){try{const result=await(await call(id,'remove')).json();cleanup.push({id,removed:result.ok===true});}catch{cleanup.push({id,removed:false});}}
 metadata.cleanup=cleanup;save();await runtime.dispose();rmSync(persist,{recursive:true,force:true});console.log(JSON.stringify({artifact:out,rounds:rounds.length,failed:rounds.filter(r=>r.message?.status!=='completed').length,cleanup:cleanup.every(r=>r.removed)}));
}
