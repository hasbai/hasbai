<script lang="ts">
 import { onDestroy, untrack, type Snippet } from 'svelte';
 import { Button } from '@hasbai/ui/button';
 import { Input } from '@hasbai/ui/input';
 import { Notice } from '@hasbai/ui/notice';
 import * as Dialog from '@hasbai/ui/dialog';
 import { Sparkles, UserRound, BookOpen, MessageCircle, Plus, Trash2, Undo2, Upload } from '@lucide/svelte';
 import { CHARACTER_FIELDS, characterCard, characterDraft, emptyCharacterDraft, generatedCharacterCard, validateCharacterDraft, type CharacterDraft, type CharacterField } from '../../shared/character-draft';
 import type { Character, JsonObject } from '../../shared/types';
 import { avatarImage, MAX_AVATAR_BYTES } from '../../shared/avatar';
 import Avatar from './Avatar.svelte';
 import type { Api } from './api';
 let { api, character, mode = 'create', onsave, oncancel, actions }: { api: Api; character?: Character; mode?: 'create' | 'view' | 'edit'; onsave: (card: JsonObject, avatar?: File) => Promise<void>; oncancel: () => void; actions?: Snippet } = $props();
 const original = untrack(() => $state.snapshot(character?.card));
 const readonly = $derived(mode === 'view');
 let draft = $state<CharacterDraft>(untrack(() => original ? characterDraft(original) : emptyCharacterDraft())), brief = $state(''), tagText = $state(untrack(() => draft.tags.join('，')));
 let avatar = $state<File>(), avatarUrl = $state(''), avatarPrompt = $state(''), generatingAvatar = $state(false), uploadingAvatar = $state(false);
 let avatarInput = $state<HTMLInputElement>(null!);
 let generating = $state(false), saving = $state(false), error = $state(''), status = $state('');
 let previous = $state<CharacterDraft>(), previousTags = $state('');
 let controller: AbortController | undefined;
 const locked = $derived(generating || generatingAvatar || uploadingAvatar || saving);
 const canGenerate = $derived([brief, draft.name, draft.description, draft.personality, draft.scenario, draft.first_mes, draft.mes_example].some(text => text.trim()));
 onDestroy(() => controller?.abort());
 $effect(() => { const url = avatar ? URL.createObjectURL(avatar) : ''; avatarUrl = url; return () => { if (url) URL.revokeObjectURL(url); }; });
 async function uploadAvatar(event: Event) {
  const input = event.currentTarget as HTMLInputElement, file = input.files?.[0];
  if (!file || locked) return;
  error = ''; uploadingAvatar = true; const active = new AbortController(); controller = active;
  try {
   if (file.size > MAX_AVATAR_BYTES) throw Error('头像不能超过 5 MB');
   const image = avatarImage(new Uint8Array(await file.arrayBuffer()));
   if (!active.signal.aborted) avatar = new File([file], file.name, { type: image.type });
  } catch (e) { if (!active.signal.aborted) error = (e as Error).message; } finally { input.value = ''; uploadingAvatar = false; }
 }
 async function generateAvatar() {
  if (locked) return; error = '';
  const active = new AbortController(); controller = active; generatingAvatar = true;
  try {
   const prompt = avatarPrompt.trim() || [draft.name, draft.description, draft.personality, draft.scenario].filter(Boolean).join('，').slice(0, 1800);
   const image = await api.avatarDraft(prompt, active.signal);
   if (active.signal.aborted || controller !== active) return;
   avatar = new File([image], 'avatar.jpg', { type: image.type });
  } catch (e) { if (!active.signal.aborted) error = (e as Error).message; }
  finally { generatingAvatar = false; }
 }
 function snapshot() {
  return validateCharacterDraft({ ...$state.snapshot(draft), tags: tagText === draft.tags.join('，') ? [...draft.tags] : tagText.split(/[,，、\n]/).map(tag => tag.trim()).filter(Boolean) });
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
   status = '已生成';
  } catch (e) { if (!controller?.signal.aborted) error = e instanceof Error ? e.message : '生成失败，请重试'; }
  finally { generating = false; }
 }
 function undo() { if (!previous || locked) return; draft = previous; tagText = previousTags; previous = undefined; status = '已撤销生成'; error = ''; }
 async function save(event: SubmitEvent) {
  event.preventDefault(); if (locked || readonly) return;
  error = ''; status = '';
  try {
   const input = snapshot();
   if (!input.name.trim()) { error = '请填写角色名称'; return; }
   saving = true; await onsave(characterCard(input, original), avatar);
  } catch (e) { error = e instanceof Error ? e.message : '保存失败，请重试'; }
  finally { saving = false; }
 }
 const sections: { title: string; icon: typeof UserRound; fields: CharacterField[] }[] = [
  { title: '人物设定', icon: BookOpen, fields: ['description', 'personality', 'scenario'] },
  { title: '开场与对白', icon: MessageCircle, fields: ['first_mes', 'mes_example'] },
 ];
</script>

<Dialog.Header>
 <Dialog.Title class="creator-title">{readonly ? character?.name : mode === 'edit' ? '编辑角色' : '创建角色'}</Dialog.Title>
</Dialog.Header>
 {#if status}<div class="creator-feedback" role="status"><span>{status}</span>{#if previous}<Button type="button" variant="ghost" onclick={undo} disabled={locked}><Undo2 size={16} aria-hidden="true"/>撤销生成</Button>{/if}</div>{/if}
 {#if error}<Notice variant="error">{error}</Notice>{/if}
<form id="character-form" class="creator-scroll" onsubmit={save}>
 {#if !readonly}
 <section class="creator-ai">
  <label class="sr-only" for="character-brief">角色构想</label>
  <textarea id="character-brief" rows="2" bind:value={brief} disabled={locked} placeholder="角色构想"></textarea>
  <div class="creator-ai-actions"><Button type="button" variant="outline" onclick={generate} disabled={locked || !canGenerate}><Sparkles size={16} aria-hidden="true"/>{generating ? '正在生成…' : 'AI 生成'}</Button></div>
 </section>
 {/if}
 <fieldset disabled={locked} class="creator-fields">
  <section class="creator-section">
   <div class="creator-section-heading"><UserRound size={18} aria-hidden="true"/><h2>基本信息</h2></div>
   <div class="creator-identity">
    <div class="creator-avatar">{#if avatarUrl}<img src={avatarUrl} alt="角色头像" width="80" height="80"/>{:else if character}<Avatar {api} id={character.id} name={character.name} available={character.hasAvatar}/>{:else}<UserRound size={28} aria-hidden="true"/>{/if}</div>
    <div class="field"><label for="character-name">角色名称</label><Input id="character-name" bind:value={draft.name} {readonly}/></div>
   </div>
   {#if !readonly}
    <input class="sr-only" tabindex="-1" bind:this={avatarInput} type="file" accept="image/png,image/jpeg,image/webp" aria-label="上传头像" onchange={uploadAvatar}/>
    <div class="creator-avatar-actions"><Button type="button" variant="outline" onclick={() => avatarInput.click()}><Upload size={16} aria-hidden="true"/>上传头像</Button><Button type="button" variant="outline" disabled={locked || ![avatarPrompt, draft.name, draft.description].some(text => text.trim())} onclick={generateAvatar}><Sparkles size={16} aria-hidden="true"/>{generatingAvatar ? '生成头像中…' : 'AI 生成头像'}</Button>{#if avatar}<Button type="button" variant="ghost" onclick={() => avatar = undefined}>撤销头像</Button>{/if}</div>
    <div class="field"><label class="sr-only" for="avatar-prompt">头像描述</label><Input id="avatar-prompt" bind:value={avatarPrompt} maxlength={1800} placeholder="头像描述"/></div>
   {/if}
   <div class="field"><label for="character-tags">标签</label><Input id="character-tags" bind:value={tagText} {readonly}/></div>
  </section>
  {#each sections as section}
   <section class="creator-section"><div class="creator-section-heading"><section.icon size={18} aria-hidden="true"/><h2>{section.title}</h2></div>
    {#each section.fields as key}<div class="field"><label for={`character-${key}`}>{CHARACTER_FIELDS[key].label}</label><textarea id={`character-${key}`} bind:value={draft[key]} rows={key === 'description' || key === 'first_mes' ? 4 : 3} {readonly}></textarea></div>{/each}
    {#if section.title === '开场与对白'}
     <div class="creator-alternates"><div class="creator-section-heading"><h3>备选开场白</h3>{#if !readonly}<Button type="button" variant="ghost" onclick={() => draft.alternate_greetings = [...draft.alternate_greetings, '']}><Plus size={16} aria-hidden="true"/>添加</Button>{/if}</div>
      {#each draft.alternate_greetings as _, i}<div class="creator-alternate"><label class="sr-only" for={`character-greeting-${i}`}>备选开场白 {i+1}</label><textarea id={`character-greeting-${i}`} bind:value={draft.alternate_greetings[i]} rows="3" {readonly}></textarea>{#if !readonly}<Button type="button" variant="ghost" aria-label={`删除备选开场白 ${i+1}`} onclick={() => draft.alternate_greetings = draft.alternate_greetings.filter((_, index) => index !== i)}><Trash2 size={16}/></Button>{/if}</div>{/each}
     </div>
    {/if}
   </section>
  {/each}
  <details class="creator-advanced"><summary>作者与高级设定</summary><div class="creator-section"><div class="creator-two-fields">{#each ['creator', 'character_version'] as key}<div class="field"><label for={`character-${key}`}>{CHARACTER_FIELDS[key as CharacterField].label}</label><Input id={`character-${key}`} bind:value={draft[key as CharacterField]} {readonly}/></div>{/each}</div>{#each ['creator_notes', 'system_prompt', 'post_history_instructions'] as key}<div class="field"><label for={`character-${key}`}>{CHARACTER_FIELDS[key as CharacterField].label}</label><textarea id={`character-${key}`} bind:value={draft[key as CharacterField]} rows="3" {readonly}></textarea></div>{/each}</div></details>
 </fieldset>
 {#if readonly && character?.sourceUrl}<a href={character.sourceUrl} target="_blank" rel="noopener noreferrer">角色来源</a>{/if}
 {#if readonly && character?.unsupported.length}<div class="tags"><span>扩展仅保留</span>{#each character.unsupported as item}<span>{item}</span>{/each}</div>{/if}
</form>
<Dialog.Footer class="creator-footer">{#if readonly && actions}{@render actions()}{:else}<div class="actions"><Button type="button" variant="outline" disabled={saving} onclick={oncancel}>{generating || generatingAvatar ? '取消生成并关闭' : '取消'}</Button><Button type="submit" form="character-form" disabled={locked}>{saving ? '保存中…' : '保存角色'}</Button></div>{/if}</Dialog.Footer>
