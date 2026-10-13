<script lang="ts">
 import { Button } from '@hasbai/ui/button';
 import { ArrowRight, Layers3, MessageSquare, Database, Sparkles, Braces, ChevronDown, Moon, Sun, ArrowLeft } from '@lucide/svelte';
 import { onMount } from 'svelte';
 import { Notice } from '@hasbai/ui/notice';
 import { AGENT_TOOLS, STATE_PREFIX, SUMMARY_PREFIX, STORY_SUMMARY_PREFIX } from '../../shared/instructions';
 import { PROMPT_LABELS, type PromptKey, type PromptTexts, type PromptConfiguration } from '../../shared/prompts';
 import type { Api } from '../lib/api';
 let {api,dark=false,ontheme=()=>{}}:{api:Api;dark?:boolean;ontheme?:()=>void}=$props();
 let configuration=$state<PromptConfiguration|null>(null),draft=$state<PromptTexts|null>(null),loading=$state(true),saving=$state(false),error=$state(''),saved=$state(false);
 let dirty=$derived(draft!==null&&configuration!==null&&JSON.stringify(draft)!==JSON.stringify(configuration.texts));
 onMount(()=>{void load();});
 async function load(){loading=true;error='';try{configuration=await api.request<PromptConfiguration>('prompts');draft={...configuration.texts};}catch(e){error=(e as Error).message;}finally{loading=false;}}
 async function save(){if(!draft)return;saving=true;error='';saved=false;try{configuration=await api.request<PromptConfiguration>('prompts','PUT',{texts:draft});draft={...configuration.texts};saved=true;}catch(e){error=(e as Error).message;}finally{saving=false;}}
 type Stage='body'|'tools'|'length'|'repair'|'director'|'summary'|'character';
 let stage=$state<Stage>('body');
 const stages:[Stage,string][]=[['body','正文'],['tools','工具'],['length','续写'],['repair','修订'],['director','候选'],['summary','压缩'],['character','角色卡']];
 const descriptions:Record<Stage,string>={character:'独立请求根据生成要求与草稿创建角色卡，返回完整 CCv2 JSON；保存后才入库。',body:'新回合从有效剧情重建，只附带当前已确认状态与本轮输入。',tools:'正文请求可调用工具。执行结果以原生 tool 消息返回，接着生成正文；可发生多轮。',length:'上游因长度中断时，自动追加本次部分正文与短续写指令。用户手动继续使用已保存的部分正文。',repair:'think 协议泄露或达到阈值的逐字复写触发一次修订。从原输入与 before 状态重建，丢弃拒稿和暂存工具结果。',director:'正文正常结束后发起独立请求。保留本轮实际前缀，追加最后一次请求的新正文与候选任务。',summary:'只在输入超出已知窗口或上游明确报超限时压缩。独立请求总结更早剧情，原文保留。'};
 const base=[{role:'system',title:'设定与协议',note:'一条 system，内部顺序见下方。'},{role:'user / assistant',title:'有效近期剧情',note:'开场白及成功消息版本，按时间顺序；已被摘要覆盖的旧消息不重复放入。'},{role:'user',title:'当前已确认状态',note:'只含 scene、facts、relationships、inventory 数据。非空时加入。'},{role:'user',title:'本轮用户输入',note:'用户发送的内容，角色与用户名称宏会展开。'}];
 const additions:Record<Stage,{role:string;title:string;note:string}[]>={character:[],body:[],tools:[{role:'assistant',title:'工具调用与已写正文',note:'真实 tool_calls，可同时含正文。'},{role:'tool',title:'工具结果',note:'按调用顺序返回检索来源或状态更新结果，不再追加写作提醒。'}],length:[{role:'assistant',title:'本次部分正文',note:'保留已写内容；窗口不足时，只压缩确认剧情。'},{role:'user',title:'短续写指令',note:'上游 length 后追加自动续写文本。'}],repair:[{role:'user',title:'本次修订指令',note:'短重写要求 + 实际检测到的问题列表，仅在本回合有效。'}],director:[{role:'assistant',title:'最后一次请求的新正文',note:'前缀已有的正文不重复追加。续写或压缩改变前缀时，从有效剧情重建并保留完整正文一次。'},{role:'user',title:'Director 候选任务',note:'当前候选规则 + 最新非空 state。输出三个用户视角候选，工具选择为 none。'}],summary:[]};
 const systemParts=['用户 System Prompt 与角色卡 system_prompt 合并','用户 persona（填写时）','世界书 before_char 条目（激活时）','角色描述 → 性格 → 初始场景','世界书 after_char 条目（激活时）','角色卡示例对白与 post_history_instructions（填写时）','应用正文协议','已校验历史摘要与本轮正文压缩记忆（有时）'];
 const stagePrompts:Record<Stage,PromptKey[]>={character:['character'],body:['agent','cardPostOriginal'],tools:['agent'],length:['continueBody','continueReply'],repair:['repair','repairIncompleteThink','repairRepeatedParagraph','repairRepeatedHistory','repairExposedThink'],director:['director'],summary:['summary','summaryTask']};
 const promptRoles:Record<PromptKey,string>={character:'system',agent:'system',cardPostOriginal:'system · original',director:'user',summary:'system',summaryTask:'user',continueReply:'user',continueBody:'user',repair:'user',repairIncompleteThink:'JSON 问题列表',repairRepeatedParagraph:'JSON 问题列表',repairRepeatedHistory:'JSON 问题列表',repairExposedThink:'JSON 问题列表'};
 const journey=[{icon:MessageSquare,title:'你的输入',subtitle:'浏览器 · 身份验证'},{icon:Database,title:'会话与记忆',subtitle:'每会话 SQLite DO'},{icon:Layers3,title:'上下文与模型',subtitle:'Worker → AI Gateway'},{icon:Sparkles,title:'正文与下一步',subtitle:'流式正文 → Director'}];
</script>

<div class="about">
 <header class="about-head"><a href="#settings" class="back-link"><ArrowLeft size={16} aria-hidden="true"/>设置</a><Button variant="ghost" onclick={ontheme} aria-label={dark?'切换浅色模式':'切换深色模式'}>{#if dark}<Sun size={18} aria-hidden="true"/>{:else}<Moon size={18} aria-hidden="true"/>{/if}主题</Button></header>
 <h1>关于酒馆</h1>

 <section class="journey-section" aria-labelledby="journey-title">
  <div class="about-section-head"><span class="section-number">01</span><h2 id="journey-title">对话流程</h2></div>
  <ol class="journey">{#each journey as item,i}<li><span class="journey-icon"><item.icon size={21} strokeWidth={1.5} aria-hidden="true"/></span><span class="journey-order">0{i+1}</span><h3>{item.title}</h3><p>{item.subtitle}</p>{#if i<3}<ArrowRight class="journey-arrow" size={18} aria-hidden="true"/>{/if}</li>{/each}</ol>
  <div class="storage-note"><span><strong>D1</strong>角色、世界书、设置与目录</span><span><strong>R2</strong>私有原始资源</span><span><strong>DO</strong>会话、消息版本、状态与摘要</span><span><strong>KV</strong>应用提示词</span></div>
 </section>

 <section class="context-section" aria-labelledby="context-title">
  <div class="about-section-head"><span class="section-number">02</span><h2 id="context-title">上下文与提示词</h2></div>
  <div class="stage-selector" role="group" aria-label="查看请求阶段">{#each stages as [id,label]}<Button variant={stage===id?'default':'ghost'} aria-pressed={stage===id} onclick={()=>stage=id}>{label}</Button>{/each}</div>
  <div class="context-layout"><div class="context-diagram">
   <div class="diagram-label"><Braces size={16} aria-hidden="true"/><span>{stage==='length'?'请求消息 · 自动续写路径':stage==='director'?'请求消息 · Director 复用路径':'请求消息 · 按发送顺序'}</span><span class="stage-caption">{stages.find(s=>s[0]===stage)?.[1]}</span></div>
   <p class="stage-description">{descriptions[stage]}</p>
   {#if stage==='director'}<p class="stage-description">图示为复用路径。手动继续或超限重建时，改为设定与摘要 → 有效剧情 → 完整当前正文（一次） → 候选任务与最新非空 state；不保留旧 state 和本轮控制。</p>{/if}
   {#if stage==='length'}<p class="stage-description">手动继续的顺序：有效剧情（含保存的中断正文） → 本版本 before 状态（非空时） → 手动继续指令；原用户输入保留在历史中。重新生成也复用最近用户输入，但从本版本之前的剧情与 before 状态重新写。</p>{/if}
   <ol class="message-stack" aria-label="模型请求消息顺序">
    {#if stage==='character'}
     <li><span class="message-dot"></span><div><span class="role-badge">system</span><h3>角色卡创作规则</h3></div></li>
     <li><span class="message-dot"></span><div><span class="role-badge">user</span><h3>生成要求与草稿</h3><p>JSON：brief + draft。响应由 CCv2 JSON Schema 约束。</p></div></li>
    {:else if stage==='summary'}
     <li><span class="message-dot"></span><div><span class="role-badge">system</span><h3>摘要规则</h3><p>独立压缩请求使用当前摘要规则，不携带正文角色卡与工具。</p></div></li>
     <li><span class="message-dot"></span><div><span class="role-badge">user</span><h3>已有记忆与源剧情</h3><p>只读取有效剧情，区分用户与角色。容量不足时拆小来源，并检查摘要确实缩短。</p></div></li>
    {:else}
     {#each base as item,i}<li class:state-row={i===2}><span class="message-dot"></span><div><span class="role-badge">{item.role}</span>{#if i===2}<span class="optional">非空时</span>{/if}<h3>{stage!=='body'&&i===3?'最近用户输入':stage==='director'&&i===2?'正文请求时的状态':item.title}</h3><p>{item.note}</p>
      {#if i===0}<details class="system-detail"><summary>展开 system 组成<ChevronDown size={14} aria-hidden="true"/></summary><ol>{#each systemParts as part}<li>{part}</li>{/each}</ol><p>世界书按启用状态、常驻或关键词激活。角色卡中的 <code>{'{{original}}'}</code> 会合并原提示；后置指令的原提示见“角色卡 original 后置文本”。</p></details>{/if}
     </div></li>{/each}
     {#if stage==='director'}<li><span class="message-dot"></span><div><span class="role-badge">本轮实际前缀</span><h3>按需发生的工具与续写消息</h3><p>如果正文使用过工具、自动续写或修订，复用路径保留这些消息；重建路径只取确认剧情。它们不会带到下一轮。</p></div></li>{/if}
     {#each additions[stage] as item}<li class="transient-row"><span class="message-dot"></span><div><span class="role-badge">{item.role}</span><span class="optional">本轮</span><h3>{item.title}</h3><p>{item.note}</p></div></li>{/each}
    {/if}
   </ol>
   {#if stage!=='summary'&&stage!=='character'}<details class="tool-schema"><summary><Braces size={16} aria-hidden="true"/>独立 tools 字段<ChevronDown size={14} aria-hidden="true"/></summary><p>正文允许自动调用以下两个工具；Director 保留同一 schema，tool_choice 为 none。</p><pre>{JSON.stringify(AGENT_TOOLS,null,2)}</pre></details>{/if}
  </div>
  <div class="prompt-editor" aria-labelledby="prompt-title">
   <div class="editor-head"><h3 id="prompt-title">{stages.find(s=>s[0]===stage)?.[1]}提示词</h3><span class="role-badge">Cloudflare KV</span></div>
   {#if error}<Notice variant="error">{error}{#if !configuration}<Button variant="outline" onclick={load}>重试</Button>{/if}</Notice>{/if}
   {#if loading}<p role="status">正在加载提示词…</p>{:else if draft&&configuration}
    <form onsubmit={e=>{e.preventDefault();void save();}} oninput={()=>saved=false}>
     {#each stagePrompts[stage] as key}<div class="prompt-field"><div class="field-head"><label for={`prompt-${key}`}>{PROMPT_LABELS[key]}</label><span class="role-badge">{promptRoles[key]}</span></div>
      {#if configuration.admin}<textarea id={`prompt-${key}`} bind:value={draft[key]} rows={key==='agent'||key==='director'?10:5} required disabled={saving}></textarea>{:else}<pre>{draft[key]}</pre>{/if}
      {#if key==='cardPostOriginal'}<p class="field-hint">角色卡后置指令含 <code>{'{{original}}'}</code> 时生效。</p>{/if}
     </div>{/each}
     {#if configuration.admin}<div class="editor-actions"><Button type="submit" disabled={saving||!dirty}>{saving?'保存中…':'保存提示词'}</Button>{#if saved}<span role="status">已保存，缓存逐步更新</span>{/if}</div>{/if}
    </form>
    {#if stage==='body'}<details class="data-labels"><summary>数据标签<ChevronDown size={14} aria-hidden="true"/></summary><pre>{STATE_PREFIX+'[状态 JSON]\n\n'+SUMMARY_PREFIX+'[历史摘要]\n\n'+STORY_SUMMARY_PREFIX+'[正文摘要]'}</pre></details>{/if}
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
 .about section{margin-top:28px}.about-section-head{display:flex;align-items:center;gap:13px;margin-bottom:22px}.section-number{font-size:11px;font-family:ui-monospace,monospace;color:var(--about-ink);padding:5px 8px;border:1px solid var(--border);border-radius:5px}.about h2{font-size:19px;font-weight:550;letter-spacing:-.02em}
 .journey{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));list-style:none;padding:0;margin:0;border:1px solid var(--border);border-radius:14px;background:var(--card)}.journey>li{position:relative;padding:24px 20px;min-width:0}.journey>li+li{border-left:1px solid var(--border)}.journey-icon{width:40px;height:40px;border-radius:10px;background:var(--about-wash);color:var(--about-ink);display:grid;place-items:center;margin-bottom:18px}.journey-order{position:absolute;right:20px;top:32px;font:11px ui-monospace,monospace;color:var(--muted-foreground)}.about h3{font-size:14px;font-weight:550}.journey p{font-size:12px;line-height:1.8;color:var(--muted-foreground);margin-top:6px}.journey :global(.journey-arrow){position:absolute;right:-10px;top:38px;background:var(--card);color:var(--muted-foreground);z-index:1}.storage-note{display:flex;flex-wrap:wrap;gap:8px 24px;font-size:12px;color:var(--muted-foreground);padding:15px 2px;line-height:1.8}.storage-note strong{font-size:11px;color:var(--foreground);margin-right:7px}
 .stage-selector{display:flex;flex-wrap:wrap;gap:6px;margin-bottom:18px;padding:6px;border:1px solid var(--border);border-radius:12px;background:var(--card);width:fit-content}.stage-selector :global(button){min-width:65px;min-height:44px;font-size:13px;border-radius:7px}
 .context-layout{display:grid;grid-template-columns:minmax(0,1fr) minmax(0,1fr);gap:28px;align-items:start}.context-diagram{padding:24px;border:1px solid var(--border);border-radius:14px;background:var(--card);min-width:0}.diagram-label{display:flex;align-items:center;gap:8px;font-size:12px;font-weight:550}.stage-caption{margin-left:auto;font-weight:400;color:var(--muted-foreground)}.stage-description{font-size:13px;line-height:1.8;color:var(--muted-foreground);margin:14px 0 23px}
 .message-stack{list-style:none;padding:0;margin:0}.message-stack>li{position:relative;display:grid;grid-template-columns:14px minmax(0,1fr);gap:13px;padding:0 0 24px}.message-stack>li:before{content:'';position:absolute;top:15px;bottom:0;left:5px;border-left:1px solid var(--border)}.message-stack>li:last-child{padding-bottom:8px}.message-stack>li:last-child:before{display:none}.message-dot{margin-top:6px;width:11px;height:11px;border:2px solid var(--about-ink);border-radius:50%;background:var(--card)}.transient-row .message-dot{border-style:dashed}.role-badge{display:inline-block;font:10px ui-monospace,monospace;letter-spacing:.02em;padding:3px 6px;border-radius:4px;background:var(--muted);color:var(--muted-foreground);white-space:nowrap}.optional{font-size:10px;color:var(--muted-foreground);margin-left:8px}.message-stack h3{margin-top:8px}.message-stack p{font-size:13px;line-height:1.8;color:var(--muted-foreground);margin:5px 0 0;overflow-wrap:anywhere}
 details summary{cursor:pointer;list-style:none;min-height:44px}details summary::-webkit-details-marker{display:none}summary :global(svg:last-child){transition:transform .15s}details[open]>summary :global(svg:last-child){transform:rotate(180deg)}summary:focus-visible{outline:2px solid var(--ring);outline-offset:3px;border-radius:6px}.system-detail{margin-top:10px;border:1px solid var(--border);border-radius:8px}.system-detail summary{display:flex;align-items:center;justify-content:space-between;padding:10px 12px;color:var(--about-ink);font-size:12px}.system-detail ol{padding:0 16px 0 32px;font-size:12px;line-height:1.85;color:var(--muted-foreground)}.system-detail ol li{padding:4px 0}.system-detail>p{padding:0 12px 12px;font-size:11px}.tool-schema{border-top:1px solid var(--border);margin-top:15px;padding-top:9px}.tool-schema summary{display:flex;align-items:center;gap:8px;font-size:12px}.tool-schema summary :global(svg:last-child){margin-left:auto}.tool-schema>p{font-size:12px;line-height:1.8;color:var(--muted-foreground);margin:8px 0}
 .field-hint{font-size:12px;color:var(--muted-foreground);line-height:1.8;margin-top:8px}
 .prompt-editor{min-width:0;border:1px solid var(--border);border-radius:14px;background:var(--card);padding:24px}.editor-head,.field-head{display:flex;align-items:center;justify-content:space-between;gap:12px}.editor-head{margin-bottom:24px}.editor-head h3{font-size:15px}.prompt-field+.prompt-field{margin-top:22px}.field-head{margin-bottom:10px}.field-head label{font-size:12px;font-weight:550}.prompt-editor textarea{font-family:inherit;font-size:13px;line-height:1.85;resize:vertical;min-height:120px;width:100%}.editor-actions{display:flex;align-items:center;flex-wrap:wrap;gap:12px;margin-top:20px}.editor-actions>span{font-size:12px;color:var(--muted-foreground)}pre{white-space:pre-wrap;overflow-wrap:anywhere;font-family:ui-monospace,"PingFang SC",monospace;font-size:12px;line-height:1.9;padding:16px;background:var(--muted);border-radius:8px;margin:0}.tool-schema pre{margin:10px 0 0}.data-labels{border-top:1px solid var(--border);padding-top:10px;margin-top:24px}.data-labels summary{display:flex;align-items:center;justify-content:space-between;font-size:12px;color:var(--muted-foreground)}
 @media(max-width:1050px){.context-layout{gap:18px}.journey>li{padding:20px 14px}.journey-order{right:14px}}
 @media(max-width:760px){.context-layout{grid-template-columns:1fr}.journey{grid-template-columns:1fr 1fr}.journey>li:nth-child(3){border-left:0}.journey>li:nth-child(n+3){border-top:1px solid var(--border)}.journey :global(.journey-arrow){display:none}.journey-icon{margin-bottom:12px}.about>h1{font-size:28px}.context-diagram,.prompt-editor{padding:20px}.stage-selector{display:grid;grid-template-columns:repeat(4,1fr);width:100%}.about-head{margin-bottom:16px}.editor-head{margin-bottom:20px}}
 @media(prefers-reduced-motion:reduce){summary :global(svg:last-child){transition:none}}
</style>
