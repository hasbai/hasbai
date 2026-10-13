import { REPAIR_PROBLEMS } from '../shared/instructions';
import { readPrompts } from './prompts';
import { capabilities, modelInput, recordFeedback, type Capability } from './models';
import { candidateDelimiter, CandidateStream } from '../shared/candidates';
import { runRoleplay } from './gateway';
import { DirectorAgent, DirectorContextError, DIRECTOR_RESPONSE_FORMAT, directorTask } from './director';
import { InferenceMetrics } from './metrics';
import { parseBook, parseCard } from '../shared/cards';
import {LoreIndex,embeddings} from './lore';
import { buildPrompt, stateMessage, type PromptMessage } from '../shared/prompt';
import { ConversationContext, summarizeWithModel, explicitContextLimit, contextLimit, validSummary } from './context';
import { sseData } from '../shared/sse';
import { generationNotice } from '../shared/outcomes';
import type { FinishReason, Message } from '../shared/types';
import { HttpError, json } from './http';
import { settings, currentMessages, message, ownedBooks } from './store';
import type { SessionStore } from './session-store';
import { recallRequested, draftProblems, protocolProblems, streamableEnd } from './narrative';
import { AGENT_TOOLS, AgentTurn, contentHash, stableJson, stateContext, storyMessages, ToolCallStream, type ModelProjection, type StoryState } from './agent';
export { explicitContextLimit } from './context';
const UUID=/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i;
export async function generate(request:Request,env:Env,ctx:Pick<ExecutionContext,'waitUntil'>,owner:string,id:string,data:Record<string,unknown>,username:string,store:SessionStore,onSettled:(id:string)=>Promise<void> = async()=>{},onClaim:(id:string,abort:AbortController)=>void = ()=>{},beforeClaim:()=>void=()=>{}) {
 const started=Date.now();
 const requestId=String(data.requestId??'');if(!UUID.test(requestId))throw new HttpError(400,'请求 ID 无效');
 const initial=store.get();
 const existing=store.findRequest(requestId);
 if(existing)return json({message:message(existing),replayed:true});
 const promptDocument=await readPrompts(env),texts=promptDocument.texts;
 const contextOptions={protocol:texts.agent,cardPostOriginal:texts.cardPostOriginal,summaryRule:texts.summary,summaryTask:texts.summaryTask};
 const repairTexts:Record<string,string>={[REPAIR_PROBLEMS.incompleteThink]:texts.repairIncompleteThink,[REPAIR_PROBLEMS.repeatedParagraph]:texts.repairRepeatedParagraph,[REPAIR_PROBLEMS.repeatedHistory]:texts.repairRepeatedHistory,[REPAIR_PROBLEMS.exposedThink]:texts.repairExposedThink};
 const repairProblem=(value:string)=>repairTexts[value]??value;
 const capability=await capabilities(env,ctx);beforeClaim();if(request.signal.aborted||store.cancelled(requestId))throw new HttpError(409,'生成已停止');const now=Date.now();
 const regenerate=data.regenerate===true;let continuing=data.continue===true;
 if(regenerate&&continuing)throw new HttpError(400,'生成模式无效');const text=typeof data.content==='string'?data.content.trim():'';
 if(!regenerate && !continuing && (!text || text.length>24000))throw new HttpError(400,'消息需为 1–24000 字符');
 const assistantId=crypto.randomUUID();
 if(!store.claim(assistantId,now))throw new HttpError(409,'当前会话正在生成');
 const abort=new AbortController();let checking=false;let leaseLost=false;let ready=false;let finishing=false;let abortReason:FinishReason='stopped';onClaim(assistantId,abort);
 const owns=async()=>{if(abort.signal.aborted)throw new Error('生成已停止');if(!store.owns(assistantId)){leaseLost=true;abort.abort();throw new Error('会话生成已接管');}};
 const stopWatcher=setInterval(()=>{if(checking||finishing||abort.signal.aborted)return;checking=true;try{if(!store.renew(assistantId)){leaseLost=true;abort.abort();return;}if(ready&&!store.pending(assistantId)){abortReason='stopped';abort.abort();}}catch{leaseLost=true;abortReason='upstream';abort.abort();}finally{checking=false;}},1000);
 let prefix='';let row=initial;let prompt:ReturnType<typeof buildPrompt>;let conversation:ConversationContext;let agent:AgentTurn;
 const toolTranscript:PromptMessage[]=[];
 let projectionContext:unknown;let storyProjection:ModelProjection|undefined;let lore:LoreIndex;let beforeState:StoryState;let committedBase:Message[];
 try {
  row=store.get();
  const history=currentMessages(store.messages());const messageTime=Math.max(now,...history.map(m=>m.createdAt+1));
  let ordinal=Math.max(-1,...history.map(m=>m.ordinal))+1;
  let base=storyMessages(store.messages());let before=store.state(base);
  if(continuing){const last=history.at(-1);if(last?.role!=='assistant'||last.status==='pending'||last.status==='completed'||!last.content.trim())throw new HttpError(400,'没有可继续的回复');prefix=last.content;ordinal=last.ordinal;before=store.before(last.id);base=[...base.filter(m=>m.ordinal<last.ordinal),{...last,status:'completed'}];}
  if(regenerate){const last=history.at(-1);if(last?.role==='assistant'){ordinal=last.ordinal;before=store.before(last.id);base=base.filter(m=>m.ordinal<ordinal);}else if(last?.role==='user'){ordinal=last.ordinal+1;}else throw new HttpError(400,'没有可重新生成的消息');}
  beforeState=structuredClone(before);committedBase=structuredClone(base);agent=new AgentTurn(before,base);
  const userMessage:Message={id:crypto.randomUUID(),role:'user',content:text,status:'completed',ordinal,requestId,createdAt:messageTime};
  const assistantOrdinal=regenerate||continuing?ordinal:ordinal+1;
  const books=await ownedBooks(env,owner,JSON.parse(row.book_ids_json));
  const embedded=parseCard(JSON.parse(row.character_json)).data.character_book;
  lore=new LoreIndex(store.storage.sql,[...(embedded?[{id:'character',book:parseBook(embedded)}]:[]),...books.filter(b=>b.enabled).map(b=>({id:b.id,book:parseBook(JSON.parse(b.book_json),b.name)}))],(texts,signal)=>embeddings(env,texts,username,requestId,signal),abort.signal);
  projectionContext={character:JSON.parse(row.character_json),books:books.map(b=>[b.id,b.enabled,b.book_json]),settings:JSON.parse(row.settings_json),tools:AGENT_TOOLS,prompts:promptDocument,promptVersion:7};
  conversation=new ConversationContext([...base,...(regenerate||continuing?[]:[userMessage])],JSON.parse(row.character_json),books.filter(b=>b.enabled).map(b=>parseBook(JSON.parse(b.book_json),b.name)),settings(JSON.parse(row.settings_json)),capability.contextTokens,{...contextOptions,inputRatio:capability.inputRatio,state:stateContext(before)},messages=>summarizeWithModel(env,username,requestId,settings(JSON.parse(row.settings_json)),messages,abort.signal));
  await conversation.restore(row.summary_json);if(continuing)conversation.resume(assistantId);
  prompt=conversation.prompt(continuing?texts.continueReply:'');
  if(!continuing){const previous=base.at(-1),saved=previous?store.projection(previous.id):null;
   if(saved&&saved.messages[0]?.content===prompt.messages[0]?.content&&saved.key===await contentHash([projectionContext,base.map(m=>[m.id,m.content])])){
    const tail:PromptMessage[]=[...(conversation.options.state?[stateMessage(conversation.options.state)]:[]),...(regenerate?[]:[prompt.messages.at(-1)!])];
    conversation.useProjection([...saved.messages,...tail]);prompt=conversation.prompt();
   }
  }
  modelInput(settings(JSON.parse(row.settings_json)));
  await owns();store.start(assistantId,regenerate||continuing?undefined:userMessage,{id:assistantId,role:'assistant',content:prefix,status:'pending',ordinal:assistantOrdinal,requestId,createdAt:messageTime+1},before);ready=true;
 }catch(error){clearInterval(stopWatcher);abort.abort();try{store.release(assistantId);}finally{await onSettled(assistantId);}if(error instanceof Error&&error.message.includes('上下文上限'))throw new HttpError(400,error.message);throw error;}
 let sourceHistory=structuredClone(conversation.history);let checkpoint=row.summary_json;
 let disconnected=false;let output=prefix;let publishedOutput=prefix;let draftRejected=false;let repairIssues:string[]=[];let revisions=0;let finishReason:FinishReason='interrupted';let model='';let gatewayLogId:string|null=null;let metrics=new InferenceMetrics();let firstModelStarted:number|null=null;let modelRequests=0;let firstBodyAt:number|null=null;let candidates:string[]=[];let parser=new CandidateStream(candidateDelimiter());let parserFinished=false;let candidateOutcome='not-started';let bodyModel='';let bodyGatewayLogId:string|null=null;let bodyFinishedAt:number|null=null;let candidateStartedAt:number|null=null;let candidateFirstAt:number|null=null;let candidateFinishedAt:number|null=null;let bodyRequests=0;let director:DirectorAgent|undefined;let synopsisRequests=0;let synopsisSource='not-started';let synopsisCovered=0;let synopsisMetrics:ReturnType<InferenceMetrics['snapshot']>|null=null;let synopsisGatewayLogId:string|null=null;let synopsisModel='';let synopsisElapsedMs=0;let directorStartedAt:number|null=null;let bodyMetrics:ReturnType<InferenceMetrics['snapshot']>|null=null;

 let transport!:TransformStreamDefaultController<Uint8Array>,ending=false;
 const stream=new TransformStream<Uint8Array,Uint8Array>({start(controller){transport=controller;}});
 const writer=stream.writable.getWriter(),encoder=new TextEncoder();
 const frame=(event:unknown)=>encoder.encode('data: '+JSON.stringify(event)+'\n\n');
 const send=async(event:unknown)=>{
  if(abort.signal.aborted)throw new Error('生成已停止');
  let stop!:()=>void;
  const cancelled=new Promise<never>((_,reject)=>{stop=()=>reject(new Error('生成已停止'));abort.signal.addEventListener('abort',stop,{once:true});});
  try{await Promise.race([writer.write(frame(event)),cancelled]);}finally{abort.signal.removeEventListener('abort',stop);}
 };
 const onDisconnect=()=>{if(ending)return;disconnected=true;abortReason='disconnected';abort.abort();};request.signal.addEventListener('abort',onDisconnect,{once:true});if(request.signal.aborted)onDisconnect();void writer.closed.catch(onDisconnect);
 const work=(async()=>{
  let status:Message['status']='completed';let failure='';
  try{
   await send({type:'start',messageId:assistantId,requestId});
   const opts=settings(JSON.parse(row.settings_json));
   let continuation=continuing?texts.continueReply:'';
   prompt=await conversation.fit(continuation);
   const saveSummary=async()=>{await owns();if(conversation.summary?.covered.includes(assistantId))return;checkpoint=conversation.summary?JSON.stringify(conversation.summary):null;const saved=store.saveSummary(assistantId,checkpoint);if(!saved){abort.abort();throw new Error('生成已停止');}if(conversation.contextTokens!==null)await recordFeedback(env,capability,{contextLimit:conversation.contextTokens});};
   await saveSummary();
   const checkpointDraft=async()=>{await owns();if(protocolProblems(output).length){draftRejected=true;publishedOutput='';if(!store.rejectDraft(assistantId))throw Error('生成已停止');}else if(!draftRejected&&!store.saveDraft(assistantId,output))throw Error('生成已停止');};
   const syncOutput=(start:number)=>{const delta=output.slice(start);if(!delta)return;conversation.appendOutput({id:assistantId,role:'assistant',content:'',status:'completed',ordinal:0,requestId,createdAt:now},delta,continuing);continuation=texts.continueBody;};
   // Only plain emitted prose may become story memory; legacy candidate protocol stays opaque.
   const storyWire=(raw:string,start:number):PromptMessage=>output.slice(start).trim()===raw.replace(/\r\n?/g,'\n').trim()?conversation.storyFragment(raw):{role:'assistant',content:raw};
   attempts:for(revisions=0;revisions<=1;revisions++){
   if(revisions){
    if(continuing){
     // A rejected legacy partial is regenerated from its original before-state.
     const ordinal=store.findMessage(assistantId)!.ordinal;sourceHistory=sourceHistory.filter(m=>m.ordinal<ordinal);committedBase=committedBase.filter(m=>m.ordinal<ordinal);prefix='';publishedOutput='';continuing=false;await owns();if(!store.saveOutput(assistantId,''))throw Error('生成已停止');
    }
    continuation=continuing?texts.continueReply:'';
    await owns();output=prefix;draftRejected=false;agent=new AgentTurn(beforeState,committedBase);toolTranscript.length=0;store.saveSteps(assistantId,[]);parser=new CandidateStream(candidateDelimiter());parserFinished=false;
    const previous=conversation;
    conversation=new ConversationContext(structuredClone(sourceHistory),previous.card,previous.books,previous.settings,previous.contextTokens,previous.options,previous.infer);
    await conversation.restore(checkpoint);if(continuing)conversation.resume(assistantId);
    prompt=await conversation.fit(continuation);
    const repair:PromptMessage={role:'user',content:texts.repair+stableJson(repairIssues.map(repairProblem))};
    toolTranscript.push(repair);prompt=conversation.extend(prompt,[repair]);
    if(prompt.needsCompression)prompt=await conversation.fit(continuation,conversation.options,toolTranscript);
   }
   const attemptPrefix=structuredClone(prompt.messages);let draftSavedAt=0;let streamedUntil=prefix.length;
   const streamOutput=async()=>{
    if(protocolProblems(output).length){await checkpointDraft();return;}
    // A rejected first version may already be visible. The private revision replaces it via done.
    if(revisions||draftRejected)return;
    const end=streamableEnd(output),delta=output.slice(streamedUntil,end);
    if(delta){firstBodyAt??=Date.now();await send({type:'delta',text:delta});streamedUntil=end;}
   };
   for(;;){
   await owns();const storyAtStart=output.length;let requestOutput='';const toolCalls=new ToolCallStream();
   finishReason='upstream';
   firstModelStarted??=Date.now();modelRequests++;bodyRequests++;metrics=new InferenceMetrics();
   const result=await runRoleplay(env,username,requestId,{messages:prompt.messages,tools:AGENT_TOOLS,tool_choice:'auto',stream:true,...modelInput(opts)},abort.signal);
   if(!(result instanceof Response)){finishReason='unsupported';throw new Error('nonstream');}
   gatewayLogId=result.headers.get('cf-aig-log-id');
   if(!result.ok){const limit=await inspectLimit(result,env,capability);if(limit){conversation.contextTokens=limit;const before=prompt.estimatedTokens;await conversation.compressProjection(toolTranscript);prompt=await conversation.fit(continuation,conversation.options,toolTranscript);if(prompt.estimatedTokens>=before)throw new Error('会话压缩未缩短输入');await saveSummary();continue;}throw new Error('upstream');}
   if(!result.body||!result.headers.get('Content-Type')?.includes('text/event-stream')){finishReason='unsupported';await result.body?.cancel();throw new Error('nonstream');}
   finishReason='interrupted';
   let upstreamReason:string|undefined;let streamLimit:number|undefined;
   for await(const data of sseData(result.body,abort.signal)) {
    if(data==='[DONE]')break;
    const event=JSON.parse(data);if(event.error){await errorFeedback(env,capability,event).catch(()=>{});streamLimit=contextLimit(event);if(streamLimit)break;finishReason='upstream';throw new Error('upstream');}
    if(typeof event.model==='string')model=event.model;
    metrics.observe(event);
    const choice=event.choices?.[0];if(typeof choice?.finish_reason==='string'&&choice.finish_reason){if(upstreamReason&&upstreamReason!==choice.finish_reason){finishReason='interrupted';throw new Error('conflicting finish');}upstreamReason=choice.finish_reason;}
    toolCalls.push(choice?.delta?.tool_calls);
    const delta=choice?.delta?.content;
    if(typeof delta==='string') {requestOutput+=delta;output+=parser.push(delta);if(Date.now()-draftSavedAt>=1000){await checkpointDraft();draftSavedAt=Date.now();}await streamOutput();}

   }
   await checkpointDraft();
   if(streamLimit){if(toolCalls.size)throw new Error('工具调用中断');syncOutput(storyAtStart);if(toolTranscript.length&&requestOutput)toolTranscript.push(storyWire(requestOutput,storyAtStart));conversation.contextTokens=streamLimit;const before=conversation.prompt(continuation,conversation.options,toolTranscript).estimatedTokens;await conversation.compressProjection(toolTranscript);prompt=await conversation.fit(continuation,conversation.options,toolTranscript);if(prompt.estimatedTokens>=before)throw new Error('会话压缩未缩短输入');await saveSummary();continue;}
   if(upstreamReason==='tool_calls'){
    finishReason='unsupported';
    const calls=toolCalls.finish();if(!calls.length)throw new Error('工具调用为空');agent.validate(calls);const recalled=new Map();
    for(const call of calls)if(call.function.name==='search_memory'){const args=JSON.parse(call.function.arguments);if(typeof args.query==='string')recalled.set(args.query,await lore.search(args.query));}
    await owns();const results=agent.execute(calls,recalled);if(!store.saveSteps(assistantId,agent.steps))throw new Error('生成已停止');
    const toolMessage=storyWire(requestOutput,storyAtStart);
    toolMessage.tool_calls=calls;
    const additions:PromptMessage[]=[toolMessage,...results];
    if(storyAtStart&&!toolTranscript.length)toolTranscript.push(conversation.storyFragment(output.slice(0,storyAtStart)));toolTranscript.push(...additions);prompt=conversation.extend(prompt,additions);
    if(prompt.needsCompression)prompt=await conversation.fit(continuation,conversation.options,toolTranscript);await saveSummary();continue;
   }
   if(toolCalls.size)throw new Error('工具终态无效');
   if(upstreamReason==='length'){if(!requestOutput.length)throw new Error('模型续写没有进展');
    const additions:PromptMessage[]=[storyWire(requestOutput,storyAtStart),{role:'user',content:texts.continueBody}];toolTranscript.push(...additions);
    syncOutput(storyAtStart);prompt=conversation.extend(prompt,additions);if(prompt.needsCompression)prompt=await conversation.fit(continuation,conversation.options,toolTranscript);await saveSummary();continue;}
   const parsed=parser.finish();parserFinished=true;output+=parsed.body;await streamOutput();
   if(abort.signal.aborted)throw new Error('aborted');
   finishReason=upstreamReason==='stop'?'stop':upstreamReason==='length'?'length':upstreamReason==='content_filter'?'content_filter':upstreamReason?'unsupported':'interrupted';
   if(finishReason!=='stop')throw new Error('incomplete');
   if(!output.slice(prefix.length).trim()){finishReason='empty';throw new Error('empty');}
   bodyFinishedAt=Date.now();bodyModel=model;bodyGatewayLogId=gatewayLogId;bodyMetrics=metrics.snapshot();
   const latestInput=[...sourceHistory].reverse().find(m=>m.role==='user')?.content??'';
   const problems=[...new Set([...draftProblems(output),...draftProblems(output.slice(prefix.length),committedBase.filter(m=>m.role==='assistant'&&m.status==='completed'&&(!continuing||m.ordinal<store.findMessage(assistantId)!.ordinal)).map(m=>m.content),recallRequested(latestInput))])];
   if(problems.length){
    draftRejected=true;publishedOutput='';await owns();if(!store.rejectDraft(assistantId))throw Error('生成已停止');repairIssues=problems;storyProjection=undefined;
    if(revisions===1){finishReason='review_failed';throw Error('正文校验未通过');}
    continue attempts;
   }
   publishedOutput=output;finishReason='stop';
   await owns();if(!store.saveOutput(assistantId,publishedOutput))throw Error('生成已停止');
   await send({type:'candidates_pending',messageId:assistantId});
   const committedHistory=storyMessages([...store.messages().filter(m=>m.id!==assistantId),{id:assistantId,role:'assistant',content:output,status:'completed',ordinal:store.findMessage(assistantId)!.ordinal,requestId,createdAt:now}]);
   // Persist only confirmed story, never the request's state snapshots or control turns.
   const summary=await validSummary(checkpoint,committedHistory);
   const canonical=buildPrompt(conversation.card,conversation.books,committedHistory.slice(summary?.covered.length??0),opts,null,'',{...contextOptions,inputRatio:capability.inputRatio,summary:summary?.text});
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
      fallback=new ConversationContext(structuredClone(committedHistory.filter(m=>m.id!==assistantId&&(!continuing||m.ordinal<store.findMessage(assistantId)!.ordinal))),conversation.card,conversation.books,opts,limit,{...contextOptions,inputRatio:capability.inputRatio},synopsisOptions.infer);
      await fallback.restore(conversation.summary?JSON.stringify(conversation.summary):null);
     }
     fallback.contextTokens=limit;
     let rebuilt=await fallback.fit();
     let tail:PromptMessage[]=[{role:'assistant',content:output},directorTask(agent.state,texts.director)];
     while(fallback.extend(rebuilt,tail).needsCompression){const before=rebuilt.estimatedTokens;await fallback.compress();rebuilt=await fallback.fit();if(rebuilt.estimatedTokens>=before)throw Error('完整正文与候选任务超过上下文');tail=[{role:'assistant',content:output},directorTask(agent.state,texts.director)];}
     synopsisOptions.contextTokens=fallback.contextTokens;if(director)director.contextTokens=fallback.contextTokens;
     return [...rebuilt.messages,...tail];
    };
    const prefixIntact=!continuing&&stableJson(prompt.messages.slice(0,attemptPrefix.length))===stableJson(attemptPrefix);
    if(prefixIntact)director=new DirectorAgent(prompt.messages,requestOutput,agent.state,conversation.contextTokens,capability.inputRatio,texts.director);
    else{
     // The body may have compressed its own fragments. Include the full visible draft once.
     const rebuilt=await rebuild(conversation.contextTokens);
     director=new DirectorAgent(rebuilt.slice(0,-2),output,agent.state,fallback!.contextTokens,capability.inputRatio,texts.director);
    }
    directorStartedAt=Date.now();candidates=await director.run(async messages=>{
     modelRequests++;
     // Keep the body template; budget auxiliary reasoning where the backend supports it.
     const response=await runRoleplay(env,username,requestId,{messages,tools:AGENT_TOOLS,tool_choice:'none',response_format:DIRECTOR_RESPONSE_FORMAT,stream:true,...modelInput(opts),...(opts.thinkingEnabled?{thinking_budget_tokens:0}:{})},abort.signal);
     if(!(response instanceof Response))throw Error('Director非响应');director!.gatewayLogId=response.headers.get('cf-aig-log-id');
     if(!response.ok){const limit=await inspectLimit(response,env,capability);if(limit)throw new DirectorContextError(limit);throw Error('Director上游错误');}
     return response;
    },abort.signal,owns,rebuild);
    candidateOutcome=director.outcome;candidateFirstAt=director.firstAt;model=director.model||model;gatewayLogId=director.gatewayLogId;metrics=director.metrics;
   }catch(error){candidateOutcome='error';if(abort.signal.aborted)throw error;candidates=[];}
   candidateFinishedAt=Date.now();
   break attempts;
   }
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
     if(!parserFinished)output+=parser.finish().body;
     if(draftProblems(output).length){draftRejected=true;publishedOutput='';if(!store.rejectDraft(assistantId))throw Error('生成已停止');}
     // Interrupted drafts remain visibly incomplete versions; they never commit state.
     if(status!=='completed'&&!draftRejected)publishedOutput=output;
     if(!draftRejected&&store.owns(assistantId))store.saveDraft(assistantId,publishedOutput);saved=store.finish(assistantId,publishedOutput,status,finishReason,candidates,agent.state,storyProjection);}finally{await onSettled(assistantId);}
    console.info('tavern-generation-outcome',{messageId:assistantId,requestId,gatewayLogId,finishReason:saved?.finish_reason,status:saved?.status,model,modelRequests,metricsScope:director?.requests?'last-candidate-request':synopsisRequests?'last-synopsis-request':'last-body-request',...phaseMetrics,firstBodyMs:firstBodyAt===null?null:firstBodyAt-started,modelFirstBodyMs:firstBodyAt===null||firstModelStarted===null?null:firstBodyAt-firstModelStarted,promptBudget:prompt.budget,estimatedInputTokens:prompt.estimatedTokens,chars:publishedOutput.length,revisions,bodyModel,bodyGatewayLogId,bodyRequests,candidateRequests:director?.requests??0,synopsisRequests,synopsisSource,synopsisCovered,synopsisMetricsScope:'last-synopsis-request',synopsisMetrics,synopsisGatewayLogId,synopsisElapsedMs,directorFirstMs:candidateFirstAt===null||directorStartedAt===null?null:candidateFirstAt-directorStartedAt,bodyMetricsScope:'last-body-request',bodyMetrics,bodyCompleteMs:bodyFinishedAt===null?null:bodyFinishedAt-started,candidateFirstMs:candidateFirstAt===null||candidateStartedAt===null?null:candidateFirstAt-candidateStartedAt,candidateElapsedMs:candidateFinishedAt===null||candidateStartedAt===null?null:candidateFinishedAt-candidateStartedAt,directorContextRebuilds:director?.rebuilds??0,directorEstimatedInputTokens:director?.prompt().estimatedTokens??null,directorIncludedMessages:director?.prompt().includedMessages??null,directorStoryCondensed:director?.prompt().condensed??false,candidateOutcome,candidateCount:saved?.candidates_json?JSON.parse(saved.candidates_json).length:0,elapsedMs:Date.now()-started});
    // Terminal frames are bounded and must not retain the generation while a reader is paused.
    if(!disconnected&&!leaseLost){if(failure)transport.enqueue(frame({type:'error',message:failure}));transport.enqueue(frame({type:'done',message:message(saved!)}));}
   }finally{ending=true;clearInterval(stopWatcher);request.signal.removeEventListener('abort',onDisconnect);try{transport.terminate();}catch{/* The reader may already have cancelled. */}}

  }
 })();
 ctx.waitUntil(work.catch(()=>{console.error('tavern-generation-persist-failed',{messageId:assistantId});abort.abort();}));
 return new Response(stream.readable,{headers:{'Content-Type':'text/event-stream; charset=utf-8','Cache-Control':'no-cache, no-store','X-Content-Type-Options':'nosniff'}});
}

async function inspectLimit(response:Response,env:Env,capability:Capability):Promise<number|undefined> {
 if(!response.body)return;const reader=response.body.getReader(),decoder=new TextDecoder();let text='',bytes=0;const timer=setTimeout(()=>{void reader.cancel().catch(()=>{});},1000);
 try{for(;;){const {value,done}=await reader.read();if(done)break;bytes+=value.length;if(bytes>16384)break;text+=decoder.decode(value,{stream:true});}text+=decoder.decode();
  try{const value=JSON.parse(text);await errorFeedback(env,capability,value);return contextLimit(value);}catch{}
 }catch{}finally{clearTimeout(timer);await reader.cancel().catch(()=>{});}
}

export async function errorFeedback(env:Env,capability:Capability,value:unknown) {
 if(!value||typeof value!=='object')return;const v=value as {model?:unknown;error?:{model?:unknown;message?:unknown};message?:unknown};
 const actualModel=typeof v.model==='string'?v.model:typeof v.error?.model==='string'?v.error.model:undefined;
 const text=typeof v.error?.message==='string'?v.error.message:typeof v.message==='string'?v.message:'';
 const limit=contextLimit(value);if(limit)await recordFeedback(env,capability,{model:actualModel,contextLimit:limit});
}
