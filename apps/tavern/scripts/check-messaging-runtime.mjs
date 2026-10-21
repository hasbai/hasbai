// Isolated real workerd: transport fetches and model responses are synthetic.
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {readFileSync,readdirSync,mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
const require=createRequire(import.meta.url),runtimeRequire=createRequire(require.resolve('wrangler'));
const {Miniflare,convertV4MiniflareOptions}=runtimeRequire('miniflare'),{build}=runtimeRequire('esbuild');
const root=resolve(import.meta.dirname,'..'),persist=mkdtempSync(join(tmpdir(),'tavern-messaging-'));
const source=`
import {TavernSession} from './worker/session-object';
import {MessageInbox} from './worker/message-inbox';
export class RuntimeSession extends TavernSession {constructor(ctx,env){super(ctx,{...env,AIG_RP_RUN_TOKEN:'fixture-only'});}}
export class RuntimeInbox extends MessageInbox {
 async step(){await this.alarm();return this.status('route');}
 inspect(){return {jobs:this.ctx.storage.sql.exec('SELECT update_id,request_id,phase FROM inbox_jobs ORDER BY update_id').toArray(),chunks:this.ctx.storage.sql.exec('SELECT text,state,telegram_id FROM inbox_chunks ORDER BY update_id,ordinal').toArray()};}
}
const telegramEvents=[];
globalThis.fetch=async(url,options)=>{
 if(String(url).includes('api.telegram.org/')){telegramEvents.push({method:String(url).split('/').at(-1),body:JSON.parse(options.body)});return Response.json({ok:true,result:{message_id:123}});}
 if(!String(url).includes('/compat/chat/completions'))throw Error('unexpected external request');
 const input=JSON.parse(options.body);if(input.model!=='dynamic/rp')throw Error('unexpected model');
 if(input.messages.some(m=>m.role==='user'&&m.content.includes('"speaker":')))throw Error('Telegram envelope leaked into model prompt');
 if(!input.messages.some(m=>m.role==='user'&&m.content.includes('@untrusted-telegram-name: 你好')))throw Error('Telegram dialogue projection missing');
 if(input.messages.some(m=>m.content.includes('口吻更自然'))&&!input.messages.some(m=>m.content.includes('[OOC：')))throw Error('OOC instruction lost');
 const metadata=JSON.parse(options.headers['cf-aig-metadata']);if(metadata.username!=='verified-profile')throw Error('unverified profile');
 const text=input.response_format?JSON.stringify({choices:['继续。','等一会。','看向窗外。']}):'收到你的消息。';
 if(input.response_format)return new Response('data: '+JSON.stringify({choices:[{delta:{content:text},finish_reason:'stop'}]})+'\\n\\ndata: [DONE]\\n\\n',{headers:{'Content-Type':'text/event-stream'}});
 return new Response(new ReadableStream({start(c){const frame=(content,finish_reason=null)=>new TextEncoder().encode('data: '+JSON.stringify({choices:[{delta:{content},finish_reason}]})+'\\n\\n');c.enqueue(frame(text.slice(0,2)));setTimeout(()=>{c.enqueue(frame(text.slice(2),'stop'));c.enqueue(new TextEncoder().encode('data: [DONE]\\n\\n'));c.close();},1800);}}),{headers:{'Content-Type':'text/event-stream'}});
};
export default {async fetch(request,env){const d=await request.json(),stub=env.MESSAGE_INBOX.getByName('[12,0]');
 if(d.method==='receive')return Response.json(await stub.receive('route',{update_id:d.updateId??100,message:{message_id:10,chat:{id:12,type:'private'},from:{id:12,username:'untrusted-telegram-name'},text:d.content??'你好'}}));
 if(d.method==='inspect')return Response.json(await stub.inspect());
 if(d.method==='events')return Response.json(telegramEvents);
 if(d.method==='view')return Response.json(JSON.parse(await env.SESSIONS.getByName(JSON.stringify(['owner','session'])).invoke('owner','session','read')).value);
 return Response.json(await stub.step());
}};`;
const bundle=await build({stdin:{contents:source,resolveDir:root,sourcefile:'messaging-runtime.ts',loader:'ts'},bundle:true,write:false,format:'esm',platform:'browser',target:'es2022',external:['cloudflare:workers']});
const options={modules:true,script:bundle.outputFiles[0].text,compatibilityDate:'2026-10-03',compatibilityFlags:['nodejs_compat','enable_request_signal'],durableObjects:{SESSIONS:{className:'RuntimeSession',useSQLite:true},MESSAGE_INBOX:{className:'RuntimeInbox',useSQLite:true}},resourcePersistencePath:persist,kvNamespaces:{PROMPTS:'test-prompts'},d1Databases:{DB:'test'},bindings:{AIG_GATEWAY_ID:'default',TELEGRAM_BOT_TOKEN:'fixture-only',TELEGRAM_BOT_USERNAME:'saki_main_bot'}};
let runtime=new Miniflare(convertV4MiniflareOptions(options));
async function call(method,data={}){const response=await runtime.dispatchFetch('https://test',{method:'POST',body:JSON.stringify({method,...data})});assert.equal(response.status,200);return response.json();}
try{
 const db=await runtime.getD1Database('DB');for(const name of readdirSync(join(root,'migrations')).filter(n=>n.endsWith('.sql')).sort())await db.exec(readFileSync(join(root,'migrations',name),'utf8').replace(/--[^\n]*/g,'').replace(/\n/g,' '));
 const settings={userName:'群成员',persona:'',systemPrompt:'保持角色',modelId:'rp',thinkingEnabled:false,temperature:.9,topP:1,topK:0,frequencyPenalty:0,presencePenalty:0};
 await db.prepare("INSERT INTO sessions(id,owner,title,character_json,character_name,settings_json,created_at,updated_at,storage_backend,generation_id,generation_until) VALUES('session','owner','Saki',?, 'Saki',?,1,1,'do','do:session',?)").bind('{"name":"Saki"}',JSON.stringify(settings),Number.MAX_SAFE_INTEGER).run();
 await db.prepare("INSERT INTO channel_routes VALUES('route','[12,0]',12,0,'owner','verified-profile','session',1,1)").run();
 await db.prepare('INSERT INTO model_capabilities VALUES(?,?,?)').bind('rp',JSON.stringify({contextTokens:32768,source:'llama.cpp:n_ctx',inputRatio:1.2}),Date.now()+300000).run();
 assert.equal((await call('receive')).accepted,true);const first=await call('inspect');assert.equal(first.jobs.length,1);const requestId=first.jobs[0].request_id;assert((await call('events')).some(e=>e.method==='setMessageReaction'&&e.body.message_id===10&&e.body.reaction[0].emoji==='👀'));
 await runtime.dispose();runtime=new Miniflare(convertV4MiniflareOptions(options));
 for(let n=0;n<300;n++){const value=await call('inspect');if(value.jobs[0].phase==='done')break;await new Promise(r=>setTimeout(r,50));}
 const completed=await call('inspect');assert.equal(completed.jobs[0].phase,'done');assert.equal(completed.jobs[0].request_id,requestId);assert.equal(completed.chunks[0].telegram_id,123);assert.equal(completed.chunks[0].state,'sent');const delivered=await call('events');assert(delivered.some(e=>e.method==='sendMessage'&&e.body.reply_parameters.message_id===10));assert(delivered.some(e=>e.method==='editMessageText'&&e.body.text==='收到你的消息。'));const stored=await call('view');assert.equal(stored.messages.find(m=>m.role==='user').content,'@untrusted-telegram-name: 你好');
 await runtime.dispose();runtime=new Miniflare(convertV4MiniflareOptions(options));await call('receive');await call('step');const replay=await call('inspect');assert.equal(replay.jobs.length,1);assert.equal(replay.jobs[0].request_id,requestId);
 await call('receive',{updateId:101,content:'/status@saki_main_bot'});await call('step');const status=await call('inspect');assert.equal(status.jobs[1].phase,'done');assert(status.chunks.at(-1).text.includes('当前会话状态'));
 await runtime.dispose();runtime=new Miniflare(convertV4MiniflareOptions(options));await call('receive',{updateId:101,content:'/status@saki_main_bot'});await call('step');assert.equal((await call('inspect')).jobs.length,2);
 await call('receive',{updateId:102,content:'/ooc@saki_main_bot 口吻更自然'});await call('step');for(let n=0;n<300;n++){const value=await call('inspect');if(value.jobs[2].phase==='done')break;await new Promise(r=>setTimeout(r,50));}assert.equal((await call('inspect')).jobs[2].phase,'done');
 console.log('workerd messaging: durable ingress, restart with automatic alarm recovery, existing Tavern generation, verified profile attribution, persisted delivery receipt, native status activity receipt, OOC projection and duplicate update passed');
}finally{await runtime.dispose();rmSync(persist,{recursive:true,force:true});}
