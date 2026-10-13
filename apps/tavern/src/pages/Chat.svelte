<script lang="ts">
 import { Notice } from '@hasbai/ui/notice';
 import { onMount, onDestroy, tick } from 'svelte';import { Button } from '@hasbai/ui/button';import * as Dialog from '@hasbai/ui/dialog';
 import { MessageCircle, ArrowUp, Copy, Check, Square, RefreshCw, Pencil, Download, Trash2, SlidersHorizontal, ChevronLeft, ArrowUpRight } from '@lucide/svelte';
 import { generationNotice } from '../../shared/outcomes';
 import type { Api } from '../lib/api';import type { Message, Session, Worldbook, ModelOption } from '../../shared/types';import Confirm from '../lib/Confirm.svelte';import GenerationSettings from '../lib/GenerationSettings.svelte';
 import { DEFAULT_SETTINGS } from '../../shared/types';
 let {api,initialId='',onlibrary}:{api:Api;initialId?:string;onlibrary:()=>void}=$props();
 let systemTemplate=$state(DEFAULT_SETTINGS.systemPrompt);
 let models=$state<ModelOption[]>([]),candidatePending=$state(''),copied=$state('');
 let input=$state<HTMLTextAreaElement>();
 $effect(()=>{text;if(input){input.style.height='0px';input.style.height=Math.min(input.scrollHeight,200)+'px';}});
 async function copyMessage(m:Message){try{await navigator.clipboard.writeText(m.content);copied=m.id;}catch{error='复制失败，请重试';}}
 let sessions=$state<Session[]>([]),active=$state<Session>(),messages=$state<Message[]>([]),loading=$state(true),error=$state(''),busy=$state(false),generating=$state(false),text=$state(''),mobileList=$state(true),config=$state(false),configDraft=$state<Session>(),books=$state<Worldbook[]>([]),edit=$state(false),editMessage=$state<Message>(),editText=$state(''),deleteOpen=$state(false);let abort:AbortController|undefined;let log=$state<HTMLDivElement>();let alive=true;let selectionVersion=0;let generationId='';let composing=false;let poll:ReturnType<typeof setTimeout>|undefined;
 onMount(()=>{void load();});onDestroy(()=>{alive=false;selectionVersion++;abort?.abort();if(poll)clearTimeout(poll);});
 async function load(){loading=true;error='';try{sessions=(await api.request<{sessions:Session[]}>('sessions')).sessions;if(initialId)await select(initialId);}catch(e){error=(e as Error).message;}finally{loading=false;}}
 async function select(id:string){if(generating)return;const changed=active?.id!==id;const version=++selectionVersion;busy=true;candidatePending='';error='';try{const d=await api.request<{session:Session;messages:Message[]}>('sessions/'+id);if(!alive||version!==selectionVersion)return;const readingTop=log?.scrollTop??0;active={...d.session,settings:{...DEFAULT_SETTINGS,...d.session.settings}};messages=d.messages;generationId=d.session.generationId??'';if(poll)clearTimeout(poll);if(generationId&&!generating)poll=setTimeout(()=>{if(alive&&active?.id===id&&version===selectionVersion)void select(id);},1200);mobileList=false;await tick();if(alive&&version===selectionVersion&&log)log.scrollTop=changed?log.scrollHeight:readingTop;}catch(e){if(alive&&version===selectionVersion)error=(e as Error).message;}finally{if(alive&&version===selectionVersion)busy=false;}}
 function keydown(e:KeyboardEvent){if(e.key==='Enter'&&!e.shiftKey&&!e.isComposing&&!composing&&e.keyCode!==229){e.preventDefault();void send();}}
 async function send(regenerate=false,candidate?:{messageId:string;content:string}){if(!active||generating||busy||active.generationId||(!regenerate&&!(candidate?.content??text).trim()))return;if(candidate&&(messages.at(-1)?.id!==candidate.messageId||!messages.at(-1)?.candidates?.includes(candidate.content)))return;error='';generating=true;abort=new AbortController();const requestId=crypto.randomUUID(),sessionId=active.id;let pending='';const content=candidate?.content??text;candidatePending='';messages=messages.map(m=>({...m,candidates:[]}));
  if(!regenerate&&!candidate)text='';
  try{await api.generate(sessionId,{requestId,content,regenerate},e=>{if(!alive||active?.id!==sessionId)return;
   if(e.type==='start'){pending=e.messageId;generationId=e.messageId;if(active)active.generationId=e.messageId;if(!regenerate)messages=[...messages,{id:'local-user',role:'user',content,status:'completed',ordinal:messages.length,requestId,createdAt:Date.now()}];else if(messages.at(-1)?.role==='assistant')messages=messages.slice(0,-1);messages=[...messages,{id:pending,role:'assistant',content:'',status:'pending',ordinal:messages.length,requestId,createdAt:Date.now()}];}
   if(e.type==='delta')messages=messages.map(m=>m.id===pending?{...m,content:m.content+e.text}:m);
   if(e.type==='candidates_pending')candidatePending=e.messageId;
   if(e.type==='error')error=e.message;
   if(e.type==='done'){messages=messages.map(m=>m.id===pending?e.message:m);if(e.message.finishReason)error='';}
  },abort.signal);}catch(e){if(alive&&!abort.signal.aborted){error=(e as Error).message;if(!pending&&!regenerate&&!candidate)text=text?content+'\n'+text:content;}}
  finally{if(alive&&active?.id===sessionId){generating=false;candidatePending='';generationId='';if(active)active.generationId=null;const failure=error;await select(sessionId);error=failure;sessions=(await api.request<{sessions:Session[]}>('sessions').catch(()=>({sessions}))).sessions;}}
 }
 async function stop(){if(!active||!generationId)return;error='';try{await api.request('sessions/'+active.id+'/stop','POST',{generationId});abort?.abort();if(!generating)await select(active.id);}catch(e){error=(e as Error).message;}}
 async function openConfig(){if(!active)return;busy=true;error='';try{const [b,m,p]=await Promise.all([api.request<{worldbooks:Worldbook[]}>('worldbooks'),api.request<{models:ModelOption[]}>('models'),api.request<{texts:{systemTemplate:string}}>('prompts')]);books=b.worldbooks;models=m.models;systemTemplate=p.texts.systemTemplate;configDraft=structuredClone($state.snapshot(active));config=true;}catch(e){error=(e as Error).message;}finally{busy=false;}}
 async function saveConfig(){if(!active||!configDraft)return;busy=true;error='';try{active=await api.request<Session>('sessions/'+active.id,'PATCH',{title:configDraft.title,settings:configDraft.settings,bookIds:configDraft.bookIds});config=false;}catch(e){error=(e as Error).message;}finally{busy=false;}}
 async function fork(){if(!active||!editMessage)return;busy=true;error='';try{const s=await api.request<Session>('sessions/'+active.id+'/fork','POST',{messageId:editMessage.id,content:editText});edit=false;sessions=[s,...sessions];await select(s.id);}catch(e){error=(e as Error).message;}finally{busy=false;}}
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
        <p class="message-text">{m.content || (m.status==='pending'?'…':'')}</p>
        {#if m.status==='pending'}<span class="status" role="status">{m.content?'正在回复':'正在构思'}</span>{/if}
        {#if m.status==='error'||m.status==='aborted'}
         <div class="message-outcome" role="status"><span>{m.finishReason?generationNotice(m.finishReason):m.status==='aborted'?'已停止生成':'生成失败，请重试'}</span>
         </div>
        {/if}
        {#if m.status!=='pending'}
         <div class="message-tools" class:user-tools={m.role==='user'}>
          {#if m.role==='assistant'&&m.content}<Button variant="ghost" aria-label={copied===m.id?'已复制回复':'复制回复'} onclick={()=>copyMessage(m)}>{#if copied===m.id}<Check size={16} aria-hidden="true"/>{:else}<Copy size={16} aria-hidden="true"/>{/if}</Button>{/if}
          {#if m.status==='completed'}<Button class="message-edit" variant="ghost" aria-label={`编辑第 ${m.ordinal+1} 条消息`} disabled={generating||busy||!!active.generationId} onclick={()=>{editMessage=m;editText=m.content;edit=true;}}><Pencil size={16} aria-hidden="true"/></Button>{/if}
          {#if m.role==='assistant'&&m.id===messages.at(-1)?.id&&messages.some(m=>m.role==='user'&&m.status==='completed')}
           <Button variant="ghost" aria-label="重新生成" disabled={generating||busy||!!active.generationId} onclick={()=>send(true)}><RefreshCw size={16} aria-hidden="true"/></Button>
          {/if}
         </div>
        {/if}
        {#if m.role==='assistant'&&m.id===messages.at(-1)?.id}
         {#if candidatePending===m.id&&m.status==='pending'}<div class="candidate-wait" role="status"><span>接下来</span><div class="candidate-skeleton"></div></div>
         {:else if m.status==='completed'&&m.candidates?.length&&!generating&&!active.generationId}
          <section class="next-directions" aria-label="接下来"><h3>接下来</h3><div class="candidate-list">{#each m.candidates.slice(0,3) as candidate}<button type="button" class="candidate-button" disabled={busy} onclick={()=>send(false,{messageId:m.id,content:candidate})}><span>{candidate}</span><ArrowUpRight size={16} aria-hidden="true"/></button>{/each}</div></section>
         {/if}
        {/if}
       </div>
      </article>
     {/each}
    </div>
   </div>
   <form class="composer" onsubmit={e=>{e.preventDefault();void send();}}>
    <div class="composer-inner">
     <label class="sr-only" for="message-input">发送消息</label>
     <textarea id="message-input" bind:this={input} bind:value={text} placeholder="写下你的行动或对白…" rows="1" maxlength={24000} disabled={busy&&!generating} oncompositionstart={()=>composing=true} oncompositionend={()=>composing=false} onkeydown={keydown}></textarea>
     {#if generating||active.generationId}<Button class="composer-submit" type="button" aria-label="停止" onclick={stop}><Square size={18} fill="currentColor" aria-hidden="true"/></Button>
     {:else}<Button class="composer-submit" type="submit" aria-label="发送" disabled={!text.trim()||busy}><ArrowUp size={22} strokeWidth={2} aria-hidden="true"/></Button>{/if}
    </div>
   </form>
  {:else}<div class="empty chat-empty"><MessageCircle size={36}/><h2>暂无对话</h2><Button onclick={onlibrary}>选择角色</Button></div>{/if}
 </section>
</div>
<Dialog.Root bind:open={config}><Dialog.Content><Dialog.Header><Dialog.Title>会话设置</Dialog.Title></Dialog.Header>{#if configDraft}<div class="stack detail-body"><div class="field"><label for="session-title">会话名称</label><input id="session-title" bind:value={configDraft.title} maxlength="120"/></div><GenerationSettings bind:settings={configDraft.settings} {models} disabled={busy} scope="当前会话" id="session"/><div class="field"><label for="session-name">你的名字</label><input id="session-name" bind:value={configDraft.settings.userName} maxlength="80"/></div><div class="field"><label for="session-persona">你的角色设定</label><textarea id="session-persona" bind:value={configDraft.settings.persona} rows="4" maxlength="12000"></textarea></div><div class="field"><div class="field-heading"><label for="session-system-prompt">System Prompt</label><Button type="button" variant="ghost" disabled={busy} onclick={()=>{if(configDraft)configDraft.settings.systemPrompt=systemTemplate;}}>恢复默认提示</Button></div><textarea id="session-system-prompt" bind:value={configDraft.settings.systemPrompt} rows="4"></textarea></div><h2>世界书</h2>{#each books as b}<label class="checkbox-row"><input type="checkbox" disabled={!b.enabled} checked={configDraft.bookIds.includes(b.id)} onchange={e=>toggleBook(b.id,e.currentTarget.checked)}/>{b.name}<span class="muted">{b.enabled?`${b.count} 条`:'已停用'}</span></label>{/each}{#if !books.length}<Button variant="outline" onclick={()=>config=false}>关闭</Button>{/if}</div>{/if}{#if error}<Notice variant="error">{error}</Notice>{/if}<Dialog.Footer><Button variant="outline" disabled={busy} onclick={()=>config=false}>取消</Button><Button disabled={busy} onclick={saveConfig}>保存</Button></Dialog.Footer></Dialog.Content></Dialog.Root>
<Dialog.Root bind:open={edit}><Dialog.Content><Dialog.Header><Dialog.Title>编辑并创建分支</Dialog.Title></Dialog.Header><label for="edit-message">消息内容</label><textarea id="edit-message" bind:value={editText} rows="10" maxlength="24000"></textarea>{#if error}<Notice variant="error">{error}</Notice>{/if}<Dialog.Footer><Button variant="outline" disabled={busy} onclick={()=>edit=false}>取消</Button><Button disabled={busy||!editText.trim()} onclick={fork}>创建分支</Button></Dialog.Footer></Dialog.Content></Dialog.Root>
<Confirm bind:open={deleteOpen} title={`删除会话「${active?.title??''}」？`} {busy} onconfirm={remove}/>
