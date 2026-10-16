<script lang="ts">
 import { Notice } from '@hasbai/ui/notice';
 import { onMount, onDestroy, tick } from 'svelte';import { Button } from '@hasbai/ui/button';import * as Dialog from '@hasbai/ui/dialog';
 import { MessageCircle, ArrowUp, Copy, Check, Square, RefreshCw, Pencil, Download, Trash2, SlidersHorizontal, ChevronLeft, ArrowUpRight } from '@lucide/svelte';
 import { generationNotice } from '../../shared/outcomes';
 import type { Api } from '../lib/api';import type { Message, Session, Worldbook, ModelOption } from '../../shared/types';import Confirm from '../lib/Confirm.svelte';import GenerationSettings from '../lib/GenerationSettings.svelte';
 import AgentActivities from '../lib/AgentActivities.svelte';
 import { directCommand, userPrompt } from '../../shared/commands';
 import { estimateTokens } from '../../shared/prompt';
 import type { AgentActivity, ContextUsage, SessionDetail } from '../../shared/types';
 import { DEFAULT_SETTINGS } from '../../shared/types';
 let {api,initialId='',onlibrary}:{api:Api;initialId?:string;onlibrary:()=>void}=$props();
 let text=$state('');
 let activities=$state<AgentActivity[]>([]),context=$state<ContextUsage>(),commandOpen=$state(false),commandIndex=$state(-1),contextOpen=$state(false),deleteMessage=$state<Message>(),messageDeleteOpen=$state(false);
 const commands=[{id:'compress',label:'/compress',description:'压缩较早上下文'},{id:'ooc',label:'/ooc',description:'本行写系统指令，换行写对白'},{id:'status',label:'/status',description:'查看状态与上下文'}] as const;
 let availableCommands=$derived(commands.filter(c=>!text.trim().startsWith('/')||c.label.startsWith(text.trim())));
 let usedTokens=$derived((context?.estimatedTokens??0)+Math.ceil(estimateTokens(userPrompt(text))*(context?.inputRatio??1.2))+(text.trim()?8:0));
 let percent=$derived(context?.contextTokens?Math.round(usedTokens/context.contextTokens*100):null);
 let systemTemplate=$state(DEFAULT_SETTINGS.systemPrompt);
 let models=$state<ModelOption[]>([]),candidatePending=$state(''),copied=$state('');
 let input=$state<HTMLTextAreaElement>();
 $effect(()=>{text;if(input){input.style.height='0px';input.style.height=Math.min(input.scrollHeight,200)+'px';}});
 async function copyMessage(m:Message){try{await navigator.clipboard.writeText(m.content);copied=m.id;}catch{error='复制失败，请重试';}}
 let sessions=$state<Session[]>([]),active=$state<Session>(),messages=$state<Message[]>([]),loading=$state(true),error=$state(''),busy=$state(false),generating=$state(false),mobileList=$state(true),config=$state(false),configDraft=$state<Session>(),books=$state<Worldbook[]>([]),edit=$state(false),editMessage=$state<Message>(),editText=$state(''),deleteOpen=$state(false);let abort:AbortController|undefined;let log=$state<HTMLDivElement>();let alive=true;let selectionVersion=0;let generationId='';let composing=false;let poll:ReturnType<typeof setTimeout>|undefined;
 onMount(()=>{void load();});onDestroy(()=>{alive=false;selectionVersion++;abort?.abort();if(poll)clearTimeout(poll);});
 async function load(){loading=true;error='';try{sessions=(await api.request<{sessions:Session[]}>('sessions')).sessions;if(initialId)await select(initialId);}catch(e){error=(e as Error).message;}finally{loading=false;}}
 async function select(id:string){if(generating)return;const changed=active?.id!==id;const version=++selectionVersion;busy=true;candidatePending='';error='';try{const d=await api.request<SessionDetail>('sessions/'+id);if(!alive||version!==selectionVersion)return;const readingTop=log?.scrollTop??0;active={...d.session,settings:{...DEFAULT_SETTINGS,...d.session.settings}};messages=d.messages;activities=d.activities??[];context=d.context;generationId=d.session.generationId??'';if(poll)clearTimeout(poll);if(generationId&&!generating)poll=setTimeout(()=>{if(alive&&active?.id===id&&version===selectionVersion)void select(id);},1200);mobileList=false;await tick();if(alive&&version===selectionVersion&&log)log.scrollTop=changed?log.scrollHeight:readingTop;}catch(e){if(alive&&version===selectionVersion)error=(e as Error).message;}finally{if(alive&&version===selectionVersion)busy=false;}}
 function keydown(e:KeyboardEvent){
  if(e.isComposing||composing||e.keyCode===229)return;
  if(e.key==='Escape'){commandOpen=false;commandIndex=-1;return;}
  if(commandOpen&&availableCommands.length&&(e.key==='ArrowDown'||e.key==='ArrowUp')){e.preventDefault();commandIndex=(commandIndex+(e.key==='ArrowDown'?1:-1)+availableCommands.length)%availableCommands.length;return;}
  if(e.key==='Enter'&&!e.shiftKey){e.preventDefault();if(commandOpen&&commandIndex>=0){void chooseCommand(availableCommands[commandIndex].id);return;}void send();}
 }
 async function chooseCommand(command:'compress'|'status'|'ooc'){
  commandOpen=false;commandIndex=-1;
  if(command==='ooc'){text='/ooc '+(text.startsWith('/')?'':'\n'+text);await tick();input?.focus();input?.setSelectionRange(5,5);return;}
  await runCommand(command,false);
 }
 async function runCommand(command:'compress'|'status',fromText=true){
  if(!active||busy||generating||active.generationId)return;
  const sessionId=active.id,original=text;busy=true;commandOpen=false;error='';if(fromText)text='';
  try{await api.request('sessions/'+sessionId+'/command','POST',{requestId:crypto.randomUUID(),content:'/'+command});await select(sessionId);}
  catch(e){error=(e as Error).message;if(fromText)text=original;}finally{busy=false;}
 }
 async function send(regenerate=false,candidate?:{messageId:string;content:string},target?:Message){if(!active||generating||busy||active.generationId||(!regenerate&&!(candidate?.content??text).trim()))return;if(candidate&&(messages.at(-1)?.id!==candidate.messageId||!messages.at(-1)?.candidates?.includes(candidate.content)))return;const command=!regenerate&&!candidate?directCommand(text):null;if(command){await runCommand(command);return;}commandOpen=false;commandIndex=-1;error='';generating=true;abort=new AbortController();const requestId=crypto.randomUUID(),sessionId=active.id;let pending='';const content=candidate?.content??text;candidatePending='';messages=messages.map(m=>({...m,candidates:[]}));
  if(!regenerate&&!candidate)text='';
  try{await api.generate(sessionId,{requestId,content,regenerate,...(target?{messageId:target.id}:{})},e=>{if(!alive||active?.id!==sessionId)return;
   if(e.type==='start'){pending=e.messageId;generationId=e.messageId;if(active)active.generationId=e.messageId;if(!regenerate)messages=[...messages,{id:'local-user',role:'user',content,status:'completed',ordinal:messages.length,requestId,createdAt:Date.now()}];else {const selected=target??messages.at(-1);if(selected){messages=messages.filter(m=>m.ordinal<selected.ordinal||(selected.role==='user'&&m.id===selected.id));activities=activities.filter(a=>a.ordinal<selected.ordinal);}}messages=[...messages,{id:pending,role:'assistant',content:'',status:'pending',ordinal:messages.length,requestId,createdAt:Date.now()}];}
   if(e.type==='activity')activities=activities.some(a=>a.id===e.activity.id)?activities.map(a=>a.id===e.activity.id?e.activity:a):[...activities,e.activity];
   if(e.type==='context')context=e.context;
   if(e.type==='delta')messages=messages.map(m=>m.id===pending?{...m,content:m.content+e.text}:m);
   if(e.type==='candidates_pending')candidatePending=e.messageId;
   if(e.type==='error')error=e.message;
   if(e.type==='done'){messages=messages.map(m=>m.id===pending?e.message:m);if(e.message.finishReason)error='';}
  },abort.signal);}catch(e){if(alive&&!abort.signal.aborted){error=(e as Error).message;if(!pending&&!regenerate&&!candidate)text=text?content+'\n'+text:content;}}
  finally{if(alive&&active?.id===sessionId){generating=false;candidatePending='';generationId='';if(active)active.generationId=null;const failure=error;await select(sessionId);error=failure;sessions=(await api.request<{sessions:Session[]}>('sessions').catch(()=>({sessions}))).sessions;}}
 }
 async function stop(){if(!active||!generationId)return;error='';try{await api.request('sessions/'+active.id+'/stop','POST',{generationId});abort?.abort();if(!generating)await select(active.id);}catch(e){error=(e as Error).message;}}
 async function openConfig(){if(!active)return;busy=true;error='';try{const [b,m,p]=await Promise.all([api.request<{worldbooks:Worldbook[]}>('worldbooks'),api.request<{models:ModelOption[]}>('models'),api.request<{texts:{systemTemplate:string}}>('prompts')]);books=b.worldbooks;models=m.models;systemTemplate=p.texts.systemTemplate;configDraft=structuredClone($state.snapshot(active));config=true;}catch(e){error=(e as Error).message;}finally{busy=false;}}
 async function saveConfig(){if(!active||!configDraft)return;busy=true;error='';try{active=await api.request<Session>('sessions/'+active.id,'PATCH',{title:configDraft.title,settings:configDraft.settings,bookIds:configDraft.bookIds});config=false;await select(active.id);}catch(e){error=(e as Error).message;}finally{busy=false;}}
 async function saveEdit(){if(!active||!editMessage)return;busy=true;error='';try{await api.request('sessions/'+active.id+'/messages','PATCH',{messageId:editMessage.id,content:editText});edit=false;await select(active.id);}catch(e){error=(e as Error).message;}finally{busy=false;}}
 async function removeMessage(){if(!active||!deleteMessage)return;busy=true;error='';try{await api.request('sessions/'+active.id+'/messages','DELETE',{messageId:deleteMessage.id});deleteMessage=undefined;messageDeleteOpen=false;await select(active.id);}catch(e){error=(e as Error).message;}finally{busy=false;}}
 async function remove(){if(!active)return;busy=true;error='';try{await api.request('sessions/'+active.id,'DELETE');sessions=sessions.filter(s=>s.id!==active!.id);active=undefined;messages=[];deleteOpen=false;mobileList=true;}catch(e){error=(e as Error).message;}finally{busy=false;}}
 function toggleBook(id:string,checked:boolean){if(configDraft)configDraft.bookIds=checked?[...configDraft.bookIds,id]:configDraft.bookIds.filter(i=>i!==id);}
</script>
<div class="chat-workspace" class:show-list={mobileList}>
 <aside class="conversation-list"><div class="list-heading"><h1>对话 <span class="count">{sessions.length}</span></h1><Button variant="ghost" aria-label="新建对话" onclick={onlibrary}><MessageCircle size={18}/></Button></div>{#if error&&!active}<Notice variant="error">{error}<Button variant="outline" onclick={load}>重试</Button></Notice>{/if}{#if loading}<p role="status" class="muted">正在加载对话…</p>{/if}{#each sessions as s(s.id)}<button class="conversation" aria-current={active?.id===s.id?'page':undefined} disabled={generating||busy} onclick={()=>select(s.id)}><strong>{s.title}</strong><span>{s.characterName}</span></button>{/each}{#if !loading&&!sessions.length}<Button variant="outline" onclick={onlibrary}>选择角色</Button>{/if}</aside>
 <section class="chat-main" aria-label="角色对话">
  {#if active}<header class="chat-header"><div class="actions"><Button class="mobile-back" variant="ghost" aria-label="返回会话列表" disabled={generating} onclick={()=>mobileList=true}><ChevronLeft size={18}/></Button><span class="chat-character-avatar" aria-hidden="true">{active.characterName.slice(0,1)}</span><div><h2>{active.title}</h2>{#if active.title!==active.characterName}<span class="muted">{active.characterName}</span>{/if}</div></div><div class="actions"><Button variant="ghost" aria-label="会话设置" disabled={generating||busy||!!active.generationId} onclick={openConfig}><SlidersHorizontal size={18}/></Button><Button variant="ghost" aria-label="导出对话" onclick={()=>api.download('sessions/'+active!.id+'/export',active!.title+'.jsonl').catch(e=>error=e.message)}><Download size={18}/></Button><Button variant="ghost" aria-label="删除会话" disabled={generating||busy||!!active.generationId} onclick={()=>deleteOpen=true}><Trash2 size={18}/></Button></div></header>
   {#if error}<Notice variant="error">{error}</Notice>{/if}
   <!-- svelte-ignore a11y_no_noninteractive_tabindex (Keyboard users must be able to scroll the reading region.) -->
   <div class="message-log" bind:this={log} role="log" tabindex="0" aria-label="消息历史" aria-live="off">
    <div class="reading-column">
     {#each messages as m(m.id)}
      <article class="message" class:from-user={m.role==='user'} aria-label={`${m.role==='user'?'你的消息':'角色回复'}，第 ${m.ordinal+1} 条`}>
       <div class="message-body">
        {#if m.content}<p class="message-text">{m.content}</p>{/if}
        <AgentActivities activities={activities.filter(a=>a.messageId===m.id)}/>
        {#if m.status==='pending'}<span class="status" role="status">{activities.filter(a=>a.messageId===m.id&&a.status==='running').at(-1)?.title??'对话生成 · 等待模型输出'}</span>{/if}
        {#if m.status==='error'||m.status==='aborted'}
         <div class="message-outcome" role="status"><span>{m.finishReason?generationNotice(m.finishReason):m.status==='aborted'?'已停止生成':'生成失败，请重试'}</span>
         </div>
        {/if}
        {#if m.status!=='pending'}
         <div class="message-tools" class:user-tools={m.role==='user'}>
          {#if m.role==='assistant'&&m.content}<Button variant="ghost" aria-label={copied===m.id?'已复制回复':'复制回复'} onclick={()=>copyMessage(m)}>{#if copied===m.id}<Check size={16} aria-hidden="true"/>{:else}<Copy size={16} aria-hidden="true"/>{/if}</Button>{/if}
          <Button class="message-edit" variant="ghost" aria-label={`编辑第 ${m.ordinal+1} 条消息`} disabled={generating||busy||!!active.generationId} onclick={()=>{editMessage=m;editText=m.content;edit=true;}}><Pencil size={16} aria-hidden="true"/></Button>
          <Button variant="ghost" aria-label={`删除第 ${m.ordinal+1} 条消息`} disabled={generating||busy||!!active.generationId} onclick={()=>{deleteMessage=m;messageDeleteOpen=true;}}><Trash2 size={16} aria-hidden="true"/></Button>
          {#if m.role==='user'||m.role==='assistant'}
           <Button variant="ghost" aria-label={m.id===messages.at(-1)?.id?'重新生成':`重新生成第 ${m.ordinal+1} 条消息`} disabled={generating||busy||!!active.generationId} onclick={()=>send(true,undefined,m)}><RefreshCw size={16} aria-hidden="true"/></Button>
          {/if}
         </div>
        {/if}
        {#if m.role==='assistant'&&m.id===messages.at(-1)?.id}
         {#if candidatePending===m.id&&m.status==='pending'}<div class="candidate-wait" role="status"><span>Director · 正在生成下一步</span><div class="candidate-skeleton"></div></div>
         {:else if m.status==='completed'&&m.candidates?.length&&!generating&&!active.generationId}
          <section class="next-directions" aria-label="接下来"><h3>接下来</h3><div class="candidate-list">{#each m.candidates.slice(0,3) as candidate}<button type="button" class="candidate-button" disabled={busy} onclick={()=>send(false,{messageId:m.id,content:candidate})}><span>{candidate}</span><ArrowUpRight size={16} aria-hidden="true"/></button>{/each}</div></section>
         {/if}
        {/if}
       </div>
      </article>
     {/each}
     <AgentActivities activities={activities.filter(a=>a.messageId===null)}/>
    </div>
   </div>
   <form class="composer" onsubmit={e=>{e.preventDefault();void send();}}>
    <div class="composer-wrap">
    {#if commandOpen&&availableCommands.length&&!generating&&!active.generationId}<div class="command-menu" id="composer-commands" role="listbox" aria-label="可用命令">{#each availableCommands as command,i}<button id={`command-${command.id}`} role="option" aria-selected={commandIndex===i} type="button" onpointerdown={e=>e.preventDefault()} onclick={()=>chooseCommand(command.id)}><strong>{command.label}</strong><span>{command.description}</span></button>{/each}</div>{/if}
    <div class="composer-inner">
     <label class="sr-only" for="message-input">发送消息</label>
     <textarea id="message-input" bind:this={input} bind:value={text} placeholder="写下你的行动或对白…" rows="1" maxlength={24000} disabled={busy&&!generating} role="combobox" aria-expanded={commandOpen&&availableCommands.length>0} aria-controls="composer-commands" aria-autocomplete="list" aria-activedescendant={commandIndex>=0&&availableCommands[commandIndex]?`command-${availableCommands[commandIndex].id}`:undefined} onfocus={()=>{commandOpen=true;commandIndex=-1;}} onclick={()=>commandOpen=true} oninput={()=>{commandOpen=text.trim().startsWith('/')||!text.trim();commandIndex=-1;}} onblur={e=>{if(!(e.relatedTarget instanceof HTMLElement)||!e.relatedTarget.closest('.command-menu'))commandOpen=false;}} oncompositionstart={()=>composing=true} oncompositionend={()=>composing=false} onkeydown={keydown}></textarea>
     {#if generating||active.generationId}<Button class="composer-submit" type="button" aria-label="停止" onclick={stop}><Square size={18} fill="currentColor" aria-hidden="true"/></Button>
     {:else}<Button class="composer-submit" type="submit" aria-label="发送" disabled={!text.trim()||busy}><ArrowUp size={22} strokeWidth={2} aria-hidden="true"/></Button>{/if}
    </div>
    <div class="composer-footer"><span>{text.includes('/ooc')?'/ooc 本行指令 · 换行后输入对白':'Shift + Enter 换行'}</span><button type="button" class="context-trigger" aria-expanded={contextOpen} aria-label="上下文占用" onclick={()=>contextOpen=!contextOpen}><span class="context-ring" style={`--usage:${Math.min(100,percent??0)}%`}></span>{context?`${percent===null?'容量未知':percent+'%'} · 约 ${usedTokens.toLocaleString()} tokens`:'上下文容量未读取'}</button></div>
    {#if contextOpen}<div class="context-details"><strong>上下文占用（估算）</strong><p>输入约 {usedTokens.toLocaleString()} / {context?.contextTokens?.toLocaleString()??'容量未知'} tokens</p><p>已压缩 {context?.coveredMessages??0} 条 · 摘要约 {context?.summaryTokens??0} tokens</p><p>包含角色设定、世界书、有效历史、状态和当前草稿。</p></div>{/if}
    </div>
   </form>
  {:else}<div class="empty chat-empty"><MessageCircle size={36}/><h2>暂无对话</h2><Button onclick={onlibrary}>选择角色</Button></div>{/if}
 </section>
</div>
<Dialog.Root bind:open={config}><Dialog.Content><Dialog.Header><Dialog.Title>会话设置</Dialog.Title></Dialog.Header>{#if configDraft}<div class="stack detail-body"><div class="field"><label for="session-title">会话名称</label><input id="session-title" bind:value={configDraft.title} maxlength="120"/></div><GenerationSettings bind:settings={configDraft.settings} {models} disabled={busy} scope="当前会话" id="session"/><div class="field"><label for="session-name">你的名字</label><input id="session-name" bind:value={configDraft.settings.userName} maxlength="80"/></div><div class="field"><label for="session-persona">你的角色设定</label><textarea id="session-persona" bind:value={configDraft.settings.persona} rows="4" maxlength="12000"></textarea></div><div class="field"><div class="field-heading"><label for="session-system-prompt">System Prompt</label><Button type="button" variant="ghost" disabled={busy} onclick={()=>{if(configDraft)configDraft.settings.systemPrompt=systemTemplate;}}>恢复默认提示</Button></div><textarea id="session-system-prompt" bind:value={configDraft.settings.systemPrompt} rows="4"></textarea></div><h2>世界书</h2>{#each books as b}<label class="checkbox-row"><input type="checkbox" disabled={!b.enabled} checked={configDraft.bookIds.includes(b.id)} onchange={e=>toggleBook(b.id,e.currentTarget.checked)}/>{b.name}<span class="muted">{b.enabled?`${b.count} 条`:'已停用'}</span></label>{/each}{#if !books.length}<Button variant="outline" onclick={()=>config=false}>关闭</Button>{/if}</div>{/if}{#if error}<Notice variant="error">{error}</Notice>{/if}<Dialog.Footer><Button variant="outline" disabled={busy} onclick={()=>config=false}>取消</Button><Button disabled={busy} onclick={saveConfig}>保存</Button></Dialog.Footer></Dialog.Content></Dialog.Root>
<Dialog.Root bind:open={edit}><Dialog.Content><Dialog.Header><Dialog.Title>编辑消息</Dialog.Title></Dialog.Header><p class="muted">保存后会删除此消息后面的全部消息。</p><label for="edit-message">消息内容</label><textarea id="edit-message" bind:value={editText} rows="10" maxlength="24000"></textarea>{#if error}<Notice variant="error">{error}</Notice>{/if}<Dialog.Footer><Button variant="outline" disabled={busy} onclick={()=>edit=false}>取消</Button><Button disabled={busy||!editText.trim()} onclick={saveEdit}>保存并删除后续</Button></Dialog.Footer></Dialog.Content></Dialog.Root>
<Confirm bind:open={deleteOpen} title={`删除会话「${active?.title??''}」？`} {busy} onconfirm={remove}/>

<Confirm bind:open={messageDeleteOpen} title="删除此消息及后续全部消息？" {busy} onconfirm={removeMessage}/>
