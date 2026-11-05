<script lang="ts">
 import { Button } from '@hasbai/ui/button';
 import { Notice } from '@hasbai/ui/notice';
 import * as Dialog from '@hasbai/ui/dialog';
 import { Shuffle, Check } from '@lucide/svelte';
 import { parseCard } from '../../shared/cards';
 import type { Character } from '../../shared/types';
 let { character, onstart, oncancel }: { character: Character; onstart: (greeting: number) => Promise<boolean>; oncancel: () => void } = $props();
 const card = $derived(parseCard(character.card));
 const greetings = $derived([card.data.first_mes, ...card.data.alternate_greetings]);
 let selected = $state(-1), busy = $state(false), error = $state('');
 const preview = $derived(selected < 0 ? 0 : selected);
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
 {#if greetings.length > 1}
  <div class="greeting-options" role="group" aria-label="开场白选项">
   <button type="button" class="greeting-option" class:selected={selected===-1} aria-pressed={selected===-1} disabled={busy} onclick={()=>selected=-1}><Shuffle size={16}/><span>随机开场</span>{#if selected===-1}<Check size={15}/>{/if}</button>
   {#each greetings as _, index}
    <button type="button" class="greeting-option" class:selected={selected===index} aria-pressed={selected===index} disabled={busy} onclick={()=>selected=index}><span>开场白 {index+1}</span>{#if selected===index}<Check size={15}/>{/if}</button>
   {/each}
  </div>
 {/if}
 <div class="greeting-preview" aria-label="开场白预览">
  <div class="greeting-preview-heading"><span>开场白 {preview+1}</span>{#if selected===-1&&greetings.length>1}<span class="greeting-random-hint">创建时随机选择</span>{/if}</div>
  <div class="greeting-copy">{greetings[preview]||'空开场白'}</div>
 </div>
</div>
<Dialog.Footer><Button variant="outline" disabled={busy} onclick={oncancel}>取消</Button><Button disabled={busy} onclick={start}>{busy?'创建中…':'开始对话'}</Button></Dialog.Footer>
<style>
 .greeting-picker{display:flex;flex-direction:column;gap:16px;min-height:0;min-width:0;overflow:hidden}
 .greeting-options{display:flex;gap:8px;flex-wrap:wrap;flex-shrink:0;max-height:104px;overflow-y:auto;scrollbar-width:none}
 .greeting-options::-webkit-scrollbar{display:none}
 .greeting-option{display:inline-flex;align-items:center;justify-content:center;gap:8px;min-height:44px;padding:8px 14px;border:0;border-radius:12px;background:var(--muted);color:var(--muted-foreground);font:inherit;font-size:13px;cursor:pointer;transition:background .15s,color .15s}
 .greeting-option:hover{background:var(--accent);color:var(--foreground)}
 .greeting-option.selected{background:var(--primary);color:var(--primary-foreground)}
 .greeting-option.selected:hover{background:color-mix(in srgb,var(--primary) 85%,var(--card))}
 .greeting-option:disabled{opacity:.6;cursor:wait}
 .greeting-preview{display:flex;flex-direction:column;min-height:0;overflow:hidden;border-radius:16px;background:var(--muted);padding:20px}
 .greeting-preview-heading{display:flex;align-items:center;justify-content:space-between;gap:12px;flex-shrink:0;margin-bottom:12px;font-size:12px;font-weight:500;color:var(--muted-foreground)}
 .greeting-random-hint{font-weight:400;font-size:11px}
 .greeting-copy{min-height:0;max-height:min(38dvh,320px);overflow-y:auto;overscroll-behavior:contain;scrollbar-width:none;white-space:pre-wrap;overflow-wrap:anywhere;font-size:14px;line-height:1.9}
 .greeting-copy::-webkit-scrollbar{display:none}
 @media(max-width:640px){.greeting-preview{padding:16px}.greeting-options{gap:6px}.greeting-option{padding:8px 12px}}
 @media(max-height:600px){.greeting-picker{gap:12px}.greeting-preview{padding:14px}.greeting-copy{max-height:24dvh}.greeting-options{max-height:96px}}
 @media(prefers-reduced-motion:reduce){.greeting-option{transition:none}}
</style>
