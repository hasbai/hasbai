<script lang="ts">
 import { Button } from '@hasbai/ui/button';
 import { ArrowRight, Layers3, MessageSquare, Database, Sparkles, Braces, ChevronDown, Moon, Sun, ArrowLeft } from '@lucide/svelte';
 import { onMount } from 'svelte';
 import { Notice } from '@hasbai/ui/notice';
 import { AGENT_TOOLS, STATE_PREFIX, SUMMARY_PREFIX } from '../../shared/instructions';
 import { CAPABILITY_RULES } from '../../shared/agent-protocol';
 import { PROMPT_LABELS, type PromptKey, type PromptTexts, type PromptConfiguration } from '../../shared/prompts';
 import type { Settings } from '../../shared/types';
 import type { Api } from '../lib/api';
 let {api,dark=false,ontheme=()=>{}}:{api:Api;dark?:boolean;ontheme?:()=>void}=$props();
 let personal=$state<Settings|null>(null),personalPrompt=$state(''),personalSaving=$state(false),personalSaved=$state(false);
 let configuration=$state<PromptConfiguration|null>(null),draft=$state<PromptTexts|null>(null),loading=$state(true),saving=$state(false),error=$state(''),saved=$state(false);
 let dirty=$derived(draft!==null&&configuration!==null&&JSON.stringify(draft)!==JSON.stringify(configuration.texts));
 onMount(()=>{void load();});
 async function load(){loading=true;error='';try{const [p,u]=await Promise.all([api.request<PromptConfiguration>('prompts'),api.request<Settings>('settings')]);configuration=p;draft={...p.texts};personal=u;personalPrompt=u.systemPrompt;}catch(e){error=(e as Error).message;}finally{loading=false;}}
 async function save(){if(!draft)return;saving=true;error='';saved=false;try{configuration=await api.request<PromptConfiguration>('prompts','PUT',{texts:draft});draft={...configuration.texts};saved=true;}catch(e){error=(e as Error).message;}finally{saving=false;}}
 async function savePersonal(){personalSaving=true;error='';personalSaved=false;try{const latest=await api.request<Settings>('settings');personal=await api.request<Settings>('settings','PUT',{...latest,systemPrompt:personalPrompt});personalPrompt=personal.systemPrompt;personalSaved=true;}catch(e){error=(e as Error).message;}finally{personalSaving=false;}}
 type Stage='body'|'tools'|'director'|'summary'|'character';
 let stage=$state<Stage>('body');
 const stages:[Stage,string][]=[['body','正文'],['tools','工具'],['director','候选'],['summary','压缩'],['character','角色卡']];
 const systemParts=['用户系统提示词 + 角色卡 system_prompt','用户 persona','世界书 before_char','角色描述','角色性格','初始场景','世界书 after_char','示例对白','角色卡 post_history_instructions','应用正文协议','记忆与目标协议','历史摘要'];
 const stagePrompts:Record<Stage,PromptKey[]>={character:['character'],body:['systemTemplate','agent'],tools:['agent'],director:['director'],summary:['summaryTask']};
 const promptRoles:Record<PromptKey,string>={systemTemplate:'system',character:'system',agent:'system',director:'user',summaryTask:'user'};
 const journey=[{icon:MessageSquare,title:'你的输入',subtitle:'浏览器 · 身份验证'},{icon:Database,title:'会话与记忆',subtitle:'每会话 SQLite DO'},{icon:Layers3,title:'上下文与模型',subtitle:'AI SDK → AI Gateway'},{icon:Sparkles,title:'正文与下一步',subtitle:'流式正文 → Director'}];
</script>

<div class="about">
 <header class="about-head"><a href="#settings" class="back-link"><ArrowLeft size={16} aria-hidden="true"/>设置</a><Button variant="ghost" onclick={ontheme} aria-label={dark?'切换浅色模式':'切换深色模式'}>{#if dark}<Sun size={18} aria-hidden="true"/>{:else}<Moon size={18} aria-hidden="true"/>{/if}主题</Button></header>
 <h1>关于酒馆</h1>

 <section class="journey-section" aria-labelledby="journey-title">
  <div class="about-section-head"><span class="section-number">01</span><h2 id="journey-title">对话流程</h2></div>
  <ol class="journey">{#each journey as item,i}<li><span class="journey-icon"><item.icon size={21} strokeWidth={1.5} aria-hidden="true"/></span><span class="journey-order">0{i+1}</span><h3>{item.title}</h3><p>{item.subtitle}</p>{#if i<3}<ArrowRight class="journey-arrow" size={18} aria-hidden="true"/>{/if}</li>{/each}</ol>
  <div class="storage-note"><span><strong>D1</strong>角色、世界书、设置与目录</span><span><strong>R2</strong>私有原始资源</span><span><strong>DO</strong>会话、线性消息、状态与摘要</span><span><strong>KV</strong>应用提示词</span></div>
  <div class="agent-guide"><p>历史消息支持编辑、删除和重新生成；操作后删除后续消息，保留来源未变的摘要。</p><p>正文直接流式显示；Director 和工具记录可展开查看。手动命令保留在执行时的位置，压缩只显示执行结果。</p><p>自动和手动压缩使用同一算法，全部历史合成摘要，本轮输入单独保留。输入框显示上下文占用估算。点击输入框可用 /compress 将全部有效历史合成摘要、/status 查看状态；/ooc 本行填写非角色指令，换行后可继续输入对白，一次发送。</p><p>Telegram 在设置中用绑定码或对话 ID 连接。/help 查看帮助，/id 查看对话与话题 ID；/compress、/status、/ooc 复用酒馆命令，群内仅绑定账号可执行。消息中台负责接收、排队和投递；角色、记忆、工具和模型复用酒馆。Saki 是普通角色卡，私聊、群和话题分别使用独立会话。</p></div>
 </section>

 <section class="context-section" aria-labelledby="context-title">
  <div class="about-section-head"><span class="section-number">02</span><h2 id="context-title">上下文与提示词</h2></div>
  <div class="stage-selector" role="group" aria-label="查看请求阶段">{#each stages as [id,label]}<Button variant={stage===id?'default':'ghost'} aria-pressed={stage===id} onclick={()=>stage=id}>{label}</Button>{/each}</div>
  <div class="context-layout"><div class="context-diagram">
   <div class="diagram-label"><Braces size={16} aria-hidden="true"/><span>消息顺序</span></div>
   <ol class="message-stack" aria-label="模型请求消息顺序">
    {#if stage==='character'}
     <li><span class="message-dot"></span><div><span class="role-badge">system</span><h3>角色卡创作规则</h3></div></li>
     <li><span class="message-dot"></span><div><span class="role-badge">user</span><h3>生成要求与草稿</h3></div></li>
    {:else if stage==='summary'}
     <li><span class="message-dot"></span><div><span class="role-badge">user / assistant</span><h3>已有记忆与源剧情</h3></div></li>
     <li><span class="message-dot"></span><div><span class="role-badge">user</span><h3>压缩任务</h3></div></li>
    {:else}
     <li><span class="message-dot"></span><div><span class="role-badge">system</span><h3>系统提示词</h3><ol class="system-parts">{#each systemParts as part}<li>{part}</li>{/each}</ol></div></li>
     <li><span class="message-dot"></span><div><span class="role-badge">user / assistant</span><h3>有效历史</h3></div></li>
     <li><span class="message-dot"></span><div><span class="role-badge">user</span><h3>当前状态与目标<span class="optional">非空时</span></h3></div></li>
     <li><span class="message-dot"></span><div><span class="role-badge">user</span><h3>用户输入</h3></div></li>
     {#if stage==='tools'||stage==='director'}
      <li><span class="message-dot"></span><div><span class="role-badge">assistant</span><h3>工具调用<span class="optional">有调用时</span></h3></div></li>
      <li><span class="message-dot"></span><div><span class="role-badge">tool</span><h3>工具结果<span class="optional">有调用时</span></h3></div></li>
     {/if}
     {#if stage==='director'}
      <li><span class="message-dot"></span><div><span class="role-badge">assistant</span><h3>正文</h3></div></li>
      <li><span class="message-dot"></span><div><span class="role-badge">user</span><h3>候选任务 + 最新状态</h3></div></li>
     {/if}
    {/if}
   </ol>
   {#if stage==='tools'}<details class="tool-schema"><summary><Braces size={16} aria-hidden="true"/>tools<ChevronDown size={14} aria-hidden="true"/></summary><pre>{JSON.stringify(AGENT_TOOLS,null,2)}</pre></details>{/if}
  </div>
  <div class="prompt-editor" aria-labelledby="prompt-title">
   <div class="editor-head"><h3 id="prompt-title">{stages.find(s=>s[0]===stage)?.[1]}提示词</h3></div>
   {#if error}<Notice variant="error">{error}{#if !configuration}<Button variant="outline" onclick={load}>重试</Button>{/if}</Notice>{/if}
   {#if loading}<p role="status">正在加载提示词…</p>{:else if draft&&configuration}
    {#if stage==='body'&&personal}
     <form class="personal-prompt" onsubmit={e=>{e.preventDefault();void savePersonal();}} oninput={()=>personalSaved=false}>
      <label for="personal-system">我的系统提示词 · 新会话</label><textarea id="personal-system" bind:value={personalPrompt} rows="6" required disabled={personalSaving}></textarea>
      <div class="editor-actions"><Button type="submit" disabled={personalSaving||personalPrompt===personal.systemPrompt}>{personalSaving?'保存中…':'保存系统提示词'}</Button><Button type="button" variant="ghost" disabled={personalSaving} onclick={()=>{personalPrompt=configuration!.texts.systemTemplate;personalSaved=false;}}>使用默认模板</Button>{#if personalSaved}<span role="status">已保存</span>{/if}</div>
     </form>
    {/if}
    <form onsubmit={e=>{e.preventDefault();void save();}} oninput={()=>saved=false}>
     <div class="editor-head"><h3>应用提示词</h3><span class="role-badge">Cloudflare KV</span></div>
     {#each stagePrompts[stage] as key}<div class="prompt-field"><div class="field-head"><label for={`prompt-${key}`}>{PROMPT_LABELS[key]}</label><span class="role-badge">{promptRoles[key]}</span></div>
      {#if configuration.admin}<textarea id={`prompt-${key}`} bind:value={draft[key]} rows={key==='agent'||key==='director'?10:5} required disabled={saving}></textarea>{:else}<pre>{draft[key]}</pre>{/if}
     </div>{/each}
     {#if configuration.admin}<div class="editor-actions"><Button type="submit" disabled={saving||!dirty}>{saving?'保存中…':'保存提示词'}</Button>{#if saved}<span role="status">已保存，缓存逐步更新</span>{/if}</div>{/if}
    </form>
    {#if stage!=='character'}<div class="prompt-field"><div class="field-head"><span>固定能力协议</span><span class="role-badge">{stage==='body'||stage==='tools'?'system':'user'}</span></div><pre>{CAPABILITY_RULES[stage==='tools'?'body':stage]}</pre></div>{/if}
    {#if stage==='body'}<details class="data-labels"><summary>数据标签<ChevronDown size={14} aria-hidden="true"/></summary><pre>{STATE_PREFIX+'[状态 JSON]\n\n'+SUMMARY_PREFIX+'[历史摘要]'}</pre></details>{/if}
   {/if}
  </div>
  </div>
 </section>


</div>

<style>
 .about{max-width:1050px;margin:0 auto;--about-ink:oklch(.4 .035 155);--about-wash:oklch(.955 .012 155)}
 :global(.dark) .about{--about-ink:oklch(.82 .04 155);--about-wash:oklch(.245 .015 155)}
 .about-head{display:flex;align-items:center;justify-content:space-between;margin-bottom:30px}.back-link{display:inline-flex;gap:8px;align-items:center;min-height:44px;color:var(--muted-foreground);font-size:13px;text-decoration:none}.back-link:hover{color:var(--foreground)}
 .about>h1{font-size:32px;font-weight:550;letter-spacing:-.03em;margin:12px 0 30px}
 .agent-guide{font-size:12px;line-height:1.9;color:var(--muted-foreground);display:grid;gap:6px}.about section{margin-top:28px}.about-section-head{display:flex;align-items:center;gap:13px;margin-bottom:22px}.section-number{font-size:11px;font-family:ui-monospace,monospace;color:var(--about-ink);padding:5px 8px;border:1px solid var(--border);border-radius:5px}.about h2{font-size:19px;font-weight:550;letter-spacing:-.02em}
 .journey{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));list-style:none;padding:0;margin:0;border:1px solid var(--border);border-radius:14px;background:var(--card)}.journey>li{position:relative;padding:24px 20px;min-width:0}.journey>li+li{border-left:1px solid var(--border)}.journey-icon{width:40px;height:40px;border-radius:10px;background:var(--about-wash);color:var(--about-ink);display:grid;place-items:center;margin-bottom:18px}.journey-order{position:absolute;right:20px;top:32px;font:11px ui-monospace,monospace;color:var(--muted-foreground)}.about h3{font-size:14px;font-weight:550}.journey p{font-size:12px;line-height:1.8;color:var(--muted-foreground);margin-top:6px}.journey :global(.journey-arrow){position:absolute;right:-10px;top:38px;background:var(--card);color:var(--muted-foreground);z-index:1}.storage-note{display:flex;flex-wrap:wrap;gap:8px 24px;font-size:12px;color:var(--muted-foreground);padding:15px 2px;line-height:1.8}.storage-note strong{font-size:11px;color:var(--foreground);margin-right:7px}
 .stage-selector{display:flex;flex-wrap:wrap;gap:6px;margin-bottom:18px;padding:6px;border:1px solid var(--border);border-radius:12px;background:var(--card);width:fit-content}.stage-selector :global(button){min-width:65px;min-height:44px;font-size:13px;border-radius:7px}
 .context-layout{display:grid;grid-template-columns:minmax(0,1fr) minmax(0,1fr);gap:28px;align-items:start}.context-diagram{padding:24px;border:1px solid var(--border);border-radius:14px;background:var(--card);min-width:0}.diagram-label{display:flex;align-items:center;gap:8px;font-size:12px;font-weight:550}.diagram-label{margin-bottom:24px}
 .message-stack{list-style:none;padding:0;margin:0}.message-stack>li{position:relative;display:grid;grid-template-columns:14px minmax(0,1fr);gap:13px;padding:0 0 24px}.message-stack>li:before{content:'';position:absolute;top:15px;bottom:0;left:5px;border-left:1px solid var(--border)}.message-stack>li:last-child{padding-bottom:8px}.message-stack>li:last-child:before{display:none}.message-dot{margin-top:6px;width:11px;height:11px;border:2px solid var(--about-ink);border-radius:50%;background:var(--card)}.role-badge{display:inline-block;font:10px ui-monospace,monospace;letter-spacing:.02em;padding:3px 6px;border-radius:4px;background:var(--muted);color:var(--muted-foreground);white-space:nowrap}.optional{font-size:10px;color:var(--muted-foreground);margin-left:8px}.message-stack h3{margin-top:8px}
 details summary{cursor:pointer;list-style:none;min-height:44px}details summary::-webkit-details-marker{display:none}summary :global(svg:last-child){transition:transform .15s}details[open]>summary :global(svg:last-child){transform:rotate(180deg)}summary:focus-visible{outline:2px solid var(--ring);outline-offset:3px;border-radius:6px}.system-parts{margin-top:12px;padding-left:20px;font-size:12px;line-height:1.9;color:var(--muted-foreground)}.system-parts li{padding:3px 0}.tool-schema{border-top:1px solid var(--border);margin-top:15px;padding-top:9px}.tool-schema summary{display:flex;align-items:center;gap:8px;font-size:12px}.tool-schema summary :global(svg:last-child){margin-left:auto}
 .personal-prompt{padding-bottom:24px;margin-bottom:24px;border-bottom:1px solid var(--border)}.personal-prompt>label{display:block;font-size:12px;font-weight:550;margin-bottom:10px}
 .prompt-editor{min-width:0;border:1px solid var(--border);border-radius:14px;background:var(--card);padding:24px}.editor-head,.field-head{display:flex;align-items:center;justify-content:space-between;gap:12px}.editor-head{margin-bottom:24px}.editor-head h3{font-size:15px}.prompt-field+.prompt-field{margin-top:22px}.field-head{margin-bottom:10px}.field-head label{font-size:12px;font-weight:550}.prompt-editor textarea{font-family:inherit;font-size:13px;line-height:1.85;resize:vertical;min-height:120px;width:100%}.editor-actions{display:flex;align-items:center;flex-wrap:wrap;gap:12px;margin-top:20px}.editor-actions>span{font-size:12px;color:var(--muted-foreground)}pre{white-space:pre-wrap;overflow-wrap:anywhere;font-family:ui-monospace,"PingFang SC",monospace;font-size:12px;line-height:1.9;padding:16px;background:var(--muted);border-radius:8px;margin:0}.tool-schema pre{margin:10px 0 0}.data-labels{border-top:1px solid var(--border);padding-top:10px;margin-top:24px}.data-labels summary{display:flex;align-items:center;justify-content:space-between;font-size:12px;color:var(--muted-foreground)}
 @media(max-width:1050px){.context-layout{gap:18px}.journey>li{padding:20px 14px}.journey-order{right:14px}}
 @media(max-width:760px){.context-layout{grid-template-columns:1fr}.journey{grid-template-columns:1fr 1fr}.journey>li:nth-child(3){border-left:0}.journey>li:nth-child(n+3){border-top:1px solid var(--border)}.journey :global(.journey-arrow){display:none}.journey-icon{margin-bottom:12px}.about>h1{font-size:28px}.context-diagram,.prompt-editor{padding:20px}.stage-selector{display:grid;grid-template-columns:repeat(3,1fr);width:100%}.about-head{margin-bottom:16px}.editor-head{margin-bottom:20px}}
 @media(prefers-reduced-motion:reduce){summary :global(svg:last-child){transition:none}}
</style>
