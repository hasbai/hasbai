<script lang="ts">
 import { onMount, onDestroy, tick } from 'svelte';
 import { Button } from '@hasbai/ui/button';
 import { Notice } from '@hasbai/ui/notice';
 import { Sparkles, LogOut, Sun, Moon, ArrowUpRight, ArrowUp, Square, Plus, Copy, Check, Cpu, ArrowDown } from '@lucide/svelte';
 import { createLoadingProgress, LoadingBar } from '@hasbai/ui/progress';
 import Manager from './Manager.svelte';
 import ModelPicker from './ModelPicker.svelte';
 import Routes from './Routes.svelte';
 import { providerOf, type Model } from './catalog';
 import type { Api } from './lib';
 let {api, logout}: {api: Api; logout: () => void} = $props();
 type Message = {role:'user'|'assistant';content:string;name?:string;incomplete?:boolean};
 let admin = $state(false), loading = $state(true), error = $state(''), tab = $state('use'), dark = $state(false);
 let prompt = $state(''), output = $state(''), busy = $state(false), model = $state(''), models = $state<Model[]>([]), modelError = $state('');
 let messages = $state<Message[]>([]), log = $state<HTMLDivElement>(), input = $state<HTMLTextAreaElement>(), copied = $state(-1);
 let away=$state(false);
 let selected = $derived(models.find(m=>m.id===model));
 let abort: AbortController | undefined;
 const progress=createLoadingProgress();
 onMount(() => {dark = document.documentElement.classList.contains('dark'); void init(); void loadModels();});
 onDestroy(() => abort?.abort());
 $effect(()=>{prompt;if(input){input.style.height='auto';input.style.height=Math.min(input.scrollHeight,180)+'px';}});
 async function init() {error='';loading=true;try {admin=((await (await api('/api/me')).json()) as {admin:boolean}).admin;}catch(e){error=(e as Error).message;}finally{loading=false;}}
 async function loadModels() {
  modelError = '';
  try {
   const list = (await (await api('/v1/models')).json()) as {data: Model[]};
   models = list.data.filter(item => item.type === 'chat' && item.id!=='default');
   if (!models.some(item => item.id === model)) model = '';
  } catch (e) {modelError = (e as Error).message;}
 }
 function theme() {dark = !dark; document.documentElement.classList.toggle('dark', dark);}
 function fresh(){messages=[];model='';prompt='';error='';away=false;copied=-1;}
 async function copy(content:string,index:number){try{await navigator.clipboard.writeText(content);copied=index;}catch{error='复制失败，请重试';}}
 async function generate() {
  if (busy || !prompt.trim() || !model) return;
  busy=true;error='';output='';
  const question=prompt.trim(), history=messages.filter(m=>!m.incomplete).map(({role,content})=>({role,content}));
  messages=[...messages,{role:'user',content:question,incomplete:true},{role:'assistant',content:'',name:selected?.name,incomplete:true}];
  const answer=messages.length-1, active=new AbortController();abort=active;
  await tick();if(log)log.scrollTop=log.scrollHeight;
  try {
   const response=await api('/v1/chat/completions','POST',{model,stream:true,messages:[...history,{role:'user',content:question}]},active.signal);
   if(!response.body||!response.headers.get('content-type')?.includes('text/event-stream'))throw Error('模型未返回流式回复');
   const reader=response.body.getReader(),decoder=new TextDecoder();let pending='',finishReason='';
   async function event(raw:string){
    if(!raw||raw==='[DONE]')return;
    const item=JSON.parse(raw);if(item.error)throw Error('模型生成失败，请重试');
    const choice=item.choices?.[0];
    if(typeof choice?.delta?.content==='string'){
     const follow=log?log.scrollHeight-log.scrollTop-log.clientHeight<80:false;
     output+=choice.delta.content;messages[answer].content=output;
     if(follow){await tick();if(log)log.scrollTop=log.scrollHeight;}
    }
    if(typeof choice?.finish_reason==='string')finishReason=choice.finish_reason;
   }
   async function drain(){
    let end;while((end=pending.indexOf('\n\n'))>=0){const chunk=pending.slice(0,end);pending=pending.slice(end+2);await event(chunk.split('\n').filter(line=>line.startsWith('data:')).map(line=>line.slice(5).trimStart()).join('\n'));}
   }
   try{
    for(;;){const {done,value}=await reader.read();if(done)break;pending+=decoder.decode(value,{stream:true});pending=pending.replace(/\r\n/g,'\n');await drain();}
    pending+=decoder.decode();if(pending.trim()){pending+='\n\n';await drain();}
    if(active.signal.aborted)return;
    if(finishReason!=='stop'||!output.trim())throw Error('模型回复未完成，请重试');
    messages[answer].incomplete=false;messages[answer-1].incomplete=false;prompt='';
   }finally{await reader.cancel().catch(()=>{});}
  }catch(e){if(!active.signal.aborted)error=(e as Error).message;}finally{busy=false;await tick();input?.focus();}
 }

</script>
<svelte:head><title>AI · 北极小站</title></svelte:head>
<LoadingBar active={loading||busy||progress.active}/>
<header class="app-header"><a class="brand" href="/"><Sparkles size={23} aria-hidden="true"/>AI 工作台</a><nav aria-label="应用"><a href="https://hasbai.xyz">博客<ArrowUpRight size={14}/></a><Button variant="ghost" onclick={theme} aria-label={dark?'切换浅色模式':'切换深色模式'}>{#if dark}<Sun size={18}/>{:else}<Moon size={18}/>{/if}</Button><Button variant="ghost" onclick={logout} aria-label="退出登录"><LogOut size={18}/></Button></nav></header>
<main class="ai-workspace" class:chat-view={tab==='use'}>
 <nav class="workspace-nav" aria-label="工作台视图"><div class="tabs"><Button variant={tab==='use'?'secondary':'ghost'} aria-pressed={tab==='use'} onclick={()=>{tab='use';void loadModels();}}>对话</Button>{#if admin}<Button variant={tab==='manage'?'secondary':'ghost'} aria-pressed={tab==='manage'} onclick={()=>tab='manage'}>Provider 与密钥</Button><Button variant={tab==='routes'?'secondary':'ghost'} aria-pressed={tab==='routes'} onclick={()=>tab='routes'}>动态路由</Button>{/if}</div><span class="gateway-label">AI Gateway</span></nav>
 {#if tab==='manage' && admin}<Manager {api}/>{:else if tab==='routes' && admin}<Routes {api} onchanged={loadModels}/>{:else}
 <section class="chat-shell" aria-label="AI 对话">
  <header class="chat-toolbar"><div class="model-selection"><ModelPicker {models} bind:value={model} disabled={busy}/>{#if selected}<span class="selected-provider">{providerOf(selected)}</span>{/if}</div><Button variant="ghost" disabled={busy} onclick={fresh}><Plus size={17}/>新对话</Button></header>
  {#if modelError}<Notice variant="error">{modelError}<Button variant="outline" onclick={loadModels}>重试</Button></Notice>{/if}
  {#if error}<Notice variant="error">{error}</Notice>{/if}
  <!-- svelte-ignore a11y_no_noninteractive_tabindex -->
  <div class="message-log" bind:this={log} role="log" tabindex="0" aria-label="消息历史" aria-live="off" onscroll={()=>{if(log)away=log.scrollHeight-log.scrollTop-log.clientHeight>80;}}>
   {#if !messages.length}<div class="chat-welcome"><span class="welcome-icon"><Sparkles size={30}/></span><h1>开始一段对话</h1><p>{loading?'正在加载…':'选择模型，写下你想聊的内容。'}</p><div class="welcome-meta"><Cpu size={14}/>{models.length} 个可用模型</div></div>{:else}<div class="reading-column">
    {#each messages as message,i}<article class="chat-message" class:from-user={message.role==='user'} aria-label={message.role==='user'?'你的消息':'模型回复'}><div class="message-author">{message.role==='user'?'你':message.name}</div><div class="message-text">{message.content || (busy?'正在思考…':'未收到回复')}</div>{#if message.role==='assistant' && !busy}<div class="message-tools"><Button variant="ghost" aria-label={copied===i?'已复制回复':'复制回复'} onclick={()=>copy(message.content,i)}>{#if copied===i}<Check size={15}/>{:else}<Copy size={15}/>{/if}</Button>{#if message.incomplete}<span>回复未完成</span>{/if}</div>{/if}</article>{/each}
   </div>{/if}
  </div>
  <div class="composer-area">{#if messages.length&&away}<Button class="latest-button" variant="ghost" aria-label="回到最新消息" onclick={()=>{if(log)log.scrollTop=log.scrollHeight;}}><ArrowDown size={16}/></Button>{/if}<form class="composer" onsubmit={e=>{e.preventDefault();void generate();}}><label for="prompt" class="sr-only">你的消息</label><textarea id="prompt" bind:this={input} bind:value={prompt} rows="1" placeholder="写下你的消息…" disabled={busy} onkeydown={e=>{if(e.key==='Enter'&&!e.shiftKey&&!e.isComposing){e.preventDefault();void generate();}}}></textarea><div class="composer-bottom"><span>{selected?.name || '请先选择模型'}</span>{#if busy}<Button type="button" aria-label="停止" onclick={()=>abort?.abort()}><Square size={16}/></Button>{:else}<Button type="submit" aria-label="发送" disabled={!prompt.trim() || !model}><ArrowUp size={20}/></Button>{/if}</div></form><span class="composer-hint">{busy?'正在生成，可随时停止':'Enter 发送 · Shift + Enter 换行'}</span></div>
 </section>
 {/if}
</main>
