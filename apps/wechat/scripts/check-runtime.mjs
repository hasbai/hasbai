// Disposable workerd: real SQLite Durable Object, real alarms, MCP over HTTP, restart persistence, fake iLink upstream.
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
const require=createRequire(import.meta.url),runtimeRequire=createRequire(require.resolve('wrangler'));
const {Miniflare,convertV4MiniflareOptions}=runtimeRequire('miniflare'),{build}=runtimeRequire('esbuild');
const root=resolve(import.meta.dirname,'..'),persist=mkdtempSync(join(tmpdir(),'wechat-runtime-'));

const seen={cursors:[],sent:[]};
let delivered=false;
const ilink=async request=>{
 const url=new URL(request.url),json=value=>new Response(JSON.stringify(value),{headers:{'Content-Type':'application/json'}});
 if(url.pathname.endsWith('get_bot_qrcode'))return json({qrcode:'qr',qrcode_img_content:'weixin://qr'});
 if(url.pathname.endsWith('get_qrcode_status'))return json({status:'confirmed',bot_token:'fixture-token',ilink_bot_id:'bot-runtime@im.bot',ilink_user_id:'owner@im.wechat'});
 if(url.pathname.endsWith('getupdates')){
  assert.equal(request.headers.get('authorization'),'Bearer fixture-token');
  const body=await request.json();seen.cursors.push(body.get_updates_buf);
  await new Promise(r=>setTimeout(r,200));
  if(!delivered){delivered=true;return new Response('{"ret":0,"msgs":[{"message_id":9007199254740993123,"seq":1,"from_user_id":"friend@im.wechat","message_type":1,"create_time_ms":1700000000000,"context_token":"ctx-1","item_list":[{"type":1,"text_item":{"text":"你好 bot"}}]}],"get_updates_buf":"cursor-1","longpolling_timeout_ms":1000}');}
  return json({ret:0,msgs:[],get_updates_buf:'cursor-1'});
 }
 if(url.pathname.endsWith('sendmessage')){seen.sent.push(await request.json());return json({ret:0});}
 return json({ret:0});
};

const bundle=await build({entryPoints:[resolve(root,'worker/index.ts')],bundle:true,write:false,format:'esm',platform:'browser',target:'es2022',external:['cloudflare:workers'],
 plugins:[{name:'fixture-auth',setup(b){b.onLoad({filter:/[/\\]worker[/\\]auth\.ts$/},()=>({contents:`export async function identity(){return 'runtime-user';}`,loader:'ts'}));}}]});
const options=()=>convertV4MiniflareOptions({modules:true,script:bundle.outputFiles[0].text,compatibilityDate:'2026-10-16',compatibilityFlags:['nodejs_compat','enable_request_signal'],
 bindings:{ILINK_BASE_URL:'https://ilinkai.weixin.qq.com',ILINK_CLIENT_VERSION:'2.4.8',ILINK_BOT_AGENT:'Hasbai'},
 durableObjects:{OWNERS:{className:'WechatOwner',useSQLite:true}},resourcePersistencePath:persist,outboundService:ilink});
let runtime=new Miniflare(options());
const tool=async(name,args={})=>{
 const response=await runtime.dispatchFetch('https://wechat.test/mcp',{method:'POST',headers:{'Content-Type':'application/json',Accept:'application/json, text/event-stream'},body:JSON.stringify({jsonrpc:'2.0',id:1,method:'tools/call',params:{name,arguments:args}})});
 assert.equal(response.status,200);const body=await response.json();assert.ok(!body.error,JSON.stringify(body.error));return body.result;
};
const until=async(check,label)=>{for(let n=0;n<150;n++){const value=await check();if(value)return value;await new Promise(r=>setTimeout(r,100));}throw Error('timeout: '+label);};
try{
 const started=await tool('wechat_login_start');
 const confirmed=await tool('wechat_login_poll',{login_id:started.structuredContent.login_id});
 assert.equal(confirmed.structuredContent.status,'confirmed');assert.ok(!JSON.stringify(confirmed).includes('fixture-token'));

 const inbox=await until(async()=>{const r=await tool('wechat_read_messages',{account_id:'bot-runtime@im.bot'});return r.structuredContent.messages.length?r.structuredContent:null;},'alarm-driven poll delivers a message');
 assert.equal(inbox.messages[0].text,'你好 bot');assert.equal(inbox.messages[0].conversation_id,'friend@im.wechat');
 const sent=await tool('wechat_send_text',{account_id:'bot-runtime@im.bot',conversation_id:'friend@im.wechat',text:'收到'});
 assert.equal(sent.structuredContent.status,'sent');assert.equal(seen.sent[0].msg.context_token,'ctx-1');assert.equal(seen.sent[0].msg.to_user_id,'friend@im.wechat');

 console.log('workerd: restarting the runtime on the same persistent storage');
 await runtime.dispose();seen.cursors.length=0;runtime=new Miniflare(options());
 const accounts=await tool('wechat_list_accounts');
 assert.equal(accounts.structuredContent.accounts[0].account_id,'bot-runtime@im.bot');assert.equal(accounts.structuredContent.accounts[0].has_cursor,true);
 const again=await tool('wechat_read_messages',{account_id:'bot-runtime@im.bot'});assert.equal(again.structuredContent.messages.length,2);
 await until(()=>seen.cursors.length>0,'poll loop resumes after restart');
 assert.equal(seen.cursors[0],'cursor-1','resumes from the persisted cursor');

 const removed=await tool('wechat_logout',{account_id:'bot-runtime@im.bot',confirm_account_id:'bot-runtime@im.bot'});assert.equal(removed.structuredContent.deleted,true);
 assert.equal((await tool('wechat_list_accounts')).structuredContent.accounts.length,0);
 console.log('workerd: QR login, alarm polling, persisted cursor and messages, context-token reply, restart resume and logout passed');
}finally{await runtime.dispose();rmSync(persist,{recursive:true,force:true});}
