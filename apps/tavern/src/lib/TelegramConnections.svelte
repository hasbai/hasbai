<script lang="ts">
 import LoadingPlaceholder from "./LoadingPlaceholder.svelte";
 import { Check } from "@lucide/svelte";
 import { trackLoading, Spinner } from "@hasbai/ui/progress";
 import { Button } from '@hasbai/ui/button';
 import { Notice } from '@hasbai/ui/notice';
 import { Input } from '@hasbai/ui/input';
 import type { Api } from './api';
 let {api,onopen}:{api:Api;onopen:(id:string)=>void}=$props();
 type Route={id:string;chat_id:number;thread_id:number;session_id:string;active:number};
 type Job={update_id:number;phase:string;error:string|null};
 let loaded=$state(false),busy=$state(false),error=$state(''),configured=$state(false),bot=$state(''),routes=$state<Route[]>([]),characters=$state<{id:string;name:string}[]>([]),characterId=$state(''),code=$state<{command:string;expiresAt:number}|null>(null),jobs=$state<Record<string,Job[]>>({});
 let chatId=$state(''),threadId=$state(''),bound=$state(false);
 async function load(){busy=true;error='';try{const [value,cards]=await Promise.all([api.request<{configured:boolean;botUsername:string;routes:Route[]}>('messaging/telegram'),api.request<{characters:{id:string;name:string}[]}>('characters')]);configured=value.configured;bot=value.botUsername;routes=value.routes;characters=cards.characters;loaded=true;for(const route of routes)await status(route.id);}catch(e){error=(e as Error).message;}finally{busy=false;}}
 async function status(id:string){jobs[id]=(await api.request<{jobs:Job[]}>(`messaging/telegram/${id}/status`)).jobs;}
 async function create(kind:'private'|'group'){busy=true;error='';try{code=await api.request('messaging/telegram/codes','POST',{kind,...(characterId?{characterId}:{})});}catch(e){error=(e as Error).message;}finally{busy=false;}}
 async function bindId(event:SubmitEvent){event.preventDefault();busy=true;error='';bound=false;try{await api.request('messaging/telegram/bind','POST',{chatId:chatId.trim(),...(threadId.trim()?{threadId:threadId.trim()}:{}),...(characterId?{characterId}:{})});await load();bound=true;}catch(e){error=(e as Error).message;}finally{busy=false;}}
 async function remove(id:string){busy=true;error='';try{await api.request(`messaging/telegram/${id}`,'DELETE');await load();}catch(e){error=(e as Error).message;}finally{busy=false;}}
 async function resolve(id:string,action:'retry'|'skip'){busy=true;error='';try{await api.request(`messaging/telegram/${id}/resolve`,'POST',{action});await status(id);}catch(e){error=(e as Error).message;}finally{busy=false;}}
 trackLoading(()=>busy);
</script>
<details class="connections" ontoggle={e=>{if(e.currentTarget.open&&!loaded&&!busy)void load();}}>
 <summary>Telegram 接入</summary>
 {#if error}<Notice variant="error">{error}</Notice>{/if}
 {#if loaded}
  <p>先将私聊绑定码发送给 @{bot}。群管理员再将群聊绑定码发送到目标群或话题。每次绑定新建独立会话。</p>
  <label for="telegram-character">对话角色</label><select id="telegram-character" bind:value={characterId} disabled={busy}><option value="">Saki（祥子）</option>{#each characters as character}<option value={character.id}>{character.name}</option>{/each}</select>
  <form class="id-binding" onsubmit={bindId}>
   <h3>通过对话 ID 绑定</h3>
   <p id="telegram-id-hint">向机器人发送 /id 查看 ID。私聊须已关联本人；绑定群聊须是群管理员，且机器人已加入。</p>
   <div class="id-fields"><div><label for="telegram-chat-id">Telegram 对话 ID</label><Input id="telegram-chat-id" bind:value={chatId} placeholder="如 -1001234567890" required pattern="-?[1-9][0-9]*" aria-describedby="telegram-id-hint" disabled={busy}/></div><div><label for="telegram-thread-id">话题 ID（可选）</label><Input id="telegram-thread-id" bind:value={threadId} inputmode="numeric" pattern="[1-9][0-9]*" placeholder="仅话题群填写" disabled={busy}/></div></div>
   <Button type="submit" disabled={busy||!configured}>{#if busy}<Spinner/>{:else if bound}<Check size={16} aria-hidden="true"/>{/if}绑定对话</Button>
   {#if bound}<span class="sr-only" role="status">已绑定 Telegram 对话。</span>{/if}
  </form>
  <div class="actions"><Button disabled={busy||!configured} onclick={()=>create('private')}>生成私聊绑定码</Button><Button variant="outline" disabled={busy||!configured} onclick={()=>create('group')}>生成群聊绑定码</Button><Button variant="ghost" disabled={busy} onclick={load}>刷新绑定</Button></div>
  {#if !configured}<Notice>Telegram 尚未配置。</Notice>{/if}
  {#if code}<div class="binding-code"><p>将以下命令发送到对应 Telegram 对话，十分钟内有效，使用一次后失效。</p><code>{code.command}</code></div>{/if}
  {#each routes as route}<div class="connection"><div class="actions"><span>会话 {route.chat_id}{route.thread_id?' · 话题 '+route.thread_id:''}</span><Button variant="ghost" onclick={()=>onopen(route.session_id)}>查看对话</Button><Button variant="outline" disabled={busy} onclick={()=>remove(route.id)}>解绑</Button></div>
   {#each jobs[route.id]??[] as job}<div class="job"><span>消息 {job.update_id} · {#if job.error}{job.error}{:else}<Spinner/><span class="sr-only">{job.phase==='sending'?'正在发送':'等待回复'}</span>{/if}</span>{#if job.phase==='attention'}<p>先核对 Telegram 是否已收到。重试可能重复发送。</p><div class="actions"><Button variant="outline" disabled={busy} onclick={()=>resolve(route.id,'retry')}>重试发送</Button><Button variant="ghost" disabled={busy} onclick={()=>resolve(route.id,'skip')}>跳过此消息</Button></div>{/if}</div>{/each}
  </div>{/each}
 {:else if busy}<LoadingPlaceholder layout="list"/>{:else}<Button variant="outline" onclick={load}>加载接入配置</Button>{/if}
</details>
<style>
 .connections{margin-top:28px;border:1px solid var(--border);border-radius:12px;padding:16px;max-width:840px}.connections summary{cursor:pointer;min-height:44px;line-height:44px;font-weight:550}.connections p{font-size:13px;line-height:1.8;color:var(--muted-foreground);margin:10px 0}.connections label{display:block;font-size:13px;margin:16px 0 8px}.connections select{width:100%;min-height:44px;padding:8px;border:1px solid var(--border);border-radius:6px;background:var(--background)}.connections .actions{margin-top:12px;flex-wrap:wrap}.binding-code{padding:12px;background:var(--muted);border-radius:8px;margin-top:16px}.binding-code code{overflow-wrap:anywhere;font-size:13px}.connection{border-top:1px solid var(--border);margin-top:16px;padding-top:12px}.job{margin-top:12px;font-size:13px}
 .id-binding{margin-top:20px;padding:16px;border:1px solid var(--border);border-radius:8px}.id-binding h3{font-size:14px;font-weight:550}.id-fields{display:grid;grid-template-columns:2fr 1fr;gap:16px;margin-bottom:16px}.id-fields>div{min-width:0}.id-fields :global(input){min-height:44px;width:100%;font-size:16px}@media(max-width:600px){.id-fields{grid-template-columns:1fr;gap:0}}
</style>
