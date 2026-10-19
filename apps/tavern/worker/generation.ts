import { contextUsage } from './session-context';
import type { AgentActivity } from '../shared/types';
import { readPrompts } from './prompts';
import { capabilityProtocol } from '../shared/agent-protocol';
import { capabilities, modelInput, recordFeedback, type Capability } from './models';
import { candidateDelimiter, CandidateStream } from '../shared/candidates';
import { inferRoleplay, InferenceError } from './inference';
import { DirectorAgent, DIRECTOR_RESPONSE_FORMAT, directorTask } from './director';
import { InferenceMetrics } from './metrics';
import { parseBook, parseCard } from '../shared/cards';
import {LoreIndex,embeddings} from './lore';
import { buildPrompt, stateMessage, type PromptMessage } from '../shared/prompt';
import { ConversationContext, summarizeWithModel, explicitContextLimit, contextLimit, validSummary } from './context';
import { generationNotice } from '../shared/outcomes';
import type { FinishReason, Message } from '../shared/types';
import { HttpError, json } from './http';
import { settings, currentMessages, message, ownedBooks } from './store';
import type { SessionStore } from './session-store';
import { recallRequested, draftProblems } from './narrative';
import { AGENT_TOOLS, AgentTurn, contentHash, stableJson, stateContext, storyMessages, type ToolCall, type ModelProjection } from './agent';
export { explicitContextLimit } from './context';
const UUID=/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i;
export async function generate(request:Request,env:Env,ctx:Pick<ExecutionContext,'waitUntil'>,owner:string,id:string,data:Record<string,unknown>,username:string,store:SessionStore,onSettled:(id:string)=>Promise<void> = async()=>{},onClaim:(id:string,abort:AbortController)=>void = ()=>{},beforeClaim:()=>void=()=>{}) {
 const started=Date.now();
 const requestId=String(data.requestId??'');if(!UUID.test(requestId))throw new HttpError(400,'请求 ID 无效');
 const initial=store.get();
 const existing=store.findRequest(requestId);
 if(existing)return json({message:message(existing),replayed:true});
 const promptDocument=await readPrompts(env),texts=promptDocument.texts;
 const contextOptions={protocol:capabilityProtocol('body',texts.agent),summaryTask:capabilityProtocol('summary',texts.summaryTask)};
 const directorRule=capabilityProtocol('director',texts.director);
 const capability=await capabilities(env,ctx);beforeClaim();if(request.signal.aborted||store.cancelled(requestId))throw new HttpError(409,'生成已停止');const now=Date.now();
 if(data.continue===true)throw new HttpError(400,'续写已移除');
 const regenerate=data.regenerate===true;const text=typeof data.content==='string'?data.content.trim():'';
 if(!regenerate && (!text || text.length>24000))throw new HttpError(400,'消息需为 1–24000 字符');
 const assistantId=crypto.randomUUID();
 if(!store.claim(assistantId,now))throw new HttpError(409,'当前会话正在生成');
 const abort=new AbortController();let checking=false;let leaseLost=false;let ready=false;let finishing=false;let abortReason:FinishReason='stopped';onClaim(assistantId,abort);
 const owns=async()=>{if(abort.signal.aborted)throw new HttpError(409,'生成已停止');if(!store.owns(assistantId)){leaseLost=true;abort.abort();throw new Error('会话生成已接管');}};
 const stopWatcher=setInterval(()=>{if(checking||finishing||abort.signal.aborted)return;checking=true;try{if(!store.renew(assistantId)){leaseLost=true;abort.abort();return;}if(ready&&!store.pending(assistantId)){abortReason='stopped';abort.abort();}}catch{leaseLost=true;abortReason='upstream';abort.abort();}finally{checking=false;}},1000);
 let report:(kind:AgentActivity['kind'],key:string,status:AgentActivity['status'],title:string,result?:unknown,input?:unknown)=>Promise<void>;
 let compression=0;let compressionKey='';
 const observeCompression=async(status:'running'|'completed'|'error',result:unknown)=>{if(status==='running')compressionKey='compression-'+(++compression);await report('compression',compressionKey,status,'压缩上下文',result);};
 let row=initial;let prompt:ReturnType<typeof buildPrompt>;let conversation:ConversationContext;let agent:AgentTurn;
 const toolTranscript:PromptMessage[]=[];
 let projectionContext:unknown;let storyProjection:ModelProjection|undefined;let lore:LoreIndex;let committedBase:Message[];
 try {
  row=store.get();
  const history=currentMessages(store.messages());const messageTime=Math.max(now,...history.map(m=>m.createdAt+1));
  let ordinal=Math.max(-1,...history.map(m=>m.ordinal))+1;
  let base=storyMessages(store.messages());let before=store.state(base);
  const target=regenerate?(data.messageId?history.find(m=>m.id===data.messageId):history.at(-1)):undefined;
  if(regenerate){if(!target)throw new HttpError(400,'没有可重新生成的消息');ordinal=target.ordinal+(target.role==='user'?1:0);before=target.role==='assistant'?store.before(target.id):store.state(base.filter(m=>m.ordinal<ordinal));base=base.filter(m=>m.ordinal<ordinal);}
  committedBase=structuredClone(base);
  const userMessage:Message={id:crypto.randomUUID(),role:'user',content:text,status:'completed',ordinal,requestId,createdAt:messageTime};
  const assistantOrdinal=regenerate?ordinal:ordinal+1;
  const books=await ownedBooks(env,owner,JSON.parse(row.book_ids_json));
  const embedded=parseCard(JSON.parse(row.character_json)).data.character_book;
  lore=new LoreIndex(store.storage.sql,[...(embedded?[{id:'character',book:parseBook(embedded)}]:[]),...books.filter(b=>b.enabled).map(b=>({id:b.id,book:parseBook(JSON.parse(b.book_json),b.name)}))],(texts,signal)=>embeddings(env,texts,username,requestId,signal),abort.signal,base);
  agent=new AgentTurn(before,base,regenerate?[...base].reverse().find(m=>m.role==='user'):userMessage,(hit,offset)=>lore.read(hit,offset));
  projectionContext={character:JSON.parse(row.character_json),books:books.map(b=>[b.id,b.enabled,b.book_json]),settings:JSON.parse(row.settings_json),tools:AGENT_TOOLS,prompts:promptDocument,contextOptions,directorRule,promptVersion:9};
  const currentInput=regenerate?(base.at(-1)?.role==='user'?base.at(-1):undefined):userMessage;
  const contextHistory=currentInput&&base.at(-1)?.id===currentInput.id?base.slice(0,-1):base;
  conversation=new ConversationContext(contextHistory,JSON.parse(row.character_json),books.filter(b=>b.enabled).map(b=>parseBook(JSON.parse(b.book_json),b.name)),settings(JSON.parse(row.settings_json)),capability.contextTokens,{...contextOptions,inputRatio:capability.inputRatio,state:stateContext(before),currentInput},messages=>summarizeWithModel(env,username,requestId,settings(JSON.parse(row.settings_json)),messages,abort.signal),observeCompression);
  await conversation.restore(row.summary_json);
  prompt=conversation.prompt();
  {const previous=base.at(-1),saved=previous?store.projection(previous.id):null;
   if(saved&&saved.messages[0]?.content===prompt.messages[0]?.content&&saved.key===await contentHash([projectionContext,base.map(m=>[m.id,m.content])])){
    const tail:PromptMessage[]=[...(conversation.options.state?[stateMessage(conversation.options.state)]:[]),...(regenerate?[]:[prompt.messages.at(-1)!])];
    conversation.useProjection([...saved.messages,...tail]);prompt=conversation.prompt();
   }
  }
  modelInput(settings(JSON.parse(row.settings_json)));
  await owns();store.start(assistantId,regenerate?undefined:userMessage,{id:assistantId,role:'assistant',content:'',status:'pending',ordinal:assistantOrdinal,requestId,createdAt:messageTime+1},before,target?.id);ready=true;
 }catch(error){clearInterval(stopWatcher);abort.abort();try{store.release(assistantId);}finally{await onSettled(assistantId);}if(error instanceof Error&&error.message.includes('上下文上限'))throw new HttpError(400,error.message);throw error;}
 const sourceHistory=structuredClone([...conversation.history,...(conversation.options.currentInput?[conversation.options.currentInput]:[])]);let checkpoint=conversation.summary?JSON.stringify(conversation.summary):null;
 let disconnected=false;let output='';let finishReason:FinishReason='interrupted';let model='';let gatewayLogId:string|null=null;let metrics=new InferenceMetrics();let firstModelStarted:number|null=null;let modelRequests=0;let firstBodyAt:number|null=null;let candidates:string[]=[];let parser=new CandidateStream(candidateDelimiter());let parserFinished=false;let candidateOutcome='not-started';let candidateError='';let bodyModel='';let bodyGatewayLogId:string|null=null;let bodyFinishedAt:number|null=null;let candidateStartedAt:number|null=null;let candidateFirstAt:number|null=null;let candidateFinishedAt:number|null=null;let bodyRequests=0;let director:DirectorAgent|undefined;let synopsisRequests=0;let synopsisSource='not-started';let synopsisCovered=0;let synopsisMetrics:ReturnType<InferenceMetrics['snapshot']>|null=null;let synopsisGatewayLogId:string|null=null;let synopsisModel='';let synopsisElapsedMs=0;let directorStartedAt:number|null=null;let bodyMetrics:ReturnType<InferenceMetrics['snapshot']>|null=null;

 let transport!:TransformStreamDefaultController<Uint8Array>,ending=false;
 const stream=new TransformStream<Uint8Array,Uint8Array>({start(controller){transport=controller;}});
 const writer=stream.writable.getWriter(),encoder=new TextEncoder();
 const frame=(event:unknown)=>encoder.encode('data: '+JSON.stringify(event)+'\n\n');
 const send=async(event:unknown)=>{
  if(abort.signal.aborted)throw new Error('生成已停止');
  if(disconnected)return;
  let stop!:()=>void;
  const cancelled=new Promise<never>((_,reject)=>{stop=()=>reject(new Error('生成已停止'));abort.signal.addEventListener('abort',stop,{once:true});});
  const bytes=frame(event);
  try{await Promise.race([writer.write(bytes),cancelled]);}catch(error){if(abort.signal.aborted)throw error;onDisconnect();}finally{abort.signal.removeEventListener('abort',stop);}
 };
 // Detach transport without aborting the independent model task. Terminating
 // the stream also releases a write blocked by a paused/disconnected reader.
 const onDisconnect=()=>{if(ending||disconnected)return;disconnected=true;try{transport.terminate();}catch{/* The reader may already have cancelled. */}};request.signal.addEventListener('abort',onDisconnect,{once:true});if(request.signal.aborted)onDisconnect();void writer.closed.catch(onDisconnect);
 report=async(kind,key,status,title,result,input)=>{const value:AgentActivity={id:assistantId+':'+key,messageId:assistantId,ordinal:store.findMessage(assistantId)!.ordinal,kind,title,status,result,input,createdAt:Date.now()};const previous=store.activities().find(a=>a.id===value.id);if(previous){value.createdAt=previous.createdAt;value.input??=previous.input;}store.activity(value);if(!disconnected&&!ending)try{transport.enqueue(frame({type:'activity',activity:value}));}catch{onDisconnect();}};
 const publishContext=async()=>{if(!disconnected)try{transport.enqueue(frame({type:'context',context:contextUsage(conversation)}));}catch{onDisconnect();}};
 const work=(async()=>{
  let status:Message['status']='completed';let failure='';
  try{
   await send({type:'start',messageId:assistantId,requestId});
   const opts=settings(JSON.parse(row.settings_json));
   prompt=await conversation.fit();await publishContext();
   const saveSummary=async()=>{await owns();if(conversation.summary?.covered.includes(assistantId))return;checkpoint=conversation.summary?JSON.stringify(conversation.summary):null;const saved=store.saveSummary(assistantId,checkpoint);if(!saved){abort.abort();throw new Error('生成已停止');}if(conversation.contextTokens!==null)await recordFeedback(env,capability,{contextLimit:conversation.contextTokens});};
   await saveSummary();
   const checkpointDraft=async()=>{await owns();if(!store.saveDraft(assistantId,output))throw Error('生成已停止');};
   const attemptPrefix=structuredClone(prompt.messages);let draftSavedAt=0;let streamedUntil=0;
   const streamOutput=async()=>{
    const delta=output.slice(streamedUntil),end=output.length;
    if(delta){firstBodyAt??=Date.now();await send({type:'delta',text:delta});streamedUntil=end;}
   };
   for(;;){
   await owns();const storyAtStart=output.length;let requestOutput='';let calls:ToolCall[]=[];
   finishReason='upstream';
   firstModelStarted??=Date.now();modelRequests++;bodyRequests++;metrics=new InferenceMetrics();
   finishReason='interrupted';
   let upstreamReason:string|undefined;let streamLimit:number|undefined;
   try{
    for await(const event of inferRoleplay(env,username,requestId,{messages:prompt.messages,tools:AGENT_TOOLS,tool_choice:'auto',...modelInput(opts)},abort.signal)){
     if(event.type==='observation'){metrics.observe(event.value);if(typeof event.value.model==='string')model=event.value.model;gatewayLogId=event.logId;}
     else if(event.type==='text'){requestOutput+=event.text;output+=parser.push(event.text);if(Date.now()-draftSavedAt>=1000){await checkpointDraft();draftSavedAt=Date.now();}await streamOutput();}
     else {upstreamReason=event.reason;calls=event.calls;}
    }
   }catch(error){
    if(!(error instanceof InferenceError))throw error;
    finishReason=error.reason;gatewayLogId=error.logId;await errorFeedback(env,capability,error.value).catch(()=>{});streamLimit=contextLimit(error.value);if(!streamLimit||error.hasToolFragments)throw error;
   }
   await checkpointDraft();
   if(streamLimit){if(output.length||calls.length)throw new Error('生成途中上下文超限');conversation.contextTokens=streamLimit;const before=prompt.estimatedTokens;await conversation.compress();prompt=await conversation.fit(conversation.options,toolTranscript);if(prompt.estimatedTokens>=before)throw new Error('会话压缩未缩短输入');await saveSummary();continue;}
   if(upstreamReason==='tool_calls'){
    finishReason='unsupported';
    if(!calls.length)throw new Error('工具调用为空');
    for(const call of calls)await report('tool',call.id,'running',call.function.name,undefined,{arguments:call.function.arguments});
    agent.observeOutput(output);agent.validate(calls);const recalled=new Map();
    for(const call of calls)if(call.function.name==='search_memory'){const args=JSON.parse(call.function.arguments);if(typeof args.query==='string')recalled.set(args.query,await lore.search(args.query));}
    await owns();const results=agent.execute(calls,recalled);if(!store.saveSteps(assistantId,agent.steps))throw new Error('生成已停止');
    for(const step of agent.steps.filter(step=>calls.some(call=>call.id===step.call.id)))await report('tool',step.call.id,'completed',step.call.function.name,step.result,{arguments:step.call.function.arguments});
    const toolMessage:PromptMessage={role:'assistant',content:requestOutput};
    toolMessage.tool_calls=calls;
    const additions:PromptMessage[]=[toolMessage,...results];
    if(storyAtStart&&!toolTranscript.length)toolTranscript.push({role:'assistant',content:output.slice(0,storyAtStart)});toolTranscript.push(...additions);prompt=conversation.extend(prompt,additions);
    if(prompt.needsCompression){if(output.length){finishReason='upstream';throw Error('工具后上下文超限');}prompt=await conversation.fit(conversation.options,toolTranscript);}await saveSummary();continue;
   }
   if(calls.length)throw new Error('工具终态无效');
   const parsed=parser.finish();parserFinished=true;output+=parsed.body;await streamOutput();
   if(abort.signal.aborted)throw new Error('aborted');
   finishReason=upstreamReason==='stop'?'stop':upstreamReason==='length'?'length':upstreamReason==='content_filter'?'content_filter':upstreamReason?'unsupported':'interrupted';
   if(finishReason!=='stop')throw new Error('incomplete');
   if(!output.trim()){finishReason='empty';throw new Error('empty');}
   bodyFinishedAt=Date.now();bodyModel=model;bodyGatewayLogId=gatewayLogId;bodyMetrics=metrics.snapshot();
   const latestInput=[...sourceHistory].reverse().find(m=>m.role==='user')?.content??'';
   const problems=draftProblems(output,committedBase.filter(m=>m.role==='assistant'&&m.status==='completed').map(m=>m.content),recallRequested(latestInput));
   if(problems.length){finishReason='invalid_output';throw Error('正文输出异常');}
   finishReason='stop';
   await owns();if(!store.saveOutput(assistantId,output))throw Error('生成已停止');
   await report('director','director','running','Director · 下一步');
   await send({type:'candidates_pending',messageId:assistantId});
   const committedHistory=storyMessages([...store.messages().filter(m=>m.id!==assistantId),{id:assistantId,role:'assistant',content:output,status:'completed',ordinal:store.findMessage(assistantId)!.ordinal,requestId,createdAt:now}]);
   // Persist only confirmed story, never the request's state snapshots or control turns.
   const summary=await validSummary(checkpoint,committedHistory);
   const canonical=buildPrompt(conversation.card,conversation.books,committedHistory.slice(summary?.covered.length??0),opts,null,{...contextOptions,inputRatio:capability.inputRatio,summary:summary?.text});
   storyProjection={key:await contentHash([projectionContext,committedHistory.map(m=>[m.id,m.content])]),messages:canonical.messages};
   await owns();
   candidateStartedAt=Date.now();candidateOutcome='generating';
   try{
    const synopsisOptions={contextTokens:conversation.contextTokens,inputRatio:capability.inputRatio,infer:async(messages:PromptMessage[])=>{
     await owns();synopsisRequests++;modelRequests++;synopsisGatewayLogId=null;const started=Date.now(),observations=new InferenceMetrics();
     try{const result=await summarizeWithModel(env,username,requestId,opts,messages,abort.signal,(event,logId)=>{observations.observe(event);synopsisGatewayLogId=logId;const value=event as {model?:unknown};if(typeof value.model==='string')synopsisModel=value.model;});await owns();return result;}finally{synopsisElapsedMs+=Date.now()-started;synopsisMetrics=observations.snapshot();}
    }};
    // Preserve the body prefix, including tool transcript and any existing checkpoint.
    synopsisSource='body-prefix';synopsisCovered=conversation.summary?.covered.length??0;
    let fallback:ConversationContext|undefined;
    const rebuild=async(limit:number|null)=>{
     if(!fallback){
      fallback=new ConversationContext(structuredClone(committedHistory.filter(m=>m.id!==assistantId&&m.id!==conversation.options.currentInput?.id)),conversation.card,conversation.books,opts,limit,{...contextOptions,inputRatio:capability.inputRatio,currentInput:conversation.options.currentInput},synopsisOptions.infer,observeCompression);
      await fallback.restore(conversation.summary?JSON.stringify(conversation.summary):null);
     }
     fallback.contextTokens=limit;
     let rebuilt=await fallback.fit();
     let tail:PromptMessage[]=[{role:'assistant',content:output},directorTask(agent.state,directorRule)];
     while(fallback.extend(rebuilt,tail).needsCompression){const before=rebuilt.estimatedTokens;await fallback.compress();rebuilt=await fallback.fit();if(rebuilt.estimatedTokens>=before)throw Error('完整正文与候选任务超过上下文');tail=[{role:'assistant',content:output},directorTask(agent.state,directorRule)];}
     synopsisOptions.contextTokens=fallback.contextTokens;if(director)director.contextTokens=fallback.contextTokens;
     return [...rebuilt.messages,...tail];
    };
    const prefixIntact=stableJson(prompt.messages.slice(0,attemptPrefix.length))===stableJson(attemptPrefix);
    if(prefixIntact)director=new DirectorAgent(prompt.messages,requestOutput,agent.state,conversation.contextTokens,capability.inputRatio,directorRule);
    else{
     // A history checkpoint may have changed. Include the full visible body once.
     const rebuilt=await rebuild(conversation.contextTokens);
     director=new DirectorAgent(rebuilt.slice(0,-2),output,agent.state,fallback!.contextTokens,capability.inputRatio,directorRule);
    }
    directorStartedAt=Date.now();candidates=await director.run(messages=>{
     modelRequests++;
     return inferRoleplay(env,username,requestId,{messages,tools:AGENT_TOOLS,tool_choice:'none',response_format:DIRECTOR_RESPONSE_FORMAT,...modelInput(opts),...(opts.thinkingEnabled?{thinking_budget_tokens:0}:{})},abort.signal);
    },abort.signal,owns,rebuild);
    candidateOutcome=director.outcome;candidateFirstAt=director.firstAt;model=director.model||model;gatewayLogId=director.gatewayLogId;metrics=director.metrics;
   }catch(error){candidateOutcome='error';candidateError=(error as Error).message;if(abort.signal.aborted)throw error;candidates=[];}
   candidateFinishedAt=Date.now();
   await report('director','director',candidateOutcome==='completed'?'completed':'error','Director · 下一步',{candidates,outcome:candidateOutcome,output:director?.rawOutput??'',...((candidateError||director?.error)?{error:candidateError||director?.error}:{})});
   break;
   }
  }catch{if(candidateStartedAt!==null)candidateOutcome=abort.signal.aborted?abortReason:'error';if(abort.signal.aborted)finishReason=abortReason;else if(finishReason==='stop')finishReason='upstream';status=['stopped','disconnected','timeout'].includes(finishReason)?'aborted':'error';failure=generationNotice(finishReason);}
  finally{
   if(candidateStartedAt!==null)candidateFinishedAt??=Date.now();
   if(director)candidateFirstAt=director.firstAt;
   const phaseMetrics=director?.requests?director.metrics.snapshot():synopsisRequests?synopsisMetrics:metrics.snapshot();
   if(director?.requests){gatewayLogId=director.gatewayLogId;model=director.model;}else if(synopsisRequests){gatewayLogId=synopsisGatewayLogId;model=synopsisModel;}
   finishing=true;clearInterval(stopWatcher);
   try{
    let saved:ReturnType<SessionStore['finish']>;try{
     store.settleActivities(assistantId,status==='aborted'?'stopped':'error',failure||'运行中断');
     if(!parserFinished)output+=parser.finish().body;
     if(store.owns(assistantId))store.saveDraft(assistantId,output);saved=store.finish(assistantId,output,status,finishReason,candidates,agent.state,storyProjection);}finally{await onSettled(assistantId);}
    console.info('tavern-generation-outcome',{messageId:assistantId,requestId,gatewayLogId,finishReason:saved?.finish_reason,status:saved?.status,model,modelRequests,metricsScope:director?.requests?'last-candidate-request':synopsisRequests?'last-synopsis-request':'last-body-request',...phaseMetrics,firstBodyMs:firstBodyAt===null?null:firstBodyAt-started,modelFirstBodyMs:firstBodyAt===null||firstModelStarted===null?null:firstBodyAt-firstModelStarted,promptBudget:prompt.budget,estimatedInputTokens:prompt.estimatedTokens,chars:output.length,bodyModel,bodyGatewayLogId,bodyRequests,candidateRequests:director?.requests??0,synopsisRequests,synopsisSource,synopsisCovered,synopsisMetricsScope:'last-synopsis-request',synopsisMetrics,synopsisGatewayLogId,synopsisElapsedMs,directorFirstMs:candidateFirstAt===null||directorStartedAt===null?null:candidateFirstAt-directorStartedAt,bodyMetricsScope:'last-body-request',bodyMetrics,bodyCompleteMs:bodyFinishedAt===null?null:bodyFinishedAt-started,candidateFirstMs:candidateFirstAt===null||candidateStartedAt===null?null:candidateFirstAt-candidateStartedAt,candidateElapsedMs:candidateFinishedAt===null||candidateStartedAt===null?null:candidateFinishedAt-candidateStartedAt,directorContextRebuilds:director?.rebuilds??0,directorEstimatedInputTokens:director?.prompt().estimatedTokens??null,directorIncludedMessages:director?.prompt().includedMessages??null,directorStoryCondensed:director?.prompt().condensed??false,candidateOutcome,candidateCount:saved?.candidates_json?JSON.parse(saved.candidates_json).length:0,elapsedMs:Date.now()-started});
    // Terminal frames are bounded and must not retain the generation while a reader is paused.
    if(!disconnected&&!leaseLost){if(failure)transport.enqueue(frame({type:'error',message:failure}));transport.enqueue(frame({type:'done',message:message(saved!)}));}
   }finally{ending=true;clearInterval(stopWatcher);request.signal.removeEventListener('abort',onDisconnect);try{transport.terminate();}catch{/* The reader may already have cancelled. */}}

  }
 })();
 ctx.waitUntil(work.catch(()=>{console.error('tavern-generation-persist-failed',{messageId:assistantId});abort.abort();}));
 return new Response(stream.readable,{headers:{'Content-Type':'text/event-stream; charset=utf-8','Cache-Control':'no-cache, no-store','X-Content-Type-Options':'nosniff'}});
}

export async function errorFeedback(env:Env,capability:Capability,value:unknown) {
 if(!value||typeof value!=='object')return;const v=value as {model?:unknown;error?:{model?:unknown;message?:unknown};message?:unknown};
 const actualModel=typeof v.model==='string'?v.model:typeof v.error?.model==='string'?v.error.model:undefined;
 const text=typeof v.error?.message==='string'?v.error.message:typeof v.message==='string'?v.message:'';
 const limit=contextLimit(value);if(limit)await recordFeedback(env,capability,{model:actualModel,contextLimit:limit});
}
