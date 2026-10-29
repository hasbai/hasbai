<script lang="ts">
 import { Button } from '@hasbai/ui/button';
 import { Notice } from '@hasbai/ui/notice';
 import * as Dialog from '@hasbai/ui/dialog';
 import { Shuffle, Check, ChevronLeft, ChevronRight, MessageCircle } from '@lucide/svelte';
 import { parseCard } from '../../shared/cards';
 import type { Character } from '../../shared/types';
 let { character, onstart, oncancel }: { character: Character; onstart: (greeting: number) => Promise<boolean>; oncancel: () => void } = $props();
 const card = $derived(parseCard(character.card));
 const greetings = $derived([card.data.first_mes, ...card.data.alternate_greetings]);
 let selected = $state(-1), busy = $state(false), error = $state('');
 let rail: HTMLDivElement;
 function move(direction: number) { rail.scrollBy({left: direction * rail.clientWidth * .8, behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'instant' : 'smooth'}); }
 async function start() {
  if (busy) return;
  busy = true; error = '';
  try { if (!await onstart(selected === -1 ? Math.floor(Math.random() * greetings.length) : selected)) error = '对话创建失败，请重试'; }
  catch (e) { error = e instanceof Error ? e.message : '对话创建失败，请重试'; }
  finally { busy = false; }
 }
</script>
<Dialog.Header><Dialog.Title>选择开场白</Dialog.Title><Dialog.Description>{character.name}</Dialog.Description></Dialog.Header>
{#if error}<Notice variant="error">{error}</Notice>{/if}
<div class="greeting-picker">
 <div class="greeting-toolbar"><span>{greetings.length} 个开场白</span><div><Button variant="ghost" size="icon" aria-label="上一个开场白" onclick={()=>move(-1)}><ChevronLeft size={20}/></Button><Button variant="ghost" size="icon" aria-label="下一个开场白" onclick={()=>move(1)}><ChevronRight size={20}/></Button></div></div>
 <div class="greeting-rail" bind:this={rail} role="group" aria-label="开场白卡片">
  {#each [-1, ...greetings.map((_, i)=>i)] as index}
   <button type="button" class="greeting-card" class:selected={selected===index} aria-pressed={selected===index} disabled={busy} onclick={()=>selected=index}>
    <span class="greeting-card-heading"><span class="greeting-icon">{#if index===-1}<Shuffle size={22}/>{:else}<MessageCircle size={22}/>{/if}</span><span>{index===-1?'随机开场':`开场白 ${index+1}`}</span><span class="greeting-check">{#if selected===index}<Check size={18}/>{/if}</span></span>
    <span class="greeting-copy">{index===-1?'新建会话时，随机使用一个开场白。':greetings[index]||'空开场白'}</span>
   </button>
  {/each}
 </div>
 <div class="greeting-dots" aria-hidden="true">{#each [-1, ...greetings.map((_, i)=>i)] as index}<span class:active={selected===index}></span>{/each}</div>
</div>
<Dialog.Footer><Button variant="outline" disabled={busy} onclick={oncancel}>取消</Button><Button disabled={busy} onclick={start}>{busy?'创建中…':'开始对话'}</Button></Dialog.Footer>
<style>
 .greeting-picker{min-width:0;overflow:hidden}.greeting-toolbar{display:flex;align-items:center;justify-content:space-between;color:var(--muted-foreground);font-size:.85rem}.greeting-toolbar>div{display:flex;gap:.25rem}.greeting-rail{display:flex;gap:1rem;overflow-x:auto;scroll-snap-type:x mandatory;padding:1rem .25rem 1.25rem;scrollbar-width:thin;overscroll-behavior-x:contain}.greeting-card{flex:0 0 82%;scroll-snap-align:center;display:flex;flex-direction:column;gap:1.5rem;text-align:left;border:1px solid var(--border);border-radius:1.25rem;padding:1.5rem;background:var(--card);color:var(--foreground);height:18rem;box-shadow:0 8px 24px rgb(0 0 0 / .04);transition:transform .25s,border-color .25s,box-shadow .25s,background .25s;animation:greeting-enter .35s ease-out both;cursor:pointer}.greeting-card:hover{transform:translateY(-3px)}.greeting-card.selected{border-color:var(--primary);background:color-mix(in srgb,var(--primary) 6%,var(--card));box-shadow:0 10px 28px color-mix(in srgb,var(--primary) 12%,transparent)}.greeting-card:focus-visible{outline:2px solid var(--primary);outline-offset:2px}.greeting-card-heading{display:flex;align-items:center;gap:.75rem;font-weight:600;width:100%}.greeting-icon{display:grid;place-items:center;width:44px;height:44px;border-radius:14px;background:color-mix(in srgb,var(--primary) 10%,var(--card));color:var(--primary)}.greeting-check{margin-left:auto;width:18px;color:var(--primary)}.greeting-copy{white-space:pre-wrap;overflow-y:auto;font-size:.95rem;line-height:1.85;font-weight:400;overflow-wrap:anywhere;min-height:0}.greeting-dots{display:flex;justify-content:center;gap:6px;padding:.25rem;flex-wrap:wrap}.greeting-dots span{width:6px;height:6px;border-radius:99px;background:var(--border);transition:width .25s,background .25s}.greeting-dots .active{width:22px;background:var(--primary)}@keyframes greeting-enter{from{opacity:0;transform:translateY(12px)}to{opacity:1;transform:translateY(0)}}@media(max-height:600px){.greeting-card{height:12rem;padding:1rem;gap:.75rem}}@media(prefers-reduced-motion:reduce){.greeting-card,.greeting-dots span{animation:none;transition:none}.greeting-card:hover{transform:none}}
</style>
