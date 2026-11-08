// Disposable workerd instances, real service binding and cancellable HTTP upstream.
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {resolve} from 'node:path';
const require=createRequire(import.meta.url),runtimeRequire=createRequire(require.resolve('wrangler'));
const {Miniflare,convertV4MiniflareOptions}=runtimeRequire('miniflare'),{build}=runtimeRequire('esbuild');
const root=resolve(import.meta.dirname,'..');
let last;
const upstream=async(request,response)=>{
 let body='';for await(const chunk of request)body+=chunk;
 const record={input:JSON.parse(body),headers:request.headers,cancelled:false};last=record;
 if(record.input.fail){response.writeHead(429,{'cf-aig-log-id':'failure-log'});response.end('upstream failure');return;}
 response.writeHead(200,{'Content-Type':'text/event-stream','cf-aig-log-id':'stream-log'});response.write('data: first\n\n');
 const timer=setTimeout(()=>response.end(),3000);
 response.on('close',()=>{clearTimeout(timer);record.cancelled=!response.writableEnded;});
};
const service=await build({entryPoints:[resolve(root,'worker/index.ts')],bundle:true,write:false,format:'esm',platform:'browser',target:'es2022',external:['cloudflare:workers'],plugins:[{name:'fixture-auth',setup(b){b.onLoad({filter:/[/\\]worker[/\\]auth\.ts$/},()=>({contents:`export async function identity(){return {username:'verified',admin:false};}`,loader:'ts'}));}}]});
const client=await build({stdin:{resolveDir:root,sourcefile:'client.ts',loader:'ts',contents:`
import {runAI} from '@hasbai/ai';
export default {async fetch(request,env,ctx){const input=await request.json(),abort=new AbortController();if(!input.fail)ctx.waitUntil(new Promise(resolve=>setTimeout(()=>{abort.abort();resolve();},100)));const response=await runAI(env.AI_SERVICE,'roleplay',input,{app:'tavern',username:'verified',requestId:'round'},abort.signal);if(input.fail)return response;const reader=response.body.getReader();let ended=false;return new Response(new ReadableStream({async pull(c){try{const next=await reader.read();if(ended)return;if(next.done){ended=true;c.close();}else c.enqueue(next.value);}catch(error){if(ended)return;ended=true;if(abort.signal.aborted)c.close();else c.error(error);}},async cancel(){ended=true;abort.abort();await reader.cancel().catch(()=>{});}}),response);}};
`},bundle:true,write:false,format:'esm',platform:'browser',target:'es2022'});
const runtime=new Miniflare(convertV4MiniflareOptions({handleUncaughtError(error){if(!/AbortError|operation was aborted/.test(String(error)))throw error;},workers:[
 {name:'client',modules:true,script:client.outputFiles[0].text,compatibilityDate:'2026-10-16',compatibilityFlags:['enable_request_signal'],serviceBindings:{AI_SERVICE:{name:'ai',entrypoint:'InferenceService'}}},
 {name:'ai',modules:true,script:service.outputFiles[0].text,compatibilityDate:'2026-10-16',compatibilityFlags:['nodejs_compat','enable_request_signal'],bindings:{CLOUDFLARE_ACCOUNT_ID:'fixture',AIG_GATEWAY_ID:'default',AIG_RUN_TOKEN:'fixture'},outboundService:{node:upstream}},
]}));
try {
 const abort=new AbortController();const response=await runtime.dispatchFetch('https://client.test',{method:'POST',signal:abort.signal,body:JSON.stringify({model:'translate',messages:[{role:'user',content:'hi'}],stream:true})});
 assert.equal(response.status,200);assert.equal(response.headers.get('cf-aig-log-id'),'stream-log');
 const reader=response.body.getReader();const first=await reader.read();assert.equal(new TextDecoder().decode(first.value),'data: first\n\n');abort.abort();await reader.cancel().catch(()=>{});
 for(let n=0;n<50&&!last.cancelled;n++)await new Promise(resolve=>setTimeout(resolve,20));
 assert.equal(last.cancelled,true,'response cancellation must close the HTTP upstream before it finishes');
 assert.equal(last.input.model,'dynamic/translate');assert.equal(JSON.parse(last.headers['cf-aig-metadata']).username,'verified');assert.equal(last.headers['cf-aig-event-id'],'round');
 const ai=await runtime.getWorker('ai');assert.equal((await ai.fetch('https://ai.test/internal/roleplay',{method:'POST',body:'{}'})).status,404);
 const failed=await runtime.dispatchFetch('https://client.test',{method:'POST',body:JSON.stringify({fail:true})});assert.equal(failed.status,429);assert.equal(failed.headers.get('cf-aig-log-id'),'failure-log');assert.equal(await failed.text(),'upstream failure');
 console.log('workerd: named service binding, first SSE chunk, HTTP upstream cancellation, fixed route, attribution, public/internal separation and raw upstream failures passed');
} finally {await runtime.dispose();}
