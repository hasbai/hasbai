// Run from the repository checkout. Credentials and private prompts remain in memory.
import {readFileSync} from 'node:fs';
import {parseEnv} from 'node:util';
import {spawnSync} from 'node:child_process';
import {resolve,join} from 'node:path';
import {fileURLToPath} from 'node:url';
const root=resolve(import.meta.dirname,'..'),args=process.argv.slice(2);
const value=name=>{const at=args.indexOf(name);return at<0?undefined:args[at+1];};
const source=value('--source'),origin=value('--origin')??'https://tavern.hasbai.xyz';
function run(cwd,params,input){
 const result=spawnSync(process.execPath,[resolve(root,'node_modules/wrangler/bin/wrangler.js'),...params],{cwd,encoding:'utf8',input,env:{...process.env,WRANGLER_SEND_METRICS:'false'},timeout:120000,maxBuffer:2*1024*1024});
 if(result.status!==0)throw Error('Wrangler operation failed; no credential output was printed');
 return result.stdout;
}
async function telegram(token,method,body){
 let response;try{response=await fetch(`https://api.telegram.org/bot${token}/${method}`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body),signal:AbortSignal.timeout(20000)});}catch{throw Error('Telegram transport failed');}
 const data=await response.json().catch(()=>({ok:false}));if(!response.ok||!data.ok)throw Error('Telegram API rejected operation');return data.result;
}
export function sakiCard(text){
 // These are retired runtime instructions. All other original prose is retained.
 const sections=text.split(/(?=^# )/m).filter(section=>!/^# (Tools|Thread 历史（系统自动注入）)\s*$/m.test(section));
 const description=sections.join('').replace(/你可能拥有关于群和成员的长期记忆（通过 memory context 与 set_context 工具）。\n?/,'').trim();
 return {spec:'chara_card_v2',spec_version:'2.0',data:{name:'Saki（祥子）',description,personality:'',scenario:'',first_mes:'',mes_example:'',system_prompt:'',post_history_instructions:'',alternate_greetings:[],tags:['Saki','Telegram'],creator:'',extensions:{}}};
}
async function main(){
 if(!source)throw Error('Usage: node scripts/saki-cutover.mjs --source <Saki checkout> --prepare|--import-prompt|--switch|--inspect');
 const credentials=value('--credentials');if(credentials){const values=parseEnv(readFileSync(credentials,'utf8'));for(const key of ['AUTH0_TEST_EMAIL','AUTH0_TEST_PASSWORD'])if(values[key])process.env[key]=values[key];}
 const secrets={...parseEnv(readFileSync(join(source,'.env'),'utf8')),...parseEnv(readFileSync(join(source,'.dev.vars'),'utf8'))};
 const token=secrets.TELEGRAM_BOT_TOKEN,secret=secrets.TELEGRAM_WEBHOOK_SECRET;
 if(!token||!secret)throw Error('Source Telegram credentials missing');
 const me=await telegram(token,'getMe',{});if(me.username!=='saki_main_bot')throw Error('Unexpected Telegram bot');
 if(args.includes('--prepare')){
  run(root,['secret','bulk'],JSON.stringify({TELEGRAM_BOT_TOKEN:token,TELEGRAM_WEBHOOK_SECRET:secret}));
  console.log(JSON.stringify({prepared:true,botUsername:me.username}));
 }
 if(args.includes('--import-prompt')){
  const keys=JSON.parse(run(source,['kv','key','list','--binding','PROMPTS','--remote']));
  if(!Array.isArray(keys))throw Error('Could not list private Saki prompts');
  if(!keys.some(key=>key.name==='soul:v1'))console.log(JSON.stringify({privateOverride:false,roleSource:'reviewed-built-in-card'}));
  else {
  const raw=run(source,['kv','key','get','soul:v1','--binding','PROMPTS','--remote','--text']);
  let stored;try{stored=JSON.parse(raw);}catch{throw Error('Could not parse private Saki prompt');}
  if(typeof stored?.text!=='string'||!stored.text.trim())throw Error('Private Saki prompt missing');
  const {withUserToken}=await import('../../financial/scripts/auth0-token.mjs');
  await withUserToken(async accessToken=>{
   const response=await fetch(origin+'/api/characters',{method:'POST',headers:{Authorization:'Bearer '+accessToken,'X-Filename':'saki-import.json'},body:JSON.stringify(sakiCard(stored.text))});
   if(!response.ok)throw Error('Private card installation failed');const card=await response.json();console.log(JSON.stringify({privateCardId:card.id,imported:true}));
  });
  }
 }
 if(args.includes('--switch')){
  const health=await fetch(origin+'/health');if(!health.ok)throw Error('Tavern is unavailable');
  const signature=await fetch(origin+'/api/messaging/telegram/webhook',{method:'POST',headers:{'x-telegram-bot-api-secret-token':secret},body:'{}'});if(!signature.ok)throw Error('New webhook is not ready');
  await telegram(token,'setWebhook',{url:origin+'/api/messaging/telegram/webhook',secret_token:secret,allowed_updates:['message'],drop_pending_updates:false});
 }
 if(args.includes('--inspect')||args.includes('--switch')){
  const info=await telegram(token,'getWebhookInfo',{});
  if(args.includes('--switch')&&info.url!==origin+'/api/messaging/telegram/webhook')throw Error('Webhook URL mismatch');
  console.log(JSON.stringify({botUsername:me.username,webhookUrl:info.url,pendingUpdateCount:info.pending_update_count,hasDeliveryError:!!info.last_error_date}));
 }
}
if(process.argv[1]&&fileURLToPath(import.meta.url)===resolve(process.argv[1]))main().catch(()=>{console.error('Saki cutover operation failed. No credentials or private prompt were printed.');process.exitCode=1;});
