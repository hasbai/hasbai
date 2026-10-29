<script lang="ts">
 import LoadingPlaceholder from "../lib/LoadingPlaceholder.svelte";
 import { trackLoading } from "@hasbai/ui/progress";
 import { Notice } from '@hasbai/ui/notice';
 import { onMount } from 'svelte';
 import { Button } from '@hasbai/ui/button'; import { Input } from '@hasbai/ui/input'; import * as Dialog from '@hasbai/ui/dialog';
 import { Plus, Upload, MessageCircle, Download, Trash2 } from '@lucide/svelte';
 import type { Api, CharacterImageDrafts } from '../lib/api'; import type { Character, JsonObject } from '../../shared/types'; import { parseCard } from '../../shared/cards';
 import Avatar from '../lib/Avatar.svelte'; import Confirm from '../lib/Confirm.svelte';
 import GreetingPicker from '../lib/GreetingPicker.svelte';
 import CharacterCreator from '../lib/CharacterCreator.svelte';
 let {api,onchat}:{api:Api;onchat:(id:string,greeting:number)=>Promise<boolean>}=$props();
 let cards=$state<Character[]>([]),query=$state(''),loading=$state(true),error=$state(''),busy=$state(false),editor=$state(false),detail=$state<Character>(),deleting=$state<Character>(),deleteOpen=$state(false); let input:HTMLInputElement; let characterDialog=$state<HTMLElement|null>(null);
 let starting=$state<Character>();
 let filtered=$derived(cards.filter(c=>`${c.name} ${c.creator} ${c.tags.join(' ')}`.toLowerCase().includes(query.toLowerCase())));
 onMount(()=>{void load();});
 async function load(){loading=true;error='';try{cards=(await api.request<{characters:Character[]}>('characters')).characters;}catch(e){error=(e as Error).message;}finally{loading=false;}}
 async function upload(event:Event){const file=(event.target as HTMLInputElement).files?.[0];if(!file)return;busy=true;error='';try{await api.upload('characters',file);await load();}catch(e){error=(e as Error).message;}finally{busy=false;input.value='';}}
 async function show(c:Character){busy=true;error='';try{detail=await api.request<Character>('characters/'+c.id);}catch(e){error=(e as Error).message;}finally{busy=false;}}
 function create(){detail=undefined;editor=true;}
 async function saveCreated(raw:JsonObject,images?:CharacterImageDrafts,startChat?:boolean){busy=true;try{parseCard(raw);const saved=await api.saveCharacter<Character>(raw,detail?.id,images);if(startChat)starting=saved;editor=false;detail=undefined;await load();}finally{busy=false;}}
 async function chooseGreeting(c:Character){busy=true;error='';try{starting=await api.request<Character>('characters/'+c.id);}catch(e){error=(e as Error).message;}finally{busy=false;}}
 async function startConversation(greeting:number){if(!starting||busy)return false;busy=true;try{const ok=await onchat(starting.id,greeting);if(ok)starting=undefined;return ok;}finally{busy=false;}}
 async function remove(){if(!deleting)return;busy=true;try{await api.request('characters/'+deleting.id,'DELETE');deleting=undefined;deleteOpen=false;detail=undefined;await load();}catch(e){error=(e as Error).message;}finally{busy=false;}}
 trackLoading(()=>loading||busy);
</script>
<header class="page-head"><div><h1>角色库 <span class="count">{cards.length}</span></h1></div><div class="actions"><Button variant="outline" disabled={busy} onclick={()=>input.click()}><Upload size={16}/>导入</Button><Button onclick={create}><Plus size={16}/>创建角色</Button></div></header>
<input class="sr-only" tabindex="-1" bind:this={input} type="file" accept=".json,.png,.charx" aria-label="导入角色卡" onchange={upload}/>
<label class="search-label" for="library-search">搜索角色</label><Input id="library-search" bind:value={query} placeholder="角色、作者或标签"/>
{#if error}<Notice variant="error">{error}<Button variant="outline" onclick={load}>重试</Button></Notice>{/if}
{#if loading}<LoadingPlaceholder layout="cards"/>{:else if !error&&!filtered.length}<div class="empty"><MessageCircle size={32}/><h2>{query?'没有匹配的角色':'角色库为空'}</h2><Button variant="outline" onclick={()=>input.click()}>导入角色卡</Button></div>{:else if !error}<div class="card-grid">{#each filtered as c(c)}<article class="character-card"><button class="card-main" disabled={busy} onclick={()=>show(c)}><Avatar {api} id={c.id} name={c.name} available={c.hasAvatar}/><div class="card-title"><h2>{c.name}</h2><span class="muted">{c.creator||'未署名'}</span></div><p class="description">{c.description}</p><div class="tags"><span>{c.format}</span>{#each c.tags.slice(0,3) as tag}<span>{tag}</span>{/each}</div></button><Button variant="outline" disabled={busy} onclick={()=>chooseGreeting(c)}><MessageCircle size={16}/>开始对话</Button></article>{/each}</div>{/if}
<Dialog.Root open={!!detail||editor} onOpenChange={(open)=>{if(busy)return;if(!open){detail=undefined;editor=false;}}}><Dialog.Content class="creator-dialog" bind:ref={characterDialog} showCloseButton={!busy} onOpenAutoFocus={(event)=>{event.preventDefault();characterDialog?.focus({preventScroll:true});}}>
 {#key detail?.id}
 <CharacterCreator {api} character={detail} onsave={saveCreated} oncancel={()=>{editor=false;detail=undefined;}}>
  {#snippet actions()}
   {#if detail}
    <div class="actions"><Button type="button" variant="outline" aria-label="导出角色 JSON" onclick={()=>api.download('characters/'+detail!.id+'/export',detail!.name+'.json').catch(e=>error=e.message)}><Download size={16}/></Button><Button type="button" variant="outline" aria-label="导出原文件" onclick={()=>api.download('characters/'+detail!.id+'/export?original=true',detail!.originalFilename||detail!.name+'.json').catch(e=>error=e.message)}><Download size={16}/><span>原卡</span></Button><Button type="button" variant="outline" aria-label="删除角色" onclick={()=>{deleting=detail;deleteOpen=true;}}><Trash2 size={16}/></Button></div>
   {/if}
  {/snippet}
 </CharacterCreator>
 {/key}
</Dialog.Content></Dialog.Root>
<Confirm bind:open={deleteOpen} title={`删除角色「${deleting?.name??''}」？`} {busy} onconfirm={remove}/>

<Dialog.Root open={!!starting} onOpenChange={open=>{if(!open&&!busy)starting=undefined;}}><Dialog.Content class="greeting-dialog">{#if starting}<GreetingPicker character={starting} oncancel={()=>starting=undefined} onstart={startConversation}/>{/if}</Dialog.Content></Dialog.Root>
