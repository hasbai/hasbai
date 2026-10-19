<script lang="ts">
 import { Notice } from '@hasbai/ui/notice';
 import TelegramConnections from '../lib/TelegramConnections.svelte';
 import { onMount } from 'svelte';import { Button } from '@hasbai/ui/button';import { Input } from '@hasbai/ui/input';import { Moon,Sun,UserRound,Info } from '@lucide/svelte';import { DEFAULT_SETTINGS, type Settings, type ModelOption } from '../../shared/types';import type { Api } from '../lib/api';import GenerationSettings from '../lib/GenerationSettings.svelte';
 let {api,dark=false,ontheme=()=>{},onopen=()=>{}}:{api:Api;dark?:boolean;ontheme?:()=>void;onopen?:(id:string)=>void}=$props();let systemTemplate=$state(DEFAULT_SETTINGS.systemPrompt);let settings=$state<Settings>({...DEFAULT_SETTINGS}),models=$state<ModelOption[]>([]),loading=$state(true),busy=$state(false),error=$state(''),saved=$state(false),loaded=$state(false);
 onMount(()=>{void load();});async function load(){loading=true;error='';try{const [value,options,prompts]=await Promise.all([api.request<Settings>('settings'),api.request<{models:ModelOption[]}>('models'),api.request<{texts:{systemTemplate:string}}>('prompts')]);systemTemplate=prompts.texts.systemTemplate;settings={...DEFAULT_SETTINGS,...value};models=options.models;loaded=true;}catch(e){error=(e as Error).message;}finally{loading=false;}}
 async function save(){busy=true;error='';saved=false;try{settings=await api.request<Settings>('settings','PUT',settings);saved=true;}catch(e){error=(e as Error).message;}finally{busy=false;}}
</script>
<header class="page-head"><div><h1>对话设置</h1></div><div class="actions"><Button variant="ghost" href="#about"><Info size={18} aria-hidden="true"/>关于</Button><Button variant="outline" onclick={ontheme} aria-label={dark?'切换浅色模式':'切换深色模式'}>{#if dark}<Sun size={18}/>{:else}<Moon size={18}/>{/if}主题</Button></div></header>
{#if error}<Notice variant="error">{error}<Button variant="outline" onclick={load}>重试</Button></Notice>{/if}{#if loading}<div class="empty" role="status">正在加载设置…</div>{:else if loaded}
 <form class="settings-form" onsubmit={e=>{e.preventDefault();void save();}} oninput={()=>saved=false}>
  <GenerationSettings bind:settings {models} disabled={busy}/>
  <section class="settings-section" aria-labelledby="identity-heading"><div class="section-heading"><div><UserRound size={18} aria-hidden="true"/><h2 id="identity-heading">角色设定</h2></div></div><div class="field"><label for="user-name">你的名字</label><Input id="user-name" bind:value={settings.userName} required maxlength={80} disabled={busy}/></div><div class="field"><label for="persona">你的角色设定</label><textarea id="persona" bind:value={settings.persona} rows="4" maxlength={12000} disabled={busy}></textarea></div><div class="field"><div class="field-heading"><label for="system-prompt">System Prompt</label><Button type="button" variant="ghost" disabled={busy} onclick={()=>{settings.systemPrompt=systemTemplate;saved=false;}}>恢复默认提示</Button></div><textarea id="system-prompt" bind:value={settings.systemPrompt} rows="4" required disabled={busy}></textarea></div></section>
  <div class="settings-save actions"><Button type="submit" disabled={busy}>{busy?'保存中…':'保存设置'}</Button>{#if saved}<Notice variant="success">已保存</Notice>{/if}</div>
 </form>
 <TelegramConnections {api} {onopen}/>
{/if}
