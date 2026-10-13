<script lang="ts">
 import { onDestroy } from 'svelte';
 import { Button } from '@hasbai/ui/button';
 import { Input } from '@hasbai/ui/input';
 import { Notice } from '@hasbai/ui/notice';
 import * as Dialog from '@hasbai/ui/dialog';
 import { Sparkles, UserRound, BookOpen, MessageCircle, Plus, Trash2, Undo2 } from '@lucide/svelte';
 import { CHARACTER_FIELDS, characterCard, emptyCharacterDraft, generatedCharacterCard, validateCharacterDraft, type CharacterDraft, type CharacterField } from '../../shared/character-draft';
 import type { JsonObject } from '../../shared/types';
 import type { Api } from './api';
 let { api, onsave, oncancel }: { api: Api; onsave: (card: JsonObject) => Promise<void>; oncancel: () => void } = $props();
 let draft = $state<CharacterDraft>(emptyCharacterDraft()), brief = $state(''), tagText = $state('');
 let generating = $state(false), saving = $state(false), error = $state(''), status = $state('');
 let previous = $state<CharacterDraft>(), previousTags = $state('');
 let controller: AbortController | undefined;
 const locked = $derived(generating || saving);
 const canGenerate = $derived([brief, draft.name, draft.description, draft.personality, draft.scenario, draft.first_mes, draft.mes_example].some(text => text.trim()));
 onDestroy(() => controller?.abort());
 function snapshot() {
  return validateCharacterDraft({ ...$state.snapshot(draft), tags: tagText.split(/[,，、\n]/).map(tag => tag.trim()).filter(Boolean) });
 }
 async function generate() {
  if (locked) return;
  error = ''; status = '';
  try {
   const input = snapshot();
   generating = true; const active = new AbortController(); controller = active;
   const result = await api.request<{ card: JsonObject }>('characters/generate', 'POST', { brief, draft: input }, active.signal);
   if (active.signal.aborted || controller !== active) return;
   const card = generatedCharacterCard(result.card);
   const { extensions: _extensions, ...data } = card.data as JsonObject;
   previous = input; previousTags = tagText; draft = validateCharacterDraft(data); tagText = draft.tags.join('，');
   status = '已生成，可以继续修改后保存。';
  } catch (e) { if (!controller?.signal.aborted) error = e instanceof Error ? e.message : '生成失败，请重试'; }
  finally { generating = false; }
 }
 function undo() { if (!previous || locked) return; draft = previous; tagText = previousTags; previous = undefined; status = '已恢复生成前的内容。'; error = ''; }
 async function save(event: SubmitEvent) {
  event.preventDefault(); if (locked) return;
  error = ''; status = '';
  try {
   const input = snapshot();
   if (!input.name.trim()) { error = '请填写角色名称'; return; }
   saving = true; await onsave(characterCard(input));
  } catch (e) { error = e instanceof Error ? e.message : '保存失败，请重试'; }
  finally { saving = false; }
 }
 const sections: { title: string; icon: typeof UserRound; fields: CharacterField[] }[] = [
  { title: '人物设定', icon: BookOpen, fields: ['description', 'personality', 'scenario'] },
  { title: '开场与对白', icon: MessageCircle, fields: ['first_mes', 'mes_example'] },
 ];
 const hints: Partial<Record<CharacterField, string>> = { description: '身份、外貌、经历，以及你希望保留的设定', personality: '说话风格、动机、喜好与行为习惯', scenario: '故事发生在哪里？角色与你是什么关系？', first_mes: '角色第一次与你见面时的动作与台词', mes_example: '用几轮对白展示角色的语气与反应' };
</script>

<Dialog.Header>
 <Dialog.Title class="creator-title">创建角色</Dialog.Title>
 <Dialog.Description>填写或生成角色信息。</Dialog.Description>
</Dialog.Header>
 {#if generating}<p class="creator-feedback" role="status">正在完善人物设定与开场白…</p>{/if}
 {#if status}<div class="creator-feedback" role="status"><span>{status}</span>{#if previous}<Button type="button" variant="ghost" onclick={undo} disabled={locked}><Undo2 size={16} aria-hidden="true"/>撤销生成</Button>{/if}</div>{/if}
 {#if error}<Notice variant="error">{error}</Notice>{/if}
<form id="character-form" class="creator-scroll" onsubmit={save}>
 <section class="creator-ai" aria-labelledby="creator-ai-title">
  <div class="creator-section-heading"><Sparkles size={19} aria-hidden="true"/><h2 id="creator-ai-title">让灵感成形</h2></div>
  <label for="character-brief">生成要求 <span class="muted">选填</span></label>
  <textarea id="character-brief" rows="2" bind:value={brief} disabled={locked} placeholder="想要怎样的角色、故事氛围或互动方式？"></textarea>
  <div class="creator-ai-actions"><p>根据下方已填写的内容，补全角色设定。</p><Button type="button" variant="outline" onclick={generate} disabled={locked || !canGenerate}><Sparkles size={16} aria-hidden="true"/>{generating ? '正在生成…' : 'AI 生成'}</Button></div>
 </section>
 <fieldset disabled={locked} class="creator-fields">
  <section class="creator-section">
   <div class="creator-section-heading"><UserRound size={18} aria-hidden="true"/><h2>基本信息</h2></div>
   <div class="creator-identity"><div class="creator-initial" aria-hidden="true">{draft.name.trim().slice(0,1) || '✦'}</div><div class="field"><label for="character-name">角色名称 <span class="muted">必填</span></label><Input id="character-name" bind:value={draft.name} required placeholder="为角色取一个名字"/></div></div>
   <div class="field"><label for="character-tags">标签</label><Input id="character-tags" bind:value={tagText} placeholder="用逗号分隔"/></div>
  </section>
  {#each sections as section}
   <section class="creator-section"><div class="creator-section-heading"><section.icon size={18} aria-hidden="true"/><h2>{section.title}</h2></div>
    {#each section.fields as key}<div class="field"><label for={`character-${key}`}>{CHARACTER_FIELDS[key].label}</label><textarea id={`character-${key}`} bind:value={draft[key]} rows={key === 'description' || key === 'first_mes' ? 4 : 3} placeholder={hints[key]}></textarea></div>{/each}
    {#if section.title === '开场与对白'}
     <div class="creator-alternates"><div class="creator-section-heading"><h3>备选开场白</h3><Button type="button" variant="ghost" onclick={() => draft.alternate_greetings = [...draft.alternate_greetings, '']}><Plus size={16} aria-hidden="true"/>添加</Button></div>
      {#each draft.alternate_greetings as _, i}<div class="creator-alternate"><label class="sr-only" for={`character-greeting-${i}`}>备选开场白 {i+1}</label><textarea id={`character-greeting-${i}`} bind:value={draft.alternate_greetings[i]} rows="3"></textarea><Button type="button" variant="ghost" aria-label={`删除备选开场白 ${i+1}`} onclick={() => draft.alternate_greetings = draft.alternate_greetings.filter((_, index) => index !== i)}><Trash2 size={16}/></Button></div>{/each}
     </div>
    {/if}
   </section>
  {/each}
  <details class="creator-advanced"><summary>作者与高级设定</summary><div class="creator-section"><div class="creator-two-fields">{#each ['creator', 'character_version'] as key}<div class="field"><label for={`character-${key}`}>{CHARACTER_FIELDS[key as CharacterField].label}</label><Input id={`character-${key}`} bind:value={draft[key as CharacterField]}/></div>{/each}</div>{#each ['creator_notes', 'system_prompt', 'post_history_instructions'] as key}<div class="field"><label for={`character-${key}`}>{CHARACTER_FIELDS[key as CharacterField].label}</label><textarea id={`character-${key}`} bind:value={draft[key as CharacterField]} rows="3"></textarea></div>{/each}</div></details>
 </fieldset>
</form>
<Dialog.Footer class="creator-footer"><div class="actions"><Button type="button" variant="outline" disabled={saving} onclick={oncancel}>{generating ? '取消生成并关闭' : '取消'}</Button><Button type="submit" form="character-form" disabled={locked}>{saving ? '保存中…' : '保存角色'}</Button></div></Dialog.Footer>
